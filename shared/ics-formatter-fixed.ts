/**
 * ICS Formatter - Improved version
 * 
 * Utility for formatting, sanitizing and standardizing ICS data
 * for consistent calendar interoperability.
 */

/**
 * Clean a UID string to ensure it's suitable for use in filenames and other contexts
 * Removes any embedded parameters, line breaks, or other non-filename-friendly characters
 * 
 * @param uid The raw UID string to clean
 * @returns A clean UID string suitable for filenames
 */
export function cleanUidForFilename(uid: string): string {
  if (!uid) return `event-${Date.now()}`;
  
  // First split at any whitespace, quotes, backslashes, or line breaks
  let cleanUid = uid.split(/[\s\\"\r\n;]/)[0];
  
  // If it's an email-like UID, extract just the part up to the domain
  const domainMatch = cleanUid.match(/^([^@]+@[^.]+\.[^\\]+)/);
  if (domainMatch) {
    cleanUid = domainMatch[1];
  }
  
  // Remove any remaining invalid filename characters
  cleanUid = cleanUid.replace(/[<>:"/\\|?*\r\n]+/g, '');
  
  return cleanUid;
}

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
/**
 * Deep clean ICS data to fix corrupted or malformed input
 * @param dirtyIcs The potentially corrupted ICS data
 * @returns Cleaned ICS data suitable for further processing
 */
export function deepCleanIcsData(dirtyIcs: string): string {
  console.log('[IcsFormatter] Deep cleaning malformed ICS data');
  
  // First, normalize line breaks to CRLF standard
  let cleanedIcs = dirtyIcs.replace(/\r\n|\n\r|\n|\r/g, '\r\n');
  
  // Fix corrupted or repeated line breaks
  cleanedIcs = cleanedIcs.replace(/\r\n\r\n+/g, '\r\n');
  
  // Fix broken lines with embedded \r\n sequences
  cleanedIcs = cleanedIcs.replace(/([^:]*):\r\n\s*([^\r\n]*)/g, '$1:$2');
  
  // Fix broken ATTENDEE lines with mailto: on separate line
  cleanedIcs = cleanedIcs.replace(/ATTENDEE[^:]*:\r\n\s*mailto:/gi, 'ATTENDEE:mailto:');
  
  // Fix incorrectly escaped line breaks
  cleanedIcs = cleanedIcs.replace(/\\r\\n/g, '\r\n');
  
  // Fix unwanted quotes around ICS data (from JSON serialization)
  if (cleanedIcs.startsWith('"') && cleanedIcs.endsWith('"')) {
    cleanedIcs = cleanedIcs.substring(1, cleanedIcs.length - 1);
  }
  
  // Un-escape escaped quotes
  cleanedIcs = cleanedIcs.replace(/\\"/g, '"');
  
  // Fix line breaks inside property values
  // This is critical to fix the issue with line breaks after property names
  const fixedLines: string[] = [];
  let currentLine = '';
  
  cleanedIcs.split('\r\n').forEach(line => {
    // If this line doesn't start with a property name (no colon)
    // and doesn't start with whitespace (folded line), it probably belongs to previous line
    if (line && !line.includes(':') && !line.startsWith(' ') && currentLine) {
      // Append to current line instead of creating a new line
      currentLine += line;
    } else if (line.startsWith(' ') && currentLine) {
      // This is a folded line, unfold it
      currentLine += line.substring(1);
    } else {
      // If we have a completed current line, add it to results
      if (currentLine) {
        fixedLines.push(currentLine);
      }
      // Start a new line
      currentLine = line;
    }
  });
  
  // Add the last line if any
  if (currentLine) {
    fixedLines.push(currentLine);
  }
  
  // Now join the lines with proper CRLF
  cleanedIcs = fixedLines.join('\r\n');
  
  // Fix corrupted ATTENDEE parameters with line breaks
  cleanedIcs = cleanedIcs.replace(/ATTENDEE;([^:]*)\r\n([^:]*):mailto:/gi, 'ATTENDEE;$1$2:mailto:');
  
  // Fix double mailto: issue
  cleanedIcs = cleanedIcs.replace(/:mailto:mailto:/gi, ':mailto:');
  
  // Remove any trailing whitespace from each line
  cleanedIcs = cleanedIcs.split('\r\n').map(line => line.trim()).join('\r\n');
  
  return cleanedIcs;
}

export function transformIcsForCancellation(originalIcs: string, eventData: any): string {
  console.log('Creating RFC-compliant cancellation ICS');

  // CRITICAL: First deep clean the original ICS data to fix any formatting issues
  const cleanedOriginalIcs = deepCleanIcsData(originalIcs);
  console.log('[IcsFormatter] Successfully cleaned original ICS data');

  // Extract important information from the cleaned ICS
  // We'll extract each piece separately using regex to handle various malformed inputs
  let uid = '';
  let summary = '';
  let dtstart = '';
  let dtend = '';
  let dtstamp = formatIcsDate(new Date());
  let created = '';
  let lastModified = '';
  let sequence = 0;
  let organizerEmail = '';
  let organizerName = '';
  let attendees: Array<{email: string, name?: string, role?: string, partstat?: string}> = [];

  // Extract UID (most critical - must be the same as original event)
  // CRITICAL FIX: We need to be very careful about how we parse the UID
  // The regex needs to strictly match only until the first \r\n or quoted sequence
  const uidRegex = /UID:([^"\r\n]+)/i;
  const uidMatch = originalIcs.match(uidRegex);
  
  if (uidMatch && uidMatch[1]) {
    // Check if there are any embedded escape sequences or other ICS properties
    const extractedUid = uidMatch[1].trim();
    
    // Clean up the UID - remove any trailing characters after @ symbol and domain
    // Most UIDs end with something like "@caldavclient.local" or "@example.com"
    const domainMatch = extractedUid.match(/^([^@]+@[^.]+\.[^\\]+)/);
    if (domainMatch) {
      uid = domainMatch[1];
      console.log(`Extracted and cleaned UID from original ICS: ${uid}`);
    } else {
      // If no domain pattern found, just take everything up to any special characters
      uid = extractedUid.split(/[\s\\"\r\n]/)[0];
      console.log(`Extracted partial UID from original ICS: ${uid}`);
    }
  } else if (eventData.uid) {
    uid = eventData.uid;
    console.log(`Using provided UID from event data: ${uid}`);
  } else {
    console.error('No UID found in original ICS or event data');
    uid = `cancel-${Date.now()}@caldavclient.local`;
  }

  // Extract SUMMARY
  const summaryMatch = originalIcs.match(/SUMMARY:([^\r\n]+)/i);
  if (summaryMatch && summaryMatch[1]) {
    summary = summaryMatch[1].trim();
  } else if (eventData.title) {
    summary = eventData.title;
  } else {
    summary = 'Cancelled Event';
  }

  // Extract DTSTART
  const dtstartMatch = originalIcs.match(/DTSTART:([^\r\n]+)/i);
  if (dtstartMatch && dtstartMatch[1]) {
    dtstart = dtstartMatch[1].trim();
  } else if (eventData.startDate) {
    dtstart = formatIcsDate(new Date(eventData.startDate));
  }

  // Extract DTEND
  const dtendMatch = originalIcs.match(/DTEND:([^\r\n]+)/i);
  if (dtendMatch && dtendMatch[1]) {
    dtend = dtendMatch[1].trim();
  } else if (eventData.endDate) {
    dtend = formatIcsDate(new Date(eventData.endDate));
  }

  // Extract CREATED
  const createdMatch = originalIcs.match(/CREATED:([^\r\n]+)/i);
  if (createdMatch && createdMatch[1]) {
    created = createdMatch[1].trim();
  } else {
    created = dtstamp;
  }

  // Extract LAST-MODIFIED
  const lastModifiedMatch = originalIcs.match(/LAST-MODIFIED:([^\r\n]+)/i);
  if (lastModifiedMatch && lastModifiedMatch[1]) {
    lastModified = lastModifiedMatch[1].trim();
  } else {
    lastModified = dtstamp;
  }

  // Extract SEQUENCE and increment it
  const sequenceMatch = originalIcs.match(/SEQUENCE:([0-9]+)/i);
  if (sequenceMatch && sequenceMatch[1]) {
    sequence = parseInt(sequenceMatch[1], 10) + 1;
  } else if (eventData.sequence) {
    sequence = parseInt(eventData.sequence, 10) + 1;
  } else {
    sequence = 1; // Default for cancellation is 1
  }

  // Extract ORGANIZER info
  const organizerMatch = originalIcs.match(/ORGANIZER(?:;CN=([^:]+))?:mailto:([^\r\n]+)/i);
  if (organizerMatch) {
    if (organizerMatch[1]) organizerName = organizerMatch[1].trim();
    if (organizerMatch[2]) organizerEmail = organizerMatch[2].trim();
  } else if (eventData.organizer) {
    organizerEmail = eventData.organizer.email || '';
    organizerName = eventData.organizer.name || '';
  }

  // Extract ATTENDEE info - handle all possible formats
  const attendeeRegexes = [
    /ATTENDEE(?:;([^:]+))?:mailto:([^\r\n]+)/gi,  // Standard format
    /ATTENDEE(?:;([^:]+))?:\s*mailto:([^\r\n]+)/gi, // With space after colon
    /ATTENDEE([^:]*):([^\r\n]+)/gi // Any format with colon
  ];

  let foundAttendees = false;
  for (const regex of attendeeRegexes) {
    // Use exec instead of matchAll for better compatibility
    let match;
    const matches = [];
    while ((match = regex.exec(originalIcs)) !== null) {
      matches.push(match);
    }
    
    if (matches.length > 0) {
      foundAttendees = true;
      matches.forEach(match => {
        const params = match[1] || '';
        let email = match[2].trim();
        
        // Sometimes email has mailto: prefix embedded
        if (email.startsWith('mailto:')) {
          email = email.substring(7);
        }
        
        // Extract role, name and partstat if present
        const roleMatch = params.match(/ROLE=([^;]+)/i);
        const cnMatch = params.match(/CN=([^;]+)/i);
        const partstatMatch = params.match(/PARTSTAT=([^;]+)/i);
        
        attendees.push({
          email,
          name: cnMatch ? cnMatch[1] : undefined,
          role: roleMatch ? roleMatch[1] : 'REQ-PARTICIPANT',
          partstat: partstatMatch ? partstatMatch[1] : 'NEEDS-ACTION'
        });
      });
      break; // Stop after finding attendees with one regex
    }
  }

  // If no attendees found in ICS, use the ones from eventData
  if (!foundAttendees && eventData.attendees && eventData.attendees.length > 0) {
    eventData.attendees.forEach((att: any) => {
      attendees.push({
        email: att.email,
        name: att.name,
        role: att.role || 'REQ-PARTICIPANT',
        partstat: att.status || 'NEEDS-ACTION'
      });
    });
  }

  // Build a clean, RFC-compliant cancellation ICS
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
    'METHOD:CANCEL',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    dtstart ? `DTSTART:${dtstart}` : '',
    dtend ? `DTEND:${dtend}` : '',
    `DTSTAMP:${dtstamp}`,
    created ? `CREATED:${created}` : '',
    `LAST-MODIFIED:${dtstamp}`,
    `SEQUENCE:${sequence}`,
    'STATUS:CANCELLED'
  ].filter(line => line);

  // Add organizer
  if (organizerEmail) {
    if (organizerName) {
      lines.push(`ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`);
    } else {
      lines.push(`ORGANIZER:mailto:${organizerEmail}`);
    }
  }

  // Add attendees
  attendees.forEach(att => {
    let line = 'ATTENDEE';
    
    // Add parameters in consistent order
    if (att.name) line += `;CN=${att.name}`;
    if (att.role) line += `;ROLE=${att.role}`;
    if (att.partstat) line += `;PARTSTAT=${att.partstat}`;
    
    // Ensure the email has mailto: prefix
    line += `:mailto:${att.email}`;
    
    lines.push(line);
  });

  // Close the components
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  // Join with CRLF as required by RFC 5545
  // Remove any line break errors by ensuring there's no line break after property names
  let icsData = lines.join('\r\n');
  
  // Fix the specific pattern where there are line breaks after property names but before colons
  if (icsData.includes('\r\n:')) {
    console.log('Fixing incorrect line breaks in ICS data');
    icsData = icsData.replace(/\r\n:/g, ':');
  }
  
  // Fix another common pattern where line breaks appear between property parameters
  if (icsData.includes('\r\n;')) {
    console.log('Fixing incorrect line breaks between parameters');
    icsData = icsData.replace(/\r\n;/g, ';');
  }
  
  // Fix the pattern where there are line breaks between "mailto:" and the email
  if (icsData.includes('\r\n mailto:')) {
    console.log('Fixing incorrect line breaks before mailto:');
    icsData = icsData.replace(/\r\n mailto:/g, 'mailto:');
  }
  
  // Fix double colons in mailto values
  if (icsData.includes('mailto::')) {
    console.log('Fixing double colons in mailto references');
    icsData = icsData.replace(/mailto::([^\r\n]+)/g, 'mailto:$1');
  }
  
  // Fix RRULE corruption with mailto
  if (icsData.includes('RRULE:') && icsData.includes('RRULE:') && icsData.match(/RRULE:.*mailto/)) {
    console.log('Fixing corrupted RRULE with mailto content');
    // Extract the RRULE line
    const rruleMatch = icsData.match(/RRULE:[^\r\n]*/);
    if (rruleMatch) {
      const rruleLine = rruleMatch[0];
      // If there's a mailto or colon in the RRULE, clean it
      if (rruleLine.includes('mailto:') || rruleLine.includes(';mailto')) {
        // Split at the first occurrence of mailto and keep only the part before
        const cleanRrule = 'RRULE:' + rruleLine.substring(6).split(/mailto:|;mailto/)[0];
        icsData = icsData.replace(rruleLine, cleanRrule);
      }
    }
  }
  
  // Ensure all required components according to RFC 5545
  const requiredComponents = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:',
    'DTSTAMP:',
    'DTSTART:',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  
  // Check if any required components are missing
  const missingComponents = requiredComponents.filter(component => {
    // Special case for components that need to check for prefix only
    if (component.endsWith(':')) {
      return !icsData.includes(component);
    }
    return !icsData.includes(component);
  });
  
  if (missingComponents.length > 0) {
    console.warn('Missing required components in ICS file:', missingComponents);
    // We can't fix missing core components, but we'll log it
  }
  
  return icsData;
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