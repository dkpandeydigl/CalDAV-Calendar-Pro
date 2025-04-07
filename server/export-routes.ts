import { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";

// Format date for iCalendar - YYYYMMDDTHHMMSSZ format
function formatICALDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// User interface for authenticated requests
interface User {
  id: number;
  username: string;
  email?: string;
}

// Authentication middleware
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}

export function registerExportRoutes(app: Express) {
  // Debug route to identify NaN issue
  app.get("/api/debug-export", isAuthenticated, async (req, res) => {
    try {
      // Just send back the parsed calendar IDs to check for NaN issues
      const calendarIds = req.query.ids 
        ? String(req.query.ids)
            .split(',')
            .map(id => {
              const parsedId = parseInt(id.trim(), 10);
              return { original: id.trim(), parsed: parsedId, isNaN: isNaN(parsedId) };
            })
        : [];
        
      res.json({ 
        message: 'Debug info', 
        calendarIds,
        rawIds: req.query.ids 
      });
    } catch (error) {
      console.error('Debug error:', error);
      res.status(500).json({ message: 'Debug error', error: String(error) });
    }
  });

  // Calendar Export API - new implementation completely bypassing database calls
  app.get("/api/export-simple", isAuthenticated, async (req, res) => {
    try {
      console.log('Using simple export endpoint');
      const userId = (req.user as User).id;
      
      // Get all events for the user without calendar database lookups
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      const allCalendars = [...userCalendars, ...sharedCalendars];
      
      // If no calendars are available, return an error
      if (allCalendars.length === 0) {
        return res.status(404).json({ message: 'No calendars found for user' });
      }
      
      // Get all events from all user's calendars
      const allEvents = [];
      
      for (const calendar of allCalendars) {
        const events = await storage.getEvents(calendar.id);
        allEvents.push(...events.map(event => ({
          ...event,
          calendarName: calendar.name
        })));
      }
      
      if (allEvents.length === 0) {
        return res.status(404).json({ message: 'No events found to export' });
      }
      
      // Generate simple iCalendar file
      const now = formatICALDate(new Date());
      let icalContent = 
        `BEGIN:VCALENDAR\r\n` +
        `VERSION:2.0\r\n` +
        `PRODID:-//CalDAV Client//NONSGML v1.0//EN\r\n` +
        `CALSCALE:GREGORIAN\r\n` +
        `METHOD:PUBLISH\r\n` +
        `X-WR-CALNAME:All Calendars\r\n` +
        `X-WR-CALDESC:Exported Calendar\r\n`;
      
      // Add each event
      for (const event of allEvents) {
        const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
        const startDate = formatICALDate(new Date(event.startDate));
        const endDate = formatICALDate(new Date(event.endDate));
        
        icalContent += 
          `BEGIN:VEVENT\r\n` +
          `UID:${safeUid}\r\n` +
          `DTSTAMP:${now}\r\n` +
          `DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}\r\n` +
          `DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}\r\n` +
          `SUMMARY:${event.title}\r\n`;
        
        if (event.calendarName) {
          icalContent += `CATEGORIES:${event.calendarName}\r\n`;
        }
        
        if (event.description) {
          icalContent += `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}\r\n`;
        }
        
        if (event.location) {
          icalContent += `LOCATION:${event.location}\r\n`;
        }
        
        if (event.allDay) {
          icalContent += `X-MICROSOFT-CDO-ALLDAYEVENT:TRUE\r\n`;
        }
        
        icalContent += `END:VEVENT\r\n`;
      }
      
      icalContent += `END:VCALENDAR`;
      
      // Set the appropriate headers for file download
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="all_calendars.ics"`);
      res.send(icalContent);
      
      console.log(`Successfully exported ${allEvents.length} events from simple export endpoint`);
      
    } catch (error) {
      console.error('Error in simple export:', error);
      res.status(500).json({ message: 'Export failed', error: String(error) });
    }
  });
  
  // Original Calendar Export API
  app.get("/api/calendars/export", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as User).id;
      
      // Safely convert string IDs to numbers and filter out any NaN values
      const calendarIds = req.query.ids 
        ? String(req.query.ids)
            .split(',')
            .map(id => {
              const num = parseInt(id.trim(), 10);
              return isNaN(num) ? null : num;
            })
            .filter((id): id is number => id !== null)
        : [];
        
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
      
      if (calendarIds.length === 0) {
        return res.status(400).json({ message: 'No calendars selected for export' });
      }
      
      console.log(`Exporting calendars ${calendarIds.join(', ')} for user ${userId}`);
      
      // Check permission for each calendar (user can export their own calendars and shared calendars they have access to)
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      // Map calendars for lookup by ID
      const calendarMap = new Map();
      [...userCalendars, ...sharedCalendars].forEach(cal => {
        calendarMap.set(cal.id, cal);
      });
      
      const accessibleCalendarIds = new Set([
        ...userCalendars.map(cal => cal.id),
        ...sharedCalendars.map(cal => cal.id)
      ]);
      
      // Filter out any calendar IDs the user doesn't have access to
      const validCalendarIds = calendarIds.filter(id => accessibleCalendarIds.has(id));
      
      if (validCalendarIds.length === 0) {
        return res.status(403).json({ message: 'You do not have permission to export these calendars' });
      }
      
      // Generate iCalendar content
      const mergedEvents = [];
      
      for (const calendarId of validCalendarIds) {
        // Get calendar details from our map instead of another DB call
        const calendar = calendarMap.get(calendarId);
        if (!calendar) {
          console.log(`Skipping calendar ${calendarId} - not found in map`);
          continue;
        }
        
        // Fetch all events for this calendar
        let events = await storage.getEvents(calendarId);
        
        // Apply date filtering if provided
        if (startDate && endDate) {
          events = events.filter(event => {
            const eventStart = new Date(event.startDate);
            const eventEnd = new Date(event.endDate);
            return (eventStart >= startDate && eventStart <= endDate) || 
                  (eventEnd >= startDate && eventEnd <= endDate) ||
                  (eventStart <= startDate && eventEnd >= endDate);
          });
        }
        
        // Add calendar information to each event
        const eventsWithCalendarInfo = events.map(event => ({
          uid: event.uid,
          summary: event.title,
          description: event.description || '',
          location: event.location || '',
          startDate: new Date(event.startDate),
          endDate: new Date(event.endDate),
          allDay: event.allDay || false,
          recurring: false,
          calendarName: calendar.name
        }));
        
        mergedEvents.push(...eventsWithCalendarInfo);
      }
      
      if (mergedEvents.length === 0) {
        return res.status(404).json({ message: 'No events found to export' });
      }
      
      // Determine calendar name for the export file
      let calendarName = 'Multiple Calendars';
      
      if (validCalendarIds.length === 1) {
        // Safely get calendar name from our map
        const calendarId = validCalendarIds[0];
        const calendar = calendarMap.get(calendarId);
        calendarName = calendar?.name || 'Exported Calendar';
      }
      
      // Generate iCalendar content
      const now = formatICALDate(new Date());
      let icalContent = 
        `BEGIN:VCALENDAR\r\n` +
        `VERSION:2.0\r\n` +
        `PRODID:-//CalDAV Client//NONSGML v1.0//EN\r\n` +
        `CALSCALE:GREGORIAN\r\n` +
        `METHOD:PUBLISH\r\n` +
        `X-WR-CALNAME:${calendarName}\r\n` +
        `X-WR-CALDESC:Exported Calendar\r\n`;
      
      // Add each event
      for (const event of mergedEvents) {
        const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
        const startDate = formatICALDate(event.startDate);
        const endDate = formatICALDate(event.endDate);
        
        icalContent += 
          `BEGIN:VEVENT\r\n` +
          `UID:${safeUid}\r\n` +
          `DTSTAMP:${now}\r\n` +
          `DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}\r\n` +
          `DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}\r\n` +
          `SUMMARY:${event.summary}\r\n`;
        
        if (event.calendarName) {
          icalContent += `CATEGORIES:${event.calendarName}\r\n`;
        }
        
        if (event.description) {
          icalContent += `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}\r\n`;
        }
        
        if (event.location) {
          icalContent += `LOCATION:${event.location}\r\n`;
        }
        
        if (event.allDay) {
          icalContent += `X-MICROSOFT-CDO-ALLDAYEVENT:TRUE\r\n`;
        }
        
        icalContent += `END:VEVENT\r\n`;
      }
      
      icalContent += `END:VCALENDAR`;
      
      // Set the appropriate headers for file download
      let filename = 'calendars_export.ics';
      
      if (validCalendarIds.length === 1) {
        // Ensure the calendar name is valid for a filename
        const safeCalendarName = calendarName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        filename = `calendar_${safeCalendarName}.ics`;
      }
        
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icalContent);
      
      console.log(`Successfully exported ${mergedEvents.length} events from ${validCalendarIds.length} calendars`);
      
    } catch (error) {
      console.error('Error exporting calendars:', error);
      res.status(500).json({ message: 'Failed to export calendars', error: (error as Error).message });
    }
  });
}