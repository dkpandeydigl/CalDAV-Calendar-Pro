import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "./storage";
import { v4 as uuidv4 } from "uuid";
import { InsertEvent, Calendar } from "@shared/schema";

// Use dynamic import for node-ical
import * as ical from 'node-ical';

// Set up multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    // Accept only .ics files
    if (file.mimetype === "text/calendar" || file.originalname.endsWith(".ics")) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file format. Only .ics (iCalendar) files are allowed."));
    }
  },
});

interface User {
  id: number;
  username: string;
}

// Enhanced middleware to check if user is authenticated - using the same implementation as routes.ts
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  // Enhanced logging for authentication debugging
  const path = req.path;
  const method = req.method;
  console.log(`Auth check [${method} ${path}]`, {
    isAuthenticated: req.isAuthenticated(),
    hasSession: !!req.session,
    sessionID: req.sessionID,
    hasUser: !!req.user,
    userID: req.user?.id,
    username: req.user?.username,
    cookies: req.headers.cookie ? 'Present' : 'None',
    cookieCount: req.headers.cookie ? req.headers.cookie.split(';').length : 0,
  });
  
  if (req.isAuthenticated()) {
    // Log successful authentication with more details
    console.log(`User ${req.user!.id} (${req.user!.username}) authenticated for ${method} ${path}`);
    return next();
  }
  
  // Enhanced error handling and debugging for failed authentication
  console.log(`Authentication failed for ${method} ${path}`);
  
  // Check for specific authentication issues
  if (!req.session) {
    console.error("No session object found");
    return res.status(401).json({ message: "Session error. Please try again." });
  }
  
  if (!req.headers.cookie) {
    console.error("No cookies present in request");
    return res.status(401).json({ message: "No session cookies found. Please enable cookies in your browser." });
  }
  
  // Try to recover the session if it exists but user is not logged in
  if (req.session && req.sessionID) {
    console.log(`Attempting to recover session: ${req.sessionID}`);
    
    // Regenerate the session to clear any corrupt state
    req.session.regenerate((err) => {
      if (err) {
        console.error("Failed to regenerate session:", err);
      } else {
        console.log("Session regenerated successfully");
      }
      res.status(401).json({ message: "Not authenticated. Please log in again." });
    });
  } else {
    res.status(401).json({ message: "Not authenticated" });
  }
}

interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
}

export function registerImportRoutes(app: Express) {
  // Endpoint to parse an ICS file and return the events
  app.post("/api/calendars/parse-ics", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Parse the ICS file content
      const fileContent = req.file.buffer.toString();
      
      // Parse using node-ical
      // Handle both default export and named export patterns
      const parseICS = (ical as any).default?.parseICS || ical.parseICS;
      const parsedCal = parseICS(fileContent);
      
      // Extract events
      const events: ICSEvent[] = [];
      
      Object.keys(parsedCal).forEach(key => {
        const event = parsedCal[key];
        
        // Only process VEVENT items
        if (event.type === "VEVENT") {
          let allDay = false;
          
          // Handle start and end dates
          let startDate: Date;
          
          if (event.start instanceof Date) {
            startDate = event.start;
          } else if (event.start && typeof event.start === 'object' && 'toJSDate' in event.start && typeof event.start.toJSDate === 'function') {
            startDate = event.start.toJSDate();
            // Check if it's an all-day event
            if ('dateOnly' in event.start && event.start.dateOnly) {
              allDay = true;
            }
          } else {
            // Fallback to current date if we can't parse the start date
            startDate = new Date();
          }
          
          // Handle end date
          let endDate: Date | null = null;
          
          if (event.end instanceof Date) {
            endDate = event.end;
          } else if (event.end && typeof event.end === 'object' && 'toJSDate' in event.end && typeof event.end.toJSDate === 'function') {
            endDate = event.end.toJSDate();
          }
          
          // If no end date is provided, derive from start date
          if (!endDate) {
            endDate = new Date(startDate);
            if (allDay) {
              // For all-day events, set end to next day
              endDate.setDate(endDate.getDate() + 1);
            } else {
              // For timed events, set end to 1 hour after start
              endDate.setHours(endDate.getHours() + 1);
            }
          }
          
          // Only add event if it has valid dates
          if (startDate && endDate) {
            events.push({
              uid: event.uid || uuidv4(),
              summary: event.summary || "Untitled Event",
              description: event.description,
              location: event.location,
              startDate,
              endDate,
              allDay
            });
          }
        }
      });
      
      res.json(events);
      
    } catch (error) {
      console.error("Error parsing ICS file:", error);
      res.status(500).json({ 
        message: "Failed to parse ICS file", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Endpoint to import events into a calendar
  app.post("/api/calendars/import-events", isAuthenticated, async (req, res) => {
    try {
      if (!req.user) {
        console.log("No authenticated user found in request", { session: req.session?.id || 'no-session' });
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = (req.user as User).id;
      const { calendarId, events, replaceExisting } = req.body;
      
      console.log("Import events request:", { 
        userId, 
        calendarId, 
        eventCount: events?.length || 0,
        replaceExisting: !!replaceExisting 
      });
      
      if (!calendarId || !Array.isArray(events)) {
        console.log("Invalid request. Missing calendarId or events:", { calendarId, eventsIsArray: Array.isArray(events) });
        return res.status(400).json({ message: "Invalid request. Missing calendarId or events" });
      }
      
      if (events.length === 0) {
        console.log("No events to import");
        return res.status(400).json({ message: "No events to import" });
      }
      
      // Validate the first event to see if structure is correct
      console.log("First event sample:", JSON.stringify(events[0]));
      
      // Debug authentication state
      console.log(`User authentication confirmed: ID ${userId}, checking calendars...`);
      
      // Check if user has permission to add events to this calendar
      const userCalendars = await storage.getCalendars(userId);
      console.log(`User ${userId} has ${userCalendars.length} personal calendars`);
      
      const sharedCalendars = await storage.getSharedCalendars(userId);
      console.log(`User ${userId} has ${sharedCalendars.length} shared calendars`);
      
      // Print detailed debug info
      console.log("User calendars:", userCalendars.map(c => ({ id: c.id, name: c.name })));
      console.log("Shared calendars:", sharedCalendars.map(c => ({ id: c.id, name: c.name })));
      
      // Verify calendar ID type matches
      console.log(`Target calendar ID: ${calendarId} (type: ${typeof calendarId})`);
      
      // If calendarId is a string, try to convert it to a number
      let targetCalendarId = calendarId;
      if (typeof calendarId === 'string' && !isNaN(Number(calendarId))) {
        targetCalendarId = Number(calendarId);
        console.log(`Converted calendar ID from string to number: ${targetCalendarId}`);
      }
      
      // Find the target calendar and check permissions with better type handling
      const targetCalendar = [...userCalendars, ...sharedCalendars].find(
        cal => cal.id === targetCalendarId || cal.id === calendarId
      );
      
      // If the calendar doesn't exist in the user's calendars or shared calendars, they don't have access
      if (!targetCalendar) {
        console.log("Calendar not found in user's calendars:", calendarId);
        console.log(`User ID: ${userId}, Available calendars:`, 
          [...userCalendars, ...sharedCalendars].map(c => ({ id: c.id, name: c.name, idType: typeof c.id })));
        
        // Check if any calendar exists with this ID in the system
        const allCalendars = await storage.getAllCalendars();
        
        console.log(`Collected ${allCalendars.length} calendars to check`);
        
        // Try to match with both original and converted ID
        const calendarExists = allCalendars.some(cal => 
          cal?.id === targetCalendarId || cal?.id === calendarId
        );
        
        if (calendarExists) {
          console.log("Calendar exists in system but user doesn't have access:", calendarId);
          return res.status(403).json({ message: "You don't have access to this calendar" });
        } else {
          console.log("Calendar doesn't exist in system:", calendarId);
          return res.status(404).json({ message: "Calendar not found" });
        }
      }
      
      console.log("Target calendar:", { id: targetCalendar.id, name: targetCalendar.name });
      
      // For shared calendars, check if user has edit permission
      if (targetCalendar.userId !== userId) {
        // Find the share record to check permissions
        const shareRecords = await storage.getCalendarSharing(targetCalendar.id);
        const shareRecord = shareRecords.find(record => 
          record.sharedWithUserId === userId || record.sharedWithEmail === req.user?.username
        );
        
        console.log("Shared calendar permission check:", {
          calendarId: targetCalendar.id,
          userName: req.user?.username,
          userId,
          shareRecords: shareRecords.map(r => ({
            id: r.id,
            sharedWithUserId: r.sharedWithUserId,
            sharedWithEmail: r.sharedWithEmail,
            permissionLevel: r.permissionLevel
          })),
          shareRecord: shareRecord ? {
            id: shareRecord.id,
            sharedWithUserId: shareRecord.sharedWithUserId,
            sharedWithEmail: shareRecord.sharedWithEmail,
            permissionLevel: shareRecord.permissionLevel
          } : 'none'
        });
        
        if (!shareRecord || shareRecord.permissionLevel !== "edit") {
          console.log("No edit permission for shared calendar:", { 
            calendarId: targetCalendar.id, 
            shareRecord: shareRecord ? JSON.stringify(shareRecord) : 'none'
          });
          return res.status(403).json({ 
            message: "You don't have permission to add events to this shared calendar" 
          });
        }
      }
      
      // Import the events
      let importedCount = 0;
      const errors: string[] = [];
      
      for (const event of events) {
        try {
          // Create a new event from the imported data
          const newEvent: InsertEvent = {
            calendarId,
            title: event.summary,
            description: event.description || null,
            location: event.location || null,
            startDate: new Date(event.startDate),
            endDate: new Date(event.endDate),
            allDay: event.allDay || false,
            uid: event.uid || uuidv4(),
            timezone: "UTC",
            syncStatus: "local",
            busyStatus: "busy",
            attendees: [],
            resources: [],
            rawData: {},
            emailSent: 'not_sent',
            emailError: null
          };
          
          console.log("Attempting to import event:", { 
            uid: newEvent.uid,
            title: newEvent.title,
            startDate: newEvent.startDate,
            endDate: newEvent.endDate
          });
          
          // Check if an event with this UID already exists
          const existingEvent = await storage.getEventByUID(newEvent.uid);
          
          if (existingEvent) {
            if (replaceExisting) {
              // Update the existing event instead of creating a new one
              console.log("Replacing existing event:", { uid: newEvent.uid, title: newEvent.title });
              
              // Include the existing event ID in the update
              const updatedEvent = await storage.updateEvent(existingEvent.id, {
                ...newEvent,
                id: existingEvent.id // Make sure to keep the same ID
              });
              
              if (updatedEvent) {
                importedCount++;
                console.log("Successfully replaced event:", { uid: newEvent.uid, title: newEvent.title });
              } else {
                console.error("Failed to replace event:", { uid: newEvent.uid, title: newEvent.title });
                errors.push(`Failed to replace event "${newEvent.title}" with UID ${newEvent.uid}`);
              }
            } else {
              // Skip this event and record the error if not replacing
              console.log("Event already exists (skipping):", { uid: newEvent.uid, title: newEvent.title });
              errors.push(`Event "${newEvent.title}" with UID ${newEvent.uid} already exists`);
            }
            continue;
          }
          
          // Save the event as new
          await storage.createEvent(newEvent);
          importedCount++;
          console.log("Successfully imported new event:", { uid: newEvent.uid, title: newEvent.title });
          
        } catch (eventError) {
          console.error("Error importing event:", eventError);
          errors.push(`Failed to import event "${event.summary}": ${eventError}`);
        }
      }
      
      // Return the result
      console.log("Import complete:", { importedCount, totalEvents: events.length, errorCount: errors.length });
      
      res.json({
        message: `Imported ${importedCount} events`,
        imported: importedCount,
        total: events.length,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (error) {
      console.error("Error importing events:", error);
      res.status(500).json({ 
        message: "Failed to import events", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });
}