/**
 * RFC 5545 Compliant Formatter
 * 
 * This module provides utilities for generating iCalendar content that strictly
 * complies with RFC 5545 specifications for iCalendar format.
 * 
 * Key features:
 * - Line length validation and folding
 * - Proper escaping of special characters
 * - Sequence number management for event updates
 * - Timezone handling
 * - METHOD property support for REQUEST/CANCEL/etc
 */

import { EventInvitationData, Attendee, Resource } from '../server/enhanced-email-service';

// Constants for RFC 5545 compliance
const LINE_LENGTH_LIMIT = 75; // RFC 5545 specifies line length limit

// Helper functions for RFC 5545 compliance

/**
 * Formats a date in UTC format as specified by RFC 5545
 */
const formatDateToUTC = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

/**
 * Formats a date with timezone info as specified by RFC 5545
 */
const formatDateWithTimezone = (date: Date, timezone: string): string => {
  // This is a simplified implementation; a production system would need
  // a more robust timezone handling mechanism
  const formatted = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // For now we'll use UTC dates, but in a real implementation we would convert to the specified timezone
  return formatted;
};

/**
 * Escapes special characters in text fields as per RFC 5545
 */
const escapeText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\') // Escape backslashes first!
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
};

/**
 * Folds long lines as per RFC 5545 (each line <= 75 octets)
 * When a line exceeds 75 characters, it must be folded by inserting a CRLF
 * followed by a single whitespace character (LWSP)
 */
const foldLine = (line: string): string => {
  if (line.length <= LINE_LENGTH_LIMIT) return line;
  
  let result = '';
  let currentPos = 0;
  
  while (currentPos < line.length) {
    if (currentPos === 0) {
      // First line
      result += line.slice(0, LINE_LENGTH_LIMIT);
      currentPos += LINE_LENGTH_LIMIT;
    } else {
      // Continuation lines - must begin with a space
      // Use literal CRLF for now, we'll replace with actual CRLF later
      result += '\r\n ';  // Changed from '\\r\\n ' to use actual CRLF
      const chunk = line.slice(currentPos, currentPos + LINE_LENGTH_LIMIT - 1);
      result += chunk;
      currentPos += chunk.length;
    }
  }
  
  return result;
};

/**
 * Formats an attendee property as per RFC 5545
 */
const formatAttendee = (attendee: Attendee): string => {
  let role = 'REQ-PARTICIPANT';
  let partstat = 'NEEDS-ACTION';
  
  // Map our internal role values to RFC 5545 values
  if (attendee.role) {
    if (attendee.role === 'Chairman') role = 'CHAIR';
    else if (attendee.role === 'Secretary') role = 'REQ-PARTICIPANT';
  }
  
  // Map status if present
  if (attendee.status) {
    if (attendee.status.toUpperCase() === 'ACCEPTED') partstat = 'ACCEPTED';
    else if (attendee.status.toUpperCase() === 'DECLINED') partstat = 'DECLINED';
    else if (attendee.status.toUpperCase() === 'TENTATIVE') partstat = 'TENTATIVE';
  }
  
  const params = [
    'CUTYPE=INDIVIDUAL',
    `ROLE=${role}`,
    `PARTSTAT=${partstat}`,
    'RSVP=TRUE'
  ];
  
  // Add CN parameter if name is present
  if (attendee.name) {
    params.push(`CN=${escapeText(attendee.name)}`);
  }
  
  return `ATTENDEE;${params.join(';')}:mailto:${attendee.email}`;
};

/**
 * Formats a resource as an attendee with resource cutype as per RFC 5545
 */
const formatResource = (resource: Resource): string => {
  const params = [
    'CUTYPE=RESOURCE',
    'ROLE=NON-PARTICIPANT',
    'PARTSTAT=NEEDS-ACTION',
    'RSVP=TRUE'
  ];
  
  // Add CN parameter for resource name
  if (resource.name) {
    params.push(`CN=${escapeText(resource.name)}`);
  }
  
  // Add resource-specific parameters
  params.push(`X-RESOURCE-TYPE=${escapeText(resource.subType || resource.type || 'UNKNOWN')}`);
  
  if (resource.capacity) {
    params.push(`X-RESOURCE-CAPACITY=${resource.capacity}`);
  }
  
  // Use adminEmail as the resource email (or fallback to email property)
  const email = resource.adminEmail || resource.email || '';
  
  return `ATTENDEE;${params.join(';')}:mailto:${email}`;
};

/**
 * Generate a complete iCalendar event as a string following RFC 5545 rules
 * @param data The event data to format
 * @param options Additional options for formatting the event
 * @returns A RFC 5545 compliant iCalendar string
 */
export function formatRFC5545Event(
  data: EventInvitationData, 
  options?: {
    method?: string;
    status?: string;
    sequence?: number;
  }
): string {
  // CRITICAL: We must ONLY use the UID provided by the CentralUIDService
  // Never generate a new UID here - that would break the event lifecycle integrity
  if (!data.uid) {
    console.error('ERROR: Missing UID in event data - this should never happen if validateEventUID is working');
    throw new Error('Missing UID in event data');
  }
  const uid = data.uid;
  
  // Determine the METHOD (prioritize options, then data, then default to REQUEST)
  const method = (options?.method || data.method || 'REQUEST').toUpperCase();
  
  // Start building the ics content
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CALDAVCLIENT//RFC5545FORMATTER//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT'
  ];
  
  // Add basic event properties
  icsContent.push(`UID:${uid}`);
  icsContent.push(`SUMMARY:${escapeText(data.title)}`);
  
  // Add description if present
  if (data.description) {
    icsContent.push(`DESCRIPTION:${escapeText(data.description)}`);
  }
  
  // Add location if present
  if (data.location) {
    icsContent.push(`LOCATION:${escapeText(data.location)}`);
  }
  
  // Add date/time properties using UTC format as default
  const dtstart = formatDateToUTC(data.startDate);
  const dtend = formatDateToUTC(data.endDate);
  
  icsContent.push(`DTSTART:${dtstart}`);
  icsContent.push(`DTEND:${dtend}`);
  
  // Add creation timestamp
  const now = new Date();
  const dtstamp = formatDateToUTC(now);
  icsContent.push(`DTSTAMP:${dtstamp}`);
  
  // Add organizer
  const organizerName = data.organizer.name ? `CN=${escapeText(data.organizer.name)}` : '';
  const organizerLine = organizerName 
    ? `ORGANIZER;${organizerName}:mailto:${data.organizer.email}`
    : `ORGANIZER:mailto:${data.organizer.email}`;
  icsContent.push(organizerLine);
  
  // Add attendees
  if (data.attendees && data.attendees.length > 0) {
    data.attendees.forEach(attendee => {
      icsContent.push(formatAttendee(attendee));
    });
  }
  
  // Add resources as special attendees
  if (data.resources && data.resources.length > 0) {
    data.resources.forEach(resource => {
      icsContent.push(formatResource(resource));
    });
  }
  
  // Add status if specified (important for cancellations)
  // Prioritize options.status over data.status
  const status = options?.status || data.status;
  if (status) {
    icsContent.push(`STATUS:${status.toUpperCase()}`);
  }
  
  // Add sequence number for tracking updates (RFC 5545 requires sequence increments for updates)
  // Prioritize options.sequence over data.sequence
  const sequence = options?.sequence !== undefined ? options.sequence : (data.sequence || 0);
  icsContent.push(`SEQUENCE:${sequence}`);
  
  // Add recurrence rule if specified, with improved sanitization
  if (data.recurrenceRule) {
    let rrule: string;
    
    if (typeof data.recurrenceRule === 'string') {
      // Extract only valid RRULE parts: FREQ, UNTIL, COUNT, INTERVAL, etc.
      const validRulePrefixes = ['FREQ=', 'UNTIL=', 'COUNT=', 'INTERVAL=', 'BYSECOND=', 
        'BYMINUTE=', 'BYHOUR=', 'BYDAY=', 'BYMONTHDAY=', 'BYYEARDAY=', 
        'BYWEEKNO=', 'BYMONTH=', 'BYSETPOS=', 'WKST='];
      
      const originalRule = data.recurrenceRule.trim();
      const ruleParts = originalRule.split(';');
      const validParts = ruleParts.filter(part => {
        // Keep only parts that start with valid RRULE parameter names
        return validRulePrefixes.some(prefix => part.startsWith(prefix));
      });
      
      // Reconstruct the RRULE with only valid parts
      rrule = validParts.join(';');
      
      // If we modified the rule, log it
      if (rrule !== originalRule) {
        console.log(`Sanitized RRULE: ${rrule} (original: ${originalRule})`);
      }
    } else {
      // Assume it's an object that needs to be converted to RRULE format
      // This would be implementation-specific based on your recurrence rule object structure
      rrule = 'FREQ=DAILY;COUNT=1'; // Fallback default
      console.log('Converting recurrence rule object to string format not fully implemented');
    }
    
    // Only add if we have a valid rule after sanitization
    if (rrule && rrule.startsWith('FREQ=')) {
      icsContent.push(`RRULE:${rrule}`);
    } else {
      console.warn('Skipping invalid recurrence rule:', rrule);
    }
  }
  
  // Close the event and calendar
  icsContent.push('END:VEVENT');
  icsContent.push('END:VCALENDAR');
  
  // Create the initial string with literal '\r\n' that will be replaced
  let icsString = icsContent.join('\r\n');
  
  // Apply proper line folding and ensure CRLF line endings
  return ensureProperLineEndings(icsString);
}

/**
 * Validate an iCalendar string against basic RFC 5545 requirements
 * @param icsData The iCalendar string to validate
 * @returns Object with validation result
 */
export function validateICSData(icsData: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for required components
  if (!icsData.includes('BEGIN:VCALENDAR')) {
    errors.push('Missing BEGIN:VCALENDAR');
  }
  
  if (!icsData.includes('END:VCALENDAR')) {
    errors.push('Missing END:VCALENDAR');
  }
  
  if (!icsData.includes('BEGIN:VEVENT')) {
    errors.push('Missing BEGIN:VEVENT');
  }
  
  if (!icsData.includes('END:VEVENT')) {
    errors.push('Missing END:VEVENT');
  }
  
  // Check for required event properties
  if (!icsData.includes('UID:')) {
    errors.push('Missing UID property');
  }
  
  if (!icsData.includes('DTSTAMP:')) {
    errors.push('Missing DTSTAMP property');
  }
  
  if (!icsData.includes('DTSTART:')) {
    errors.push('Missing DTSTART property');
  }
  
  // Validate VERSION property
  if (!icsData.includes('VERSION:2.0')) {
    errors.push('Missing VERSION:2.0 property');
  }
  
  // For METHOD property, validate it's one of the allowed values
  const methodMatch = icsData.match(/METHOD:([^\r\n]+)/);
  if (methodMatch) {
    const method = methodMatch[1];
    const validMethods = ['REQUEST', 'CANCEL', 'REPLY', 'ADD', 'REFRESH', 'COUNTER', 'PUBLISH'];
    if (!validMethods.includes(method)) {
      errors.push(`Invalid METHOD value: ${method}`);
    }
  }
  
  // For existing STATUS values, validate they're valid
  const statusMatch = icsData.match(/STATUS:([^\r\n]+)/);
  if (statusMatch) {
    const status = statusMatch[1];
    const validStatuses = ['TENTATIVE', 'CONFIRMED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      errors.push(`Invalid STATUS value: ${status}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Ensure ics data has proper line endings (CRLF) and apply folding for long lines
 * according to RFC 5545 requirements
 */
export function ensureProperLineEndings(icsData: string): string {
  // First, replace literal \\r\\n with actual CRLF
  let result = icsData.replace(/\\r\\n/g, '\r\n');
  
  // Now properly fold long lines according to RFC 5545
  const lines = result.split('\r\n');
  const foldedLines: string[] = [];
  
  lines.forEach(line => {
    if (line.length <= LINE_LENGTH_LIMIT) {
      // Line is short enough, add as is
      foldedLines.push(line);
    } else {
      // Line needs folding
      let pos = 0;
      const length = line.length;
      
      // First chunk (75 chars max)
      foldedLines.push(line.substring(0, LINE_LENGTH_LIMIT));
      pos = LINE_LENGTH_LIMIT;
      
      // Add continuation chunks with space prefix
      while (pos < length) {
        const chunk = line.substring(pos, Math.min(pos + LINE_LENGTH_LIMIT - 1, length));
        foldedLines.push(` ${chunk}`);
        pos += LINE_LENGTH_LIMIT - 1;
      }
    }
  });
  
  // Join with CRLF
  result = foldedLines.join('\r\n');
  
  // Ensure the file ends with a CRLF
  if (!result.endsWith('\r\n')) {
    result += '\r\n';
  }
  
  return result;
}

/**
 * Extract UID from an ICS string
 * @param icsData The iCalendar string to extract from
 * @returns The UID, or null if not found
 */
export function extractUIDFromICS(icsData: string): string | null {
  const uidMatch = icsData.match(/UID:([^\r\n]+)/);
  return uidMatch ? uidMatch[1] : null;
}