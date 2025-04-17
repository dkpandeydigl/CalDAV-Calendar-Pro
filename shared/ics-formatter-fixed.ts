/**
 * ICS Formatter - Improved version
 * 
 * Utility for formatting, sanitizing and standardizing ICS data
 * for consistent calendar interoperability.
 */

export type ICSFormattingOptions = {
  uid?: string;
  method?: 'REQUEST' | 'CANCEL' | 'REPLY' | string;
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE' | string;
  sequence?: number;
  forceNewUID?: boolean;
  preserveAttendees?: boolean;
  preserveResources?: boolean;
  organizer?: {
    email: string;
    name?: string;
  };
};

/**
 * Clean and format an ICS string to ensure compatibility with various calendar clients
 * 
 * @param rawICS The raw ICS string to format
 * @param options Options for formatting
 * @returns A properly formatted ICS string
 */
export function sanitizeAndFormatICS(
  rawICS: string, 
  options: ICSFormattingOptions = {}
): string {
  // Default options
  const method = options.method || 'REQUEST';
  const status = options.status || 'CONFIRMED';
  const sequence = options.sequence !== undefined ? options.sequence : null;
  
  // Extract original UID if we're not forcing a new one
  let originalUID = '';
  if (!options.forceNewUID) {
    const uidMatch = rawICS.match(/UID:([^\r\n]+)/i);
    if (uidMatch) {
      originalUID = uidMatch[1].trim();
    }
  }
  
  // Split into lines for processing
  let lines = rawICS.split(/\r?\n/);
  let outputLines: string[] = [];
  let inVEvent = false;
  let hasMethod = false;
  let hasStatus = false;
  let hasCalScale = false;
  let hasSequence = false;
  let seenAttendees: Set<string> = new Set();
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Check if we're entering a VEVENT
    if (line === 'BEGIN:VEVENT') {
      inVEvent = true;
      outputLines.push(line);
      continue;
    }
    
    // Check if we're exiting a VEVENT
    if (line === 'END:VEVENT') {
      inVEvent = false;
      
      // Add STATUS if not already present
      if (!hasStatus && status) {
        outputLines.push(`STATUS:${status}`);
      }
      
      // Add SEQUENCE if not already present and we have a value
      if (!hasSequence && sequence !== null) {
        outputLines.push(`SEQUENCE:${sequence}`);
      }
      
      outputLines.push(line);
      continue;
    }
    
    // Handle VCALENDAR header properties
    if (line === 'BEGIN:VCALENDAR') {
      outputLines.push(line);
      continue;
    }
    
    if (line === 'END:VCALENDAR') {
      outputLines.push(line);
      continue;
    }
    
    if (line.startsWith('METHOD:')) {
      hasMethod = true;
      // Override the method if specified in options
      if (options.method) {
        outputLines.push(`METHOD:${method}`);
      } else {
        outputLines.push(line);
      }
      continue;
    }
    
    if (line.startsWith('CALSCALE:')) {
      hasCalScale = true;
      outputLines.push(line);
      continue;
    }
    
    // Handle VEVENT properties
    if (inVEvent) {
      // Handle STATUS property
      if (line.startsWith('STATUS:')) {
        hasStatus = true;
        // Override the status if specified in options
        if (options.status) {
          outputLines.push(`STATUS:${status}`);
        } else {
          outputLines.push(line);
        }
        continue;
      }
      
      // Handle SEQUENCE property
      if (line.startsWith('SEQUENCE:')) {
        hasSequence = true;
        // Override the sequence if specified in options
        if (sequence !== null) {
          outputLines.push(`SEQUENCE:${sequence}`);
        } else {
          outputLines.push(line);
        }
        continue;
      }
      
      // Handle UID property
      if (line.startsWith('UID:')) {
        // Use original UID unless forceNewUID is true
        if (!options.forceNewUID && originalUID) {
          outputLines.push(`UID:${originalUID}`);
        } else {
          outputLines.push(line);
        }
        continue;
      }

      // Handle RRULE property - fix common issues
      if (line.startsWith('RRULE:')) {
        // Check if it's using the non-standard pattern= format
        if (line.includes('pattern=')) {
          // Convert to standard format
          let newRule = 'RRULE:FREQ=';
          
          if (line.includes('pattern=Daily')) {
            newRule += 'DAILY';
          } else if (line.includes('pattern=Weekly')) {
            newRule += 'WEEKLY';
          } else if (line.includes('pattern=Monthly')) {
            newRule += 'MONTHLY';
          } else if (line.includes('pattern=Yearly')) {
            newRule += 'YEARLY';
          }
          
          // Add interval if present
          const intervalMatch = line.match(/interval=(\d+)/);
          if (intervalMatch) {
            newRule += `;INTERVAL=${intervalMatch[1]}`;
          }
          
          // Add count if present
          const countMatch = line.match(/occurrences=(\d+)/);
          if (countMatch) {
            newRule += `;COUNT=${countMatch[1]}`;
          }
          
          // Add until if present
          const untilMatch = line.match(/endDate=([^;]+)/);
          if (untilMatch) {
            // Format the date properly for UNTIL
            newRule += `;UNTIL=${untilMatch[1].replace(/[-:]/g, '')}`;
          }
          
          outputLines.push(newRule);
          continue;
        } else if (line.includes('mailto:')) {
          // Fix broken RRULE that has mailto: in it
          outputLines.push(line.split('mailto:')[0]);
          continue;
        }
      }
      
      // Handle ATTENDEE properties - fix common issues
      if (line.startsWith('ATTENDEE')) {
        // Reconstruct full line if it's broken across multiple lines
        let fullLine = line;
        while (i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
          fullLine += lines[i + 1].trim();
          i++;
        }
        
        // Check for problems with mailto: syntax
        if (!fullLine.includes('mailto:') && fullLine.includes(':')) {
          // Add mailto: if missing
          const parts = fullLine.split(':');
          fullLine = `${parts[0]}:mailto:${parts[1]}`;
        } else if (fullLine.endsWith(':')) {
          // Skip incomplete ATTENDEE lines
          continue;
        } else if (fullLine.includes(':mailto')) {
          // Fix spacing issue
          fullLine = fullLine.replace(':mailto', ':mailto:');
        }
        
        // Extract email to check for duplicates
        const emailMatch = fullLine.match(/mailto:([^;,\s]+)/i);
        const email = emailMatch ? emailMatch[1] : '';
        
        // Skip duplicate attendees unless explicitly preserving all
        if (email && seenAttendees.has(email) && !options.preserveAttendees) {
          continue;
        }
        
        if (email) {
          seenAttendees.add(email);
        }
        
        // Properly fold long lines according to RFC 5545
        if (fullLine.length > 75) {
          outputLines.push(foldLine(fullLine));
        } else {
          outputLines.push(fullLine);
        }
        continue;
      }
      
      // Handle DESCRIPTION property - ensure proper formatting
      if (line.startsWith('DESCRIPTION:')) {
        // Remove HTML tags if present
        let description = line.substring(12);
        description = description.replace(/<[^>]*>/g, '');
        
        // Escape special characters
        description = escapeIcsSpecialChars(description);
        
        // Fold long lines
        const descLine = `DESCRIPTION:${description}`;
        if (descLine.length > 75) {
          outputLines.push(foldLine(descLine));
        } else {
          outputLines.push(descLine);
        }
        continue;
      }
      
      // Handle ORGANIZER property
      if (line.startsWith('ORGANIZER')) {
        // Ensure it has mailto:
        if (!line.includes('mailto:') && line.includes(':')) {
          const parts = line.split(':');
          line = `${parts[0]}:mailto:${parts[1]}`;
        }
        
        // Properly fold long lines
        if (line.length > 75) {
          outputLines.push(foldLine(line));
        } else {
          outputLines.push(line);
        }
        continue;
      }
      
      // For all other lines, just add them as is
      outputLines.push(line);
    } else {
      // Non-VEVENT lines, just add them
      outputLines.push(line);
    }
  }
  
  // Add required properties if not already present
  let finalOutput: string[] = [];
  let vcalendarStartIndex = -1;
  let methodAdded = false;
  
  for (let i = 0; i < outputLines.length; i++) {
    const line = outputLines[i];
    
    if (line === 'BEGIN:VCALENDAR') {
      vcalendarStartIndex = finalOutput.length;
    }
    
    finalOutput.push(line);
    
    // Add METHOD after VERSION
    if (!hasMethod && line.startsWith('VERSION:') && !methodAdded) {
      finalOutput.push(`METHOD:${method}`);
      methodAdded = true;
    }
    
    // Add CALSCALE after PRODID if not present
    if (!hasCalScale && line.startsWith('PRODID:') && vcalendarStartIndex !== -1) {
      finalOutput.push('CALSCALE:GREGORIAN');
      hasCalScale = true;
    }
  }
  
  // Join lines with CRLF as required by RFC 5545
  return finalOutput.join('\r\n');
}

/**
 * Fold a long line according to RFC 5545
 * 
 * @param line The line to fold
 * @returns The folded line
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  
  let result = '';
  let currentLine = line;
  
  while (currentLine.length > 75) {
    result += currentLine.substring(0, 75) + '\r\n ';
    currentLine = currentLine.substring(75);
  }
  
  result += currentLine;
  return result;
}

/**
 * Escape special characters in ICS content
 * 
 * @param text The text to escape
 * @returns The escaped text
 */
function escapeIcsSpecialChars(text: string): string {
  return text
    .replace(/\\/g, '\\\\')  // Escape backslash
    .replace(/;/g, '\\;')    // Escape semicolon
    .replace(/,/g, '\\,')    // Escape comma
    .replace(/\n/g, '\\n');  // Escape newlines
}

/**
 * Transform an ICS string for event cancellation
 * 
 * @param originalIcs The original ICS string
 * @param eventData Event data with status="CANCELLED"
 * @returns A properly formatted cancellation ICS
 */
export function transformIcsForCancellation(originalIcs: string, eventData: any): string {
  // If the input ICS data is malformed with incorrect line breaks
  // First clean it up to have proper line breaks
  let cleanedIcs = originalIcs;
  
  // Check if we have proper line breaks
  if (!cleanedIcs.match(/\r?\n/) || cleanedIcs.includes('\r\n:')) {
    console.log('Fixing malformed ICS data for cancellation with improper line breaks');
    
    // Remove any literal \r\n that should be actual line breaks
    cleanedIcs = cleanedIcs.replace(/\\r\\n/g, '\r\n');
    
    // Clear out problematic line breaks in the wrong places
    cleanedIcs = cleanedIcs.replace(/\r\n:/g, ':');
    
    // If still no proper line breaks, fully restructure the content
    if (!cleanedIcs.match(/\r?\n/)) {
      // Extract key properties
      const uid = cleanedIcs.match(/UID:([^;:\r\n]+)/i)?.[1]?.trim() || eventData.uid;
      const dtstart = cleanedIcs.match(/DTSTART:([^;:\r\n]+)/i)?.[1]?.trim();
      const dtend = cleanedIcs.match(/DTEND:([^;:\r\n]+)/i)?.[1]?.trim();
      const summary = cleanedIcs.match(/SUMMARY:([^;:\r\n]+)/i)?.[1]?.trim();
      const organizer = cleanedIcs.match(/ORGANIZER[^:]*:([^;:\r\n]+)/i)?.[1]?.trim();
      const organizerCN = cleanedIcs.match(/ORGANIZER;CN=([^;:\r\n]+)/i)?.[1]?.trim();
      
      // Extract attendees
      const attendeeMatches = [...cleanedIcs.matchAll(/ATTENDEE[^:]*:([^;:\r\n]+)/gi)];
      const attendees = attendeeMatches.map(match => {
        const line = match[0];
        
        // Extract role, participation status and other parameters
        const role = line.match(/ROLE=([^;:\r\n]+)/i)?.[1] || 'REQ-PARTICIPANT';
        const partstat = line.match(/PARTSTAT=([^;:\r\n]+)/i)?.[1] || 'NEEDS-ACTION';
        const cn = line.match(/CN=([^;:\r\n]+)/i)?.[1];
        const email = line.match(/mailto:([^;:\r\n>\s]+)/i)?.[1];
        
        if (!email) return null;
        
        return {
          role,
          partstat,
          cn,
          email
        };
      }).filter(a => a !== null);
      
      // Reconstruct a clean ICS file
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
        'METHOD:CANCEL',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        summary ? `SUMMARY:${summary}` : 'SUMMARY:CANCELLED EVENT',
        dtstart ? `DTSTART:${dtstart}` : '',
        dtend ? `DTEND:${dtend}` : '',
        `DTSTAMP:${formatIcsDate(new Date())}`,
        `SEQUENCE:${(parseInt(eventData.sequence || '0') + 1)}`,
        'STATUS:CANCELLED'
      ];
      
      // Add organizer
      if (organizer) {
        if (organizerCN) {
          lines.push(`ORGANIZER;CN=${organizerCN}:${organizer}`);
        } else {
          lines.push(`ORGANIZER:${organizer}`);
        }
      }
      
      // Add attendees
      attendees.forEach(attendee => {
        if (!attendee) return;
        
        let line = 'ATTENDEE';
        if (attendee.cn) line += `;CN=${attendee.cn}`;
        line += `;ROLE=${attendee.role};PARTSTAT=${attendee.partstat}`;
        line += `:mailto:${attendee.email}`;
        
        lines.push(line);
      });
      
      // Close the event and calendar
      lines.push('END:VEVENT');
      lines.push('END:VCALENDAR');
      
      // Join with proper line endings
      cleanedIcs = lines.filter(l => l).join('\r\n');
    }
  }
  
  // Now use the sanitizer on our cleaned ICS data
  return sanitizeAndFormatICS(cleanedIcs, {
    method: 'CANCEL',
    status: 'CANCELLED',
    sequence: (parseInt(eventData.sequence || '0') + 1),
    preserveAttendees: true // Ensure all attendees are notified
  });
}

/**
 * Format a date for iCalendar
 */
function formatIcsDate(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, '')  // Remove dashes and colons
    .replace(/\.\d{3}/, '') // Remove milliseconds
    .replace(/Z$/, 'Z');    // Ensure Z stays at end
}