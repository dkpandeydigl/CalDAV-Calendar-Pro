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
import { WebSocketServer, WebSocket } from "ws";
import { setupAuth } from "./auth";
import { DAVClient } from "tsdav";
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
  
  // Create the HTTP server
  const httpServer = createServer(app);
  
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
      
      // First check if the user has a server connection
      const connection = await storage.getServerConnection(userId);
      
      if (connection && connection.status === 'connected') {
        try {
          // Create the calendar on the server first
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
          
          // Get the calendars from the server to determine the base URL structure
          const calendars = await davClient.fetchCalendars();
          if (calendars && calendars.length > 0) {
            // Extract the base URL from the first calendar's URL
            // For davical, this is usually something like /caldav.php/username/
            let homeUrl = '';
            
            for (const cal of calendars) {
              if (cal.url && cal.url.includes('/caldav.php/')) {
                const parts = cal.url.split('/');
                // Find the index of caldav.php
                const caldavIndex = parts.findIndex(p => p === 'caldav.php');
                if (caldavIndex >= 0 && caldavIndex + 1 < parts.length) {
                  // Extract up to the username part (which is usually after caldav.php)
                  homeUrl = parts.slice(0, caldavIndex + 2).join('/') + '/';
                  break;
                }
              }
            }
            
            if (!homeUrl) {
              // If we couldn't parse from existing calendars, try to construct from username
              homeUrl = `${connection.url.replace(/\/?$/, '')}/caldav.php/${connection.username}/`;
            }
            
            console.log(`Attempting to create calendar "${validatedData.name}" on CalDAV server at ${homeUrl}`);
            
            // For DaviCal, which is the server we're using, we need to construct the URL correctly
            // The URL pattern is usually /caldav.php/username/calendarname/
            if (homeUrl.includes('/caldav.php/')) {
              // Extract the base URL up to the username part
              const baseUrl = homeUrl.substring(0, homeUrl.lastIndexOf('/') + 1);
              
              // Create a URL-safe version of the calendar name
              const safeCalendarName = encodeURIComponent(validatedData.name.toLowerCase().replace(/\s+/g, '-'));
              
              // Construct the new calendar URL
              const newCalendarUrl = `${baseUrl}${safeCalendarName}/`;
              
              try {
                // Create the calendar on the server
                await davClient.makeCalendar({
                  url: newCalendarUrl,
                  props: {
                    displayname: validatedData.name,
                    color: validatedData.color
                  }
                });
                
                console.log(`Successfully created calendar "${validatedData.name}" on CalDAV server at ${newCalendarUrl}`);
                
                // Save the URL in our database
                validatedData.url = newCalendarUrl;
              } catch (makeCalendarError) {
                console.error(`Error creating calendar on server:`, makeCalendarError);
                // Continue with local creation even if server creation fails
              }
            } else {
              console.log(`Calendar home URL does not match expected DaviCal pattern: ${homeUrl}`);
            }
          } else {
            console.log('Could not find calendar home set');
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local creation even if server connection fails
        }
      }
      
      // Create the calendar locally
      const newCalendar = await storage.createCalendar(calendarData);
      
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });

  // Update a calendar
  app.put("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      const userId = req.user!.id;
      
      // Get the existing calendar to check ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if the user owns this calendar
      if (existingCalendar.userId !== userId) {
        return res.status(403).json({ message: "You don't have permission to modify this calendar" });
      }
      
      // Set content type header explicitly to ensure JSON response
      res.setHeader('Content-Type', 'application/json');
      
      // If this calendar exists on the CalDAV server and we're changing its properties
      // Note that some properties (like color) can be changed locally without affecting the server
      if (existingCalendar.url && 
          (req.body.name !== undefined && req.body.name !== existingCalendar.name)) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client using import
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
            
            // Try to update the calendar on the server
            // Note: Not all CalDAV servers support renaming calendars through the API
            // We can try but we'll continue with the local update even if it fails
            try {
              // Attempt to update properties - this is highly server-dependent
              if (existingCalendar.url.includes('/caldav.php/')) {
                // For DaviCal-based servers, updating calendar properties is limited
                console.log(`Server appears to be DaviCal-based, calendar renaming may not be supported`);
                
                // For DaviCal, we would need to use PROPPATCH - but it's usually limited
                // Most DaviCal servers restrict this operation
              } else {
                // For other CalDAV servers, try standard PROPPATCH
                console.log(`Attempting to update calendar "${existingCalendar.name}" to "${req.body.name}" on CalDAV server`);
                
                // Since we can't directly access updateCalendar, we'll use davRequest with PROPPATCH
                await davClient.davRequest({
                  url: existingCalendar.url,
                  init: {
                    method: 'PROPPATCH',
                    headers: {
                      'Content-Type': 'application/xml; charset=utf-8',
                    },
                    body: `<?xml version="1.0" encoding="utf-8" ?>
                      <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                        <D:set>
                          <D:prop>
                            <D:displayname>${req.body.name}</D:displayname>
                          </D:prop>
                        </D:set>
                      </D:propertyupdate>`
                  }
                });
                
                console.log(`Successfully sent update request to CalDAV server`);
              }
            } catch (calendarUpdateError) {
              console.error(`Error updating calendar on server:`, calendarUpdateError);
              // Continue with local update even if server update fails
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't update calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local update even if server connection fails
        }
      }
      
      // Update the calendar locally
      const updatedCalendar = await storage.updateCalendar(calendarId, req.body);
      
      // Return the updated calendar
      if (updatedCalendar) {
        res.json(updatedCalendar);
      } else {
        res.status(500).json({ message: "Failed to update calendar" });
      }
    } catch (err) {
      console.error("Error updating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // Delete a calendar
  app.delete("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      const userId = req.user!.id;
      
      // Get the existing calendar to check ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if the user owns this calendar
      if (existingCalendar.userId !== userId) {
        return res.status(403).json({ message: "You don't have permission to delete this calendar" });
      }
      
      // Set content type header explicitly to ensure JSON response
      res.setHeader('Content-Type', 'application/json');
      
      // If this calendar has a URL, try to delete it from the CalDAV server first
      if (existingCalendar.url) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client using import
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
            
            // Try to delete the calendar on the server
            // Note: This is dependent on the server supporting calendar deletion
            // Some CalDAV servers might restrict this operation
            try {
              console.log(`Attempting to delete calendar "${existingCalendar.name}" from CalDAV server`);
              
              // For a full calendar deletion, we need to delete all events first
              const calendarEvents = await storage.getEvents(calendarId);
              console.log(`Found ${calendarEvents.length} events to remove from server`);
              
              // Delete each event that has a URL and etag
              for (const event of calendarEvents) {
                if (event.url && event.etag) {
                  try {
                    await davClient.deleteCalendarObject({
                      calendarObject: {
                        url: event.url,
                        etag: event.etag
                      }
                    });
                    console.log(`Deleted event "${event.title}" (ID: ${event.id}) from server`);
                  } catch (eventDeleteError) {
                    console.error(`Error deleting event ${event.id} from server:`, eventDeleteError);
                    // Continue with other events even if one fails
                  }
                }
              }
              
              // Some servers support calendar deletion, but it's not universally supported
              // This might throw an error on servers that don't allow it
              if (existingCalendar.url.includes('/caldav.php/')) {
                // For DaviCal servers, we need to try different approaches
                console.log(`Attempting to delete DaviCal calendar: ${existingCalendar.url}`);
                
                try {
                  // First, try standard DELETE method
                  await davClient.davRequest({
                    url: existingCalendar.url,
                    init: {
                      method: 'DELETE',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                      },
                      body: '' // Add empty body to satisfy DAVRequest type
                    }
                  });
                  console.log(`Successfully deleted calendar from CalDAV server using standard DELETE`);
                } catch (deleteError) {
                  console.log(`Standard DELETE failed, trying alternative approach: ${deleteError.message}`);
                  
                  // If standard DELETE fails, try PROPPATCH to mark it as hidden/disabled/inactive
                  try {
                    await davClient.davRequest({
                      url: existingCalendar.url,
                      init: {
                        method: 'PROPPATCH',
                        headers: {
                          'Content-Type': 'application/xml; charset=utf-8',
                        },
                        body: `<?xml version="1.0" encoding="utf-8" ?>
                          <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                            <D:set>
                              <D:prop>
                                <C:calendar-enabled>false</C:calendar-enabled>
                              </D:prop>
                            </D:set>
                          </D:propertyupdate>`
                      }
                    });
                    console.log(`Successfully disabled calendar on CalDAV server using PROPPATCH`);
                  } catch (propPatchError) {
                    console.log(`PROPPATCH approach also failed: ${propPatchError.message}`);
                    // At this point, we tried all server-side options, so we'll continue with local deletion
                  }
                }
              } else {
                // For other CalDAV servers, try to delete the calendar using DELETE method
                await davClient.davRequest({
                  url: existingCalendar.url,
                  init: {
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/xml; charset=utf-8',
                    },
                    body: '' // Empty body for DELETE request to satisfy DAVRequest type
                  }
                });
                console.log(`Successfully deleted calendar from CalDAV server`);
              }
            } catch (calendarDeleteError) {
              console.error(`Error deleting calendar from server:`, calendarDeleteError);
              // Continue with local deletion even if server deletion fails
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local deletion even if server connection fails
        }
      }
      
      // Delete the calendar and all its events locally
      const result = await storage.deleteCalendar(calendarId);
      
      if (result.success) {
        res.json({ message: "Calendar deleted successfully" });
      } else {
        res.status(500).json({ 
          message: "Failed to delete calendar", 
          error: result.error,
          details: result.details
        });
      }
    } catch (err) {
      console.error("Error deleting calendar:", err);
      res.status(500).json({ message: "Failed to delete calendar" });
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
      
      // CRITICAL TIMEZONE FIX: 
      // When events are created in Asia/Kolkata timezone (UTC+5:30), we need to PRESERVE the 
      // exact date/time without UTC conversion to prevent events showing on the wrong day
      
      console.log(`[EVENT CREATE DEBUG] Timezone for event: ${eventData.timezone || 'none'}`);
      
      // Make sure we always have timezone information
      if (!eventData.timezone) {
        console.log('[EVENT CREATE DEBUG] Setting timezone to default UTC');
        eventData.timezone = 'UTC';
      }
      
      // ---- HANDLE START DATE WITH PROPER TIMEZONE PRESERVATION ----
      if (typeof eventData.startDate === 'string') {
        console.log(`[EVENT CREATE DEBUG] Parsing startDate string: ${eventData.startDate}`);
        
        // Create date object from the string
        let startDate = new Date(eventData.startDate);
        
        // CRITICAL FIX: For regular (timed) events in any timezone, ensure we compensate for the day shift
        if (eventData.timezone && !eventData.allDay) {
          console.log(`[EVENT CREATE DEBUG] Timed event (not all-day) with timezone: ${eventData.timezone}`);
          
          // Extract the date and time components directly from the string
          const originalString = eventData.startDate as string;
          console.log(`[EVENT CREATE DEBUG] Original string: ${originalString}`);
          
          // Parse the date components (YYYY-MM-DD)
          const [datePart, timePart] = originalString.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          
          // Parse the time components (HH:MM:SS.sss)
          let timeString = timePart;
          if (timeString.endsWith('Z')) {
            timeString = timeString.slice(0, -1); // Remove the Z
          }
          
          // Split the time, handling potential milliseconds
          let [hours, minutes, secondsPart] = timeString.split(':');
          let seconds = secondsPart;
          let milliseconds = 0;
          
          if (seconds.includes('.')) {
            const parts = seconds.split('.');
            seconds = parts[0];
            milliseconds = parseInt(parts[1].slice(0, 3));
          }
          
          console.log(`[EVENT CREATE DEBUG] Parsed components: ${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`);
          
          // FIX: Manually add one day to all dates to counteract the client-side timezone shift
          // This is a known issue with how dates are created on the client with regular Date constructor
          const correctedDay = day + 1;
          
          // Create date using UTC to ensure consistent date handling
          const adjustedDate = new Date(Date.UTC(
            year, 
            month - 1, // JavaScript months are 0-indexed
            correctedDay, // Add one day
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds),
            milliseconds
          ));
          
          console.log(`[EVENT CREATE DEBUG] Original date: ${startDate.toISOString()}`);
          console.log(`[EVENT CREATE DEBUG] Corrected date: ${adjustedDate.toISOString()}`);
          
          startDate = adjustedDate;
        }
        
        // Store the parsed date properly
        eventData.startDate = startDate;
        console.log(`[EVENT CREATE DEBUG] Final startDate: ${eventData.startDate.toISOString()} with timezone ${eventData.timezone}`);
      } else if (!eventData.startDate) {
        console.warn("Missing startDate in event creation, using current date");
        eventData.startDate = new Date();
      }
      
      // ---- HANDLE END DATE WITH PROPER TIMEZONE PRESERVATION ----
      if (typeof eventData.endDate === 'string') {
        console.log(`[EVENT CREATE DEBUG] Parsing endDate string: ${eventData.endDate}`);
        
        // Create date object from the string
        let endDate = new Date(eventData.endDate);
        
        // CRITICAL FIX: For regular (timed) events in any timezone, ensure we compensate for the day shift
        if (eventData.timezone && !eventData.allDay) {
          console.log(`[EVENT CREATE DEBUG] Timed event (not all-day) with timezone: ${eventData.timezone}`);
          
          // Extract the date and time components directly from the string
          const originalString = eventData.endDate as string;
          console.log(`[EVENT CREATE DEBUG] Original end string: ${originalString}`);
          
          // Parse the date components (YYYY-MM-DD)
          const [datePart, timePart] = originalString.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          
          // Parse the time components (HH:MM:SS.sss)
          let timeString = timePart;
          if (timeString.endsWith('Z')) {
            timeString = timeString.slice(0, -1); // Remove the Z
          }
          
          // Split the time, handling potential milliseconds
          let [hours, minutes, secondsPart] = timeString.split(':');
          let seconds = secondsPart;
          let milliseconds = 0;
          
          if (seconds.includes('.')) {
            const parts = seconds.split('.');
            seconds = parts[0];
            milliseconds = parseInt(parts[1].slice(0, 3));
          }
          
          console.log(`[EVENT CREATE DEBUG] Parsed end components: ${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`);
          
          // FIX: Manually add one day to all dates to counteract the client-side timezone shift
          // This is a known issue with how dates are created on the client with regular Date constructor
          const correctedDay = day + 1;
          
          // Create date using UTC to ensure consistent date handling
          const adjustedDate = new Date(Date.UTC(
            year, 
            month - 1, // JavaScript months are 0-indexed
            correctedDay, // Add one day
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds),
            milliseconds
          ));
          
          console.log(`[EVENT CREATE DEBUG] Original end date: ${endDate.toISOString()}`);
          console.log(`[EVENT CREATE DEBUG] Corrected end date: ${adjustedDate.toISOString()}`);
          
          endDate = adjustedDate;
        }
        
        // Store the parsed date properly
        eventData.endDate = endDate;
        console.log(`[EVENT CREATE DEBUG] Final endDate: ${eventData.endDate.toISOString()} with timezone ${eventData.timezone}`);
      } else if (!eventData.endDate) {
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
        // CRITICAL FIX: Preserve the selected date for all-day events without timezone shifting
        console.log(`[BACKEND DATE DEBUG] Original date values:`, {
          startDate: eventData.startDate.toISOString(),
          endDate: eventData.endDate.toISOString(),
          startDateLocal: eventData.startDate.toString(),
          endDateLocal: eventData.endDate.toString()
        });
        
        // Extract the date string in YYYY-MM-DD format directly from the ISO string
        // This avoids any timezone complications
        const startDateStr = eventData.startDate.toISOString().split('T')[0];
        const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
        
        // Important: When creating a Date using components, month is 0-indexed
        // So we need to subtract 1 from the month value (January = 0)
        const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        
        // Double-check that we're creating the correct date
        console.log(`[BACKEND DATE DEBUG] Original date components:`, {
          startDateStr,
          year: startYear,
          month: startMonth - 1, // JavaScript Date constructor uses 0-indexed months
          day: startDay,
          constructedDate: startDate.toISOString()
        });
        
        eventData.startDate = startDate;
        
        // Do the same for end date
        const endDateStr = eventData.endDate.toISOString().split('T')[0];
        const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
        
        // Create end date with time 00:00:00
        const endDate = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
        
        // For CalDAV all-day events, if start and end date are the same, 
        // we need to set end date to the next day
        if (startDateStr === endDateStr) {
          // Create a new date to avoid modifying the date twice
          const nextDayDate = new Date(endDate);
          nextDayDate.setDate(nextDayDate.getDate() + 1);
          eventData.endDate = nextDayDate;
          
          console.log(`[BACKEND DATE DEBUG] Adjusted end date to next day:`, {
            originalEnd: endDate.toISOString(),
            adjustedEnd: nextDayDate.toISOString()
          });
        } else {
          eventData.endDate = endDate;
        }
        
        console.log(`[BACKEND DATE DEBUG] Final date values for all-day event:`, {
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
  
  // Delete all untitled events
  // Endpoint for deleting untitled events
  app.post("/api/events/delete-untitled", isAuthenticated, async (req, res) => {
    try {
      console.log("Delete untitled events request received");
      
      const userId = req.user!.id;
      const { deleteFrom = 'both' } = req.body;
      
      if (!['local', 'server', 'both'].includes(deleteFrom)) {
        return res.status(400).json({ message: "Invalid deleteFrom value. Must be 'local', 'server', or 'both'" });
      }
      
      // Get all user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const calendarIds = userCalendars.map(cal => cal.id);
      
      // Get all events for the user's calendars
      let allEvents: Event[] = [];
      for (const calendarId of calendarIds) {
        const events = await storage.getEvents(calendarId);
        allEvents = [...allEvents, ...events];
      }
      
      // Filter out events with "untitled" in the title (case insensitive)
      // Also include events with missing or empty titles
      const untitledEvents = allEvents.filter(event => {
        // Include events with no title or empty title
        if (!event.title || event.title.trim() === '') return true;
        
        // Include events with "untitled" in the title (case insensitive)
        if (event.title.toLowerCase().includes('untitled')) return true;
        
        // Include events with "no title" in the title (case insensitive)
        if (event.title.toLowerCase().includes('no title')) return true;
        
        // Include events that seem to be auto-generated (like with time stamps or UUIDs)
        if (event.title.toLowerCase().includes('event-')) return true;
        
        return false;
      });
      
      console.log(`Found ${untitledEvents.length} untitled events across ${calendarIds.length} calendars`);
      
      // Track successfully deleted events
      const locallyDeleted: number[] = [];
      const serverDeleted: number[] = [];
      const errors: any[] = [];
      
      // Get server connection if we need to delete from server
      let connection;
      let davClient;
      
      if (deleteFrom === 'server' || deleteFrom === 'both') {
        connection = await storage.getServerConnection(userId);
        
        if (!connection || connection.status !== 'connected') {
          return res.status(400).json({ 
            message: "Server connection not available. Cannot delete events from server.",
            locallyDeleted,
            serverDeleted,
            errors
          });
        }
        
        // Create DAV client for server operations
        const { DAVClient } = await import('tsdav');
        davClient = new DAVClient({
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
      }
      
      // Log details about all events for debugging
      console.log("Found events for potential deletion:");
      for (const event of untitledEvents) {
        console.log(`- ID: ${event.id}, Title: "${event.title}", Start: ${event.startDate}, URL: ${event.url ? 'Yes' : 'No'}, etag: ${event.etag ? 'Yes' : 'No'}`);
      }
      
      // Process each event
      for (const event of untitledEvents) {
        try {
          // Delete from server if requested and event has server info
          if ((deleteFrom === 'server' || deleteFrom === 'both') && davClient) {
            // Handle case where URL or etag might be missing
            if (!event.url || !event.etag) {
              console.log(`Event ${event.id} missing URL or etag, attempting to fetch from server`);
              
              // Try to find the event on the server
              try {
                // Try using UID if available
                if (event.uid) {
                  const findResult = await syncService.findEventOnServer(
                    davClient, 
                    event.uid,
                    event.calendarId
                  );
                  
                  if (findResult) {
                    event.url = findResult.url;
                    event.etag = findResult.etag;
                    console.log(`Found event on server by UID: ${event.uid}`);
                  }
                }
              } catch (findError) {
                console.error(`Could not find event ${event.id} on server:`, findError);
              }
            }
            
            // Now proceed if we have url and etag
            if (event.url && event.etag) {
              try {
                // Delete the event on the CalDAV server
                await davClient.deleteCalendarObject({
                  calendarObject: {
                    url: event.url,
                    etag: event.etag
                  }
                });
                
                serverDeleted.push(event.id);
                console.log(`Successfully deleted untitled event ${event.id} from CalDAV server`);
              } catch (serverError) {
                console.error(`Error deleting untitled event ${event.id} from server:`, serverError);
                errors.push({
                  eventId: event.id,
                  title: event.title,
                  message: "Failed to delete from server",
                  error: serverError
                });
                
                // If we're only deleting from server, continue to next event
                if (deleteFrom === 'server') {
                  continue;
                }
              }
            }
          }
          
          // Delete locally if requested
          if (deleteFrom === 'local' || deleteFrom === 'both') {
            const success = await storage.deleteEvent(event.id);
            
            if (success) {
              locallyDeleted.push(event.id);
              
              // Track deleted events in session to avoid re-syncing them
              if (!req.session.recentlyDeletedEvents) {
                req.session.recentlyDeletedEvents = [];
              }
              req.session.recentlyDeletedEvents.push(event.id);
            } else {
              errors.push({
                eventId: event.id,
                title: event.title,
                message: "Failed to delete locally",
                error: "Unknown error"
              });
            }
          }
        } catch (error) {
          console.error(`Error processing untitled event ${event.id} for deletion:`, error);
          errors.push({
            eventId: event.id,
            title: event.title,
            message: "Failed to process event",
            error
          });
        }
      }
      
      // Return a summary of what was deleted
      res.json({
        success: true,
        message: `Processed ${untitledEvents.length} untitled events for deletion`,
        stats: {
          totalEvents: untitledEvents.length,
          locallyDeleted: locallyDeleted.length,
          serverDeleted: serverDeleted.length,
          errors: errors.length
        },
        details: {
          locallyDeletedIds: locallyDeleted,
          serverDeletedIds: serverDeleted,
          errors
        }
      });
    } catch (err) {
      console.error("Error in untitled event deletion:", err);
      res.status(500).json({ 
        message: "Failed to delete untitled events",
        error: err
      });
    }
  });

  // Bulk event deletion with filters
  // Using POST for bulk delete to ensure body is properly handled by all clients/servers
  app.post("/api/events/bulk/delete", isAuthenticated, async (req, res) => {
    try {
      console.log("Bulk delete request received:", req.body);
      
      const userId = req.user!.id;
      const { 
        calendarIds, 
        deleteFrom, 
        year,
        month,
        day,
        deleteScope 
      } = req.body;
      
      if (!Array.isArray(calendarIds) || calendarIds.length === 0) {
        return res.status(400).json({ message: "At least one calendar ID must be provided" });
      }
      
      if (!['local', 'server', 'both'].includes(deleteFrom)) {
        return res.status(400).json({ message: "Invalid deleteFrom value. Must be 'local', 'server', or 'both'" });
      }
      
      // Validate that the user has access to these calendars
      const userCalendars = await storage.getCalendars(userId);
      const validCalendarIds = userCalendars.map(cal => cal.id);
      
      const invalidCalendars = calendarIds.filter(id => !validCalendarIds.includes(id));
      if (invalidCalendars.length > 0) {
        return res.status(403).json({ 
          message: "Access denied to one or more calendars",
          invalidCalendars
        });
      }
      
      // Get all events for the selected calendars
      let allEvents: Event[] = [];
      for (const calendarId of calendarIds) {
        const events = await storage.getEvents(calendarId);
        allEvents = [...allEvents, ...events];
      }
      
      // Apply additional filters
      let filteredEvents = [...allEvents];
      
      // Apply date filters if provided
      if (deleteScope !== 'all') {
        filteredEvents = filteredEvents.filter(event => {
          // Handle case when startDate might be null or invalid
          if (!event.startDate) {
            console.log(`Skipping event ${event.id} with no startDate`);
            return false;
          }
          
          try {
            const eventDate = new Date(event.startDate);
            
            // Check if date is valid
            if (isNaN(eventDate.getTime())) {
              console.log(`Skipping event ${event.id} with invalid date: ${event.startDate}`);
              return false;
            }
            
            // Filter by year if specified
            if (year !== undefined && eventDate.getFullYear() !== year) {
              return false;
            }
            
            // Filter by month if specified (note: JavaScript months are 0-based)
            if (month !== undefined && eventDate.getMonth() !== month - 1) {
              return false;
            }
            
            // Filter by day if specified
            if (day !== undefined && eventDate.getDate() !== day) {
              return false;
            }
            
            return true;
          } catch (error) {
            console.error(`Error filtering event ${event.id}:`, error);
            return false;
          }
        });
      }
      
      console.log(`Bulk deleting ${filteredEvents.length} events from ${calendarIds.length} calendars with deleteFrom=${deleteFrom}`);
      
      // Track successfully deleted events
      const locallyDeleted: number[] = [];
      const serverDeleted: number[] = [];
      const errors: any[] = [];
      
      // Get server connection if we need to delete from server
      let connection;
      let davClient;
      
      if (deleteFrom === 'server' || deleteFrom === 'both') {
        connection = await storage.getServerConnection(userId);
        
        if (!connection || connection.status !== 'connected') {
          return res.status(400).json({ 
            message: "Server connection not available. Cannot delete events from server.",
            locallyDeleted,
            serverDeleted,
            errors
          });
        }
        
        // Create DAV client for server operations
        const { DAVClient } = await import('tsdav');
        davClient = new DAVClient({
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
      }
      
      // Process each event
      for (const event of filteredEvents) {
        try {
          // Delete from server if requested and event has server info
          if ((deleteFrom === 'server' || deleteFrom === 'both') && 
              event.url && event.etag && davClient) {
            try {
              // Delete the event on the CalDAV server
              await davClient.deleteCalendarObject({
                calendarObject: {
                  url: event.url,
                  etag: event.etag
                }
              });
              
              serverDeleted.push(event.id);
              console.log(`Successfully deleted event ${event.id} from CalDAV server`);
            } catch (serverError) {
              console.error(`Error deleting event ${event.id} from server:`, serverError);
              errors.push({
                eventId: event.id,
                message: "Failed to delete from server",
                error: serverError
              });
              
              // If we're only deleting from server, continue to next event
              if (deleteFrom === 'server') {
                continue;
              }
            }
          }
          
          // Delete locally if requested
          if (deleteFrom === 'local' || deleteFrom === 'both') {
            const success = await storage.deleteEvent(event.id);
            
            if (success) {
              locallyDeleted.push(event.id);
              
              // Track deleted events in session to avoid re-syncing them
              if (!req.session.recentlyDeletedEvents) {
                req.session.recentlyDeletedEvents = [];
              }
              req.session.recentlyDeletedEvents.push(event.id);
            } else {
              errors.push({
                eventId: event.id,
                message: "Failed to delete locally",
                error: "Unknown error"
              });
            }
          }
        } catch (error) {
          console.error(`Error processing event ${event.id} for deletion:`, error);
          errors.push({
            eventId: event.id,
            message: "Failed to process event",
            error
          });
        }
      }
      
      // Return a summary of what was deleted
      res.json({
        success: true,
        message: `Processed ${filteredEvents.length} events for deletion`,
        stats: {
          totalEvents: filteredEvents.length,
          locallyDeleted: locallyDeleted.length,
          serverDeleted: serverDeleted.length,
          errors: errors.length
        },
        details: {
          locallyDeletedIds: locallyDeleted,
          serverDeletedIds: serverDeleted,
          errors
        }
      });
    } catch (err) {
      console.error("Error in bulk event deletion:", err);
      res.status(500).json({ 
        message: "Failed to delete events",
        error: err
      });
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
      
      // Handle timezone information preservation
      if (!updateData.timezone && existingEvent.timezone) {
        // Preserve the existing timezone if not explicitly changed
        updateData.timezone = existingEvent.timezone;
      }
      
      console.log(`[EVENT UPDATE DEBUG] Timezone for event: ${updateData.timezone || 'none'}`);
      
      // ---- HANDLE START DATE WITH PROPER TIMEZONE PRESERVATION ----
      if (typeof updateData.startDate === 'string') {
        console.log(`[EVENT UPDATE DEBUG] Parsing startDate string: ${updateData.startDate}`);
        
        // Create date object from the string
        let startDate = new Date(updateData.startDate);
        
        // CRITICAL FIX: For regular (timed) events in any timezone, ensure we compensate for the day shift
        if (updateData.timezone && !updateData.allDay) {
          console.log(`[EVENT UPDATE DEBUG] Timed event (not all-day) with timezone: ${updateData.timezone}`);
          
          // Extract the date and time components directly from the string
          const originalString = updateData.startDate as string;
          console.log(`[EVENT UPDATE DEBUG] Original string: ${originalString}`);
          
          // Parse the date components (YYYY-MM-DD)
          const [datePart, timePart] = originalString.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          
          // Parse the time components (HH:MM:SS.sss)
          let timeString = timePart;
          if (timeString.endsWith('Z')) {
            timeString = timeString.slice(0, -1); // Remove the Z
          }
          
          // Split the time, handling potential milliseconds
          let [hours, minutes, secondsPart] = timeString.split(':');
          let seconds = secondsPart;
          let milliseconds = 0;
          
          if (seconds.includes('.')) {
            const parts = seconds.split('.');
            seconds = parts[0];
            milliseconds = parseInt(parts[1].slice(0, 3));
          }
          
          console.log(`[EVENT UPDATE DEBUG] Parsed components: ${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`);
          
          // FIX: Manually add one day to all dates to counteract the client-side timezone shift
          // This is a known issue with how dates are created on the client with regular Date constructor
          const correctedDay = day + 1;
          
          // Create date using UTC to ensure consistent date handling
          const adjustedDate = new Date(Date.UTC(
            year, 
            month - 1, // JavaScript months are 0-indexed
            correctedDay, // Add one day
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds),
            milliseconds
          ));
          
          console.log(`[EVENT UPDATE DEBUG] Original date: ${startDate.toISOString()}`);
          console.log(`[EVENT UPDATE DEBUG] Corrected date: ${adjustedDate.toISOString()}`);
          
          startDate = adjustedDate;
          console.log(`[EVENT UPDATE DEBUG] Preserved date: ${startDate.toString()}`);
        }
        
        // Store the parsed date properly
        updateData.startDate = startDate;
      } else if (updateData.startDate === null || updateData.startDate === undefined) {
        // Keep existing startDate if not provided
        updateData.startDate = existingEvent.startDate;
      }
      
      // ---- HANDLE END DATE WITH PROPER TIMEZONE PRESERVATION ----
      if (typeof updateData.endDate === 'string') {
        console.log(`[EVENT UPDATE DEBUG] Parsing endDate string: ${updateData.endDate}`);
        
        // Create date object from the string
        let endDate = new Date(updateData.endDate);
        
        // CRITICAL FIX: For regular (timed) events in any timezone, ensure we compensate for the day shift
        if (updateData.timezone && !updateData.allDay) {
          console.log(`[EVENT UPDATE DEBUG] Timed event (not all-day) with timezone: ${updateData.timezone}`);
          
          // Extract the date and time components directly from the string
          const originalString = updateData.endDate as string;
          console.log(`[EVENT UPDATE DEBUG] Original end string: ${originalString}`);
          
          // Parse the date components (YYYY-MM-DD)
          const [datePart, timePart] = originalString.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          
          // Parse the time components (HH:MM:SS.sss)
          let timeString = timePart;
          if (timeString.endsWith('Z')) {
            timeString = timeString.slice(0, -1); // Remove the Z
          }
          
          // Split the time, handling potential milliseconds
          let [hours, minutes, secondsPart] = timeString.split(':');
          let seconds = secondsPart;
          let milliseconds = 0;
          
          if (seconds.includes('.')) {
            const parts = seconds.split('.');
            seconds = parts[0];
            milliseconds = parseInt(parts[1].slice(0, 3));
          }
          
          console.log(`[EVENT UPDATE DEBUG] Parsed end components: ${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`);
          
          // FIX: Manually add one day to all dates to counteract the client-side timezone shift
          // This is a known issue with how dates are created on the client with regular Date constructor
          const correctedDay = day + 1;
          
          // Create date using UTC to ensure consistent date handling
          const adjustedDate = new Date(Date.UTC(
            year, 
            month - 1, // JavaScript months are 0-indexed
            correctedDay, // Add one day
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds),
            milliseconds
          ));
          
          console.log(`[EVENT UPDATE DEBUG] Original end date: ${endDate.toISOString()}`);
          console.log(`[EVENT UPDATE DEBUG] Corrected end date: ${adjustedDate.toISOString()}`);
          
          endDate = adjustedDate;
          console.log(`[EVENT UPDATE DEBUG] Preserved end date: ${endDate.toString()}`);
        }
        
        // Store the parsed date properly
        updateData.endDate = endDate;
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
        // CRITICAL FIX: Preserve the selected date for all-day events without timezone shifting
        console.log(`[BACKEND DATE DEBUG] Event update - Original date values:`, {
          startDate: updateData.startDate ? updateData.startDate.toISOString() : null,
          endDate: updateData.endDate ? updateData.endDate.toISOString() : null,
          startDateLocal: updateData.startDate ? updateData.startDate.toString() : null,
          endDateLocal: updateData.endDate ? updateData.endDate.toString() : null
        });
        
        if (updateData.startDate) {
          // Extract date string from ISO to avoid timezone issues
          const startDateStr = updateData.startDate.toISOString().split('T')[0];
          const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
          
          // Create date using components with month - 1 (JS months are 0-indexed)
          const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
          
          console.log(`[BACKEND DATE DEBUG] Event update - Start date components:`, {
            startDateStr,
            year: startYear,
            month: startMonth - 1, // Adjusted for JS Date 0-indexed months
            day: startDay,
            constructedDate: startDate.toISOString()
          });
          
          updateData.startDate = startDate;
        }
        
        if (updateData.endDate) {
          // Do the same for end date
          const endDateStr = updateData.endDate.toISOString().split('T')[0];
          const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
          
          // Create end date with time 00:00:00
          const endDate = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
          
          // For single-day all-day events, end date should be the next day in CalDAV
          if (updateData.startDate) {
            const startDateStr = updateData.startDate.toISOString().split('T')[0];
            
            if (startDateStr === endDateStr) {
              // Create a new date to avoid modifying the date twice
              const nextDayDate = new Date(endDate);
              nextDayDate.setDate(nextDayDate.getDate() + 1);
              updateData.endDate = nextDayDate;
              
              console.log(`[BACKEND DATE DEBUG] Event update - Adjusted end date to next day:`, {
                originalEnd: endDate.toISOString(),
                adjustedEnd: nextDayDate.toISOString()
              });
            } else {
              updateData.endDate = endDate;
            }
          } else {
            updateData.endDate = endDate;
          }
        }
        
        console.log(`[BACKEND DATE DEBUG] Event update - Final date values:`, {
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
  // Add WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data);
        
        // Echo back
        if (ws.readyState === WebSocket.OPEN) {
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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message: 'Connected to server' }));
    }
  });
  
  // FIX THUNDERBIRD EVENTS API
  app.post("/api/fix-thunderbird-events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Find all events with Asia/Kolkata timezone
      const calendars = await storage.getCalendars(userId);
      let fixedCount = 0;
      
      for (const calendar of calendars) {
        const events = await storage.getEvents(calendar.id);
        const kolkataEvents = events.filter(event => 
          event.timezone === 'Asia/Kolkata' && 
          !event.allDay && 
          new Date(event.startDate).getHours() >= 5 // Events after 5:00 AM likely need adjustment
        );
        
        console.log(`Found ${kolkataEvents.length} Asia/Kolkata events in calendar ${calendar.name} that need fixing`);
        
        for (const event of kolkataEvents) {
          console.log(`Fixing Thunderbird event: ${event.title} (${event.id}) with dates: ${event.startDate} - ${event.endDate}`);
          
          // Convert the dates to Date objects
          const startDate = new Date(event.startDate);
          const endDate = new Date(event.endDate);
          
          // Apply the 5:30 timezone offset adjustment
          const hoursOffset = 5;
          const minutesOffset = 30;
          
          const fixedStartDate = new Date(startDate);
          fixedStartDate.setHours(startDate.getHours() - hoursOffset);
          fixedStartDate.setMinutes(startDate.getMinutes() - minutesOffset);
          
          const fixedEndDate = new Date(endDate);
          fixedEndDate.setHours(endDate.getHours() - hoursOffset);
          fixedEndDate.setMinutes(endDate.getMinutes() - minutesOffset);
          
          console.log(`Original: ${startDate.toISOString()} - ${endDate.toISOString()}`);
          console.log(`Fixed: ${fixedStartDate.toISOString()} - ${fixedEndDate.toISOString()}`);
          
          // Update the event
          await storage.updateEvent(event.id, {
            startDate: fixedStartDate,
            endDate: fixedEndDate
          });
          
          fixedCount++;
        }
      }
      
      res.json({ 
        message: `Fixed ${fixedCount} Thunderbird events with Asia/Kolkata timezone`,
        fixedCount
      });
    } catch (err) {
      console.error("Error fixing Thunderbird events:", err);
      res.status(500).json({ message: "Failed to fix Thunderbird events" });
    }
  });

  return httpServer;
}
