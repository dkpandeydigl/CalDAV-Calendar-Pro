/**
 * Utility functions for working with iCalendar data
 */

/**
 * Decodes HTML entities in a string
 * This is a simplified version that handles common HTML entities
 * @param html The HTML string with entities to decode
 * @returns The decoded string
 */
function decodeHtmlEntities(html: string): string {
  if (!html) return '';
  
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '--')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&bull;/g, '*')
    .replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
}

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
  organizerName?: string; // Add organizer display name
  sequence: number;
  timestamp: string;
  method?: string;
  status?: string;
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN'
  ];
  
  // Add METHOD if provided (e.g., CANCEL, REQUEST)
  if (options.method) {
    lines.push(`METHOD:${options.method}`);
  }
  
  lines.push('BEGIN:VEVENT');
  
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
  
  // Add STATUS if provided (e.g., CANCELLED)
  if (options.status) {
    lines.push(formatContentLine('STATUS', options.status));
  }
  
  // Handle recurrence rules
  try {
    // First check if there's a direct recurrenceRule property
    if (event.recurrenceRule) {
      // Check if it's already a string in RRULE format (starts with FREQ=)
      if (typeof event.recurrenceRule === 'string' && event.recurrenceRule.includes('FREQ=')) {
        lines.push(formatContentLine('RRULE', event.recurrenceRule));
      } else {
        // Otherwise try to format it
        const rrule = formatRecurrenceRule(event.recurrenceRule);
        if (rrule) {
          lines.push(formatContentLine('RRULE', rrule));
        }
      }
    }
    
    // If we still don't have a recurrence rule but it's a CANCELLED event, try to extract it from rawData
    if (options.status === 'CANCELLED' && !event.recurrenceRule && event.rawData) {
      // Try to extract recurrence rule from raw data
      const rruleMatch = typeof event.rawData === 'string' 
        ? event.rawData.match(/RRULE:([^\r\n]+)/)
        : null;
      
      if (rruleMatch && rruleMatch[1]) {
        console.log(`Extracted RRULE from raw ICS data for cancellation: ${rruleMatch[1]}`);
        lines.push(formatContentLine('RRULE', rruleMatch[1]));
      }
    }
  } catch (rruleError) {
    console.warn('Error processing recurrence rule:', rruleError);
    // Continue without recurrence rule if there's an error
  }
  
  // Process attendees and resources
  const attendeesAndResources = generateAttendeesAndResources(event);
  lines.push(...attendeesAndResources);
  
  // Add organizer with name if provided
  const emailMatch = options.organizer.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
  const email = emailMatch ? options.organizer : `${options.organizer}@caldavclient.local`;
  const organizerParams: Record<string, string> = { 
    CN: options.organizerName || options.organizer 
  };
  lines.push(formatContentLine('ORGANIZER', `mailto:${email}`, organizerParams));
  
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
            // Use resource name for CN parameter if available, fallback to adminName
            if (resource.name) {
              params.CN = resource.name;
            } else if (resource.adminName) {
              params.CN = resource.adminName;
            }
            
            params.CUTYPE = 'RESOURCE';
            params.ROLE = 'NON-PARTICIPANT';
            
            // Add X-RESOURCE-TYPE
            if (resource.type || resource.subType) {
              params['X-RESOURCE-TYPE'] = resource.type || resource.subType;
            }
            
            // Add X-RESOURCE-CAPACITY if available
            if (resource.capacity !== undefined && resource.capacity !== null) {
              params['X-RESOURCE-CAPACITY'] = String(resource.capacity);
            }
            
            // Add X-ADMIN-NAME if available
            if (resource.adminName) {
              params['X-ADMIN-NAME'] = resource.adminName;
            }
            
            // Add X-NOTES-REMARKS if available
            if (resource.remarks) {
              params['X-NOTES-REMARKS'] = resource.remarks;
            }
            
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
export function formatRecurrenceRule(ruleString: string | undefined | null): string {
  if (!ruleString) {
    return '';
  }
  
  // If the string already has FREQ= in it, it's likely already in proper RRULE format
  if (typeof ruleString === 'string' && ruleString.includes('FREQ=')) {
    return ruleString;
  }
  
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
    // If it's not valid JSON but has a format that looks like a valid RRULE,
    // return it as is instead of causing an error
    if (typeof ruleString === 'string' && 
        (ruleString.includes('DAILY') || 
         ruleString.includes('WEEKLY') || 
         ruleString.includes('MONTHLY') || 
         ruleString.includes('YEARLY'))) {
      return ruleString;
    }
    return ruleString || ''; // Return the original string or empty string if null/undefined
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

/**
 * Generate a cancellation iCalendar for an event
 * This follows RFC 5546 for properly canceling events
 * @param event The event data to cancel
 * @param options Additional options for the cancellation
 * @returns Properly formatted iCalendar cancellation data
 */
export function generateCancellationICalEvent(event: any, options: {
  organizer: string;
  organizerName?: string;
  sequence: number;
  timestamp: string;
}): string {
  // Increment the sequence number
  const updatedSequence = options.sequence + 1;
  
  // Extract the original UID from raw data if available to ensure exact match
  let originalUid = event.uid;
  if (event.rawData && typeof event.rawData === 'string') {
    const uidMatch = event.rawData.match(/UID:([^\r\n]+)/);
    if (uidMatch && uidMatch[1]) {
      console.log(`Using exact UID from raw data for cancellation: ${uidMatch[1]}`);
      originalUid = uidMatch[1];
      // Update the event object with the extracted UID to ensure it's used
      event.uid = originalUid;
    }
  }
  
  // Create a shallow copy of the event - we don't want to modify the original
  const eventCopy = { ...event, uid: originalUid };
  
  // Make sure we retain the resources array for cancellations
  if (!eventCopy.resources || !Array.isArray(eventCopy.resources) || eventCopy.resources.length === 0) {
    let extractedResources: any[] = [];
    
    // First try to parse resources if they're stored as a string
    if (typeof eventCopy.resources === 'string') {
      try {
        const parsedResources = JSON.parse(eventCopy.resources);
        if (Array.isArray(parsedResources) && parsedResources.length > 0) {
          extractedResources = parsedResources;
          console.log(`Parsed ${extractedResources.length} resources from string in event data`);
        }
      } catch (e) {
        console.warn('Failed to parse resources string:', e);
      }
    }
    
    // If we still don't have resources, try to extract from raw data
    if (extractedResources.length === 0 && event.rawData && typeof event.rawData === 'string') {
      // Try to extract resource attendees from the raw data with multiple patterns
      const resourcePatterns = [
        /ATTENDEE;[^:]*CUTYPE=RESOURCE[^:]*:mailto:([^\r\n]+)/gi,
        /ATTENDEE;[^:]*CN=([^;:]+)[^:]*CUTYPE=RESOURCE[^:]*:mailto:([^\r\n]+)/gi,
        /ATTENDEE;[^:]*X-RESOURCE-TYPE=[^:]*:mailto:([^\r\n]+)/gi
      ];
      
      for (const pattern of resourcePatterns) {
        const matches = Array.from(event.rawData.matchAll(pattern));
        if (matches && matches.length > 0) {
          console.log(`Found ${matches.length} resource attendees in raw data using pattern: ${pattern}`);
          
          // Parse each resource attendee into our format
          const resources = matches.map((match: RegExpMatchArray) => {
            const resourceStr = match[0];
            
            // Extract email
            const emailMatch = resourceStr.match(/:mailto:([^\r\n]+)/);
            const email = emailMatch ? emailMatch[1] : '';
            
            // Extract name/subType
            const nameMatch = resourceStr.match(/CN=([^;:]+)/);
            const subType = nameMatch ? nameMatch[1] : 'Resource';
            
            // Extract type from X-RESOURCE-TYPE or fallback to standard parameters
            const typeMatches = [
              resourceStr.match(/X-RESOURCE-TYPE=([^;:]+)/),
              resourceStr.match(/RESOURCE-TYPE=([^;:]+)/),
              resourceStr.match(/X-TYPE=([^;:]+)/)
            ];
            const typeMatch = typeMatches.find(match => match !== null);
            const resourceType = typeMatch ? typeMatch[1] : 'Resource';
            
            // Extract capacity with multiple patterns
            const capacityMatches = [
              resourceStr.match(/X-RESOURCE-CAPACITY=(\d+)/),
              resourceStr.match(/RESOURCE-CAPACITY=(\d+)/),
              resourceStr.match(/X-CAPACITY=(\d+)/),
              resourceStr.match(/CAPACITY=(\d+)/)
            ];
            const capacityMatch = capacityMatches.find(match => match !== null);
            const capacity = capacityMatch ? parseInt(capacityMatch[1], 10) : undefined;
            
            // Extract admin name
            const adminNameMatches = [
              resourceStr.match(/X-ADMIN-NAME=([^;:]+)/),
              resourceStr.match(/ADMIN-NAME=([^;:]+)/),
              resourceStr.match(/X-ADMIN=([^;:]+)/)
            ];
            const adminNameMatch = adminNameMatches.find(match => match !== null);
            const adminName = adminNameMatch ? adminNameMatch[1] : undefined;
            
            // Extract remarks with multiple patterns
            const remarksMatches = [
              resourceStr.match(/X-NOTES-REMARKS=([^;:]+)/),
              resourceStr.match(/X-REMARKS=([^;:]+)/),
              resourceStr.match(/REMARKS=([^;:]+)/),
              resourceStr.match(/X-NOTES=([^;:]+)/),
              resourceStr.match(/NOTES=([^;:]+)/)
            ];
            const remarksMatch = remarksMatches.find(match => match !== null);
            const remarks = remarksMatch ? 
              remarksMatch[1].replace(/\\n/g, '\n').replace(/\\;/g, ';').replace(/\\,/g, ',').replace(/\\\\/g, '\\') : 
              undefined;
            
            return {
              id: email,
              name: subType,
              adminEmail: email,
              adminName: adminName || subType,
              type: resourceType,
              subType,
              capacity,
              remarks,
              displayName: subType,
              email: email
            };
          });
          
          if (resources.length > 0) {
            extractedResources = resources;
            break; // Once we have resources, stop trying patterns
          }
        }
      }
      
      if (extractedResources.length > 0) {
        console.log(`Successfully extracted ${extractedResources.length} resources for cancellation`);
        eventCopy.resources = extractedResources;
      } else {
        console.warn('No resources could be extracted from raw data');
      }
    }
  } else {
    console.log(`Using ${eventCopy.resources.length} resources already present in event data`);
  }
  
  // If the original event had a TRANSP property that wasn't TRANSPARENT,
  // ensure we don't carry that over as it conflicts with CANCELLED status
  eventCopy.transparency = 'TRANSPARENT';
  
  // Generate a cancellation iCalendar - make sure we use the original UID
  return generateICalEvent(eventCopy, {
    organizer: options.organizer,
    organizerName: options.organizerName, // Pass through the organizer name
    sequence: updatedSequence,
    timestamp: options.timestamp,
    method: 'CANCEL',
    status: 'CANCELLED'
  });
}