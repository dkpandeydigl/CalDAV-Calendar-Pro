/**
 * ICS Formatter Utility
 * 
 * Handles proper formatting of iCalendar files according to RFC 5545
 * Ensures consistent line folding across client and server implementations
 */

/**
 * Format an iCalendar string to be compliant with RFC 5545
 * - Ensures proper line folding (lines must be ≤ 75 octets)
 * - Formats with proper CRLF line endings
 * - Handles continuation lines with leading spaces
 * 
 * The iCalendar specification (RFC 5545) requires:
 * 1. Lines MUST be no longer than 75 octets excluding CRLF
 * 2. Long lines MUST be split into multiple lines, with each continuation line
 *    starting with a space character
 * 3. Line separators MUST be CRLF (CR+LF, \r\n)
 * 
 * @param content String or array of lines to format
 * @returns Properly formatted iCalendar string with CRLF line breaks
 */
export function formatICS(content: string | string[]): string {
  // Convert content to array of lines if it's a string
  // First normalize any line endings to simple LF
  const inputLines = typeof content === 'string'
    ? content.replace(/\r\n|\r/g, '\n').split('\n')
    : content;
  
  const result: string[] = [];
  
  // Process each input line
  for (let i = 0; i < inputLines.length; i++) {
    const line = inputLines[i].trim();
    
    // Skip completely empty lines
    if (!line) continue;
    
    // If line is shorter than 75 chars, add it as is
    if (line.length <= 75) {
      result.push(line);
      continue;
    }
    
    // Line needs folding - split it into chunks
    let pos = 0;
    const length = line.length;
    
    // Add first chunk (75 chars max)
    result.push(line.substring(0, 75));
    pos = 75;
    
    // Add continuation chunks with space prefix
    while (pos < length) {
      // Each continuation line can be 74 chars max (plus the leading space)
      const chunk = line.substring(pos, Math.min(pos + 74, length));
      result.push(` ${chunk}`);
      pos += 74;
    }
  }
  
  // Join with CRLF as required by RFC 5545
  return result.join('\r\n');
}

/**
 * Sanitize raw ICS data and format it according to RFC 5545
 * Fixes common issues with iCalendar data from different sources
 * 
 * Handles issues like:
 * - Malformed RRULE values with embedded mailto: strings
 * - Improperly formatted attendee lines
 * - Incorrect line breaks within content
 * - Incorrect SCHEDULE-STATUS values
 * 
 * @param icsData Raw iCalendar data string
 * @returns Sanitized and properly formatted iCalendar data
 */
export function sanitizeAndFormatICS(icsData: string): string {
  if (!icsData) return '';
  
  // First, convert all line endings to LF for processing
  let data = icsData.replace(/\r\n|\r/g, '\n');
  
  // Fix literal "\r\n" text occurrences that should be actual breaks
  data = data.replace(/\\r\\n/g, '\n');
  
  // Split into lines for content-aware processing
  const lines = data.split('\n');
  const sanitizedLines: string[] = [];
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip completely empty lines
    if (!line) continue;
    
    // Fix RRULE with improperly appended mailto:
    if (line.startsWith('RRULE:') && line.includes('mailto:')) {
      const ruleParts = line.split('mailto:');
      line = ruleParts[0]; // Keep only the part before mailto:
    }
    
    // Fix issues with ATTENDEE and ORGANIZER lines
    if (line.includes('ATTENDEE') || line.includes('ORGANIZER')) {
      // Fix improper SCHEDULE-STATUS formatting
      if (line.includes('SCHEDULE-STATUS=') && line.includes(':')) {
        // Split into parameters and value parts
        const parts = line.split(':');
        if (parts.length > 1) {
          const parameters = parts[0];
          const value = parts[1];
          
          // Remove any stray colons from the value part
          const cleanValue = value.replace(/:/g, '');
          line = `${parameters}:${cleanValue}`;
        }
      }
    }
    
    // Add the sanitized line
    sanitizedLines.push(line);
  }
  
  // Apply proper RFC 5545 formatting to the sanitized content
  return formatICS(sanitizedLines);
}

/**
 * Create a basic RFC 5545 compliant iCalendar file for an event
 * 
 * @param event Required event data
 * @returns Properly formatted iCalendar string
 */
export function createBasicICS(event: {
  title: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
  uid: string;
}): string {
  // Format dates as required by iCalendar spec (UTC, no separators)
  // Format: YYYYMMDDTHHmmssZ
  const formatDate = (date: Date): string => {
    return date.toISOString()
      .replace(/[-:]/g, '')  // Remove dashes and colons
      .replace(/\.\d+/g, ''); // Remove milliseconds
  };
  
  // Escape special characters in text fields according to RFC 5545
  const escapeText = (text: string): string => {
    return text
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/;/g, '\\;')    // Escape semicolons
      .replace(/,/g, '\\,')    // Escape commas
      .replace(/\n/g, '\\n');  // Convert newlines to literal \n
  };
  
  // Create required iCalendar component lines
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `SUMMARY:${escapeText(event.title)}`,
    `DTSTART:${formatDate(event.startDate)}`,
    `DTEND:${formatDate(event.endDate)}`,
    `DESCRIPTION:${escapeText(event.description || '')}`,
    `LOCATION:${escapeText(event.location || '')}`,
    `UID:${event.uid}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  
  // Apply proper formatting according to RFC 5545
  return formatICS(lines);
}