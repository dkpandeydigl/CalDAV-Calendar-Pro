/**
 * Utility functions for working with iCalendar data
 */

/**
 * Escapes special characters in a string according to RFC 5545
 * @param value The string to escape
 * @returns The escaped string
 */
export function escapeICalString(value: string | undefined | null): string {
  if (!value) return '';
  
  // First sanitize any HTML content
  const sanitizedValue = sanitizeHtmlForIcal(value);
  
  return sanitizedValue
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/;/g, '\\;')    // Escape semicolons
    .replace(/,/g, '\\,')    // Escape commas
    .replace(/\n/g, '\\n');  // Escape line breaks
}

/**
 * Sanitizes HTML content for iCalendar format
 * Converts HTML to plain text with line breaks to ensure cross-client compatibility
 * @param html The HTML string to sanitize
 * @returns Plain text representation with line breaks
 */
function sanitizeHtmlForIcal(html: string): string {
  if (!html) return '';
  
  // Check if this is HTML content (has tags)
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return html; // Not HTML, return as is
  }
  
  try {
    // Handle common HTML block elements first
    
    // First unfold any wrapped lines in the HTML (Thunderbird sometimes does this)
    let unfolded = html.replace(/\r\n\s+/g, ' ');
    
    // Replace common block elements with their content plus newlines
    const blockElements = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
    let plainText = unfolded;
    
    // Process each block element
    blockElements.forEach(tag => {
      // Match both self-closing and regular tags
      const selfClosingRegex = new RegExp(`<${tag}[^>]*\\/>`, 'gi');
      plainText = plainText.replace(selfClosingRegex, '\n');
      
      // Match opening and closing tags, capture content
      const regex = new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, 'gi');
      plainText = plainText.replace(regex, '$1\n');
    });
    
    // Handle <br> tags - both self-closing and regular
    plainText = plainText.replace(/<br\s*\/?>/gi, '\n');
    
    // Handle lists
    plainText = plainText.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
    plainText = plainText.replace(/<\/ul>\s*<ul[^>]*>/gi, '\n'); // Separate consecutive lists
    plainText = plainText.replace(/<\/ol>\s*<ol[^>]*>/gi, '\n');
    
    // Handle table cells
    plainText = plainText.replace(/<\/td>\s*<td[^>]*>/gi, ' | ');
    plainText = plainText.replace(/<\/tr>\s*<tr[^>]*>/gi, '\n');
    
    // Special handling for Thunderbird-specific elements
    plainText = plainText.replace(/<moz-[^>]+>(.*?)<\/moz-[^>]+>/gi, '$1');
    
    // Remove all remaining HTML tags
    plainText = plainText.replace(/<[^>]+>/g, '');
    
    // Decode HTML entities - we use a simplified approach to avoid LSP issues with Unicode
    plainText = decodeHtmlEntities(plainText);
    
    // Clean up whitespace and normalize line breaks
    plainText = plainText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Remove excessive line breaks
      .replace(/^\s+|\s+$/g, '');        // Trim whitespace
    
    return plainText.trim();
  } catch (e) {
    console.error('Error sanitizing HTML for iCalendar:', e);
    return html; // Return original if error occurs
  }
}

/**
 * Folds a line according to RFC 5545
 * Lines longer than 75 octets should be folded
 * @param line The line to fold
 * @returns The folded line
 */
export function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  
  let result = '';
  let pos = 0;
  
  while (pos < line.length) {
    if (pos > 0) {
      result += '\r\n '; // Continuation line starts with a space
    }
    
    let lineLength = Math.min(75, line.length - pos);
    
    // If we're breaking in the middle of a UTF-8 character, back up
    while (lineLength > 0 && (line.charCodeAt(pos + lineLength - 1) & 0xC0) === 0x80) {
      lineLength--;
    }
    
    result += line.substring(pos, pos + lineLength);
    pos += lineLength;
  }
  
  return result;
}

/**
 * Formats an iCalendar content line with proper folding
 * @param name The property name
 * @param value The property value
 * @param parameters Optional parameters for the property
 * @returns The formatted line
 */
export function formatContentLine(name: string, value: string, parameters: Record<string, string> = {}): string {
  let line = name;
  
  // Add parameters if any
  for (const [key, val] of Object.entries(parameters)) {
    if (val) {
      line += `;${key}=${val}`;
    }
  }
  
  line += `:${value}`;
  
  // Fold the line if necessary
  return foldLine(line);
}

/**
 * Properly formats an iCalendar date-time value
 * @param date The date to format
 * @param allDay Whether this is an all-day event
 * @returns Formatted date string for iCalendar
 */
export function formatICalDate(date: Date | null | undefined, allDay: boolean = false): string {
  // If date is null or undefined, use current date as fallback
  if (!date) {
    console.warn("Converting null/undefined date to current date");
    date = new Date();
  }
  
  // Verify that the date is valid
  if (isNaN(date.getTime())) {
    console.warn("Invalid date detected, using current date instead");
    date = new Date();
  }
  
  try {
    if (allDay) {
      return date.toISOString().replace(/[-:]/g, '').split('T')[0];
    }
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
  } catch (error) {
    console.error("Error formatting date for iCalendar:", error);
    // Last resort fallback - use current time
    const now = new Date();
    return allDay 
      ? now.toISOString().replace(/[-:]/g, '').split('T')[0]
      : now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
  }
}

/**
 * Generates an iCalendar event from scratch
 * @param event The event data
 * @param options Additional options for the iCalendar generation
 * @returns Properly formatted iCalendar data
 */
export function generateICalEvent(event: any, options: {
  organizer: string;
  sequence: number;
  timestamp: string;
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'BEGIN:VEVENT'
  ];
  
  // Add required properties
  lines.push(formatContentLine('UID', event.uid));
  lines.push(formatContentLine('SUMMARY', event.title || "Untitled Event"));
  
  // Start date with optional VALUE=DATE parameter for all-day events
  const dtStartParams: Record<string, string> = {};
  if (event.allDay) dtStartParams.VALUE = 'DATE';
  lines.push(formatContentLine('DTSTART', formatICalDate(event.startDate, event.allDay === true), dtStartParams));
  
  // End date with optional VALUE=DATE parameter for all-day events
  const dtEndParams: Record<string, string> = {};
  if (event.allDay) dtEndParams.VALUE = 'DATE';
  lines.push(formatContentLine('DTEND', formatICalDate(event.endDate, event.allDay === true), dtEndParams));
  
  // Optional properties
  if (event.description) {
    // Always sanitize the description to convert HTML to plain text for interoperable iCalendar
    lines.push(formatContentLine('DESCRIPTION', escapeICalString(event.description)));
  }
  
  if (event.location) {
    lines.push(formatContentLine('LOCATION', escapeICalString(event.location)));
  }
  
  // Required timestamps
  lines.push(formatContentLine('DTSTAMP', options.timestamp));
  lines.push(formatContentLine('CREATED', options.timestamp));
  lines.push(formatContentLine('LAST-MODIFIED', options.timestamp));
  lines.push(formatContentLine('SEQUENCE', String(options.sequence)));
  
  // Recurrence rule if present
  if (event.recurrenceRule) {
    const rrule = formatRecurrenceRule(event.recurrenceRule);
    if (rrule) {
      lines.push(formatContentLine('RRULE', rrule));
    }
  }
  
  // Process attendees and resources
  const attendeesAndResources = generateAttendeesAndResources(event);
  lines.push(...attendeesAndResources);
  
  // Add organizer
  const emailMatch = options.organizer.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
  const email = emailMatch ? options.organizer : `${options.organizer}@caldavclient.local`;
  lines.push(formatContentLine('ORGANIZER', `mailto:${email}`, { CN: options.organizer }));
  
  // Close the event and calendar
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  
  return lines.join('\r\n');
}

/**
 * Generate attendee and resource lines for an event
 * @param event The event data
 * @returns Array of formatted iCalendar lines for attendees and resources
 */
function generateAttendeesAndResources(event: any): string[] {
  const lines: string[] = [];
  
  // Process attendees if present
  if (event.attendees) {
    try {
      const attendeesArray = typeof event.attendees === 'string' 
        ? JSON.parse(event.attendees) 
        : event.attendees;
        
      if (Array.isArray(attendeesArray)) {
        attendeesArray.forEach(attendee => {
          if (attendee && attendee.email) {
            const params: Record<string, string> = {};
            if (attendee.name) params.CN = attendee.name;
            params.ROLE = attendee.role || 'REQ-PARTICIPANT';
            params.PARTSTAT = attendee.status || 'NEEDS-ACTION';
            
            lines.push(formatContentLine('ATTENDEE', `mailto:${attendee.email}`, params));
          }
        });
      }
    } catch (e) {
      console.error(`Error processing attendees:`, e);
    }
  }
  
  // Process resources if present
  if (event.resources) {
    try {
      const resourcesArray = typeof event.resources === 'string' 
        ? JSON.parse(event.resources) 
        : event.resources;
        
      if (Array.isArray(resourcesArray)) {
        resourcesArray.forEach(resource => {
          if (resource && resource.adminEmail) {
            const params: Record<string, string> = {};
            if (resource.adminName) params.CN = resource.adminName;
            params.CUTYPE = 'RESOURCE';
            params.ROLE = 'NON-PARTICIPANT';
            if (resource.subType) params['X-RESOURCE-TYPE'] = resource.subType;
            
            lines.push(formatContentLine('ATTENDEE', `mailto:${resource.adminEmail}`, params));
          }
        });
      }
    } catch (e) {
      console.error(`Error processing resources:`, e);
    }
  }
  
  return lines;
}

/**
 * Format a recurrence rule for iCalendar
 * @param ruleString The recurrence rule as a JSON string
 * @returns Formatted RRULE string
 */
export function formatRecurrenceRule(ruleString: string): string {
  try {
    const parsedRule = JSON.parse(ruleString);
    
    // Start building the RRULE string
    const ruleParts: string[] = [];
    
    // Pattern (FREQ)
    if (parsedRule.pattern) {
      ruleParts.push(`FREQ=${parsedRule.pattern.toUpperCase()}`);
    }
    
    // Interval
    if (parsedRule.interval && parsedRule.interval > 1) {
      ruleParts.push(`INTERVAL=${parsedRule.interval}`);
    }
    
    // Weekdays (BYDAY) for weekly patterns
    if (parsedRule.pattern === 'Weekly' && parsedRule.weekdays && parsedRule.weekdays.length > 0) {
      const days = parsedRule.weekdays.map((day: string) => {
        switch (day) {
          case 'Monday': return 'MO';
          case 'Tuesday': return 'TU';
          case 'Wednesday': return 'WE';
          case 'Thursday': return 'TH';
          case 'Friday': return 'FR';
          case 'Saturday': return 'SA';
          case 'Sunday': return 'SU';
          default: return '';
        }
      }).filter(Boolean).join(',');
      
      if (days) {
        ruleParts.push(`BYDAY=${days}`);
      }
    }
    
    // End type
    if (parsedRule.endType) {
      if (parsedRule.endType === 'After' && parsedRule.occurrences) {
        ruleParts.push(`COUNT=${parsedRule.occurrences}`);
      } else if (parsedRule.endType === 'On' && parsedRule.untilDate) {
        const untilDate = new Date(parsedRule.untilDate);
        ruleParts.push(`UNTIL=${formatICalDate(untilDate)}`);
      }
    }
    
    return ruleParts.join(';');
  } catch (error) {
    console.error(`Error formatting recurrence rule:`, error);
    return ruleString; // Return the original string if parsing fails
  }
}

/**
 * Extract the SEQUENCE value from an iCalendar event string
 * @param icalData The raw iCalendar data string
 * @returns The SEQUENCE value as a number (defaults to 0 if not found)
 */
export function extractSequenceFromICal(icalData: string): number {
  try {
    const sequenceMatch = icalData.match(/SEQUENCE:(\d+)/);
    if (sequenceMatch && sequenceMatch[1]) {
      return parseInt(sequenceMatch[1], 10);
    }
    return 0; // Default if no SEQUENCE is found
  } catch (error) {
    console.error('Error extracting SEQUENCE from iCalendar data:', error);
    return 0; // Safe default
  }
}