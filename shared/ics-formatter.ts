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
 * - Accidental quote enclosures (e.g., when copying and pasting)
 * 
 * @param icsData Raw iCalendar data string
 * @param options Optional settings to modify the ICS content
 * @returns Sanitized and properly formatted iCalendar data
 */
export interface SanitizeOptions {
  uid?: string;
  method?: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH';
  status?: string;
  sequence?: number;
  organizer?: {
    email: string;
    name?: string;
  };
  preserveAttendees?: boolean;
  preserveResources?: boolean;
}

export function sanitizeAndFormatICS(icsData: string, options?: SanitizeOptions): string {
  if (!icsData) return '';
  
  // Remove any enclosing quotes that might have been added when copying and pasting
  let data = icsData.trim();
  if ((data.startsWith('"') && data.endsWith('"')) || 
      (data.startsWith("'") && data.endsWith("'"))) {
    data = data.substring(1, data.length - 1);
  }
  
  // Convert all line endings to LF for processing
  data = data.replace(/\r\n|\r/g, '\n');
  
  // Fix literal "\r\n" text occurrences that should be actual breaks
  data = data.replace(/\\r\\n/g, '\n');
  
  // Split into lines for content-aware processing
  const lines = data.split('\n');
  const sanitizedLines: string[] = [];
  
  // Track if we need to apply modifications based on options
  let foundMethod = false;
  let foundStatus = false;
  let foundSequence = false;
  let foundUID = false;
  let foundOrganizer = false;
  let inVCalendar = false;
  let inVEvent = false;
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip completely empty lines
    if (!line) continue;
    
    // Track component boundaries
    if (line === 'BEGIN:VCALENDAR') {
      inVCalendar = true;
    } else if (line === 'END:VCALENDAR') {
      inVCalendar = false;
    } else if (line === 'BEGIN:VEVENT') {
      inVEvent = true;
    } else if (line === 'END:VEVENT') {
      inVEvent = false;
      
      // Before ending the VEVENT, add any missing properties from options
      if (options) {
        // Add METHOD if specified and not already present
        if (options.method && !foundMethod) {
          sanitizedLines.push(`METHOD:${options.method}`);
        }
        
        // Add STATUS if specified and not already present
        if (options.status && !foundStatus) {
          sanitizedLines.push(`STATUS:${options.status}`);
        }
        
        // Add SEQUENCE if specified and not already present
        if (options.sequence !== undefined && !foundSequence) {
          sanitizedLines.push(`SEQUENCE:${options.sequence}`);
        }
        
        // Add UID if specified and not already present
        if (options.uid && !foundUID) {
          sanitizedLines.push(`UID:${options.uid}`);
        }
        
        // Add ORGANIZER if specified and not already present
        if (options.organizer && !foundOrganizer) {
          const { email, name } = options.organizer;
          const organizerLine = name 
            ? `ORGANIZER;CN=${name}:mailto:${email}` 
            : `ORGANIZER:mailto:${email}`;
          sanitizedLines.push(organizerLine);
        }
      }
      
      // Add the END:VEVENT line
      sanitizedLines.push(line);
      continue;
    }
    
    // Track properties for optional modifications
    if (inVCalendar && !inVEvent && line.startsWith('METHOD:')) {
      foundMethod = true;
      // Replace METHOD if specified in options
      if (options?.method) {
        line = `METHOD:${options.method}`;
      }
    } else if (inVEvent && line.startsWith('STATUS:')) {
      foundStatus = true;
      // Replace STATUS if specified in options
      if (options?.status) {
        line = `STATUS:${options.status}`;
      }
    } else if (inVEvent && line.startsWith('SEQUENCE:')) {
      foundSequence = true;
      // Replace SEQUENCE if specified in options
      if (options?.sequence !== undefined) {
        line = `SEQUENCE:${options.sequence}`;
      }
    } else if (inVEvent && line.startsWith('UID:')) {
      foundUID = true;
      // Replace UID if specified in options
      if (options?.uid) {
        line = `UID:${options.uid}`;
      }
    } else if (inVEvent && line.match(/^ORGANIZER[^:]*:/)) {
      foundOrganizer = true;
      // Replace ORGANIZER if specified in options
      if (options?.organizer) {
        const { email, name } = options.organizer;
        line = name 
          ? `ORGANIZER;CN=${name}:mailto:${email}` 
          : `ORGANIZER:mailto:${email}`;
      }
    }
    
    // Skip or modify ATTENDEE lines based on options
    if (line.startsWith('ATTENDEE') && options) {
      if (!options.preserveAttendees && !line.includes('CUTYPE=RESOURCE')) {
        continue; // Skip non-resource attendees if not preserving them
      }
      
      if (!options.preserveResources && line.includes('CUTYPE=RESOURCE')) {
        continue; // Skip resource attendees if not preserving them
      }
    }
    
    // Fix RRULE with improperly appended mailto: or any other text after valid parameters
    if (line.startsWith('RRULE:')) {
      const originalRule = line.substring(6); // Remove 'RRULE:' prefix
      
      // Check if there's a mailto: or colon in the RRULE - this is a common issue
      if (originalRule.includes('mailto:') || originalRule.includes(':')) {
        console.log(`Found mailto: or colon in RRULE - cleaning it properly`);
        
        // If there's a colon, split at the first colon and only keep the part before it
        // This handles cases like "FREQ=DAILY;COUNT=2:mailto:someone@example.com"
        let cleanedRule = originalRule;
        if (originalRule.includes(':')) {
          const colonIndex = originalRule.indexOf(':');
          cleanedRule = originalRule.substring(0, colonIndex);
          console.log(`Split RRULE at colon, keeping only: ${cleanedRule}`);
        }
        
        // Continue with normal processing with the cleaned rule
        line = `RRULE:${cleanedRule}`;
      }
      
      // Extract only valid RRULE parts: FREQ, UNTIL, COUNT, INTERVAL, BYSECOND, BYMINUTE, etc.
      const validRulePrefixes = ['FREQ=', 'UNTIL=', 'COUNT=', 'INTERVAL=', 'BYSECOND=', 
        'BYMINUTE=', 'BYHOUR=', 'BYDAY=', 'BYMONTHDAY=', 'BYYEARDAY=', 
        'BYWEEKNO=', 'BYMONTH=', 'BYSETPOS=', 'WKST='];
      
      const ruleParts = line.substring(6).split(';'); // Remove 'RRULE:' prefix and split by semicolon
      const validParts = ruleParts.filter(part => {
        // Keep only parts that start with valid RRULE parameter names
        return validRulePrefixes.some(prefix => part.startsWith(prefix));
      });
      
      // Reconstruct the RRULE with only valid parts
      line = `RRULE:${validParts.join(';')}`;
      console.log(`Extracted RRULE from raw ICS data: ${validParts.join(';')}`);
    }
    
    // Fix issues with ATTENDEE and ORGANIZER lines
    if (line.includes('ATTENDEE') || line.includes('ORGANIZER')) {
      // Fix double colon issue in mailto:: (a common formatting error)
      if (line.includes('mailto::')) {
        console.log('Found double colon in mailto:: - fixing to mailto:');
        line = line.replace(/mailto::/g, 'mailto:');
      }
      
      // Check if this line contains SCHEDULE-STATUS
      if (line.includes('SCHEDULE-STATUS=')) {
        console.log('Found SCHEDULE-STATUS in raw ICS data - preprocessing...');
        
        // Fix improper SCHEDULE-STATUS formatting
        if (line.includes(':')) {
          // Split into parameters and value parts
          const parts = line.split(':');
          if (parts.length > 1) {
            const parameters = parts[0];
            const value = parts[1];
            
            // Extract SCHEDULE-STATUS component before the colon
            let scheduleStatusPattern = /SCHEDULE-STATUS=([^;:]+)/;
            let scheduleStatusMatch = parameters.match(scheduleStatusPattern);
            
            if (scheduleStatusMatch) {
              const statusValue = scheduleStatusMatch[1];
              
              // Ensure the status value is properly formatted (should be a number.number format)
              const statusRegex = /^\d+\.\d+$/;
              if (!statusRegex.test(statusValue)) {
                // Replace with a valid value (1.2 means successfully processed)
                const fixedParameters = parameters.replace(
                  /SCHEDULE-STATUS=[^;:]+/, 
                  'SCHEDULE-STATUS=1.2'
                );
                
                // Remove any stray colons from the value part
                const cleanValue = value.replace(/:/g, '');
                line = `${fixedParameters}:${cleanValue}`;
                console.log('Fixed invalid SCHEDULE-STATUS format');
              } else {
                // Status value is valid, just clean up any stray colons
                const cleanValue = value.replace(/:/g, '');
                line = `${parameters}:${cleanValue}`;
              }
            } else {
              // No SCHEDULE-STATUS parameter found despite the string being present
              // This could be due to malformed data - just clean up
              const cleanValue = value.replace(/:/g, '');
              line = `${parameters}:${cleanValue}`;
            }
          }
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
  attendees?: Array<{email: string, name?: string, role?: string, status?: string}>;
  resources?: Array<{email: string, name?: string, type?: string, capacity?: number}>;
  recurrenceRule?: string;
  organizer?: {email: string, name?: string};
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
  
  // Create array for iCalendar component lines
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
    `UID:${event.uid}`,
    `DTSTAMP:${formatDate(new Date())}`
  ];
  
  // Add description and location if provided
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }
  
  // Add status
  lines.push('STATUS:CONFIRMED');
  
  // Add sequence
  lines.push('SEQUENCE:0');
  
  // Add organizer if provided
  if (event.organizer) {
    const organizerStr = event.organizer.name ? 
      `ORGANIZER;CN=${event.organizer.name}:mailto:${event.organizer.email}` : 
      `ORGANIZER:mailto:${event.organizer.email}`;
    lines.push(organizerStr);
  }
  
  // Add attendees if provided
  if (event.attendees && Array.isArray(event.attendees)) {
    for (const attendee of event.attendees) {
      let attendeeStr = 'ATTENDEE';
      
      if (attendee.name) {
        attendeeStr += `;CN=${attendee.name}`;
      }
      
      if (attendee.role) {
        attendeeStr += `;ROLE=${attendee.role}`;
      } else {
        attendeeStr += `;ROLE=REQ-PARTICIPANT`;
      }
      
      if (attendee.status) {
        attendeeStr += `;PARTSTAT=${attendee.status}`;
      } else {
        attendeeStr += `;PARTSTAT=NEEDS-ACTION`;
      }
      
      attendeeStr += `:mailto:${attendee.email}`;
      lines.push(attendeeStr);
    }
  }
  
  // Add resources if provided
  if (event.resources && Array.isArray(event.resources)) {
    for (const resource of event.resources) {
      let resourceStr = 'ATTENDEE;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT';
      
      if (resource.name) {
        resourceStr += `;CN=${resource.name}`;
      }
      
      if (resource.type) {
        resourceStr += `;X-RESOURCE-TYPE=${resource.type}`;
      }
      
      if (resource.capacity) {
        resourceStr += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
      }
      
      resourceStr += `:mailto:${resource.email}`;
      lines.push(resourceStr);
    }
  }
  
  // Add recurrence rule if provided, ensuring it's properly formatted
  if (event.recurrenceRule) {
    // Clean up the recurrence rule to ensure no mailto: or other erroneous text
    let cleanRule = event.recurrenceRule;
    
    // Remove any trailing "mailto" text that might be present
    if (cleanRule.includes('mailto')) {
      cleanRule = cleanRule.split('mailto')[0];
    }
    
    // Make sure rule starts with FREQ=
    if (!cleanRule.startsWith('FREQ=')) {
      cleanRule = `FREQ=${cleanRule}`;
    }
    
    lines.push(`RRULE:${cleanRule}`);
  }
  
  // Complete the event
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  
  // Apply proper formatting according to RFC 5545
  return formatICS(lines);
}