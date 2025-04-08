import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "./storage";
import { v4 as uuidv4 } from "uuid";
import { InsertEvent } from "@shared/schema";

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

// Middleware to check if user is authenticated
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
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
      
      // Check if user has permission to add events to this calendar
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      console.log("User calendars:", userCalendars.map(c => ({ id: c.id, name: c.name })));
      console.log("Shared calendars:", sharedCalendars.map(c => ({ id: c.id, name: c.name })));
      
      // Find the target calendar and check permissions
      const targetCalendar = [...userCalendars, ...sharedCalendars].find(
        cal => cal.id === calendarId
      );
      
      if (!targetCalendar) {
        console.log("Calendar not found or no access:", calendarId);
        return res.status(403).json({ message: "You don't have access to this calendar" });
      }
      
      console.log("Target calendar:", { id: targetCalendar.id, name: targetCalendar.name });
      
      // For shared calendars, check if user has edit permission
      if (targetCalendar.userId !== userId) {
        // Find the share record to check permissions
        const shareRecords = await storage.getCalendarSharing(targetCalendar.id);
        const shareRecord = shareRecords.find(record => 
          record.sharedWithUserId === userId || record.sharedWithEmail === req.user?.username
        );
        
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