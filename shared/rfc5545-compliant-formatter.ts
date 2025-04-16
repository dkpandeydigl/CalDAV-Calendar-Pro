/**
 * RFC 5545 Compliant iCalendar Formatter
 * 
 * This module implements strict RFC 5545 compliant iCalendar file generation.
 * It ensures proper:
 *  - Line folding at 75 characters
 *  - CRLF line endings
 *  - Character escaping
 *  - Required fields presence
 *  - UID persistence
 */

export type ICSMethod = 'REQUEST' | 'CANCEL' | 'REPLY';
export type ICSStatus = 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';

export interface ICSAttendee {
  email: string;
  name?: string;
  role?: string;
  partstat?: string; // NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE
  rsvp?: boolean;
  type?: string; // INDIVIDUAL, GROUP, RESOURCE, ROOM
}

export interface ICSResource {
  id: string;
  email: string;
  name?: string;
  type?: string;
  capacity?: number;
}

export interface ICSOrganizer {
  email: string;
  name?: string;
}

export interface ICSEventData {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  organizer: ICSOrganizer;
  attendees?: ICSAttendee[];
  resources?: ICSResource[];
  method?: ICSMethod;
  status?: ICSStatus;
  sequence?: number;
  recurrenceRule?: string;
  isAllDay?: boolean;
}

/**
 * Format a date as iCalendar UTC format
 * @param date The date to format
 * @returns iCalendar UTC formatted date string
 */
export function formatDateToUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters in iCalendar text
 * @param text The text to escape
 * @returns Escaped text
 */
export function escapeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\') // Escape backslash first
    .replace(/;/g, '\\;')   // Escape semicolon
    .replace(/,/g, '\\,')   // Escape comma
    .replace(/\n/g, '\\n'); // Escape newline
}

/**
 * Apply line folding to ensure lines don't exceed 75 characters
 * @param line The line to fold
 * @returns The folded line with proper CRLF continuation
 */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  
  const chunks: string[] = [];
  let currentPos = 0;
  
  while (currentPos < line.length) {
    if (currentPos === 0) {
      // First line can be up to 75 chars
      chunks.push(line.substring(0, Math.min(75, line.length)));
      currentPos = Math.min(75, line.length);
    } else {
      // Continuation lines start with a space and can be up to 74 chars after that
      chunks.push(' ' + line.substring(currentPos, Math.min(currentPos + 74, line.length)));
      currentPos += 74;
    }
  }
  
  return chunks.join('\r\n');
}

/**
 * Transform an existing iCalendar string into a cancellation notice
 * @param originalIcs The original iCalendar string
 * @param uid The event UID (must match original)
 * @param sequence The sequence number (should be incremented)
 * @returns A properly formatted cancellation iCalendar string
 */
export function createCancellation(originalIcs: string, uid: string, sequence: number): string {
  // First verify the UID matches to prevent errors
  const uidMatch = originalIcs.match(/UID:([^\r\n]+)/i);
  const originalUid = uidMatch ? uidMatch[1].trim() : null;
  
  if (originalUid && originalUid !== uid) {
    console.error(`UID mismatch: ${originalUid} != ${uid}`);
    throw new Error('UID mismatch: Cannot create cancellation with different UID');
  }
  
  // Modify the key properties for cancellation
  let cancelledIcs = originalIcs
    .replace(/METHOD:[^\r\n]+/i, 'METHOD:CANCEL')
    .replace(/STATUS:[^\r\n]+/i, 'STATUS:CANCELLED')
    .replace(/SEQUENCE:\d+/i, `SEQUENCE:${sequence}`);
  
  // Add METHOD if missing
  if (!cancelledIcs.includes('METHOD:')) {
    cancelledIcs = cancelledIcs.replace(
      /VERSION:[^\r\n]+(\r?\n)/i, 
      `VERSION:2.0$1METHOD:CANCEL$1`
    );
  }
  
  // Add STATUS if missing
  if (!cancelledIcs.includes('STATUS:')) {
    cancelledIcs = cancelledIcs.replace(
      /SEQUENCE:[^\r\n]+(\r?\n)/i,
      `SEQUENCE:${sequence}$1STATUS:CANCELLED$1`
    );
  }
  
  // Add SEQUENCE if missing
  if (!cancelledIcs.includes('SEQUENCE:')) {
    cancelledIcs = cancelledIcs.replace(
      /UID:[^\r\n]+(\r?\n)/i,
      `UID:${uid}$1SEQUENCE:${sequence}$1`
    );
  }
  
  return cancelledIcs;
}

/**
 * Generate a complete iCalendar string for an event
 * @param event The event data
 * @returns RFC 5545 compliant iCalendar string
 */
export function generateICalendarString(event: ICSEventData): string {
  // Default values
  const method = event.method || 'REQUEST';
  const status = event.status || 'CONFIRMED';
  const sequence = event.sequence || 0;
  
  if (!event.uid) {
    throw new Error('Event UID is required');
  }
  
  const dtstamp = formatDateToUTC(new Date());
  const dtstart = formatDateToUTC(event.startDate);
  const dtend = formatDateToUTC(event.endDate);
  
  // Start building the iCalendar string
  let components: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//RFC5545 Compliant//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    `SUMMARY:${escapeText(event.summary)}`
  ];
  
  // Add optional components
  if (event.description) {
    components.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  
  if (event.location) {
    components.push(`LOCATION:${escapeText(event.location)}`);
  }
  
  // Add organizer
  if (event.organizer?.email) {
    let organizerStr = 'ORGANIZER';
    if (event.organizer.name) {
      organizerStr += `;CN=${escapeText(event.organizer.name)}`;
    }
    organizerStr += `:mailto:${event.organizer.email}`;
    components.push(organizerStr);
  }
  
  // Add attendees
  if (event.attendees && event.attendees.length > 0) {
    for (const attendee of event.attendees) {
      if (!attendee.email) continue;
      
      let attendeeStr = 'ATTENDEE';
      
      if (attendee.name) {
        attendeeStr += `;CN=${escapeText(attendee.name)}`;
      }
      
      if (attendee.role) {
        attendeeStr += `;ROLE=${attendee.role}`;
      }
      
      if (attendee.partstat) {
        attendeeStr += `;PARTSTAT=${attendee.partstat}`;
      } else {
        attendeeStr += ';PARTSTAT=NEEDS-ACTION';
      }
      
      if (attendee.rsvp !== false) {
        attendeeStr += ';RSVP=TRUE';
      }
      
      if (attendee.type) {
        attendeeStr += `;CUTYPE=${attendee.type}`;
      } else {
        attendeeStr += ';CUTYPE=INDIVIDUAL';
      }
      
      attendeeStr += `:mailto:${attendee.email}`;
      components.push(attendeeStr);
    }
  }
  
  // Add resources as special attendees
  if (event.resources && event.resources.length > 0) {
    for (const resource of event.resources) {
      if (!resource.email) continue;
      
      let resourceStr = 'ATTENDEE;CUTYPE=RESOURCE';
      
      if (resource.name) {
        resourceStr += `;CN=${escapeText(resource.name)}`;
      }
      
      if (resource.type) {
        resourceStr += `;RESOURCE-TYPE=${resource.type}`;
      } else {
        resourceStr += ';RESOURCE-TYPE=ROOM';
      }
      
      if (resource.id) {
        resourceStr += `;X-RESOURCE-ID=${resource.id}`;
      }
      
      if (resource.capacity) {
        resourceStr += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
      }
      
      resourceStr += `:mailto:${resource.email}`;
      components.push(resourceStr);
    }
  }
  
  // Add recurrence rule if present
  if (event.recurrenceRule) {
    components.push(`RRULE:${event.recurrenceRule}`);
  }
  
  // Close the iCalendar
  components.push('END:VEVENT');
  components.push('END:VCALENDAR');
  
  // Fold any lines that are too long
  const foldedComponents = components.map(line => foldLine(line));
  
  // Join with CRLF as required by RFC 5545
  return foldedComponents.join('\r\n');
}

/**
 * Update an existing iCalendar string with new event data
 * @param originalIcs The original iCalendar string
 * @param event The updated event data (must have same UID)
 * @returns RFC 5545 compliant updated iCalendar string
 */
export function updateICalendarString(originalIcs: string, event: ICSEventData): string {
  // Extract the original UID and verify it matches
  const uidMatch = originalIcs.match(/UID:([^\r\n]+)/i);
  const originalUid = uidMatch ? uidMatch[1].trim() : null;
  
  if (originalUid && originalUid !== event.uid) {
    console.error(`UID mismatch: ${originalUid} != ${event.uid}`);
    throw new Error('UID mismatch: Cannot update event with different UID');
  }
  
  // Extract the current sequence and increment it
  const sequenceMatch = originalIcs.match(/SEQUENCE:(\d+)/i);
  const currentSequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
  const newSequence = event.sequence !== undefined ? event.sequence : currentSequence + 1;
  
  // Determine method and status
  const method = event.method || 'REQUEST';
  const status = event.status || 'CONFIRMED';
  
  // Update basic properties
  let updatedIcs = originalIcs
    .replace(/METHOD:[^\r\n]+/i, `METHOD:${method}`)
    .replace(/STATUS:[^\r\n]+/i, `STATUS:${status}`)
    .replace(/SEQUENCE:\d+/i, `SEQUENCE:${newSequence}`)
    .replace(/SUMMARY:[^\r\n]+/i, `SUMMARY:${escapeText(event.summary)}`);
  
  // Update dates
  if (event.startDate) {
    const dtstart = formatDateToUTC(event.startDate);
    updatedIcs = updatedIcs.replace(/DTSTART[^:]*:[^\r\n]+/i, `DTSTART:${dtstart}`);
  }
  
  if (event.endDate) {
    const dtend = formatDateToUTC(event.endDate);
    updatedIcs = updatedIcs.replace(/DTEND[^:]*:[^\r\n]+/i, `DTEND:${dtend}`);
  }
  
  // Update description if present
  if (event.description !== undefined) {
    if (updatedIcs.includes('DESCRIPTION:')) {
      updatedIcs = updatedIcs.replace(
        /DESCRIPTION:[^\r\n]+(\r?\n)/i,
        `DESCRIPTION:${escapeText(event.description)}$1`
      );
    } else {
      // Add after summary
      updatedIcs = updatedIcs.replace(
        /SUMMARY:[^\r\n]+(\r?\n)/i,
        `SUMMARY:${escapeText(event.summary)}$1DESCRIPTION:${escapeText(event.description)}$1`
      );
    }
  }
  
  // Update location if present
  if (event.location !== undefined) {
    if (updatedIcs.includes('LOCATION:')) {
      updatedIcs = updatedIcs.replace(
        /LOCATION:[^\r\n]+(\r?\n)/i,
        `LOCATION:${escapeText(event.location)}$1`
      );
    } else {
      // Add after description or summary
      const insertAfter = updatedIcs.includes('DESCRIPTION:') ? 'DESCRIPTION' : 'SUMMARY';
      updatedIcs = updatedIcs.replace(
        new RegExp(`${insertAfter}:[^\\r\\n]+(\\r?\\n)`, 'i'),
        `${insertAfter}:${updatedIcs.match(new RegExp(`${insertAfter}:[^\\r\\n]+`, 'i'))?.[0].substring(insertAfter.length + 1) || ''}$1LOCATION:${escapeText(event.location)}$1`
      );
    }
  }
  
  // Ensure METHOD, STATUS, and SEQUENCE exist
  if (!updatedIcs.includes('METHOD:')) {
    updatedIcs = updatedIcs.replace(
      /VERSION:[^\r\n]+(\r?\n)/i, 
      `VERSION:2.0$1METHOD:${method}$1`
    );
  }
  
  if (!updatedIcs.includes('STATUS:')) {
    updatedIcs = updatedIcs.replace(
      /SEQUENCE:[^\r\n]+(\r?\n)/i,
      `SEQUENCE:${newSequence}$1STATUS:${status}$1`
    );
  }
  
  if (!updatedIcs.includes('SEQUENCE:')) {
    updatedIcs = updatedIcs.replace(
      /UID:[^\r\n]+(\r?\n)/i,
      `UID:${event.uid}$1SEQUENCE:${newSequence}$1`
    );
  }
  
  // Since handling attendees is complex with removal/addition, we'll leave them as is
  // A more complete implementation would parse and diff attendees
  
  return updatedIcs;
}