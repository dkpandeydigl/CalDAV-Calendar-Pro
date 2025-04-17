/**
 * Enhanced ICS Cancellation Generator
 * 
 * Properly formats ICS files for event cancellations according to RFC 5545
 * Ensures consistency with update ICS files and preserves all required fields
 */

/**
 * Event data interface for cancellation
 */
export interface CancellationEventData {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startDate: Date;
  endDate: Date;
  organizer: {
    email: string;
    name?: string;
  };
  attendees?: {
    email: string;
    name?: string;
    role?: string;
    status?: string;
  }[];
  resources?: {
    email: string;
    name?: string;
    type?: string;
    subType?: string;
    adminEmail?: string;
  }[];
  sequence?: number;
  [key: string]: any; // Allow additional properties
}

/**
 * Generate a standardized cancellation ICS file
 * 
 * This approach preserves the original UID and correctly formats the ICS according to RFC 5545
 * for maximum compatibility across email clients.
 * 
 * @param originalIcs The original ICS data from the event
 * @param eventData Event data for the cancellation
 * @returns Properly formatted ICS file for cancellation
 */
export function generateCancellationIcs(originalIcs: string, eventData: CancellationEventData): string {
  // Extract key components from original ICS
  const uidMatch = originalIcs.match(/UID:([^\r\n]+)/i);
  const originalUid = uidMatch ? uidMatch[1].trim() : eventData.uid;

  // Extract original sequence number and increment it
  const sequenceMatch = originalIcs.match(/SEQUENCE:(\d+)/i);
  const originalSequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
  const newSequence = eventData.sequence !== undefined ? eventData.sequence : originalSequence + 1;
  
  // Extract original DTSTAMP to maintain consistency
  const dtstampMatch = originalIcs.match(/DTSTAMP:([^\r\n]+)/i);
  const dtstamp = dtstampMatch ? dtstampMatch[1].trim() : formatICalDate(new Date());
  
  // Extract original CREATED date to maintain consistency
  const createdMatch = originalIcs.match(/CREATED:([^\r\n]+)/i);
  const created = createdMatch ? createdMatch[1].trim() : formatICalDate(new Date());
  
  // Format dates properly for ICS
  const formattedStartDate = formatICalDate(eventData.startDate);
  const formattedEndDate = formatICalDate(eventData.endDate);
  const lastModified = formatICalDate(new Date());
  
  // Begin building the ICS file
  let icsLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'METHOD:CANCEL',
    'BEGIN:VEVENT',
    `UID:${originalUid}`,
    `SUMMARY:${escapeICalString(eventData.title)}`,
    `DTSTART:${formattedStartDate}`,
    `DTEND:${formattedEndDate}`,
    `DTSTAMP:${dtstamp}`,
    `CREATED:${created}`,
    `LAST-MODIFIED:${lastModified}`,
    `SEQUENCE:${newSequence}`,
    'STATUS:CANCELLED'
  ];
  
  // Add optional fields
  if (eventData.description) {
    icsLines.push(`DESCRIPTION:${escapeICalString(eventData.description)}`);
  }
  
  if (eventData.location) {
    icsLines.push(`LOCATION:${escapeICalString(eventData.location)}`);
  }
  
  // Add organizer
  const organizerName = eventData.organizer.name ? 
    `;CN=${escapeICalString(eventData.organizer.name)}` : '';
  icsLines.push(`ORGANIZER${organizerName}:mailto:${eventData.organizer.email}`);
  
  // Add attendees
  if (eventData.attendees && eventData.attendees.length > 0) {
    eventData.attendees.forEach(attendee => {
      const name = attendee.name ? `;CN=${escapeICalString(attendee.name)}` : '';
      const role = attendee.role ? `;ROLE=${attendee.role}` : '';
      const partstat = attendee.status ? `;PARTSTAT=${attendee.status}` : ';PARTSTAT=NEEDS-ACTION';
      icsLines.push(`ATTENDEE${name}${role}${partstat}:mailto:${attendee.email}`);
    });
  }
  
  // Add resources (as special attendees with CUTYPE=RESOURCE)
  if (eventData.resources && eventData.resources.length > 0) {
    eventData.resources.forEach(resource => {
      const name = resource.name ? `;CN=${escapeICalString(resource.name)}` : '';
      const resourceType = resource.type ? `;X-RESOURCE-TYPE=${escapeICalString(resource.type)}` : '';
      
      // Add the resource as an attendee with special properties
      icsLines.push(
        `ATTENDEE${name};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT${resourceType}:mailto:${resource.email}`
      );
    });
  }
  
  // Extract any X- properties from original ICS to preserve them
  const xPropLines = extractXProperties(originalIcs);
  if (xPropLines.length > 0) {
    icsLines = icsLines.concat(xPropLines);
  }
  
  // Finish the ICS file
  icsLines.push('END:VEVENT');
  icsLines.push('END:VCALENDAR');
  
  // Join lines with proper CRLF line endings for maximum compatibility
  return icsLines.join('\r\n');
}

/**
 * Format a date for iCalendar format
 * @param date Date to format
 * @returns Formatted date string
 */
function formatICalDate(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Escape special characters in iCalendar strings
 * @param str String to escape
 * @returns Escaped string
 */
function escapeICalString(str: string | null | undefined): string {
  if (!str) return '';
  
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n/g, '\\n');
}

/**
 * Extract X- properties from original ICS to preserve them
 * @param icsData Original ICS data
 * @returns Array of X- property lines
 */
function extractXProperties(icsData: string): string[] {
  const lines = icsData.split(/\r?\n/);
  const xProps: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('X-')) {
      xProps.push(line);
    }
  }
  
  return xProps;
}