/**
 * Enhanced ICS Cancellation Generator
 * 
 * Properly formats ICS files for event cancellations according to RFC 6638
 * This ensures conformance with the CalDAV Scheduling Extensions specification
 * which builds upon the core RFC 5545 iCalendar standard for event cancellation.
 * 
 * Key features:
 * - METHOD:CANCEL is used in the iCalendar component
 * - STATUS:CANCELLED is set on the event
 * - SEQUENCE number is incremented per the specification
 * - UID is preserved from the original event
 * - All required timestamp fields (CREATED, DTSTAMP, LAST-MODIFIED) are included
 * - Original resource and attendee information is maintained
 * - No surrounding quotes are added to the ICS file
 */

/**
 * Event data interface for cancellation
 */
export interface CancellationEventData {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startDate: Date;
  endDate: Date;
  organizer: {
    email: string;
    name?: string;
  };
  attendees?: {
    email: string;
    name?: string;
    role?: string;
    status?: string;
  }[];
  resources?: {
    email: string;
    name?: string;
    type?: string;
    subType?: string;
    adminEmail?: string;
  }[];
  sequence?: number;
  [key: string]: any; // Allow additional properties
}

/**
 * Generate a standardized cancellation ICS file
 * 
 * This approach preserves the original UID and correctly formats the ICS according to RFC 6638
 * (CalDAV Scheduling Extensions) which builds upon RFC 5545 for maximum compatibility across
 * email clients and calendar servers.
 * 
 * @param originalIcs The original ICS data from the event
 * @param eventData Event data for the cancellation
 * @returns Properly formatted ICS file for cancellation
 */
export function generateCancellationIcs(originalIcs: string, eventData: CancellationEventData): string {
  console.log(`=== GENERATING RFC 6638 COMPLIANT CANCELLATION ICS ===`);
  
  // Always log the current UID being used for cancellation
  console.log(`Using event UID for cancellation: ${eventData.uid}`);
  
  let finalUid = eventData.uid;
  let icsData = '';
  
  // If we have the original ICS, try to use it as a base for the cancellation
  if (originalIcs && originalIcs.trim().length > 0) {
    try {
      // Preprocess the ICS data to fix common issues
      let processedIcs = originalIcs;
      
      // Fix literal \r\n strings
      if (processedIcs.includes('\\r\\n') || !processedIcs.includes('\r\n')) {
        processedIcs = processedIcs
          .replace(/\\r\\n/g, '\r\n')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');
      }
      
      // Fix single-line ICS files
      if (!processedIcs.includes('\r\n') && processedIcs.includes(':')) {
        processedIcs = processedIcs
          .replace(/BEGIN:/g, '\r\nBEGIN:')
          .replace(/END:/g, '\r\nEND:')
          .replace(/SUMMARY:/g, '\r\nSUMMARY:')
          .replace(/DTSTART:/g, '\r\nDTSTART:')
          .replace(/DTEND:/g, '\r\nDTEND:')
          .replace(/LOCATION:/g, '\r\nLOCATION:')
          .replace(/DESCRIPTION:/g, '\r\nDESCRIPTION:')
          .replace(/UID:/g, '\r\nUID:')
          .replace(/METHOD:/g, '\r\nMETHOD:')
          .replace(/STATUS:/g, '\r\nSTATUS:')
          .replace(/SEQUENCE:/g, '\r\nSEQUENCE:')
          .replace(/ORGANIZER/g, '\r\nORGANIZER')
          .replace(/ATTENDEE/g, '\r\nATTENDEE')
          .replace(/DTSTAMP:/g, '\r\nDTSTAMP:')
          .replace(/CREATED:/g, '\r\nCREATED:')
          .replace(/LAST-MODIFIED:/g, '\r\nLAST-MODIFIED:')
          .replace(/VERSION:/g, '\r\nVERSION:')
          .replace(/PRODID:/g, '\r\nPRODID:')
          .replace(/CALSCALE:/g, '\r\nCALSCALE:')
          .replace(/\r\n\r\n/g, '\r\n')
          .trim();
      }
      
      // Extract original UID - this is critical for RFC 6638 compliance
      const uidMatch = processedIcs.match(/UID:([^\r\n]+)/i);
      
      if (uidMatch && uidMatch[1]) {
        const extractedUid = uidMatch[1].trim();
        
        // Log if we found a different UID than the one provided
        if (extractedUid !== eventData.uid) {
          console.log(`⚠️ UID mismatch detected! Extracted: ${extractedUid}, Provided: ${eventData.uid}`);
          console.log(`Using the provided UID for consistency: ${eventData.uid}`);
        } else {
          console.log(`✓ Original UID verified: ${extractedUid}`);
        }
      }
      
      // RFC 6638 COMPLIANCE REQUIREMENTS
      // Extract essential information from original ICS
      const originalSequence = extractSequence(processedIcs);
      
      // Handle sequence number - ensure it's treated as a number and incremented
      // RFC 6638 requires that SEQUENCE be incremented for cancellations
      const newSequence = typeof originalSequence === 'number' ? 
        (originalSequence + 1) : 
        (eventData.sequence ? Number(eventData.sequence) + 1 : 1);
      
      // Extract X-properties to preserve them
      const xProperties = extractXProperties(processedIcs);
      
      // Extract CREATED and LAST-MODIFIED from original ICS if possible
      const createdMatch = processedIcs.match(/CREATED:([^\r\n]+)/i);
      const lastModifiedMatch = processedIcs.match(/LAST-MODIFIED:([^\r\n]+)/i);
      
      const createdTime = createdMatch ? createdMatch[1] : formatICalDate(new Date());
      const currentTime = formatICalDate(new Date());
      
      // Create the cancellation ICS according to RFC 6638
      // The following properties are REQUIRED for RFC 6638 compliance:
      // 1. METHOD:CANCEL in VCALENDAR component
      // 2. STATUS:CANCELLED in VEVENT component 
      // 3. Original UID must be preserved
      // 4. SEQUENCE must be incremented
      icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Client//NONSGML v1.0//EN
METHOD:CANCEL
BEGIN:VEVENT
UID:${finalUid}
SUMMARY:CANCELLED: ${escapeICalString(eventData.title || 'Cancelled Event')}
DTSTART:${formatICalDate(eventData.startDate)}
DTEND:${formatICalDate(eventData.endDate)}
DTSTAMP:${currentTime}
CREATED:${createdTime}
LAST-MODIFIED:${currentTime}
SEQUENCE:${newSequence}
STATUS:CANCELLED
`;

        // Add ORGANIZER with CN if available
        if (eventData.organizer) {
          const organizerName = eventData.organizer.name ? `;CN=${escapeICalString(eventData.organizer.name)}` : '';
          icsData += `ORGANIZER${organizerName}:mailto:${eventData.organizer.email}\r\n`;
        }
        
        // Add location if available
        if (eventData.location) {
          icsData += `LOCATION:${escapeICalString(eventData.location)}\r\n`;
        }
        
        // Add description if available
        if (eventData.description) {
          icsData += `DESCRIPTION:${escapeICalString(eventData.description)}\r\n`;
        }
        
        // Add attendees if available
        if (eventData.attendees && eventData.attendees.length > 0) {
          for (const attendee of eventData.attendees) {
            if (!attendee || !attendee.email) continue;
            
            let attendeeLine = 'ATTENDEE';
            
            // Add CN if available
            if (attendee.name) {
              attendeeLine += `;CN=${escapeICalString(attendee.name)}`;
            }
            
            // Add role if available
            if (attendee.role) {
              attendeeLine += `;ROLE=${attendee.role}`;
            }
            
            // Add PARTSTAT if available, otherwise default to NEEDS-ACTION
            if (attendee.status) {
              attendeeLine += `;PARTSTAT=${attendee.status}`;
            } else {
              attendeeLine += `;PARTSTAT=NEEDS-ACTION`;
            }
            
            attendeeLine += `:mailto:${attendee.email}`;
            icsData += `${attendeeLine}\r\n`;
          }
        }
        
        // Add resources if available (as special attendees with resource type)
        if (eventData.resources && eventData.resources.length > 0) {
          for (const resource of eventData.resources) {
            if (!resource || !resource.email) continue;
            
            let resourceLine = 'ATTENDEE';
            
            // Add CN if available
            if (resource.name) {
              resourceLine += `;CN=${escapeICalString(resource.name)}`;
            }
            
            // Add CUTYPE=RESOURCE
            resourceLine += `;CUTYPE=RESOURCE`;
            
            // Add X-RESOURCE-TYPE if type is available
            const resourceType = resource.subType || resource.type;
            if (resourceType) {
              resourceLine += `;X-RESOURCE-TYPE=${escapeICalString(resourceType)}`;
            }
            
            resourceLine += `;PARTSTAT=NEEDS-ACTION`;
            resourceLine += `:mailto:${resource.email}`;
            icsData += `${resourceLine}\r\n`;
          }
        }
        
        // Add any X-properties we extracted from the original ICS
        xProperties.forEach(property => {
          icsData += `${property}\r\n`;
        });
        
        // Close the VEVENT and VCALENDAR
        icsData += `END:VEVENT\r\nEND:VCALENDAR`;
        
        console.log(`Successfully generated RFC 6638 compliant cancellation ICS for event: ${finalUid}`);
        return icsData;
      
    } catch (error) {
      console.error("Error parsing original ICS, falling back to basic cancellation:", error);
      // Fall through to basic cancellation below
    }
  }
  
  // If we couldn't process the original ICS or if there was none,
  // create a minimal but fully RFC 6638 compliant cancellation ICS
  console.log(`Creating minimal RFC 6638 compliant cancellation ICS for event: ${finalUid}`);
  
  // Ensure we have a valid sequence number (increment if provided)
  const sequenceNumber = eventData.sequence ? Number(eventData.sequence) + 1 : 1;
  const currentTime = formatICalDate(new Date());
  
  // Create a minimal but fully compliant cancellation ICS
  // CRITICAL FIX: Log the UID being used to help debug any inconsistencies
  console.log(`[ICS Cancellation] Using event UID for cancellation: ${finalUid}`);
  
  icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Client//NONSGML v1.0//EN
METHOD:CANCEL
BEGIN:VEVENT
UID:${finalUid}
SUMMARY:CANCELLED: ${escapeICalString(eventData.title || 'Cancelled Event')}
DTSTART:${formatICalDate(eventData.startDate)}
DTEND:${formatICalDate(eventData.endDate)}
DTSTAMP:${currentTime}
CREATED:${currentTime}
LAST-MODIFIED:${currentTime}
SEQUENCE:${sequenceNumber}
STATUS:CANCELLED`;
  
  // Add organizer
  if (eventData.organizer) {
    const organizerName = eventData.organizer.name ? `;CN=${escapeICalString(eventData.organizer.name)}` : '';
    icsData += `\r\nORGANIZER${organizerName}:mailto:${eventData.organizer.email}`;
  }
  
  // Add attendees if available
  if (eventData.attendees && eventData.attendees.length > 0) {
    for (const attendee of eventData.attendees) {
      if (!attendee || !attendee.email) continue;
      
      let attendeeLine = '\r\nATTENDEE';
      
      // Add CN if available
      if (attendee.name) {
        attendeeLine += `;CN=${escapeICalString(attendee.name)}`;
      }
      
      // For cancellations, use PARTSTAT=NEEDS-ACTION 
      attendeeLine += `;PARTSTAT=NEEDS-ACTION`;
      
      attendeeLine += `:mailto:${attendee.email}`;
      icsData += attendeeLine;
    }
  }
  
  // Add resources if available
  if (eventData.resources && eventData.resources.length > 0) {
    for (const resource of eventData.resources) {
      if (!resource || !resource.email) continue;
      
      let resourceLine = '\r\nATTENDEE';
      
      // Add CN if available
      if (resource.name) {
        resourceLine += `;CN=${escapeICalString(resource.name)}`;
      }
      
      // Add CUTYPE=RESOURCE
      resourceLine += `;CUTYPE=RESOURCE`;
      
      // For cancellations, use PARTSTAT=NEEDS-ACTION 
      resourceLine += `;PARTSTAT=NEEDS-ACTION`;
      
      resourceLine += `:mailto:${resource.email}`;
      icsData += resourceLine;
    }
  }
  
  // Close the VEVENT and VCALENDAR
  icsData += `\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  
  return icsData;
}

/**
 * Extract the sequence number from the original ICS
 * @param icsData Original ICS data
 * @returns Current sequence number or null if not found
 */
export function extractSequence(icsData: string): number | null {
  const sequenceMatch = icsData.match(/SEQUENCE:(\d+)/i);
  if (sequenceMatch && sequenceMatch[1]) {
    return parseInt(sequenceMatch[1], 10);
  }
  return null;
}

/**
 * Format a date for iCalendar format
 * @param date Date to format
 * @returns Formatted date string
 */
export function formatICalDate(date: Date): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    // If date is invalid, use current date
    date = new Date();
  }
  
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
}

/**
 * Escape special characters in iCalendar strings
 * @param str String to escape
 * @returns Escaped string
 */
export function escapeICalString(str: string | null | undefined): string {
  if (!str) return '';
  
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Extract X- properties from original ICS to preserve them
 * @param icsData Original ICS data
 * @returns Array of X- property lines
 */
export function extractXProperties(icsData: string): string[] {
  const xProperties: string[] = [];
  const lines = icsData.split(/\r?\n/);
  
  for (const line of lines) {
    if (line.match(/^X-[^:]+:.+/i)) {
      xProperties.push(line);
    }
  }
  
  return xProperties;
}