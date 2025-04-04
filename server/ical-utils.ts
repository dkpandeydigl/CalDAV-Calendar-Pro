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
    eventComponents.push(event.recurrenceRule);
  }
  
  // Add attendees if provided
  if (event.attendees && event.attendees.length > 0) {
    event.attendees.forEach(attendee => {
      // Format email correctly for iCalendar
      let formattedAttendee = attendee;
      if (attendee.includes('@')) {
        formattedAttendee = `mailto:${attendee}`;
      }
      eventComponents.push(`ATTENDEE;CN=${attendee};ROLE=REQ-PARTICIPANT:${formattedAttendee}`);
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