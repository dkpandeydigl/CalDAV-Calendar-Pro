import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "./storage";
import * as ical from "node-ical";
import { v4 as uuidv4 } from "uuid";
import { InsertEvent } from "@shared/schema";

// A simple type declaration for node-ical since we don't have the official types
declare module 'node-ical' {
  export interface VEvent {
    type: 'VEVENT';
    uid: string;
    summary: string;
    start: any; // Could be Date or an object with dateOnly property
    end?: any; // Could be Date or an object with dateOnly property
    description: string;
    location: string;
  }
  
  export function parseICS(icsData: string): Promise<Record<string, any>>;
}

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
      const parsedCal = await ical.parseICS(fileContent);
      
      // Extract events
      const events: ICSEvent[] = [];
      
      Object.keys(parsedCal).forEach(key => {
        const event = parsedCal[key];
        
        // Only process VEVENT items
        if (event.type === "VEVENT") {
          let allDay = false;
          
          // Handle start and end dates
          let startDate = event.start instanceof Date ? event.start : new Date();
          let endDate = event.end instanceof Date ? event.end : null;
          
          // Check if it's an all-day event (no time component)
          if (startDate && event.start instanceof Object && 'dateOnly' in event.start && event.start.dateOnly) {
            allDay = true;
          }
          
          // If no end date is provided, set it same as start date
          if (!endDate && startDate) {
            // For all-day events, set end to next day
            endDate = new Date(startDate);
            if (allDay) {
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
      const { calendarId, events } = req.body;
      
      if (!calendarId || !Array.isArray(events)) {
        return res.status(400).json({ message: "Invalid request. Missing calendarId or events" });
      }
      
      // Check if user has permission to add events to this calendar
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      // Find the target calendar and check permissions
      const targetCalendar = [...userCalendars, ...sharedCalendars].find(
        cal => cal.id === calendarId
      );
      
      if (!targetCalendar) {
        return res.status(403).json({ message: "You don't have access to this calendar" });
      }
      
      // For shared calendars, check if user has edit permission
      if (targetCalendar.userId !== userId) {
        // Find the share record to check permissions
        const shareRecords = await storage.getCalendarSharing(targetCalendar.id);
        const shareRecord = shareRecords.find(record => 
          record.sharedWithUserId === userId || record.sharedWithEmail === req.user?.username
        );
        
        if (!shareRecord || shareRecord.permissionLevel !== "edit") {
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
            rawData: {}
          };
          
          // Check if an event with this UID already exists
          const existingEvent = await storage.getEventByUID(newEvent.uid);
          
          if (existingEvent) {
            // Skip this event and record the error
            errors.push(`Event "${newEvent.title}" with UID ${newEvent.uid} already exists`);
            continue;
          }
          
          // Save the event
          await storage.createEvent(newEvent);
          importedCount++;
          
        } catch (eventError) {
          console.error("Error importing event:", eventError);
          errors.push(`Failed to import event "${event.summary}": ${eventError}`);
        }
      }
      
      // Return the result
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