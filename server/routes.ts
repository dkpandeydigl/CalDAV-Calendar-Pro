import { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./database-storage";
import { 
  insertEventSchema, 
  insertCalendarSchema,
  insertServerConnectionSchema,
  insertCalendarSharingSchema,
  insertSmtpConfigSchema,
  type Event
} from "@shared/schema";
import { WebSocketServer } from "ws";
import { setupAuth } from "./auth";
import { createDAVClient } from "tsdav";
import { emailService } from "./email-service";
import { z } from "zod";
import { registerExportRoutes } from "./export-routes";
import { registerImportRoutes } from "./import-routes";
import fetch from "node-fetch";
import { generateThunderbirdCompatibleICS } from "./ical-utils";
import { syncService } from "./sync-service";

// Using directly imported syncService
import type { SyncService as SyncServiceType } from "./sync-service";

declare module 'express-session' {
  interface SessionData {
    recentlyDeletedEvents?: number[];
  }
}

declare module 'express' {
  interface User {
    id: number;
    username: string;
  }
  
  interface Request {
    session: session.Session & {
      recentlyDeletedEvents?: number[];
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);
  
  // Register the export and import routes
  registerExportRoutes(app);
  registerImportRoutes(app);
  
  function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  }
  
  function handleZodError(err: unknown, res: Response) {
    // Always set content type to ensure proper JSON response
    res.setHeader('Content-Type', 'application/json');
    
    try {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ errors: err.errors });
      }
      
      // Handle other error types
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      return res.status(500).json({ message: errorMessage });
    } catch (formatError) {
      // Final fallback if JSON formatting itself fails
      console.error("Error while formatting error response:", formatError);
      return res.status(500).json({ message: "Server error occurred" });
    }
  }
  
  // USERS API
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.filter((user: { id: number }) => user.id !== req.user!.id)); // Don't include the current user
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  
  // CALENDARS API
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendars = await storage.getCalendars(userId);
      res.json(calendars);
    } catch (err) {
      console.error("Error fetching calendars:", err);
      res.status(500).json({ message: "Failed to fetch calendars" });
    }
  });
  
  app.post("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertCalendarSchema.parse(calendarData);
      const newCalendar = await storage.createCalendar(validatedData);
      
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // EVENTS API
  app.get("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      let allEvents: Event[] = [];
      
      // Check if calendarIds is provided as an array in the query parameter
      if (req.query.calendarIds) {
        // Convert array-like string to actual array of numbers
        let calendarIds: number[] = [];
        
        if (Array.isArray(req.query.calendarIds)) {
          // Handle case when it's already an array in req.query
          calendarIds = req.query.calendarIds.map(id => parseInt(id as string)).filter(id => !isNaN(id));
        } else if (typeof req.query.calendarIds === 'string') {
          // Handle case when it's a JSON string array
          try {
            const parsed = JSON.parse(req.query.calendarIds);
            if (Array.isArray(parsed)) {
              calendarIds = parsed.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
            }
          } catch (e) {
            // If not a valid JSON, try comma-separated values
            calendarIds = req.query.calendarIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
          }
        }
        
        // Get events for each calendar ID
        if (calendarIds.length > 0) {
          for (const calendarId of calendarIds) {
            const calendarEvents = await storage.getEvents(calendarId);
            allEvents = [...allEvents, ...calendarEvents];
          }
          return res.json(allEvents);
        }
      }
      
      // If no calendarIds array, check for single calendarId
      if (req.query.calendarId) {
        const calendarId = parseInt(req.query.calendarId as string);
        
        if (isNaN(calendarId)) {
          return res.status(400).json({ message: "Invalid calendar ID" });
        }
        
        const events = await storage.getEvents(calendarId);
        return res.json(events);
      }
      
      // If no specific calendar ID is provided, return all events from user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      const allCalendars = [...userCalendars, ...sharedCalendars];
      
      for (const calendar of allCalendars) {
        const calendarEvents = await storage.getEvents(calendar.id);
        allEvents = [...allEvents, ...calendarEvents];
      }
      
      res.json(allEvents);
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });
  
  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Generate a unique UID for the event if not provided
      // Set syncStatus to pending to mark it for pushing to the server
      const eventData = {
        ...req.body,
        uid: req.body.uid || `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@caldavclient.local`,
        syncStatus: 'pending'
      };
      
      // Handle date conversions
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
      } else if (!eventData.startDate) {
        // If startDate is null/undefined, set it to the current date
        console.warn("Missing startDate in event creation, using current date");
        eventData.startDate = new Date();
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
      } else if (!eventData.endDate) {
        // If endDate is null/undefined, set it to 1 hour after startDate
        console.warn("Missing endDate in event creation, setting to 1 hour after startDate");
        const endDate = new Date(eventData.startDate.getTime());
        endDate.setHours(endDate.getHours() + 1);
        eventData.endDate = endDate;
      }
      
      // Validate that dates are valid
      if (isNaN(eventData.startDate.getTime())) {
        console.warn("Invalid startDate detected, using current date instead");
        eventData.startDate = new Date();
      }
      
      if (isNaN(eventData.endDate.getTime())) {
        console.warn("Invalid endDate detected, setting to 1 hour after startDate");
        const endDate = new Date(eventData.startDate.getTime());
        endDate.setHours(endDate.getHours() + 1);
        eventData.endDate = endDate;
      }
      
      // For all-day events, ensure the dates are properly formatted
      if (eventData.allDay === true) {
        // CRITICAL FIX: Preserve the selected date for all-day events
        console.log(`[BACKEND DATE DEBUG] Original date values:`, {
          startDate: eventData.startDate.toISOString(),
          endDate: eventData.endDate.toISOString()
        });
        
        // Get the date components (year, month, day) while preserving the actual calendar date
        const startYear = eventData.startDate.getFullYear();
        const startMonth = eventData.startDate.getMonth();
        const startDay = eventData.startDate.getDate();
        
        // Create a new date with the same YMD but at midnight
        const startDate = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
        eventData.startDate = startDate;
        
        // Similarly for end date
        const endYear = eventData.endDate.getFullYear();
        const endMonth = eventData.endDate.getMonth();
        const endDay = eventData.endDate.getDate();
        
        // For all-day events, end date should be midnight of the next day per CalDAV convention
        const endDate = new Date(endYear, endMonth, endDay, 0, 0, 0, 0);
        
        // If start and end date are the same, set end date to the next day
        if (startDate.getTime() === endDate.getTime()) {
          endDate.setDate(endDate.getDate() + 1);
        }
        
        eventData.endDate = endDate;
        
        console.log(`[BACKEND DATE DEBUG] Adjusted date values for all-day event:`, {
          startDate: eventData.startDate.toISOString(),
          endDate: eventData.endDate.toISOString()
        });
      }
      
      // Convert arrays to JSON strings
      if (eventData.attendees && Array.isArray(eventData.attendees)) {
        eventData.attendees = JSON.stringify(eventData.attendees);
      }
      
      if (eventData.resources && Array.isArray(eventData.resources)) {
        eventData.resources = JSON.stringify(eventData.resources);
      }
      
      const validatedData = insertEventSchema.parse(eventData);
      const newEvent = await storage.createEvent(validatedData);
      
      res.status(201).json(newEvent);
    } catch (err) {
      console.error("Error creating event:", err);
      return handleZodError(err, res);
    }
  });
  
  // Delete an event
  app.delete("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      // Get the existing event to check if it has a URL and etag (meaning it exists on the server)
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // If the event exists on the server, we should try to delete it there too
      if (event.url && event.etag) {
        try {
          // Get the user's server connection
          const userId = req.user!.id;
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client
            const { DAVClient } = await import('tsdav');
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            // Login to the server
            await davClient.login();
            
            // Try to delete the event on the server
            await davClient.deleteCalendarObject({
              calendarObject: {
                url: event.url,
                etag: event.etag
              }
            });
            
            console.log(`Successfully deleted event ${eventId} from CalDAV server`);
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete event on server`);
          }
        } catch (error) {
          console.error(`Error deleting event ${eventId} from CalDAV server:`, error);
          // Continue with local deletion even if server deletion fails
        }
      }
      
      // Delete the event locally
      const success = await storage.deleteEvent(eventId);
      
      // Track deleted events in session to avoid re-syncing them
      if (!req.session.recentlyDeletedEvents) {
        req.session.recentlyDeletedEvents = [];
      }
      req.session.recentlyDeletedEvents.push(eventId);
      
      if (success) {
        return res.status(200).json({ message: "Event deleted successfully" });
      } else {
        return res.status(500).json({ message: "Failed to delete event" });
      }
    } catch (err) {
      console.error("Error deleting event:", err);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });
  
  // Utility endpoint to cleanup duplicate untitled events
  app.post("/api/cleanup-duplicate-events", isAuthenticated, async (req, res) => {
    try {
      const { date, calendarId } = req.body;
      
      if (!date || !calendarId) {
        return res.status(400).json({ error: 'Missing date or calendarId parameter' });
      }
      
      console.log(`Cleaning up untitled events for date ${date} and calendar ${calendarId}`);
      
      // Get all events for the calendar
      const allEvents = await storage.getEvents(calendarId);
      console.log(`Total events in calendar ${calendarId}: ${allEvents.length}`);
      
      // Find all Untitled Events on the specified date
      const targetDateStr = new Date(date).toISOString().split('T')[0]; // Get just the date part
      console.log(`Looking for events on date: ${targetDateStr}`);
      
      // Find all untitled events (any case variations)
      const untitledEvents = allEvents.filter(event => {
        try {
          // Handle both null dates and actual dates
          let eventDate = null;
          if (event.startDate) {
            const eventDateObj = new Date(event.startDate);
            eventDate = isNaN(eventDateObj.getTime()) ? null : eventDateObj.toISOString().split('T')[0];
          }
          
          // Check for any case variations of "Untitled Event"
          const isTitleMatch = event.title && 
                               (event.title.toLowerCase() === 'untitled event' || 
                                event.title === 'Untitled Event');
          
          const isDateMatch = eventDate === targetDateStr;
          
          // Debug output
          if (isTitleMatch) {
            console.log(`Found untitled event: ID=${event.id}, title="${event.title}", date=${eventDate}, matches=${isDateMatch}`);
          }
          
          return isTitleMatch && isDateMatch;
        } catch (error) {
          console.error(`Error processing event ${event.id}:`, error);
          return false;
        }
      });
      
      console.log(`Found ${untitledEvents.length} untitled events for date ${targetDateStr}`);
      
      // Always attempt to clean up any duplicate "Untitled Event" entries,
      // even if there's only one per calendar - they might be duplicates across different calendars
      if (untitledEvents.length >= 1) {
        // Sort by ID to get the oldest one (first created)
        untitledEvents.sort((a, b) => a.id - b.id);
        
        // Keep the first one, delete the rest
        const eventsToDelete = untitledEvents.slice(1);
        
        if (eventsToDelete.length > 0) {
          console.log(`Deleting ${eventsToDelete.length} duplicate untitled events:`, eventsToDelete.map(e => e.id));
          
          for (const event of eventsToDelete) {
            console.log(`Deleting untitled event ID: ${event.id}`);
            await storage.deleteEvent(event.id);
          }
          
          // Also attempt to clean up the event from the server
          if (req.user) {
            syncService.syncNow(req.user.id).catch(err => {
              console.error('Error during sync after cleanup:', err);
            });
          }
          
          return res.json({ 
            success: true, 
            message: `Deleted ${eventsToDelete.length} duplicate untitled events.`,
            deletedIds: eventsToDelete.map(e => e.id)
          });
        } else {
          // If all calendars have been checked and we've deleted everything we can,
          // check if there are still outstanding untitled events
          console.log(`No more duplicate untitled events to clean on this calendar.`);
          
          return res.json({ 
            success: true, 
            message: 'No more duplicate untitled events found to clean up.'
          });
        }
      } else {
        return res.json({ 
          success: true, 
          message: 'No untitled events found to clean up.'
        });
      }
    } catch (err) {
      console.error('Error cleaning up duplicate events:', err);
      res.status(500).json({ error: 'Failed to cleanup duplicate events' });
    }
  });
  
  app.put("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      // Get the existing event
      const existingEvent = await storage.getEvent(eventId);
      if (!existingEvent) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Process the update data
      const updateData = { ...req.body };
      
      // Handle date conversions
      if (typeof updateData.startDate === 'string') {
        updateData.startDate = new Date(updateData.startDate);
      } else if (updateData.startDate === null || updateData.startDate === undefined) {
        // Keep existing startDate if not provided
        updateData.startDate = existingEvent.startDate;
      }
      
      if (typeof updateData.endDate === 'string') {
        updateData.endDate = new Date(updateData.endDate);
      } else if (updateData.endDate === null || updateData.endDate === undefined) {
        // Keep existing endDate if not provided
        updateData.endDate = existingEvent.endDate;
      }
      
      // Validate that dates are valid
      if (updateData.startDate && isNaN(updateData.startDate.getTime())) {
        console.warn("Invalid startDate detected in update, keeping existing value");
        updateData.startDate = existingEvent.startDate;
      }
      
      if (updateData.endDate && isNaN(updateData.endDate.getTime())) {
        console.warn("Invalid endDate detected in update, keeping existing value");
        updateData.endDate = existingEvent.endDate;
      }
      
      // For all-day events, ensure the dates are properly formatted
      if (updateData.allDay === true) {
        // CRITICAL FIX: Preserve the selected date for all-day events in updates too
        console.log(`[BACKEND DATE DEBUG] Event update - Original date values:`, {
          startDate: updateData.startDate ? updateData.startDate.toISOString() : null,
          endDate: updateData.endDate ? updateData.endDate.toISOString() : null
        });
        
        if (updateData.startDate) {
          // Get the date components (year, month, day) while preserving the actual calendar date
          const startYear = updateData.startDate.getFullYear();
          const startMonth = updateData.startDate.getMonth();
          const startDay = updateData.startDate.getDate();
          
          // Create a new date with the same YMD but at midnight
          const startDate = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
          updateData.startDate = startDate;
        }
        
        if (updateData.endDate) {
          // Similarly for end date
          const endYear = updateData.endDate.getFullYear();
          const endMonth = updateData.endDate.getMonth();
          const endDay = updateData.endDate.getDate();
          
          // For all-day events, end date should be midnight per CalDAV convention
          const endDate = new Date(endYear, endMonth, endDay, 0, 0, 0, 0);
          
          // If start and end date are the same, set end date to the next day
          if (updateData.startDate && 
              endDate.getTime() === updateData.startDate.getTime()) {
            endDate.setDate(endDate.getDate() + 1);
          }
          
          updateData.endDate = endDate;
        }
        
        console.log(`[BACKEND DATE DEBUG] Event update - Adjusted date values:`, {
          startDate: updateData.startDate ? updateData.startDate.toISOString() : null,
          endDate: updateData.endDate ? updateData.endDate.toISOString() : null
        });
      }
      
      // Convert arrays to JSON strings
      if (updateData.attendees && Array.isArray(updateData.attendees)) {
        updateData.attendees = JSON.stringify(updateData.attendees);
      }
      
      if (updateData.resources && Array.isArray(updateData.resources)) {
        updateData.resources = JSON.stringify(updateData.resources);
      }
      
      // Always set sync status to 'pending' for updated events to push changes to the server
      updateData.syncStatus = 'pending';
      updateData.lastSyncAttempt = new Date();
      
      // Update the event
      const updatedEvent = await storage.updateEvent(eventId, updateData);
      
      // Check if the event has attendees to determine if email workflow is needed
      let hasAttendees = false;
      
      if (updateData.attendees) {
        const attendeesArray = JSON.parse(typeof updateData.attendees === 'string' 
          ? updateData.attendees 
          : JSON.stringify(updateData.attendees));
        hasAttendees = Array.isArray(attendeesArray) && attendeesArray.length > 0;
      } else if (existingEvent.attendees) {
        const attendeesArray = JSON.parse(typeof existingEvent.attendees === 'string'
          ? existingEvent.attendees
          : JSON.stringify(existingEvent.attendees));
        hasAttendees = Array.isArray(attendeesArray) && attendeesArray.length > 0;
      }
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json({ 
        success: true, 
        event: updatedEvent,
        hasAttendees
      });
    } catch (err) {
      console.error("Error updating event:", err);
      return handleZodError(err, res);
    }
  });
  
  // CALENDAR SHARING API
  app.get("/api/shared-calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const sharedCalendars = await storage.getSharedCalendars(userId);
      res.setHeader('Content-Type', 'application/json');
      res.json(sharedCalendars);
    } catch (err) {
      console.error("Error fetching shared calendars:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch shared calendars" });
    }
  });
  
  app.post("/api/calendar-sharing", isAuthenticated, async (req, res) => {
    try {
      const sharingData = {
        ...req.body,
        sharedByUserId: req.user!.id
      };
      
      const validatedData = insertCalendarSharingSchema.parse(sharingData);
      const newSharing = await storage.shareCalendar(validatedData);
      
      res.status(201).json(newSharing);
    } catch (err) {
      console.error("Error sharing calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // SERVER CONNECTION API
  app.get("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connection = await storage.getServerConnection(userId);
      res.setHeader('Content-Type', 'application/json');
      res.json(connection || null);
    } catch (err) {
      console.error("Error fetching server connection:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch server connection" });
    }
  });
  
  app.post("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connectionData = {
        ...req.body,
        userId,
        status: 'pending'
      };
      
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      const newConnection = await storage.createServerConnection(validatedData);
      
      res.status(201).json(newConnection);
    } catch (err) {
      console.error("Error creating server connection:", err);
      return handleZodError(err, res);
    }
  });
  
  // SMTP CONFIG API
  app.get("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const config = await storage.getSmtpConfig(userId);
      res.setHeader('Content-Type', 'application/json');
      res.json(config || null);
    } catch (err) {
      console.error("Error fetching SMTP config:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch SMTP config" });
    }
  });
  
  app.post("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const configData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertSmtpConfigSchema.parse(configData);
      const newConfig = await storage.createSmtpConfig(validatedData);
      
      res.status(201).json(newConfig);
    } catch (err) {
      console.error("Error creating SMTP config:", err);
      return handleZodError(err, res);
    }
  });
  
  // EMAIL PREVIEW API
  app.post("/api/email-preview", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      await emailService.initialize(userId);
      
      const previewHtml = emailService.generateEmailPreview(req.body);
      res.setHeader('Content-Type', 'application/json');
      res.json({ html: previewHtml });
    } catch (err) {
      console.error("Error generating email preview:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to generate email preview" });
    }
  });
  
  // EMAIL SENDING API  
  app.post("/api/send-email", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      
      if (!user?.email) {
        return res.status(400).json({ 
          message: "User email not available. Please update your profile with a valid email."
        });
      }
      
      // Get the event data from the request
      const { 
        eventId,
        title, 
        description, 
        location, 
        startDate, 
        endDate, 
        attendees,
        resources,
        recurrenceRule
      } = req.body;
      
      // Validate required fields
      if (!title || !startDate || !endDate || !attendees) {
        return res.status(400).json({
          message: "Missing required fields (title, startDate, endDate, attendees)"
        });
      }
      
      // Parse the attendees if they're sent as a string
      let parsedAttendees;
      try {
        parsedAttendees = typeof attendees === 'string' ? JSON.parse(attendees) : attendees;
        if (!Array.isArray(parsedAttendees)) {
          throw new Error("Attendees must be an array");
        }
      } catch (error) {
        return res.status(400).json({
          message: "Invalid attendees format",
          error: (error instanceof Error) ? error.message : String(error)
        });
      }
      
      // Initialize with the user's SMTP configuration
      const initialized = await emailService.initialize(userId);
      
      if (!initialized) {
        return res.status(500).json({
          success: false,
          message: "Failed to initialize email service. Please check your SMTP configuration."
        });
      }
      
      // Format the dates to make them valid Date objects
      let parsedStartDate, parsedEndDate;
      try {
        parsedStartDate = new Date(startDate);
        parsedEndDate = new Date(endDate);
        
        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
          throw new Error("Invalid date format");
        }
      } catch (error) {
        return res.status(400).json({
          message: "Invalid date format",
          error: (error instanceof Error) ? error.message : String(error)
        });
      }
      
      // Use provided eventId or generate a unique ID for this event
      const uid = eventId ? `event-${eventId}@caldavclient.local` : `manual-send-${Date.now()}@caldavclient.local`;
      
      // If this is for an existing event, update the emailSent status
      if (eventId) {
        try {
          const event = await storage.getEvent(eventId);
          if (event) {
            await storage.updateEvent(eventId, { 
              emailSent: new Date().toISOString(), // Use ISO string for timestamp
              emailError: null
            });
          }
        } catch (error) {
          console.error(`Failed to update email status for event ${eventId}:`, error);
          // Continue anyway - we still want to try sending the email
        }
      }
      
      // Parse resources if they're sent as a string
      let parsedResources = [];
      if (resources) {
        try {
          parsedResources = typeof resources === 'string' ? JSON.parse(resources) : resources;
          if (!Array.isArray(parsedResources)) {
            throw new Error("Resources must be an array");
          }
        } catch (error) {
          return res.status(400).json({
            message: "Invalid resources format",
            error: (error instanceof Error) ? error.message : String(error)
          });
        }
      }
      
      // Prepare the event invitation data
      const invitationData = {
        eventId: eventId || 0,
        uid,
        title,
        description,
        location,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        organizer: {
          email: user.email,
          name: user.username || undefined
        },
        attendees: parsedAttendees.map((a: any) => ({
          email: a.email,
          name: a.name || undefined,
          role: a.role || undefined
        })),
        resources: parsedResources.length > 0 ? parsedResources : undefined,
        recurrenceRule: recurrenceRule || undefined
      };
      
      // Send the event invitation
      const result = await emailService.sendEventInvitation(userId, invitationData);
      
      // Return the result to the client
      res.setHeader('Content-Type', 'application/json');
      return res.status(result.success ? 200 : 500).json(result);
    } catch (err) {
      console.error("Error sending email:", err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ 
        success: false, 
        message: err instanceof Error ? err.message : "An unknown error occurred", 
        details: err 
      });
    }
  });
  
  // MANUAL SYNC API
  app.post("/api/sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Import syncService directly from the module, no need to access from global
      
      // Extract options
      const forceRefresh = req.body.forceRefresh === true;
      const calendarId = req.body.calendarId || null;
      
      // Request a sync
      console.log(`Sync requested for user ID ${userId} with options:`, { forceRefresh, calendarId });
      
      // If user doesn't have a sync job, set one up
      const syncStatus = syncService.getSyncStatus(userId);
      if (!syncStatus.configured) {
        // Get server connection 
        const connection = await storage.getServerConnection(userId);
        
        if (!connection) {
          return res.status(400).json({ message: "No server connection found for this user" });
        }
        
        // Try to set up sync job
        const setupResult = await syncService.setupSyncForUser(userId, connection);
        if (!setupResult) {
          return res.status(500).json({ message: "Failed to set up sync job" });
        }
      }
      
      // Trigger an immediate sync
      const success = await syncService.requestSync(userId, { forceRefresh, calendarId });
      
      res.setHeader('Content-Type', 'application/json');
      if (success) {
        res.json({ message: "Sync initiated" });
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ message: "Failed to initiate sync" });
      }
    } catch (err) {
      console.error("Error initiating sync:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to initiate sync" });
    }
  });
  
  // PUSH LOCAL EVENTS ENDPOINT
  app.post("/api/sync/push-local", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarId = req.body.calendarId ? parseInt(req.body.calendarId) : undefined;
      
      console.log(`Push local events requested for userId=${userId}, calendarId=${calendarId}`);
      
      // Check if user has a server connection configured
      const connection = await storage.getServerConnection(userId);
      if (!connection) {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Cannot push events (no server connection configured)",
          pushed: false,
          requiresConnection: true
        });
      }
      
      // Check connection status
      if (connection.status !== 'connected') {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Cannot push events (server connection not active)",
          pushed: false,
          requiresConnection: true
        });
      }

      // Setup sync job if needed
      const syncStatus = syncService.getSyncStatus(userId);
      if (!syncStatus.configured) {
        const setupResult = await syncService.setupSyncForUser(userId, connection);
        if (!setupResult) {
          return res.status(500).json({ 
            message: "Failed to set up sync job",
            pushed: false
          });
        }
      }
      
      // Push local events to the server
      const success = await syncService.pushLocalEvents(userId, calendarId);
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      
      if (success) {
        return res.status(200).json({
          message: "Successfully pushed local events to server",
          pushed: true
        });
      } else {
        return res.status(500).json({
          message: "Failed to push local events to server",
          pushed: false
        });
      }
    } catch (err) {
      console.error("Error pushing local events:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ 
        message: "Failed to push local events",
        pushed: false,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });
  
  // IMMEDIATE SYNC ENDPOINT
  app.post("/api/sync/now", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const forceRefresh = req.body.forceRefresh === true;
      const calendarId = req.body.calendarId ? parseInt(req.body.calendarId) : null;
      
      console.log(`Immediate sync requested for userId=${userId}, calendarId=${calendarId}, forceRefresh=${forceRefresh}`);
      
      // Check if user has a server connection configured
      const connection = await storage.getServerConnection(userId);
      if (!connection) {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Changes saved locally but not synced (no server connection configured)",
          synced: false,
          requiresConnection: true,
          sync: {
            attempted: false,
            succeeded: false,
            noConnection: true,
            error: "Server connection required to sync with CalDAV server"
          }
        });
      }
      
      // Check connection status
      if (connection.status !== 'connected') {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Changes saved locally but not synced (server connection not active)",
          synced: false,
          requiresConnection: true,
          sync: {
            attempted: false,
            succeeded: false,
            noConnection: true,
            error: "Server connection is not active"
          }
        });
      }

      // This will trigger a sync right away with the specified options
      const success = await syncService.syncNow(userId, { forceRefresh, calendarId });
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      
      if (success) {
        res.json({ 
          message: "Sync triggered successfully", 
          synced: true,
          sync: {
            attempted: true,
            succeeded: true,
            noConnection: false
          }
        });
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.status(202).json({ 
          message: "Changes saved locally but sync to server failed",
          synced: false,
          sync: {
            attempted: true,
            succeeded: false,
            noConnection: false,
            error: "Sync operation failed"
          }
        });
      }
    } catch (err) {
      console.error("Error in immediate sync:", err);
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      res.status(202).json({ 
        message: "Changes saved locally but sync to server failed with error",
        synced: false,
        sync: {
          attempted: true,
          succeeded: false,
          noConnection: false,
          error: err instanceof Error ? err.message : "Unknown error during sync"
        }
      });
    }
  });
  
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Add WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data);
        
        // Echo back
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({ echo: data }));
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    // Send a welcome message
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ message: 'Connected to server' }));
    }
  });
  
  return httpServer;
}
