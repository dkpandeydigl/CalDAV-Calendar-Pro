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
  
  /**
   * Download event as properly formatted ICS file
   * Ensures proper line break handling and character encoding
   * 
   * Modified to provide better error handling and fallback authentication methods
   */
  app.get("/api/download-ics/:eventId", async (req, res) => {
    try {
      console.log('Download ICS endpoint called');
      console.log('Authentication status:', req.isAuthenticated());
      console.log('Request cookies:', req.headers.cookie ? 'Session cookie exists' : 'No cookies');
      
      // Explicit authentication check with detailed logging
      if (!req.isAuthenticated() || !req.user) {
        console.error('User is not authenticated in download-ics endpoint');
        return res.status(401).json({ 
          message: 'Authentication required to download this file', 
          authenticated: false,
          sessionExists: req.headers.cookie && req.headers.cookie.includes('connect.sid')
        });
      }
      
      // Get user ID from session - we can safely use req.user here since we're using isAuthenticated middleware
      const userId = (req.user as User).id;
      console.log(`Download ICS requested by user ID: ${userId}`);
      
      const eventId = parseInt(req.params.eventId, 10);
      if (isNaN(eventId)) {
        console.error(`Invalid event ID provided: ${req.params.eventId}`);
        return res.status(400).json({ message: 'Invalid event ID' });
      }
      
      console.log(`Attempting to download event ID: ${eventId}`);
      
      // Get the event
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: 'Event not found' });
      }
      
      // Check permissions
      const calendar = await storage.getCalendar(event.calendarId);
      if (!calendar) {
        return res.status(404).json({ message: 'Calendar not found' });
      }
      
      // Check if user has permission to access this event
      if (calendar.userId !== userId) {
        // Check if calendar is shared with user
        const sharedCalendars = await storage.getSharedCalendars(userId);
        const hasAccess = sharedCalendars.some(sharedCal => sharedCal.id === calendar.id);
        if (!hasAccess) {
          return res.status(403).json({ message: 'You do not have permission to access this event' });
        }
      }
      
      // Get or create ICS content
      let icsContent = '';
      
      // If we have raw ICS data, use it with sanitization
      if (event.rawData && typeof event.rawData === 'string') {
        console.log('Using raw ICS data for download');
        icsContent = event.rawData;
        
        // Clean up any RRULE issues with mailto: appended to it
        icsContent = icsContent.replace(/RRULE:(.*?)mailto:/g, 'RRULE:$1');
        
        // Fix line breaks for proper iCalendar format
        const lines = icsContent.split(/\r\n|\n|\r/);
        
        // Process each line to fix any format issues
        const processedLines = lines.map((line: string) => {
          // Fix SCHEDULE-STATUS formatting issues in attendee lines
          if ((line.includes('ATTENDEE') || line.includes('ORGANIZER')) && 
              line.includes('SCHEDULE-STATUS=')) {
            // Extract the properties and value parts
            const parts = line.split(':');
            if (parts.length > 1) {
              const properties = parts[0];
              const email = parts[1];
              // Clean up any embedded colons in the email part
              const cleanEmail = email.replace(/:/g, '');
              return `${properties}:${cleanEmail}`;
            }
          }
          return line;
        });
        
        // Apply proper line folding for RFC 5545 compliance
        const foldedLines = [];
        for (let i = 0; i < processedLines.length; i++) {
          const line = processedLines[i];
          
          // Skip empty lines
          if (!line.trim()) continue;
          
          // If the line is longer than 75 characters, fold it according to RFC 5545
          if (line.length > 75) {
            let currentPos = 0;
            const lineLength = line.length;
            
            // Add the first line
            foldedLines.push(line.substring(0, 75));
            currentPos = 75;
            
            // Add continuation lines with a space at the beginning
            while (currentPos < lineLength) {
              const chunk = line.substring(currentPos, Math.min(currentPos + 74, lineLength));
              foldedLines.push(' ' + chunk); // Continuation lines must start with a space
              currentPos += 74;
            }
          } else {
            foldedLines.push(line);
          }
        }
        
        // Rejoin with proper CRLF line endings
        icsContent = foldedLines.join('\r\n');
      } else {
        // Create basic iCalendar format
        const startDate = new Date(event.startDate);
        const endDate = new Date(event.endDate);
        
        // Format dates as required by iCalendar format (UTC)
        console.log('Creating basic ICS file for download (no raw data)');
        
        icsContent = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//XGenCal//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nSUMMARY:${event.title}\r\nDTSTART:${formatICALDate(startDate)}\r\nDTEND:${formatICALDate(endDate)}\r\nDESCRIPTION:${event.description || ''}\r\nLOCATION:${event.location || ''}\r\nUID:${event.uid || `event-${Date.now()}`}\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR`;
      }
      
      // Log the successful preparation of ICS content
      console.log(`Successfully prepared ICS file for event ID ${eventId} with title: ${event.title}`);

      // Set appropriate headers
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics"`);
      
      // Send the content with proper line breaks
      res.send(icsContent);
      
    } catch (error) {
      console.error('Error downloading ICS file:', error);
      console.error('User authentication state:', req.isAuthenticated(), req.user ? `User ID: ${(req.user as any).id}` : 'No user');
      
      // Return a more detailed error response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ 
        message: 'Failed to download ICS file', 
        error: errorMessage,
        authenticated: req.isAuthenticated(),
        timestamp: new Date().toISOString()
      });
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
      let lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:All Calendars',
        'X-WR-CALDESC:Exported Calendar'
      ];
      
      // Add each event
      for (const event of allEvents) {
        const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
        const startDate = formatICALDate(new Date(event.startDate));
        const endDate = formatICALDate(new Date(event.endDate));
        
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${safeUid}`);
        lines.push(`DTSTAMP:${now}`);
        lines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}`);
        lines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}`);
        lines.push(`SUMMARY:${event.title}`);
        
        if (event.calendarName) {
          lines.push(`CATEGORIES:${event.calendarName}`);
        }
        
        if (event.description) {
          lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`);
        }
        
        if (event.location) {
          lines.push(`LOCATION:${event.location}`);
        }
        
        if (event.allDay) {
          lines.push(`X-MICROSOFT-CDO-ALLDAYEVENT:TRUE`);
        }
        
        lines.push('END:VEVENT');
      }
      
      lines.push('END:VCALENDAR');
      
      // Apply proper line folding for RFC 5545 compliance
      const foldedLines = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip empty lines
        if (!line.trim()) continue;
        
        // If the line is longer than 75 characters, fold it according to RFC 5545
        if (line.length > 75) {
          let currentPos = 0;
          const lineLength = line.length;
          
          // Add the first line
          foldedLines.push(line.substring(0, 75));
          currentPos = 75;
          
          // Add continuation lines with a space at the beginning
          while (currentPos < lineLength) {
            const chunk = line.substring(currentPos, Math.min(currentPos + 74, lineLength));
            foldedLines.push(' ' + chunk); // Continuation lines must start with a space
            currentPos += 74;
          }
        } else {
          foldedLines.push(line);
        }
      }
      
      // Convert to string with CRLF line endings
      const icalContent = foldedLines.join('\r\n');
      
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
      
      // Create the initial lines array
      let lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${calendarName}`,
        'X-WR-CALDESC:Exported Calendar'
      ];
      
      // Add each event
      for (const event of mergedEvents) {
        const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
        const startDate = formatICALDate(event.startDate);
        const endDate = formatICALDate(event.endDate);
        
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${safeUid}`);
        lines.push(`DTSTAMP:${now}`);
        lines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}`);
        lines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}`);
        lines.push(`SUMMARY:${event.summary}`);
        
        if (event.calendarName) {
          lines.push(`CATEGORIES:${event.calendarName}`);
        }
        
        if (event.description) {
          lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`);
        }
        
        if (event.location) {
          lines.push(`LOCATION:${event.location}`);
        }
        
        if (event.allDay) {
          lines.push(`X-MICROSOFT-CDO-ALLDAYEVENT:TRUE`);
        }
        
        lines.push('END:VEVENT');
      }
      
      lines.push('END:VCALENDAR');
      
      // Apply proper line folding for RFC 5545 compliance
      const foldedLines = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip empty lines
        if (!line.trim()) continue;
        
        // If the line is longer than 75 characters, fold it according to RFC 5545
        if (line.length > 75) {
          let currentPos = 0;
          const lineLength = line.length;
          
          // Add the first line
          foldedLines.push(line.substring(0, 75));
          currentPos = 75;
          
          // Add continuation lines with a space at the beginning
          while (currentPos < lineLength) {
            const chunk = line.substring(currentPos, Math.min(currentPos + 74, lineLength));
            foldedLines.push(' ' + chunk); // Continuation lines must start with a space
            currentPos += 74;
          }
        } else {
          foldedLines.push(line);
        }
      }
      
      // Convert to string with CRLF line endings
      const icalContent = foldedLines.join('\r\n');
      
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