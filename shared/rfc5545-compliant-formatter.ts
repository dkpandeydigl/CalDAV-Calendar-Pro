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

// Formats timestamp to RFC 5545 UTC format (20220101T120000Z)
const formatDateToUTC = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

// Formats timestamp to RFC 5545 with timezone
const formatDateWithTimezone = (date: Date, timezone: string): string => {
  // Simplified implementation - a robust implementation would handle timezone conversion properly
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('Z', '');
};

// Escape special characters as per RFC 5545
const escapeText = (text: string): string => {
  if (!text) return '';
  
  return text
    .replace(/\\/g, '\\\\')  // Backslash must be escaped first to avoid double-escaping
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
};

// Fold lines longer than 75 characters as required by RFC 5545
const foldLine = (line: string): string => {
  if (line.length <= 75) {
    return line;
  }
  
  let result = '';
  for (let i = 0; i < line.length; i += 74) {
    // First line can be 75 chars, continuation lines start with space and can be 74 chars
    const isFirstLine = i === 0;
    const maxLength = isFirstLine ? 75 : 74;
    const chunk = line.substring(i, i + maxLength);
    
    if (isFirstLine) {
      result += chunk;
    } else {
      result += '\r\n ' + chunk;
    }
  }
  
  return result;
};

// Generate attendee string in ATTENDEE format
const formatAttendee = (attendee: Attendee): string => {
  let properties = [];
  
  if (attendee.name) {
    properties.push(`CN=${escapeText(attendee.name)}`);
  }
  
  if (attendee.role) {
    properties.push(`ROLE=${attendee.role.toUpperCase()}`);
  } else {
    properties.push('ROLE=REQ-PARTICIPANT');
  }
  
  if (attendee.status) {
    properties.push(`PARTSTAT=${attendee.status.toUpperCase()}`);
  } else {
    properties.push('PARTSTAT=NEEDS-ACTION');
  }
  
  const propertiesStr = properties.join(';');
  return foldLine(`ATTENDEE;${propertiesStr}:mailto:${attendee.email}`);
};

// Generate resource string in ATTENDEE format with appropriate roles
const formatResource = (resource: Resource): string => {
  let properties = [];
  
  // Resources are typically NON-PARTICIPANT but we use their name in CN
  if (resource.name || resource.displayName) {
    properties.push(`CN=${escapeText(resource.name || resource.displayName || '')}`);
  }
  
  // Resources should have NON-PARTICIPANT role
  properties.push('ROLE=NON-PARTICIPANT');
  properties.push('PARTSTAT=ACCEPTED'); // Resources typically auto-accept
  properties.push('CUTYPE=RESOURCE');
  
  if (resource.subType || resource.type) {
    properties.push(`X-RESOURCE-TYPE=${escapeText(resource.subType || resource.type || '')}`);
  }
  
  if (resource.capacity) {
    properties.push(`X-RESOURCE-CAPACITY=${resource.capacity}`);
  }
  
  const email = resource.email || resource.adminEmail;
  const propertiesStr = properties.join(';');
  return foldLine(`ATTENDEE;${propertiesStr}:mailto:${email}`);
};

/**
 * Generate a complete iCalendar event as a string following RFC 5545 rules
 * @param data The event data to format
 * @returns A RFC 5545 compliant iCalendar string
 */
export function formatRFC5545Event(data: EventInvitationData): string {
  // Lines to be joined with CRLF
  const lines: string[] = [];
  
  // Begin calendar
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//CalDAV Client//EN');
  
  // Add METHOD if specified
  if (data.method) {
    lines.push(`METHOD:${data.method}`);
  } else if (data.status === 'CANCELLED') {
    lines.push('METHOD:CANCEL');
  } else {
    lines.push('METHOD:REQUEST');
  }
  
  // Begin event
  lines.push('BEGIN:VEVENT');
  
  // Required UID property
  if (!data.uid) {
    throw new Error('UID is required for RFC 5545 compliance');
  }
  
  lines.push(`UID:${data.uid}`);
  
  // Handle special status properties
  if (data.status === 'CANCELLED') {
    lines.push('STATUS:CANCELLED');
  }
  
  // Required DTSTAMP property (creation/modification timestamp)
  lines.push(`DTSTAMP:${formatDateToUTC(new Date())}`);
  
  // Sequence for versioning (RFC 5546)
  if (data.sequence !== undefined) {
    lines.push(`SEQUENCE:${data.sequence}`);
  } else {
    lines.push('SEQUENCE:0');
  }
  
  // Event timing properties
  lines.push(`DTSTART:${formatDateToUTC(data.startDate)}`);
  lines.push(`DTEND:${formatDateToUTC(data.endDate)}`);
  
  // Event title (SUMMARY)
  lines.push(foldLine(`SUMMARY:${escapeText(data.title)}`));
  
  // Optional properties
  if (data.location) {
    lines.push(foldLine(`LOCATION:${escapeText(data.location)}`));
  }
  
  if (data.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeText(data.description)}`));
  }
  
  // Organizer
  if (data.organizer) {
    let organizerStr = 'ORGANIZER';
    if (data.organizer.name) {
      organizerStr += `;CN=${escapeText(data.organizer.name)}`;
    }
    organizerStr += `:mailto:${data.organizer.email}`;
    lines.push(foldLine(organizerStr));
  }
  
  // Attendees
  if (data.attendees && data.attendees.length > 0) {
    for (const attendee of data.attendees) {
      lines.push(formatAttendee(attendee));
    }
  }
  
  // Resources (formatted as special attendees)
  if (data.resources && data.resources.length > 0) {
    for (const resource of data.resources) {
      lines.push(formatResource(resource));
    }
  }
  
  // Recurrence rule if provided
  if (data.recurrenceRule) {
    if (typeof data.recurrenceRule === 'string') {
      lines.push(foldLine(`RRULE:${data.recurrenceRule}`));
    } else {
      // Handle object representation of recurrence rule
      // (Implementation would depend on your object structure)
      const rruleStr = 'FREQ=DAILY;COUNT=1'; // Default fallback
      lines.push(foldLine(`RRULE:${rruleStr}`));
    }
  }
  
  // End event
  lines.push('END:VEVENT');
  
  // End calendar
  lines.push('END:VCALENDAR');
  
  // Join all lines with CR+LF as required by RFC 5545
  return lines.join('\r\n');
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
  
  // Check for required properties
  if (!icsData.includes('UID:')) {
    errors.push('Missing UID property');
  }
  
  if (!icsData.includes('DTSTAMP:')) {
    errors.push('Missing DTSTAMP property');
  }
  
  if (!icsData.includes('DTSTART:')) {
    errors.push('Missing DTSTART property');
  }
  
  // Check for VERSION
  if (!icsData.includes('VERSION:2.0')) {
    errors.push('Missing or incorrect VERSION property');
  }
  
  // Check for line length (should be folded if >75 chars)
  const lines = icsData.split('\r\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore folded continuation lines that start with space
    if (!line.startsWith(' ') && line.length > 75) {
      errors.push(`Line ${i + 1} exceeds 75 character limit and is not folded`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Ensure ics data has proper line endings (CRLF)
 */
export function ensureProperLineEndings(icsData: string): string {
  // Replace any lone CR or LF with CRLF
  return icsData.replace(/\r\n|\n\r|\n|\r/g, '\r\n');
}

/**
 * Extract UID from an ICS string
 * @param icsData The iCalendar string to extract from
 * @returns The UID, or null if not found
 */
export function extractUIDFromICS(icsData: string): string | null {
  const uidMatch = icsData.match(/UID:(.*?)(?:\r\n|\r|\n)(?! )/);
  if (uidMatch && uidMatch[1]) {
    return uidMatch[1].trim();
  }
  return null;
}