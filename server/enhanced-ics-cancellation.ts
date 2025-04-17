/**
 * Enhanced ICS Cancellation Generator
 * 
 * Properly formats ICS files for event cancellations according to RFC 5545
 * Ensures consistency with update ICS files and preserves all required fields
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
 * This approach preserves the original UID and correctly formats the ICS according to RFC 5545
 * for maximum compatibility across email clients.
 * 
 * @param originalIcs The original ICS data from the event
 * @param eventData Event data for the cancellation
 * @returns Properly formatted ICS file for cancellation
 */
export function generateCancellationIcs(originalIcs: string, eventData: CancellationEventData): string {
  console.log(`Generating RFC 5545 compliant cancellation ICS for event: ${eventData.uid}`);
  
  // Extract essential information from original ICS
  const originalSequence = extractSequence(originalIcs);
  // Handle sequence number - ensure it's treated as a number
  const newSequence = typeof originalSequence === 'number' ? 
    (originalSequence + 1) : 
    (eventData.sequence ? Number(eventData.sequence) + 1 : 1);
  
  // Extract X-properties to preserve them
  const xProperties = extractXProperties(originalIcs);
  
  // Create the cancellation ICS
  let icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Client//NONSGML v1.0//EN
METHOD:CANCEL
BEGIN:VEVENT
UID:${eventData.uid}
SUMMARY:${escapeICalString(eventData.title || 'Cancelled Event')}
DTSTART:${formatICalDate(eventData.startDate)}
DTEND:${formatICalDate(eventData.endDate)}
DTSTAMP:${formatICalDate(new Date())}
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
  
  return icsData;
}

/**
 * Extract the sequence number from the original ICS
 * @param icsData Original ICS data
 * @returns Current sequence number or null if not found
 */
function extractSequence(icsData: string): number | null {
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
function formatICalDate(date: Date): string {
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
function escapeICalString(str: string | null | undefined): string {
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
function extractXProperties(icsData: string): string[] {
  const xProperties: string[] = [];
  const lines = icsData.split(/\r?\n/);
  
  for (const line of lines) {
    if (line.match(/^X-[^:]+:.+/i)) {
      xProperties.push(line);
    }
  }
  
  return xProperties;
}