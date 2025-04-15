/**
 * ICS Cancellation Generator
 * 
 * A specialized module for generating RFC 5546 compliant cancellation ICS files.
 * This implementation ensures exact preservation of original data while making
 * only the minimal required changes for a valid cancellation.
 */

import { EventInvitationData } from './email-service';

/**
 * Generates a cancellation ICS file from an original ICS file
 * Strictly follows RFC 5546 requirements for cancellation
 * 
 * @param originalIcs The original ICS file content as a string
 * @param eventData Additional event data (can be used as fallback)
 * @returns RFC 5546 compliant cancellation ICS file as a string
 */
export function generateCancellationIcs(originalIcs: string, eventData: EventInvitationData): string {
  if (!originalIcs) {
    console.error('No original ICS data provided for cancellation.');
    return generateFallbackCancellationIcs(eventData);
  }

  console.log('Generating RFC 5546 compliant cancellation ICS with exact data preservation');
  
  try {
    // Parse the original ICS into sections to preserve as much of the structure as possible
    const sections = parseIcsIntoSections(originalIcs);
    if (!sections.vcalendar || !sections.vevent) {
      console.error('ICS file missing required sections');
      return generateFallbackCancellationIcs(eventData);
    }

    // Create a new ICS structure with mandatory changes for cancellation
    let cancellationIcs = '';
    
    // Start with BEGIN:VCALENDAR and VCALENDAR properties
    cancellationIcs += 'BEGIN:VCALENDAR\r\n';
    
    // Add properties from the original calendar section, except METHOD and any we'll modify
    Object.entries(sections.vcalendar).forEach(([key, value]) => {
      if (key !== 'METHOD') {
        cancellationIcs += `${key}:${value}\r\n`;
      }
    });
    
    // Add mandatory METHOD:CANCEL
    cancellationIcs += 'METHOD:CANCEL\r\n';
    
    // Start event section
    cancellationIcs += 'BEGIN:VEVENT\r\n';
    
    // First extract critical fields from original event
    const extractedUid = extractProperty(originalIcs, 'UID');
    const extractedSequence = extractProperty(originalIcs, 'SEQUENCE');
    
    // Calculate new sequence number
    const newSequence = extractedSequence ? (parseInt(extractedSequence, 10) + 1) : 1;
    
    // Capture and store resource attendee lines
    const resourceAttendeeLines = extractResourceAttendeeLines(originalIcs);
    console.log(`Extracted ${resourceAttendeeLines.length} resource attendee lines`);
    
    // Current timestamp for DTSTAMP and LAST-MODIFIED
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    // Add properties from the original event section, with specific changes for cancellation
    for (const [key, value] of Object.entries(sections.vevent)) {
      // Skip attendees - we'll add them back precisely as they were
      if (key.startsWith('ATTENDEE')) continue;
      
      // Update specific fields for cancellation
      if (key === 'STATUS') {
        cancellationIcs += 'STATUS:CANCELLED\r\n';
      } else if (key === 'SEQUENCE') {
        cancellationIcs += `SEQUENCE:${newSequence}\r\n`;
      } else if (key === 'TRANSP') {
        cancellationIcs += 'TRANSP:TRANSPARENT\r\n';
      } else if (key === 'DTSTAMP' || key === 'LAST-MODIFIED') {
        cancellationIcs += `${key}:${timestamp}\r\n`;
      } else {
        // Preserve all other properties exactly as they were
        cancellationIcs += `${key}:${value}\r\n`;
      }
    }
    
    // Add properties that must be present but weren't in the original
    if (!sections.vevent['STATUS']) {
      cancellationIcs += 'STATUS:CANCELLED\r\n';
    }
    
    if (!sections.vevent['SEQUENCE']) {
      cancellationIcs += `SEQUENCE:${newSequence}\r\n`;
    }
    
    if (!sections.vevent['TRANSP']) {
      cancellationIcs += 'TRANSP:TRANSPARENT\r\n';
    }
    
    if (!sections.vevent['DTSTAMP']) {
      cancellationIcs += `DTSTAMP:${timestamp}\r\n`;
    }
    
    if (!sections.vevent['LAST-MODIFIED']) {
      cancellationIcs += `LAST-MODIFIED:${timestamp}\r\n`;
    }
    
    // Add back all original attendee lines exactly as they appeared
    const attendeeLines = extractAttendeeLines(originalIcs);
    attendeeLines.forEach(line => {
      cancellationIcs += line + '\r\n';
    });
    
    // Add resource attendee lines if not already included
    if (resourceAttendeeLines.length > 0) {
      // Check if we already added these through attendeeLines
      const existingResourceAttendees = new Set(attendeeLines.filter(line => 
        line.includes('CUTYPE=RESOURCE') || 
        line.includes('X-RESOURCE-TYPE')
      ));
      
      // Add any resource attendees not already included
      resourceAttendeeLines.forEach(line => {
        if (!existingResourceAttendees.has(line)) {
          cancellationIcs += line + '\r\n';
        }
      });
    }
    
    // Complete the ICS file
    cancellationIcs += 'END:VEVENT\r\n';
    cancellationIcs += 'END:VCALENDAR\r\n';
    
    // Verify UID is preserved
    const finalUid = extractProperty(cancellationIcs, 'UID');
    if (extractedUid && finalUid !== extractedUid) {
      console.error(`UID changed during cancellation: ${extractedUid} -> ${finalUid}`);
      // Force correct UID by direct replacement if needed
      cancellationIcs = cancellationIcs.replace(/UID:[^\r\n]+\r\n/, `UID:${extractedUid}\r\n`);
    }
    
    // Verify resource attendees are preserved
    const finalResourceAttendeeCount = cancellationIcs.split('\r\n').filter(line => 
      line.includes('CUTYPE=RESOURCE') ||
      line.includes('X-RESOURCE-TYPE')
    ).length;
    
    console.log(`Original resource attendees: ${resourceAttendeeLines.length}, Final: ${finalResourceAttendeeCount}`);
    
    // If resources are missing, log an error but proceed
    if (resourceAttendeeLines.length > 0 && finalResourceAttendeeCount < resourceAttendeeLines.length) {
      console.error('Some resource attendees were lost in cancellation generation. Proceeding with what we have.');
    }
    
    return cancellationIcs;
  } catch (error) {
    console.error('Error generating cancellation ICS:', error);
    return generateFallbackCancellationIcs(eventData);
  }
}

/**
 * Parse an ICS file into sections for easier processing
 */
function parseIcsIntoSections(ics: string): { 
  [sectionName: string]: { [property: string]: string } 
} {
  const sections: { [sectionName: string]: { [property: string]: string } } = {};
  let currentSection = '';
  
  const lines = ics.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle section begins
    if (line.startsWith('BEGIN:')) {
      const sectionName = line.substring(6).toLowerCase();
      currentSection = sectionName;
      sections[currentSection] = {};
      continue;
    }
    
    // Handle section ends
    if (line.startsWith('END:')) {
      currentSection = '';
      continue;
    }
    
    // Parse properties within a section
    if (currentSection && line.includes(':')) {
      const colonPos = line.indexOf(':');
      const key = line.substring(0, colonPos);
      const value = line.substring(colonPos + 1);
      
      // For attendees, we need to keep the full line rather than just property:value
      if (key.startsWith('ATTENDEE')) {
        // Use a numeric suffix to ensure multiple attendees are preserved
        const attendeeKey = `ATTENDEE_${Object.keys(sections[currentSection]).filter(k => k.startsWith('ATTENDEE')).length}`;
        sections[currentSection][attendeeKey] = line;
      } else {
        sections[currentSection][key] = value;
      }
    }
  }
  
  return sections;
}

/**
 * Extract a property from an ICS file
 */
function extractProperty(ics: string, propertyName: string): string | null {
  const regex = new RegExp(`${propertyName}:([^\\r\\n]+)`, 'i');
  const match = ics.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract all attendee lines from an ICS file
 */
function extractAttendeeLines(ics: string): string[] {
  const attendeeRegex = /^ATTENDEE[^:\r\n]+:[^\r\n]+$/gm;
  return (ics.match(attendeeRegex) || []);
}

/**
 * Extract resource attendee lines from an ICS file
 */
function extractResourceAttendeeLines(ics: string): string[] {
  const attendeeLines = extractAttendeeLines(ics);
  return attendeeLines.filter(line => 
    line.includes('CUTYPE=RESOURCE') || 
    line.includes('X-RESOURCE-TYPE') ||
    line.includes('RESOURCE-TYPE') ||
    line.includes('X-RESOURCE-CAPACITY') ||
    line.includes('RESOURCE-CAPACITY')
  );
}

/**
 * Generate a fallback cancellation ICS if parsing the original fails
 */
function generateFallbackCancellationIcs(eventData: EventInvitationData): string {
  console.log('Using fallback method to generate cancellation ICS');
  
  // Prepare the event data with cancellation status
  const cancellationData: EventInvitationData = {
    ...eventData,
    status: 'CANCELLED'
  };
  
  // Generate a basic cancellation ICS
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//XGenplus//CalDAV Application//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:CANCEL',
    'BEGIN:VEVENT'
  ];
  
  // Format dates correctly
  const formatIcsDate = (date: Date): string => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  // Add required properties
  const now = formatIcsDate(new Date());
  
  icsLines.push(`UID:${eventData.uid}`);
  icsLines.push(`DTSTAMP:${now}`);
  icsLines.push(`DTSTART:${formatIcsDate(eventData.startDate)}`);
  icsLines.push(`DTEND:${formatIcsDate(eventData.endDate)}`);
  icsLines.push(`SUMMARY:${eventData.title}`);
  icsLines.push('STATUS:CANCELLED');
  icsLines.push('TRANSP:TRANSPARENT');
  icsLines.push(`SEQUENCE:${eventData.sequence ? eventData.sequence + 1 : 1}`);
  
  // Add organizer if available
  if (eventData.organizer && eventData.organizer.email) {
    const organizerName = eventData.organizer.name || eventData.organizer.email;
    icsLines.push(`ORGANIZER;CN=${organizerName}:mailto:${eventData.organizer.email}`);
  }
  
  // Add description if available
  if (eventData.description) {
    icsLines.push(`DESCRIPTION:${eventData.description}`);
  }
  
  // Add location if available
  if (eventData.location) {
    icsLines.push(`LOCATION:${eventData.location}`);
  }
  
  // Add attendees
  eventData.attendees.forEach(attendee => {
    if (attendee && attendee.email) {
      const status = attendee.status || 'NEEDS-ACTION';
      const role = attendee.role || 'REQ-PARTICIPANT';
      const name = attendee.name || attendee.email;
      icsLines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=${role};PARTSTAT=${status};CN=${name}:mailto:${attendee.email}`);
    }
  });
  
  // Add resources if available
  if (eventData.resources && eventData.resources.length > 0) {
    eventData.resources.forEach(resource => {
      // Comprehensive resource line generation
      let resourceLine = `ATTENDEE;CN=${resource.name || resource.subType};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT`;
      
      // Add resource type
      if (resource.type || resource.subType) {
        resourceLine += `;X-RESOURCE-TYPE=${resource.type || resource.subType}`;
      }
      
      // Add capacity if available
      if (resource.capacity !== undefined) {
        resourceLine += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
      }
      
      // Add admin name if available
      if (resource.adminName) {
        resourceLine += `;X-ADMIN-NAME=${resource.adminName}`;
      }
      
      // Add admin email
      const email = resource.email || resource.adminEmail;
      resourceLine += `:mailto:${email}`;
      
      icsLines.push(resourceLine);
    });
  }
  
  // If we have original resource attendee lines, use those directly
  if (eventData._originalResourceAttendees && eventData._originalResourceAttendees.length > 0) {
    console.log(`Using ${eventData._originalResourceAttendees.length} preserved original resource attendee lines`);
    eventData._originalResourceAttendees.forEach(line => {
      // Check if we already added this resource (by its email)
      const resourceEmail = line.match(/:mailto:([^\\r\\n]+)/i);
      if (resourceEmail && resourceEmail[1]) {
        const email = resourceEmail[1];
        // Only add if not already included
        if (!icsLines.some(existingLine => 
          existingLine.includes('CUTYPE=RESOURCE') && 
          existingLine.includes(`:mailto:${email}`)
        )) {
          icsLines.push(line);
        }
      } else {
        // If no email pattern recognized, just add the line
        icsLines.push(line);
      }
    });
  }
  
  // Complete the ICS
  icsLines.push('END:VEVENT');
  icsLines.push('END:VCALENDAR');
  
  return icsLines.join('\r\n');
}