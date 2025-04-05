// Format date for iCalendar - YYYYMMDDTHHMMSSZ format
export function formatICALDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generates iCalendar format data for an array of events
 * Handles both single events and multiple events
 */
export function generateThunderbirdCompatibleICS(
  calendarNameOrEvent: string | {
    uid: string;
    title: string;
    startDate: Date;
    endDate: Date;
    description?: string;
    location?: string;
    attendees?: string[];
    resources?: string[];
    busyStatus?: string;
    recurrenceRule?: string;
    allDay?: boolean;
  },
  events?: Array<{
    uid: string;
    summary: string;
    description?: string;
    location?: string;
    startDate: Date;
    endDate: Date;
    allDay?: boolean;
    recurring?: boolean;
    calendarName?: string;
  }>
): string {
  // Handle multi-calendar export case
  if (typeof calendarNameOrEvent === 'string' && events) {
    const calendarName = calendarNameOrEvent;
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
    for (const event of events) {
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
    return icalContent;
  }
  
  // Handle single event case (original implementation)
  const event = calendarNameOrEvent as {
    uid: string;
    title: string;
    startDate: Date;
    endDate: Date;
    description?: string;
    location?: string;
    attendees?: string[];
    resources?: string[];
    busyStatus?: string;
    recurrenceRule?: string;
    allDay?: boolean;
  };
  
  // Create a formatted UID that's compatible with Thunderbird
  // We'll use the provided UID, but ensure it has the right format
  const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
  
  // Format dates properly - use formatICALDate helper
  const now = formatICALDate(new Date());
  const startDate = formatICALDate(event.startDate);
  const endDate = formatICALDate(event.endDate);
  
  // Determine transparency based on busy status
  const transp = event.busyStatus === 'free' ? 'TRANSPARENT' : 'OPAQUE';
  
  // Determine status based on busyStatus
  let eventStatus = 'CONFIRMED';
  if (event.busyStatus === 'tentative') {
    eventStatus = 'TENTATIVE';
  } else if (event.busyStatus === 'cancelled') {
    eventStatus = 'CANCELLED';
  }
  
  // Prepare base event components
  const eventComponents = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${safeUid}`,
    `DTSTAMP:${now}`,
    `DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}`,
    `DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}`,
    `SUMMARY:${event.title}`,
    event.description ? `DESCRIPTION:${event.description}` : '',
    event.location ? `LOCATION:${event.location}` : '',
    `TRANSP:${transp}`,
    'SEQUENCE:0',
    `CREATED:${now}`,
    `LAST-MODIFIED:${now}`,
    `STATUS:${eventStatus}`,
  ];
  
  // Add recurrence rule if provided
  if (event.recurrenceRule) {
    try {
      // Define the recurrence rule type for better type checking
      interface RecurrenceRule {
        pattern: string;
        interval?: number;
        weekdays?: string[];
        endType?: string;
        occurrences?: number;
        untilDate?: string;
      }
      
      // Try to parse the recurrence rule as JSON if it's a string
      const rule: RecurrenceRule = typeof event.recurrenceRule === 'string' 
        ? JSON.parse(event.recurrenceRule) 
        : event.recurrenceRule;
      
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
        // Convert date to RRULE format (YYYYMMDD)
        const untilDate = new Date(rule.untilDate);
        const formattedUntil = untilDate.toISOString().slice(0, 10).replace(/-/g, '');
        rruleString += `;UNTIL=${formattedUntil}`;
      }
      
      eventComponents.push(rruleString);
    } catch (error) {
      console.error('Error parsing recurrence rule:', error);
      // If we can't parse it as JSON or encounter another error, try using it directly (fallback)
      if (typeof event.recurrenceRule === 'string' && event.recurrenceRule.startsWith('RRULE:')) {
        eventComponents.push(event.recurrenceRule);
      }
    }
  }
  
  // Add attendees if provided
  if (event.attendees && event.attendees.length > 0) {
    // Process each attendee
    event.attendees.forEach(attendeeItem => {
      try {
        // Handle both string and object formats
        if (typeof attendeeItem === 'string') {
          // Simple string format (just email)
          let email = attendeeItem;
          let formattedAttendee = email;
          
          // Ensure mailto: prefix for emails
          if (email.includes('@')) {
            formattedAttendee = `mailto:${email}`;
          }
          
          // Add as regular participant
          eventComponents.push(`ATTENDEE;CN=${email};ROLE=REQ-PARTICIPANT:${formattedAttendee}`);
        } 
        else if (typeof attendeeItem === 'object' && attendeeItem !== null) {
          // Object format with email and role
          const attendee = attendeeItem as { email: string, role?: string };
          
          if (!attendee.email) {
            console.warn('Attendee object missing email:', attendeeItem);
            return; // Skip this attendee
          }
          
          // Ensure mailto: prefix
          const formattedAttendee = `mailto:${attendee.email}`;
          
          // Map our role types to iCalendar role types
          let icalRole = 'REQ-PARTICIPANT';
          
          if (attendee.role) {
            switch (attendee.role) {
              case 'Chairman':
                icalRole = 'CHAIR';
                break;
              case 'Secretary':
                icalRole = 'OPT-PARTICIPANT'; // Not perfect match but closest in iCal
                break;
              case 'Member':
              default:
                icalRole = 'REQ-PARTICIPANT';
            }
          }
          
          // Add attendee with proper role
          eventComponents.push(`ATTENDEE;CN=${attendee.email};ROLE=${icalRole}:${formattedAttendee}`);
        }
      } catch (error) {
        console.error('Error processing attendee:', error, attendeeItem);
      }
    });
  }
  
  // Add resources if provided
  if (event.resources && event.resources.length > 0) {
    event.resources.forEach(resource => {
      eventComponents.push(`RESOURCES:${resource}`);
    });
  }
  
  // Add standard properties
  eventComponents.push(
    'X-MOZ-GENERATION:1',
    `X-MICROSOFT-CDO-ALLDAYEVENT:${event.allDay ? 'TRUE' : 'FALSE'}`,
    'X-MICROSOFT-CDO-IMPORTANCE:1',
    'END:VEVENT',
    'END:VCALENDAR'
  );
  
  return eventComponents.filter(Boolean).join('\r\n');
}