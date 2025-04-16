/**
 * ICS Formatter Utility
 * 
 * Handles proper formatting of iCalendar files according to RFC 5545
 * Ensures consistent line folding across both client and server implementations
 */

/**
 * Format an iCalendar string to be compliant with RFC 5545
 * - Ensures proper line folding (lines must be ≤ 75 octets)
 * - Formats with proper CRLF line endings
 * - Handles continuation lines with leading spaces
 * 
 * @param content String or array of lines to format
 * @returns Properly formatted iCalendar string
 */
export function formatICS(content: string | string[]): string {
  // If content is a string, split it into lines
  const lines = typeof content === 'string' 
    ? content.replace(/\r\n|\r/g, '\n').split('\n') 
    : content;
  
  // Format each line according to RFC 5545
  const formattedLines: string[] = [];
  
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Check if the line needs folding (longer than 75 characters)
    if (line.length > 75) {
      // First part (exactly 75 characters)
      formattedLines.push(line.substring(0, 75));
      
      // Remaining parts as continuation lines (each starting with a space)
      let position = 75;
      while (position < line.length) {
        // Each continuation line can be 74 characters + the leading space
        const chunkLength = Math.min(74, line.length - position);
        formattedLines.push(` ${line.substring(position, position + chunkLength)}`);
        position += chunkLength;
      }
    } else {
      // No folding needed for lines ≤ 75 characters
      formattedLines.push(line);
    }
  }
  
  // Join with proper CRLF line endings as required by RFC 5545
  return formattedLines.join('\r\n');
}

/**
 * Sanitize raw ICS data for proper formatting
 * Fixes common issues with iCalendar data from various sources
 * 
 * @param icsData Raw iCalendar data
 * @returns Sanitized and properly formatted iCalendar data
 */
export function sanitizeAndFormatICS(icsData: string): string {
  if (!icsData) return '';
  
  // Normalize line endings to LF first
  let normalizedData = icsData.replace(/\r\n|\r/g, '\n');
  
  // Split into lines for easier processing
  let icsLines = normalizedData.split('\n');
  let sanitizedLines: string[] = [];
  
  // Track if we're within a VEVENT section
  let inEvent = false;
  
  for (let i = 0; i < icsLines.length; i++) {
    let line = icsLines[i];
    
    // Track event boundaries
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
    } else if (line === 'END:VEVENT') {
      inEvent = false;
    }
    
    // Fix RRULE with mailto: appended to it (common error)
    if (line.startsWith('RRULE:')) {
      if (line.includes('mailto:')) {
        console.log('Fixing malformed RRULE:', line);
        const ruleParts = line.split('mailto:');
        line = ruleParts[0];
      }
    }
    
    // Fix improperly folded ATTENDEE/ORGANIZER lines
    if (line.includes('ATTENDEE') || line.includes('ORGANIZER')) {
      // Remove any embedded newlines
      if (line.includes('\n')) {
        line = line.replace(/\n/g, '');
      }
      
      // Check for improper SCHEDULE-STATUS formatting
      if (line.includes('SCHEDULE-STATUS=') && line.includes(':')) {
        const parts = line.split(':');
        if (parts.length > 1) {
          const properties = parts[0];
          const email = parts[1];
          
          // Make sure email doesn't contain any : characters
          const cleanEmail = email.replace(/:/g, '');
          line = `${properties}:${cleanEmail}`;
        }
      }
      
      // Fix attendees with incorrect line break formatting
      if (line.endsWith('\\r\\n') || line.endsWith('\r\n')) {
        line = line.replace(/\\r\\n$|\r\n$/, '');
      }
    }
    
    // Fix lines that contain END:VEVENT or END:VCALENDAR inside them
    if (line.includes('END:VEVENT') && !line.startsWith('END:VEVENT')) {
      const parts = line.split('END:VEVENT');
      line = parts[0]; // Only keep the part before END:VEVENT
    }
    
    if (line.includes('END:VCALENDAR') && !line.startsWith('END:VCALENDAR')) {
      const parts = line.split('END:VCALENDAR');
      line = parts[0]; // Only keep the part before END:VCALENDAR
    }
    
    sanitizedLines.push(line);
  }
  
  // Format the sanitized lines according to RFC 5545
  return formatICS(sanitizedLines);
}

/**
 * Create a simple iCalendar string for an event
 * 
 * @param event Event data
 * @returns Formatted iCalendar string
 */
export function createBasicICS(event: {
  title: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
  uid: string;
}): string {
  // Convert dates to iCalendar format (yyyyMMddTHHmmssZ)
  const formatDate = (date: Date): string => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/g, '');
  };
  
  // Create basic iCalendar content as array of lines
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `SUMMARY:${event.title}`,
    `DTSTART:${formatDate(event.startDate)}`,
    `DTEND:${formatDate(event.endDate)}`,
    `DESCRIPTION:${event.description || ''}`,
    `LOCATION:${event.location || ''}`,
    `UID:${event.uid}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  
  // Format according to RFC 5545
  return formatICS(lines);
}