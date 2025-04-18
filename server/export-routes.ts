import { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { formatICS, sanitizeAndFormatICS, createBasicICS } from "../shared/ics-formatter";

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
  
  // New direct export endpoint with robust authentication and error handling
  app.get("/api/export-direct", async (req, res) => {
    try {
      // Debug authentication state
      console.log('Export-direct request received');
      console.log('Session ID:', req.sessionID);
      console.log('Is authenticated:', req.isAuthenticated());
      console.log('User in session:', req.user ? 'User exists' : 'No user in session');
      
      if (!req.isAuthenticated() || !req.user) {
        console.error('User not authenticated when accessing export-direct');
        return res.status(401).json({ message: 'Authentication required. Please log in and try again.' });
      }
      
      const userId = (req.user as User).id;
      console.log(`[EXPORT] Direct calendar export requested by user ID: ${userId}`);
      
      // Get the calendar IDs from the query string
      const calendarIds = req.query.ids 
        ? String(req.query.ids)
            .split(',')
            .map(id => {
              const num = parseInt(id.trim(), 10);
              return isNaN(num) ? null : num;
            })
            .filter((id): id is number => id !== null)
        : [];
      
      // Date filters (optional)
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
      
      if (calendarIds.length === 0) {
        console.error(`[EXPORT] No valid calendar IDs provided by user ${userId}`);
        return res.status(400).json({ message: 'No calendars selected for export' });
      }
      
      console.log(`[EXPORT] Requested calendars: ${calendarIds.join(', ')} for user ${userId}`);
      
      // Get user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      console.log(`[EXPORT] Found ${userCalendars.length} owned calendars and ${sharedCalendars.length} shared calendars`);
      
      // Map for quick lookup
      const calendarMap = new Map();
      [...userCalendars, ...sharedCalendars].forEach(cal => {
        calendarMap.set(cal.id, cal);
      });
      
      // Check if user has access to requested calendars
      const accessibleCalendarIds = new Set([
        ...userCalendars.map(cal => cal.id),
        ...sharedCalendars.map(cal => cal.id)
      ]);
      
      // Filter requested calendars by user's accessible calendars
      const validCalendarIds = calendarIds.filter(id => accessibleCalendarIds.has(id));
      
      if (validCalendarIds.length === 0) {
        console.error(`[EXPORT] User ${userId} attempted to export ${calendarIds.length} calendars but has access to none`);
        return res.status(403).json({ 
          message: 'You do not have permission to export any of the selected calendars' 
        });
      }
      
      console.log(`[EXPORT] Processing ${validCalendarIds.length} valid calendars out of ${calendarIds.length} requested`);
      
      // Gather events from all selected calendars
      const allEvents = [];
      
      for (const calendarId of validCalendarIds) {
        const calendar = calendarMap.get(calendarId);
        if (!calendar) {
          console.warn(`[EXPORT] Calendar ${calendarId} not found in map`);
          continue;
        }
        
        // Get all events for this calendar
        const events = await storage.getEvents(calendarId);
        console.log(`[EXPORT] Retrieved ${events.length} events from calendar: ${calendar.name} (ID: ${calendarId})`);
        
        // Filter by date if needed
        let filteredEvents = events;
        if (startDate && endDate) {
          filteredEvents = events.filter(event => {
            const eventStart = new Date(event.startDate);
            const eventEnd = new Date(event.endDate);
            return (eventStart >= startDate && eventStart <= endDate) || 
                  (eventEnd >= startDate && eventEnd <= endDate) ||
                  (eventStart <= startDate && eventEnd >= endDate);
          });
          console.log(`[EXPORT] Filtered to ${filteredEvents.length} events within date range`);
        }
        
        // Add calendar info to each event
        allEvents.push(...filteredEvents.map(event => ({
          ...event,
          calendarName: calendar.name,
          calendarColor: calendar.color
        })));
      }
      
      if (allEvents.length === 0) {
        console.warn(`[EXPORT] No events found to export for user ${userId}`);
        return res.status(404).json({ message: 'No events found to export in the selected calendars' });
      }
      
      console.log(`[EXPORT] Generating ICS file with ${allEvents.length} events`);
      
      // Generate .ics file content
      const now = formatICALDate(new Date());
      
      let calendarName = 'Exported Calendars';
      if (validCalendarIds.length === 1) {
        calendarName = calendarMap.get(validCalendarIds[0])?.name || 'Exported Calendar';
      }
      
      // Standard iCalendar headers
      let lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${calendarName}`,
        'X-WR-CALDESC:Exported from CalDAV Client'
      ];
      
      // Add each event to the iCalendar file
      for (const event of allEvents) {
        const safeUid = event.uid?.includes('@') ? event.uid : `${event.uid || `event-${Date.now()}`}@caldavclient.local`;
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
          // Format description properly for iCalendar
          const formattedDesc = event.description
            .replace(/\n/g, '\\n')  // Line breaks
            .replace(/,/g, '\\,')   // Commas
            .replace(/;/g, '\\;');  // Semicolons
          
          lines.push(`DESCRIPTION:${formattedDesc}`);
        }
        
        if (event.location) {
          lines.push(`LOCATION:${event.location.replace(/,/g, '\\,').replace(/;/g, '\\;')}`);
        }
        
        if (event.allDay) {
          lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
        }
        
        // Add custom property for calendar color if available
        if (event.calendarColor) {
          lines.push(`X-CALDAV-COLOR:${event.calendarColor}`);
        }
        
        lines.push('END:VEVENT');
      }
      
      lines.push('END:VCALENDAR');
      
      // Use our shared formatter to ensure proper line folding and character encoding
      const icalContent = formatICS(lines);
      
      // Set filename
      let filename = 'calendars_export.ics';
      if (validCalendarIds.length === 1) {
        const safeCalendarName = calendarName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        filename = `calendar_${safeCalendarName}.ics`;
      }
      
      // Set response headers for file download
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icalContent);
      
      console.log(`[EXPORT] Successfully exported ${allEvents.length} events for user ${userId}`);
      
    } catch (error) {
      console.error('[EXPORT] Error generating calendar export:', error);
      res.status(500).json({ 
        message: 'Failed to export calendars', 
        error: error instanceof Error ? error.message : String(error)
      });
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
      
      // If we have raw ICS data, use it with our shared sanitization utility
      if (event.rawData && typeof event.rawData === 'string' && !event.rawData.startsWith('"BEGIN:VCALENDAR')) {
        console.log('Using raw ICS data for download with shared sanitizer');
        
        // Use our shared utility for consistent RFC 5545 formatting
        icsContent = sanitizeAndFormatICS(event.rawData);
      } else {
        // Create basic iCalendar format using our enhanced shared utility
        const startDate = new Date(event.startDate);
        const endDate = new Date(event.endDate);
        
        console.log('Creating basic ICS file for download using enhanced shared utility');
        
        // Parse attendees if present
        let attendees = [];
        try {
          if (event.attendees) {
            if (typeof event.attendees === 'string') {
              attendees = JSON.parse(event.attendees);
            } else if (Array.isArray(event.attendees)) {
              attendees = event.attendees;
            }
          }
        } catch (err) {
          console.warn('Failed to parse attendees:', err);
        }
        
        // Parse resources if present
        let resources = [];
        try {
          if (event.resources) {
            if (typeof event.resources === 'string') {
              resources = JSON.parse(event.resources);
            } else if (Array.isArray(event.resources)) {
              resources = event.resources;
            }
          }
        } catch (err) {
          console.warn('Failed to parse resources:', err);
        }
        
        // Parse recurrence rule
        let recurrenceRule = event.recurrenceRule;
        if (recurrenceRule && recurrenceRule.includes('mailto')) {
          recurrenceRule = recurrenceRule.split(/mailto:|mailto/)[0];
        }
        
        // Use enhanced createBasicICS function for consistent RFC 5545 formatting with all event details
        icsContent = createBasicICS({
          title: event.title,
          startDate,
          endDate,
          description: event.description || '',
          location: event.location || '',
          uid: event.uid || `event-${Date.now()}`,
          attendees,
          resources,
          recurrenceRule,
          organizer: event.organizer || {
            email: 'calendar-app@example.com',
            name: 'Calendar App'
          }
        });
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

  // POST endpoint for calendar export
  app.post("/api/calendars/export-post", isAuthenticated, async (req, res) => {
    try {
      // Debug authentication state
      console.log('POST Export request received');
      console.log('Session ID:', req.sessionID);
      console.log('Is authenticated:', req.isAuthenticated());
      console.log('User in session:', req.user ? 'User exists' : 'No user in session');
      
      if (!req.isAuthenticated() || !req.user) {
        console.error('User not authenticated when accessing export-post');
        return res.status(401).json({ message: 'Authentication required. Please log in and try again.' });
      }
      
      const userId = (req.user as User).id;
      console.log(`[EXPORT-POST] Calendar export requested by user ID: ${userId}`);
      
      // Get the calendar IDs from the body 
      const rawIds = req.body.calendarIds || '';
      const calendarIds = rawIds
        .split(',')
        .map(id => {
          const num = parseInt(id.trim(), 10);
          return isNaN(num) ? null : num;
        })
        .filter((id): id is number => id !== null);
      
      // Get date filters if provided
      const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
      const endDate = req.body.endDate ? new Date(req.body.endDate) : null;
      
      console.log(`[EXPORT-POST] Request details: IDs=${rawIds}, Calendar IDs parsed: ${calendarIds.join(', ')}`);
      
      if (calendarIds.length === 0) {
        console.error(`[EXPORT-POST] No valid calendar IDs provided`);
        return res.status(400).json({ message: 'No calendars selected for export' });
      }
      
      // Get user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      console.log(`[EXPORT-POST] User has ${userCalendars.length} own calendars and ${sharedCalendars.length} shared calendars`);
      
      // Map calendars for lookup by ID
      const calendarMap = new Map();
      [...userCalendars, ...sharedCalendars].forEach(cal => {
        calendarMap.set(cal.id, cal);
      });
      
      // Check which calendars the user has access to
      const accessibleCalendarIds = new Set([
        ...userCalendars.map(cal => cal.id),
        ...sharedCalendars.map(cal => cal.id)
      ]);
      
      // Filter out any calendar IDs the user doesn't have access to
      const validCalendarIds = calendarIds.filter(id => accessibleCalendarIds.has(id));
      
      if (validCalendarIds.length === 0) {
        console.error(`[EXPORT-POST] User ${userId} attempted to export calendars but has no permission for any of them`);
        return res.status(403).json({ message: 'You do not have permission to export any of the selected calendars' });
      }
      
      console.log(`[EXPORT-POST] Processing ${validCalendarIds.length} valid calendars`);
      
      // Generate iCalendar content
      const allEvents = [];
      
      for (const calendarId of validCalendarIds) {
        const calendar = calendarMap.get(calendarId);
        if (!calendar) {
          console.warn(`[EXPORT-POST] Calendar ${calendarId} not found in map`);
          continue;
        }
        
        // Get all events for this calendar
        let events = await storage.getEvents(calendarId);
        console.log(`[EXPORT-POST] Retrieved ${events.length} events from calendar ${calendar.name} (ID: ${calendarId})`);
        
        // Apply date filtering if provided
        if (startDate && endDate) {
          events = events.filter(event => {
            const eventStart = new Date(event.startDate);
            const eventEnd = new Date(event.endDate);
            return (eventStart >= startDate && eventStart <= endDate) || 
                  (eventEnd >= startDate && eventEnd <= endDate) ||
                  (eventStart <= startDate && eventEnd >= endDate);
          });
          console.log(`[EXPORT-POST] Filtered to ${events.length} events within date range`);
        }
        
        // Add calendar information to each event
        const eventsWithCalendarInfo = events.map(event => ({
          ...event,
          calendarName: calendar.name,
          calendarColor: calendar.color
        }));
        
        allEvents.push(...eventsWithCalendarInfo);
      }
      
      if (allEvents.length === 0) {
        console.warn(`[EXPORT-POST] No events found to export`);
        return res.status(404).json({ message: 'No events found to export in the selected calendars' });
      }
      
      // Determine calendar name for the export file
      let calendarName = 'Multiple Calendars';
      if (validCalendarIds.length === 1) {
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
      for (const event of allEvents) {
        const safeUid = event.uid?.includes('@') ? event.uid : `${event.uid || `event-${Date.now()}`}@caldavclient.local`;
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
          const formattedDesc = event.description
            .replace(/\n/g, '\\n')  // Line breaks
            .replace(/,/g, '\\,')   // Commas
            .replace(/;/g, '\\;');  // Semicolons
          
          lines.push(`DESCRIPTION:${formattedDesc}`);
        }
        
        if (event.location) {
          lines.push(`LOCATION:${event.location.replace(/,/g, '\\,').replace(/;/g, '\\;')}`);
        }
        
        if (event.allDay) {
          lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
        }
        
        lines.push('END:VEVENT');
      }
      
      lines.push('END:VCALENDAR');
      
      // Use shared formatter utility to ensure proper RFC 5545 compliance
      const icalContent = formatICS(lines);
      
      // Set the appropriate headers for file download
      let filename = 'calendars_export.ics';
      if (validCalendarIds.length === 1) {
        const safeCalendarName = calendarName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        filename = `calendar_${safeCalendarName}.ics`;
      }
      
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icalContent);
      
      console.log(`[EXPORT-POST] Successfully exported ${allEvents.length} events from ${validCalendarIds.length} calendars`);
      
    } catch (error) {
      console.error('[EXPORT-POST] Error:', error);
      res.status(500).json({ message: 'Failed to export calendars', error: (error as Error).message });
    }
  });
  
  // Calendar Export API - new implementation with parameters for filtering
  app.get("/api/export-simple", isAuthenticated, async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        console.error('User not authenticated when accessing export-simple');
        return res.status(401).json({ message: 'Authentication required' });
      }
      
      console.log('Using simple export endpoint');
      const userId = (req.user as User).id;
      console.log(`Simple calendar export requested by user ID: ${userId}`);
      
      // Parse requested calendar IDs
      const requestedIds = req.query.ids ? 
        String(req.query.ids)
          .split(',')
          .map(id => {
            const num = parseInt(id.trim(), 10);
            return isNaN(num) ? null : num;
          })
          .filter((id): id is number => id !== null)
        : [];
        
      console.log(`Received request for specific calendar IDs: ${requestedIds.join(', ')}`);
      
      // Date filters (optional)
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
      
      if (startDate && endDate) {
        console.log(`Filtering events between ${startDate.toISOString()} and ${endDate.toISOString()}`);
      }
      
      // Get all events for the user without calendar database lookups
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      console.log(`Found ${userCalendars.length} owned calendars and ${sharedCalendars.length} shared calendars`);
      
      const allCalendars = [...userCalendars, ...sharedCalendars];
      
      // If no calendars are available, return an error
      if (allCalendars.length === 0) {
        console.error(`No calendars found for user ID ${userId}`);
        return res.status(404).json({ message: 'No calendars found for user' });
      }
      
      // Filter by requested IDs if provided
      const calendarsToExport = requestedIds.length > 0 
        ? allCalendars.filter(cal => requestedIds.includes(cal.id))
        : allCalendars;
        
      console.log(`Exporting ${calendarsToExport.length} out of ${allCalendars.length} available calendars`);
      
      if (calendarsToExport.length === 0) {
        console.error(`None of the requested calendars (${requestedIds.join(', ')}) are available for user ${userId}`);
        return res.status(404).json({ message: 'The selected calendars are not available for export' });
      }
      
      // Get all events from selected calendars
      const allEvents = [];
      
      for (const calendar of calendarsToExport) {
        console.log(`Getting events for calendar ${calendar.name} (ID: ${calendar.id})`);
        const events = await storage.getEvents(calendar.id);
        
        // Filter by date if needed
        let filteredEvents = events;
        if (startDate && endDate) {
          filteredEvents = events.filter(event => {
            const eventStart = new Date(event.startDate);
            const eventEnd = new Date(event.endDate);
            return (eventStart >= startDate && eventStart <= endDate) || 
                  (eventEnd >= startDate && eventEnd <= endDate) ||
                  (eventStart <= startDate && eventEnd >= endDate);
          });
          console.log(`Filtered ${events.length} down to ${filteredEvents.length} events within date range`);
        }
        
        allEvents.push(...filteredEvents.map(event => ({
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
      
      // Use shared formatter utility to ensure proper RFC 5545 compliance
      const icalContent = formatICS(lines);
      
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
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      
      const userId = (req.user as User).id;
      
      console.log(`Calendar export requested by user ID: ${userId}`);
      
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
        console.error(`User ${userId} attempted to export calendars ${calendarIds.join(', ')} but has no permission for any of them`);
        console.error(`User has access to calendars: ${Array.from(accessibleCalendarIds).join(', ')}`);
        return res.status(403).json({ 
          message: 'You do not have permission to export these calendars',
          attemptedCalendarIds: calendarIds,
          accessibleCalendarIds: Array.from(accessibleCalendarIds)
        });
      }
      
      console.log(`Proceeding with export for validated calendar IDs: ${validCalendarIds.join(', ')}`);
      
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
      
      // Use shared formatter utility to ensure proper RFC 5545 compliance
      const icalContent = formatICS(lines);
      
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