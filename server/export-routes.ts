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
  // Single event export endpoint
  app.get("/api/events/:id/export", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: 'Invalid event ID' });
      }

      const userId = (req.user as User).id;
      
      // Fetch the event
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: 'Event not found' });
      }
      
      // Check if user has permission to view this event
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      const accessibleCalendarIds = new Set([
        ...userCalendars.map(cal => cal.id),
        ...sharedCalendars.map(cal => cal.id)
      ]);
      
      if (!accessibleCalendarIds.has(event.calendarId)) {
        return res.status(403).json({ message: 'You do not have permission to export this event' });
      }
      
      // Get calendar info
      const calendar = [...userCalendars, ...sharedCalendars].find(cal => cal.id === event.calendarId);
      if (!calendar) {
        return res.status(404).json({ message: 'Calendar not found' });
      }
      
      // Check if raw_data exists and is a valid iCalendar
      if (event.rawData && typeof event.rawData === 'string') {
        try {
          // Try to parse the rawData (it might be JSON stringified)
          let rawDataContent: string;
          try {
            rawDataContent = JSON.parse(event.rawData);
          } catch (e) {
            // If it's not valid JSON, use it as is
            rawDataContent = event.rawData;
          }
          
          // Check if it's a valid iCalendar
          if (rawDataContent.startsWith('BEGIN:VCALENDAR') && 
              rawDataContent.includes('BEGIN:VEVENT') &&
              rawDataContent.includes('END:VEVENT') && 
              rawDataContent.includes('END:VCALENDAR')) {
                
            console.log('Using raw iCalendar data for export');
            // Use the raw data directly, which preserves all properties including RRULE and ATTENDEE
            return res.send(rawDataContent);
          }
        } catch (e) {
          console.error('Error parsing raw data:', e);
        }
      }
      
      // Fallback to generating iCalendar content if raw_data can't be used
      console.log('Generating new iCalendar data for export');
      const now = formatICALDate(new Date());
      const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
      const startDate = formatICALDate(new Date(event.startDate));
      const endDate = formatICALDate(new Date(event.endDate));
      
      let icalContent = 
        `BEGIN:VCALENDAR\r\n` +
        `VERSION:2.0\r\n` +
        `PRODID:-//CalDAV Client//NONSGML v1.0//EN\r\n` +
        `CALSCALE:GREGORIAN\r\n` +
        `METHOD:PUBLISH\r\n` +
        `X-WR-CALNAME:${event.title}\r\n` +
        `X-WR-CALDESC:Exported Event\r\n` +
        `BEGIN:VEVENT\r\n` +
        `UID:${safeUid}\r\n` +
        `DTSTAMP:${now}\r\n` +
        `DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}\r\n` +
        `DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}\r\n` +
        `SUMMARY:${event.title}\r\n` +
        `CATEGORIES:${calendar.name}\r\n`;
      
      // Add description if available
      if (event.description) {
        icalContent += `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}\r\n`;
      }
      
      // Add location if available
      if (event.location) {
        icalContent += `LOCATION:${event.location}\r\n`;
      }
      
      // Add recurrence rule if available
      if (event.recurrenceRule) {
        // Handle different types of recurrence rule formats
        if (typeof event.recurrenceRule === 'string') {
          // If it starts with RRULE:, use it directly
          if (event.recurrenceRule.startsWith('RRULE:')) {
            icalContent += `${event.recurrenceRule}\r\n`;
          } else {
            try {
              // Try to parse JSON string
              const ruleObj = JSON.parse(event.recurrenceRule);
              icalContent += formatRecurrenceRule(ruleObj);
            } catch (e) {
              // If not valid JSON, use as is with RRULE: prefix
              icalContent += `RRULE:${event.recurrenceRule}\r\n`;
            }
          }
        } else if (typeof event.recurrenceRule === 'object') {
          // It's already an object
          icalContent += formatRecurrenceRule(event.recurrenceRule);
        }
      }
      
      // Add attendees if available
      if (event.attendees) {
        let attendeesList: any[] = [];
        
        // Handle string format (JSON string)
        if (typeof event.attendees === 'string') {
          try {
            // Parse JSON string to array
            const parsed = JSON.parse(event.attendees);
            attendeesList = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            // Treat as a single string attendee as fallback
            attendeesList = [event.attendees];
          }
        } 
        // Handle already parsed array
        else if (Array.isArray(event.attendees)) {
          attendeesList = event.attendees;
        }
        // Handle other formats (single item)
        else if (typeof event.attendees === 'object' && event.attendees !== null) {
          attendeesList = [event.attendees];
        }
        
        // Process each attendee
        for (let i = 0; i < attendeesList.length; i++) {
          const attendeeItem = attendeesList[i];
          if (typeof attendeeItem === 'object' && attendeeItem !== null && 'email' in attendeeItem) {
            const attendee = attendeeItem as { email: string, role?: string };
            // Map role or use default
            const role = attendee.role === 'Chairman' ? 'CHAIR' :
                          attendee.role === 'Secretary' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT';
            
            icalContent += `ATTENDEE;CN=${attendee.email};ROLE=${role}:mailto:${attendee.email}\r\n`;
          } else if (typeof attendeeItem === 'string') {
            icalContent += `ATTENDEE;CN=${attendeeItem};ROLE=REQ-PARTICIPANT:mailto:${attendeeItem}\r\n`;
          }
        }
      }
      
      // Add resources if available
      if (event.resources) {
        let resourcesList: any[] = [];
        
        // Handle string format (JSON string)
        if (typeof event.resources === 'string') {
          try {
            // Parse JSON string to array
            const parsed = JSON.parse(event.resources);
            resourcesList = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            // Treat as a single string resource as fallback
            resourcesList = [event.resources];
          }
        } 
        // Handle already parsed array
        else if (Array.isArray(event.resources)) {
          resourcesList = event.resources;
        }
        // Handle other formats (single item)
        else if (typeof event.resources === 'object' && event.resources !== null) {
          resourcesList = [event.resources];
        }
        
        // Process each resource
        for (let i = 0; i < resourcesList.length; i++) {
          const resource = resourcesList[i];
          if (resource) {  // Check for null/undefined
            const resourceStr = typeof resource === 'string' ? resource : String(resource);
            icalContent += `RESOURCES:${resourceStr}\r\n`;
          }
        }
      }
      
      // Add other standard properties
      if (event.allDay) {
        icalContent += `X-MICROSOFT-CDO-ALLDAYEVENT:TRUE\r\n`;
      } else {
        icalContent += `X-MICROSOFT-CDO-ALLDAYEVENT:FALSE\r\n`;
      }
      
      icalContent += 
        `END:VEVENT\r\n` +
        `END:VCALENDAR`;
      
      // Set the appropriate headers for file download
      const safeEventName = event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `event_${safeEventName}.ics`;
      
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icalContent);
      
      console.log(`Successfully exported event ${eventId} (${event.title})`);
      
    } catch (error) {
      console.error('Error exporting event:', error);
      res.status(500).json({ message: 'Failed to export event', error: String(error) });
    }
  });
  
  // Helper function to format recurrence rule
  function formatRecurrenceRule(rule: any): string {
    if (!rule || !rule.pattern) {
      return '';
    }
    
    // Convert our rule format to iCalendar RRULE format
    let rruleString = 'RRULE:FREQ=';
    
    // Map our pattern to iCalendar frequency
    switch (rule.pattern) {
      case 'Daily':
        rruleString += 'DAILY';
        break;
      case 'Weekly':
        rruleString += 'WEEKLY';
        break;
      case 'Monthly':
        rruleString += 'MONTHLY';
        break;
      case 'Yearly':
        rruleString += 'YEARLY';
        break;
      default:
        rruleString += 'DAILY'; // Default to daily if not specified
    }
    
    // Add interval if greater than 1
    if (rule.interval && rule.interval > 1) {
      rruleString += `;INTERVAL=${rule.interval}`;
    }
    
    // Add weekdays for weekly recurrence
    if (rule.weekdays && Array.isArray(rule.weekdays) && rule.weekdays.length > 0 && rule.pattern === 'Weekly') {
      const dayMap: Record<string, string> = {
        'Sunday': 'SU',
        'Monday': 'MO',
        'Tuesday': 'TU',
        'Wednesday': 'WE',
        'Thursday': 'TH',
        'Friday': 'FR',
        'Saturday': 'SA'
      };
      
      const days = rule.weekdays
        .map((day: string) => dayMap[day])
        .filter(Boolean)
        .join(',');
      
      if (days) {
        rruleString += `;BYDAY=${days}`;
      }
    }
    
    // Add count for "After X occurrences" or until date for "Until date"
    if (rule.endType === 'After' && rule.occurrences) {
      rruleString += `;COUNT=${rule.occurrences}`;
    } else if (rule.endType === 'Until' && rule.untilDate) {
      try {
        // Format the date as required for UNTIL (YYYYMMDDTHHMMSSZ)
        const untilDate = new Date(rule.untilDate);
        // Make sure it's UTC
        const formattedUntil = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        rruleString += `;UNTIL=${formattedUntil}`;
      } catch (e) {
        console.error("Error formatting UNTIL date:", e);
      }
    }
    
    return rruleString + '\r\n';
  }
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