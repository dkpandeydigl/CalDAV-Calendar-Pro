/**
 * iCalendar Helper Functions
 * 
 * These functions help with generating proper iCalendar format strings
 * for the enhanced synchronization service.
 */

/**
 * Format a date for iCalendar (UTC format)
 * 
 * @param date The date to format
 * @param allDay Whether this is an all-day event
 * @returns Formatted date string in iCalendar format
 */
export function formatICalDate(date: Date, allDay: boolean = false): string {
  if (allDay) {
    // For all-day events, use YYYYMMDD format (without time component)
    return date.toISOString().replace(/[-:]/g, '').substring(0, 8);
  } else {
    // For timed events, use full UTC format YYYYMMDDTHHMMSSZ
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
}

/**
 * Escape special characters in iCalendar string
 * 
 * @param text The text to escape
 * @returns Escaped string
 */
export function escapeICalText(text: string): string {
  if (!text) return '';
  
  // Handle basic escaping for iCalendar format
  return text
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/;/g, '\\;')   // Escape semicolons
    .replace(/,/g, '\\,')   // Escape commas
    .replace(/\n/g, '\\n');  // Replace newlines with \n
}

/**
 * Format content line for iCalendar file (max 75 chars per line)
 * 
 * @param line The content line to format
 * @returns Properly formatted line
 */
export function formatContentLine(line: string): string {
  if (!line) return '';
  
  // Initial string
  let result = line;
  
  // RFC 5545 requires lines to be no longer than 75 octets
  // Continuation lines start with a space
  const chunks = [];
  while (result.length > 75) {
    chunks.push(result.slice(0, 75));
    result = result.slice(75);
    result = ' ' + result;
  }
  chunks.push(result);
  
  return chunks.join('\r\n');
}

/**
 * Prepare an attendee object for iCalendar formatting
 * 
 * @param attendee The attendee object
 * @returns iCalendar-formatted attendee string
 */
export function prepareAttendeeForIcal(attendee: any): string {
  if (!attendee || !attendee.email) {
    return '';
  }
  
  // Start with basic attendee details
  let result = 'ATTENDEE';
  
  // Add name if provided
  if (attendee.name) {
    result += `;CN="${escapeICalText(attendee.name)}"`;
  }
  
  // Add role if provided (default to REQ-PARTICIPANT)
  const role = attendee.role || 'REQ-PARTICIPANT';
  result += `;ROLE=${role}`;
  
  // Add participation status if provided (default to NEEDS-ACTION)
  const status = attendee.status || 'NEEDS-ACTION';
  result += `;PARTSTAT=${status}`;
  
  // Add RSVP if provided (default to TRUE)
  const rsvp = attendee.rsvp !== false ? 'TRUE' : 'FALSE';
  result += `;RSVP=${rsvp}`;
  
  // Add email address
  result += `:mailto:${attendee.email}`;
  
  return result;
}

/**
 * Prepare a resource for iCalendar formatting
 * 
 * @param resource The resource object
 * @returns iCalendar-formatted resource string (as an attendee with CUTYPE=RESOURCE)
 */
export function prepareResourceForIcal(resource: any): string {
  if (!resource || !resource.email) {
    return '';
  }
  
  // Start with resource details (resources are special attendees)
  let result = 'ATTENDEE';
  
  // Add name if provided
  if (resource.name) {
    result += `;CN="${escapeICalText(resource.name)}"`;
  }
  
  // Add CUTYPE=RESOURCE to identify as a resource
  result += `;CUTYPE=RESOURCE`;
  
  // Add role
  result += `;ROLE=NON-PARTICIPANT`;
  
  // Add participation status
  result += `;PARTSTAT=ACCEPTED`;
  
  // Add resource type if provided
  if (resource.type) {
    result += `;X-RESOURCE-TYPE=${escapeICalText(resource.type)}`;
  }
  
  // Add capacity if provided
  if (resource.capacity) {
    result += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
  }
  
  // Add admin name if provided
  if (resource.adminName) {
    result += `;X-RESOURCE-ADMIN-NAME="${escapeICalText(resource.adminName)}"`;
  }
  
  // Add email address
  result += `:mailto:${resource.email}`;
  
  return result;
}

/**
 * Generate a complete iCalendar event string
 * 
 * @param event The event details
 * @returns Complete iCalendar event string
 */
export function generateEventICalString(event: {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
  attendees?: any[];
  resources?: any[];
  organizer?: { email: string; name?: string };
  recurrenceRule?: string;
}): string {
  const now = new Date();
  
  // Begin iCalendar object
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT'
  ];
  
  // Add required properties
  ics.push(`UID:${event.uid}`);
  ics.push(`DTSTAMP:${formatICalDate(now)}`);
  ics.push(`CREATED:${formatICalDate(now)}`);
  ics.push(`LAST-MODIFIED:${formatICalDate(now)}`);
  ics.push(`SUMMARY:${escapeICalText(event.title)}`);
  
  // Add start and end dates
  const isAllDay = event.allDay || false;
  if (isAllDay) {
    ics.push(`DTSTART;VALUE=DATE:${formatICalDate(event.startDate, true)}`);
    ics.push(`DTEND;VALUE=DATE:${formatICalDate(event.endDate, true)}`);
  } else {
    ics.push(`DTSTART:${formatICalDate(event.startDate)}`);
    ics.push(`DTEND:${formatICalDate(event.endDate)}`);
  }
  
  // Add optional properties
  if (event.description) {
    ics.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }
  
  if (event.location) {
    ics.push(`LOCATION:${escapeICalText(event.location)}`);
  }
  
  // Add sequence
  ics.push('SEQUENCE:0');
  
  // Add status
  ics.push('STATUS:CONFIRMED');
  
  // Add organizer if provided
  if (event.organizer && event.organizer.email) {
    let organizer = 'ORGANIZER';
    if (event.organizer.name) {
      organizer += `;CN="${escapeICalText(event.organizer.name)}"`;
    }
    organizer += `:mailto:${event.organizer.email}`;
    ics.push(organizer);
  }
  
  // Add attendees if provided
  if (event.attendees && Array.isArray(event.attendees) && event.attendees.length > 0) {
    for (const attendee of event.attendees) {
      const formattedAttendee = prepareAttendeeForIcal(attendee);
      if (formattedAttendee) {
        ics.push(formatContentLine(formattedAttendee));
      }
    }
  }
  
  // Add resources if provided
  if (event.resources && Array.isArray(event.resources) && event.resources.length > 0) {
    for (const resource of event.resources) {
      const formattedResource = prepareResourceForIcal(resource);
      if (formattedResource) {
        ics.push(formatContentLine(formattedResource));
      }
    }
  }
  
  // Add recurrence rule if provided
  if (event.recurrenceRule) {
    ics.push(`RRULE:${event.recurrenceRule}`);
  }
  
  // End event and calendar
  ics.push('END:VEVENT');
  ics.push('END:VCALENDAR');
  
  // Join with CRLF line endings
  return ics.join('\r\n');
}