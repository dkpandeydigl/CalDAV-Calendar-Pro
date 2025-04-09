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
      const eventData = {
        ...req.body,
        uid: req.body.uid || `${Date.now()}-${Math.floor(Math.random() * 1000000)}@caldavclient`
      };
      
      // Handle date conversions
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
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
  
  // Update an existing event
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
      }
      
      if (typeof updateData.endDate === 'string') {
        updateData.endDate = new Date(updateData.endDate);
      }
      
      // Convert arrays to JSON strings
      if (updateData.attendees && Array.isArray(updateData.attendees)) {
        updateData.attendees = JSON.stringify(updateData.attendees);
      }
      
      if (updateData.resources && Array.isArray(updateData.resources)) {
        updateData.resources = JSON.stringify(updateData.resources);
      }
      
      // Update with sync status
      updateData.syncStatus = updateData.syncStatus || 'pending';
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
      res.json(sharedCalendars);
    } catch (err) {
      console.error("Error fetching shared calendars:", err);
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
      res.json(connection || null);
    } catch (err) {
      console.error("Error fetching server connection:", err);
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
      res.json(config || null);
    } catch (err) {
      console.error("Error fetching SMTP config:", err);
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
      res.json({ html: previewHtml });
    } catch (err) {
      console.error("Error generating email preview:", err);
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
        resources
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
              emailSent: 'sent', // Use string value instead of Date since the schema defines it as text
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
        resources: parsedResources.length > 0 ? parsedResources : undefined
      };
      
      // Send the event invitation
      const result = await emailService.sendEventInvitation(userId, invitationData);
      
      // Return the result to the client
      return res.status(result.success ? 200 : 500).json(result);
    } catch (err) {
      console.error("Error sending email:", err);
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
      
      if (success) {
        res.json({ message: "Sync initiated" });
      } else {
        res.status(500).json({ message: "Failed to initiate sync" });
      }
    } catch (err) {
      console.error("Error initiating sync:", err);
      res.status(500).json({ message: "Failed to initiate sync" });
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
