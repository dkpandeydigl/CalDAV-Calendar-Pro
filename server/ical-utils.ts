/**
 * Utility functions for working with iCalendar data
 * 
 * This file contains helpers for generating, parsing, and manipulating
 * iCalendar (RFC 5545) formatted data.
 */

/**
 * Extracts the sequence number from an iCalendar string
 * 
 * @param icalData The raw iCalendar data
 * @returns The sequence number (defaults to 0 if not found)
 */
export function extractSequenceFromICal(icalData: string): number {
  try {
    if (!icalData) return 0;
    
    // Look for SEQUENCE: property
    const sequenceMatch = icalData.match(/SEQUENCE:(\d+)/i);
    if (sequenceMatch && sequenceMatch[1]) {
      return parseInt(sequenceMatch[1], 10);
    }
    
    return 0; // Default value per RFC 5545
  } catch (error) {
    console.error('Error extracting sequence number from iCalendar data:', error);
    return 0;
  }
}

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
 * Properly formats an iCalendar date-time value with enhanced type and error handling
 * @param date The date to format
 * @param allDay Whether this is an all-day event
 * @returns Formatted date string for iCalendar
 */
export function formatICalDate(date: any, allDay: boolean = false): string {
  let dateObj: Date;
  
  try {
    // Handle null or undefined dates
    if (date === null || date === undefined) {
      console.warn("Converting null/undefined date to current date");
      dateObj = new Date();
    } 
    // Handle string dates
    else if (typeof date === 'string') {
      try {
        dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          console.warn(`Invalid string date: "${date}", using current date`);
          dateObj = new Date();
        }
      } catch (e) {
        console.warn(`Failed to parse string date "${date}", using current date`);
        dateObj = new Date();
      }
    } 
    // Handle number dates (timestamps)
    else if (typeof date === 'number') {
      try {
        dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          console.warn(`Invalid numeric date: ${date}, using current date`);
          dateObj = new Date();
        }
      } catch (e) {
        console.warn(`Failed to create date from number ${date}, using current date`);
        dateObj = new Date();
      }
    }
    // Handle Date objects
    else if (date instanceof Date) {
      if (isNaN(date.getTime())) {
        console.warn(`Invalid Date object, using current date`);
        dateObj = new Date();
      } else {
        dateObj = date;
      }
    } 
    // Handle any other unexpected input
    else {
      console.warn(`Unexpected date type ${typeof date}, using current date`);
      dateObj = new Date();
    }
    
    // Generate the iCalendar format
    if (allDay) {
      return dateObj.toISOString().replace(/[-:]/g, '').split('T')[0];
    }
    return dateObj.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
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
  
  // Add required properties - UID must be preserved exactly as-is for RFC 5546 compliance
  // especially for cancellations that MUST use the same UID as the original event
  
  // CRITICAL: UID handling - ensure the exact UID is preserved and no modifications are made
  if (!event.uid) {
    console.error('CRITICAL ERROR: Attempting to generate ICS without a UID. This will cause RFC compliance issues.');
    // Generate a fallback UID only in extreme cases - should never happen
    event.uid = `emergency-fallback-${Date.now()}@caldavclient.local`;
  }
  
  // For cancellations, this UID MUST match the original event exactly (RFC 5546 requirement)
  console.log(`Generating ICS with UID: ${event.uid} (Method: ${options.method || 'REQUEST'})`);
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
        console.log(`[ICAL-GEN] Using RRULE directly from event: ${event.recurrenceRule}`);
        lines.push(formatContentLine('RRULE', event.recurrenceRule));
      } else {
        // If it's a JSON string, parse it and format
        if (typeof event.recurrenceRule === 'string' && (
            event.recurrenceRule.startsWith('{') || 
            event.recurrenceRule.includes('"pattern"') || 
            event.recurrenceRule.includes('"frequency"')
        )) {
          try {
            // Try to parse the JSON string
            const parsedRule = JSON.parse(event.recurrenceRule);
            // Format the parsed object
            console.log(`[ICAL-GEN] Parsed recurrence rule from JSON string`);
            const rrule = formatRecurrenceRule(parsedRule);
            if (rrule) {
              console.log(`[ICAL-GEN] Formatted recurrence rule: ${rrule}`);
              lines.push(formatContentLine('RRULE', rrule));
            }
          } catch (jsonError) {
            console.error(`[ICAL-GEN] Error parsing recurrence rule JSON: ${jsonError}`);
            // Try to format the string directly as a fallback
            const rrule = formatRecurrenceRule(event.recurrenceRule);
            if (rrule) {
              console.log(`[ICAL-GEN] Formatted recurrence rule (fallback): ${rrule}`);
              lines.push(formatContentLine('RRULE', rrule));
            }
          }
        } else {
          // Otherwise try to format it using the helper function
          const rrule = formatRecurrenceRule(event.recurrenceRule);
          if (rrule) {
            console.log(`[ICAL-GEN] Formatted recurrence rule from object/other: ${rrule}`);
            lines.push(formatContentLine('RRULE', rrule));
          }
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
        console.log(`[ICAL-GEN] Extracted RRULE from raw ICS data for cancellation: ${rruleMatch[1]}`);
        lines.push(formatContentLine('RRULE', rruleMatch[1]));
      }
    }
    
    // Debug logs to help track recurrence rule processing
    if (event.isRecurring && !event.recurrenceRule) {
      console.warn(`[ICAL-GEN] Warning: Event is marked as recurring but has no recurrence rule. UID: ${event.uid}`);
    }
  } catch (rruleError) {
    console.warn('[ICAL-GEN] Error processing recurrence rule:', rruleError);
    // Continue without recurrence rule if there's an error
  }
  
  // Process attendees and resources
  // First check if we have preserved original attendee lines (especially for cancellations)
  if (event._originalResourceAttendees && Array.isArray(event._originalResourceAttendees) && 
      event._originalResourceAttendees.length > 0 && options.method === 'CANCEL') {
    
    console.log(`Using ${event._originalResourceAttendees.length} preserved original resource attendee lines for cancellation`);
    
    // First add regular attendees
    const regularAttendees = generateAttendeesAndResources(event, true);
    lines.push(...regularAttendees);
    
    // Then add the original resource attendee lines exactly as they were
    lines.push(...event._originalResourceAttendees);
  } else {
    // Standard processing for regular events
    const attendeesAndResources = generateAttendeesAndResources(event);
    lines.push(...attendeesAndResources);
  }
  
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
 * @param skipResources If true, only generate lines for regular attendees (not resources)
 * @returns Array of formatted iCalendar lines for attendees and resources
 */
function generateAttendeesAndResources(event: any, skipResources: boolean = false): string[] {
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
  
  // Process resources if present and not skipped
  if (event.resources && !skipResources) {
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
 */
export function generateCancellationICalEvent(event: any, options: {
  organizer: string;
  organizerName?: string;
  sequence: number;
  timestamp: string;
}): string {
  // Increment the sequence number
  const updatedSequence = options.sequence + 1;
  
  // RFC 5546 REQUIRES the EXACT same UID to be used for cancellation events
  // This is critical for cross-client compatibility
  
  // First try to get UID from the explicit property
  let originalUid = event.uid;
  
  // If we have raw data, ALWAYS prioritize extracting the exact UID from it
  // This is the most reliable method to ensure we use the identical UID as the original event
  if (event.rawData && typeof event.rawData === 'string') {
    // Try multiple regex patterns to find the UID
    const uidPatterns = [
      /UID:([^\r\n]+)/i,           // Standard format
      /UID;[^:]*:([^\r\n]+)/i,     // With parameters
      /"UID":"([^"]+)"/i           // JSON format
    ];
    
    // Try each pattern until we find a match
    for (const pattern of uidPatterns) {
      const uidMatch = event.rawData.match(pattern);
      if (uidMatch && uidMatch[1]) {
        const extractedUid = uidMatch[1].trim();
        if (extractedUid) {
          console.log(`[RFC 5546] Using exact UID from raw data for cancellation: ${extractedUid}`);
          originalUid = extractedUid;
          // Immediately break once we find a valid UID
          break;
        }
      }
    }
    
    // Preserve all ATTENDEE lines, especially resources
    try {
      console.log("Extracting original ATTENDEE lines from raw data for preservation...");
      const attendeeLines = event.rawData.match(/ATTENDEE[^:\r\n]+:[^\r\n]+/g);
      if (attendeeLines && attendeeLines.length > 0) {
        console.log(`Found ${attendeeLines.length} original ATTENDEE lines to preserve`);
        
        // Store resource attendees for later use
        const resourceAttendees = attendeeLines.filter(line => 
          line.includes('CUTYPE=RESOURCE') || 
          line.includes('X-RESOURCE-TYPE')
        );
        
        if (resourceAttendees.length > 0) {
          console.log(`Found ${resourceAttendees.length} resource attendees to preserve:`, resourceAttendees);
          event._originalResourceAttendees = resourceAttendees;
        }
      }
    } catch (err) {
      console.error("Error extracting original ATTENDEE lines:", err);
    }
  }
  
  // Log detailed information for debugging and verification
  console.log(`[RFC 5546] Preserving original UID for cancellation: ${originalUid}`);
  console.log(`Preparing cancellation for event: ${event.title || 'Untitled'} with UID: ${originalUid}`);
  console.log(`Original event has ${event.resources ? event.resources.length : 0} resources and ${event.attendees ? event.attendees.length : 0} attendees`);
  
  // Create a shallow copy of the event and FORCE the original UID
  // Double ensure the UID is set correctly by making it a direct property
  const eventCopy = { 
    ...event, 
    uid: originalUid // Ensure the UID is exactly preserved
  };
  
  // Make sure we retain the resources array for cancellations
  if (!eventCopy.resources || !Array.isArray(eventCopy.resources) || eventCopy.resources.length === 0) {
    let extractedResources: any[] = [];
    
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

/**
 * Enhanced folding for iCalendar lines according to RFC 5545 section 3.1
 * Lines longer than 75 octets should be folded by inserting a CRLF followed by a space
 * @param text The line to fold
 * @returns The folded line
 */
export function foldLineEnhanced(text: string): string {
  if (text.length <= 75) {
    return text;
  }
  
  // Fold the line by inserting CRLF+SPACE every 75 characters
  // RFC 5545 specifies folding after 75 octets, not characters
  // But since we're mostly dealing with ASCII, this is a reasonable approximation
  let result = '';
  let currentLineLength = 0;
  let firstLine = true;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // If we've reached 75 characters (but not at the beginning of the line)
    if (!firstLine && currentLineLength >= 75) {
      result += '\r\n '; // CRLF followed by a space
      currentLineLength = 1; // Reset with the space already counted
    }
    
    result += char;
    currentLineLength++;
    
    if (firstLine) {
      firstLine = false;
    }
  }
  
  return result;
}

/**
 * Fold all lines in an iCalendar document
 * @param icsData The iCalendar data to fold
 * @returns The folded iCalendar data
 */
export function foldICSContent(icsData: string): string {
  // Split by lines, fold each line, then join back
  const lines = icsData.split(/\r?\n/);
  const foldedLines = lines.map(line => foldLineEnhanced(line));
  return foldedLines.join('\r\n');
}

/**
 * Process SCHEDULE-STATUS properties in an ICS file to ensure they are properly formatted
 * This fixes issues with incorrectly formatted SCHEDULE-STATUS parameters
 */
export function processScheduleStatus(icsData: string): string {
  // Look for SCHEDULE-STATUS in ATTENDEE lines
  const attendeeRegex = /ATTENDEE(?:[^:]*)(SCHEDULE-STATUS=[^;:]*)(?:[^:]*):([^\r\n]+)/g;
  
  return icsData.replace(attendeeRegex, (match, statusPart, value) => {
    // Extract the actual status value
    const statusMatch = statusPart.match(/SCHEDULE-STATUS=([^;:]+)/);
    if (statusMatch) {
      const status = statusMatch[1].trim();
      // Only if it's not already quoted, quote it
      if (status && !status.startsWith('"') && !status.endsWith('"')) {
        const fixedStatusPart = statusPart.replace(/SCHEDULE-STATUS=[^;:]+/, `SCHEDULE-STATUS="${status}"`);
        return match.replace(statusPart, fixedStatusPart);
      }
    }
    
    return match;
  });
}

/**
 * Sanitize and format an ICS file to ensure RFC 5545 compliance
 * This fixes various formatting issues and ensures the file is properly formatted
 * @param icsData The raw ICS data
 * @param options Optional settings to apply (method, status, sequence)
 * @returns Properly formatted and sanitized ICS data
 */
export function sanitizeAndFormatICS(icsData: string, options: { method?: string, status?: string, sequence?: number } = {}): string {
  let result = icsData;
  
  // Fix missing METHOD
  if (options.method && !result.includes('METHOD:')) {
    result = result.replace('PRODID:', `METHOD:${options.method}\r\nPRODID:`);
  }
  
  // Fix missing STATUS - add after UID line similar to SEQUENCE
  if (options.status && !result.includes('STATUS:')) {
    const uidRegex = /(UID:.*(?:\r\n|\n|$))/;
    if (uidRegex.test(result)) {
      result = result.replace(uidRegex, `$1STATUS:${options.status}\r\n`);
    } else {
      // Fallback if UID line not found
      result = result.replace('BEGIN:VEVENT', `BEGIN:VEVENT\r\nSTATUS:${options.status}`);
    }
  }
  
  // Fix missing SEQUENCE - add it after the UID line, not in the middle of it
  if (options.sequence !== undefined && !result.includes('SEQUENCE:')) {
    // Replace entire UID line with itself + SEQUENCE
    const uidRegex = /(UID:.*(?:\r\n|\n|$))/;
    if (uidRegex.test(result)) {
      result = result.replace(uidRegex, `$1SEQUENCE:${options.sequence}\r\n`);
    } else {
      // Fallback if UID line not found
      result = result.replace('BEGIN:VEVENT', `BEGIN:VEVENT\r\nSEQUENCE:${options.sequence}`);
    }
  }
  
  // Fix non-standard RESOURCE-TYPE properties (should have X- prefix)
  result = result.replace(/RESOURCE-TYPE=/g, 'X-RESOURCE-TYPE=');
  
  // Fix double colons in mailto references
  result = result.replace(/mailto::([^\r\n]+)/g, 'mailto:$1');
  
  // Fix incorrect timestamp formats with double Z (e.g., 20250417T105135ZZ)
  result = result.replace(/(\d{8}T\d{6})ZZ/g, '$1Z');
  
  // Fix SCHEDULE-STATUS values with improper syntax
  result = processScheduleStatus(result);
  
  // Fix RRULE values containing mailto references or other invalid data
  result = result.replace(/RRULE:([^;\r\n]*)(mailto:.*?)(?:\r\n|\n|$)/g, (match, prefix) => {
    // Handle cases where mailto: is incorrectly appended to RRULE
    return `RRULE:${prefix}\r\n`;
  });
  
  // Additionally look for malformed RRULE values and fix them
  const rruleRegex = /RRULE:([^\r\n]*)/g;
  let rruleMatch;
  let fixedResult = result;
  
  while ((rruleMatch = rruleRegex.exec(result)) !== null) {
    const fullMatch = rruleMatch[0];
    const rruleValue = rruleMatch[1];
    
    // Check if the RRULE contains invalid components
    if (rruleValue.includes('@') || rruleValue.includes('<') || rruleValue.includes('>')) {
      // Extract only valid RRULE parts (FREQ, UNTIL, COUNT, INTERVAL, etc.)
      const validParts = [];
      const parts = rruleValue.split(';');
      
      for (const part of parts) {
        // Only keep parts that start with valid RRULE parameters
        if (/^(FREQ|UNTIL|COUNT|INTERVAL|BYSECOND|BYMINUTE|BYHOUR|BYDAY|BYMONTHDAY|BYYEARDAY|BYWEEKNO|BYMONTH|BYSETPOS|WKST)=/i.test(part)) {
          validParts.push(part);
        }
      }
      
      // Replace the malformed RRULE with a cleaned version
      const cleanRrule = `RRULE:${validParts.join(';')}`;
      fixedResult = fixedResult.replace(fullMatch, cleanRrule);
    }
  }
  
  result = fixedResult;
  
  // Properly terminate the file if needed
  if (!result.endsWith('END:VCALENDAR')) {
    result = result.trimEnd() + '\r\nEND:VCALENDAR';
  }

  // Apply RFC 5545 compliant line folding
  result = foldICSContent(result);

  return result;
}
