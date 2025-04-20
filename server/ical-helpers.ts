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
  isRecurring?: boolean; // Add isRecurring flag to help enforce consistent state
}): string {
  // CRITICAL BUGFIX: Ensure recurrence rule and isRecurring flag are consistent
  // If event is marked as recurring but has no rule, provide a default rule
  if (event.isRecurring === true && !event.recurrenceRule) {
    console.warn(`[CRITICAL BUGFIX] Event with UID ${event.uid} is marked as recurring but has no recurrence rule`);
    event.recurrenceRule = "FREQ=DAILY;COUNT=3"; // Default rule
    console.log(`[CRITICAL BUGFIX] Applied default recurrence rule: ${event.recurrenceRule}`);
  }
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
  // CRITICAL FIX: Sanitize the UID to prevent embedding of complete ICS content
  // This fixes the bug where UIDs were getting corrupted with embedded event data
  let sanitizedUid = event.uid;
  
  // Check if the UID contains embedded ICS data and fix it
  if (sanitizedUid.includes('BEGIN:VCALENDAR') || sanitizedUid.includes('\n') || sanitizedUid.includes('\r')) {
    console.log(`[CRITICAL FIX] Detected corrupt UID with embedded ICS data: ${sanitizedUid.substring(0, 50)}...`);
    
    // Extract just the base UID without the embedded data - first try exact pattern
    if (sanitizedUid.includes('@caldavclient.local')) {
      const baseUidRegex = /(event-\d+-[a-z0-9]+@caldavclient\.local)/;
      const uidMatch = sanitizedUid.match(baseUidRegex);
      
      if (uidMatch && uidMatch[1]) {
        sanitizedUid = uidMatch[1];
        console.log(`[CRITICAL FIX] Extracted clean UID with pattern match: ${sanitizedUid}`);
      } else {
        // Try a more generic approach - grab everything up to the first line break or embedded ICS tag
        const genericMatch = sanitizedUid.split(/[\r\n]|BEGIN:VCALENDAR/)[0];
        if (genericMatch && genericMatch.length > 0) {
          sanitizedUid = genericMatch.trim();
          console.log(`[CRITICAL FIX] Extracted clean UID with generic splitting: ${sanitizedUid}`);
        } else {
          // If all extraction fails, generate a new UID
          sanitizedUid = `regenerated-${Date.now()}@caldavclient.local`;
          console.log(`[CRITICAL FIX] Generated clean replacement UID: ${sanitizedUid}`);
        }
      }
    } else {
      // For non-standard UIDs, just take everything before first line break
      const genericMatch = sanitizedUid.split(/[\r\n]/)[0];
      if (genericMatch && genericMatch.length > 0) {
        sanitizedUid = genericMatch.trim();
        console.log(`[CRITICAL FIX] Extracted generic UID: ${sanitizedUid}`);
      } else {
        // Last resort
        sanitizedUid = `regenerated-${Date.now()}@caldavclient.local`;
        console.log(`[CRITICAL FIX] Generated replacement UID as last resort: ${sanitizedUid}`);
      }
    }
  }
  
  ics.push(`UID:${sanitizedUid}`);
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
  
  // CRITICAL FIX: Enhanced recurrence rule handling with better logging and validation
  if (event.recurrenceRule) {
    // Ensure the RRULE has the required FREQ= component
    let rruleValue = event.recurrenceRule;
    
    // Strip any existing RRULE: prefix if it was incorrectly included
    if (rruleValue.startsWith('RRULE:')) {
      rruleValue = rruleValue.substring(6);
    }
    
    // Validate the RRULE has a FREQ component
    if (!rruleValue.includes('FREQ=')) {
      console.error(`[ICAL CRITICAL] Invalid RRULE missing FREQ component: ${rruleValue}`);
      // Add a default FREQ if missing
      rruleValue = `FREQ=DAILY;${rruleValue}`;
    }
    
    console.log(`[ICAL CRITICAL] Adding recurrence rule to event ${event.uid}: ${rruleValue}`);
    ics.push(`RRULE:${rruleValue}`);
  } else {
    console.log(`[ICAL] No recurrence rule provided for event ${event.uid}`);
  }
  
  // End event and calendar
  ics.push('END:VEVENT');
  ics.push('END:VCALENDAR');
  
  // Join with CRLF line endings
  return ics.join('\r\n');
}