/**
 * Event Cancellation Handler
 * 
 * This module provides a complete RFC 5546 compliant implementation 
 * for handling event cancellations, ensuring that:
 * 
 * 1. The cancellation ICS file maintains the exact same UID as the original event
 * 2. All required RFC properties are properly set (METHOD:CANCEL, STATUS:CANCELLED, etc.)
 * 3. All attendees and resources are preserved in the cancellation ICS
 * 4. The event is properly deleted from both local storage and the server after emails are sent
 */

import { DAVClient } from 'tsdav';
import { storage } from '../storage';
import { EventInvitationData } from '../email-service';

interface ServerCredentials {
  username: string;
  password: string;
}

/**
 * Generates a cancellation ICS file based on the original ICS content
 * 
 * @param originalIcs The original ICS file content
 * @param eventData Event data containing information about the event
 * @returns RFC 5546 compliant cancellation ICS content
 */
export function generateCancellationIcs(originalIcs: string, eventData: EventInvitationData): string {
  console.log('=== GENERATING RFC 6638 COMPLIANT CANCELLATION ICS ===');
  
  if (!originalIcs) {
    console.error('No original ICS content provided for cancellation');
    return createMinimalCancellationIcs(eventData);
  }
  
  try {
    // Extract the original UID to ensure we keep it exactly the same
    // First, attempt to find a clean UID (should be on its own line)
    const cleanUidMatch = originalIcs.match(/\r?\nUID:([^\r\n]+)/i);
    let originalUid = cleanUidMatch && cleanUidMatch[1] ? cleanUidMatch[1] : null;
    
    // If no clean UID was found, try a fallback approach for malformed ICS
    if (!originalUid) {
      const uidMatch = originalIcs.match(/UID:([^\\]+)/i);
      originalUid = uidMatch && uidMatch[1] ? uidMatch[1] : eventData.uid;
    }
    
    if (!originalUid) {
      throw new Error('No UID found in original ICS or event data');
    }
    
    // Clean the UID in case it contains embedded newlines or other invalid characters
    // This handles cases where malformed ICS files have UID: followed by newlines and other fields
    originalUid = originalUid.trim().split(/\r?\n/)[0];
    
    console.log(`Using original UID for cancellation: ${originalUid}`);
    
    // CRITICAL RFC 6638 REQUIREMENTS
    // -----------------------------
    // 1. First, ensure METHOD:CANCEL is present
    let cancellationIcs = originalIcs;
    
    // Handle METHOD property correctly - this MUST be in the VCALENDAR component
    if (cancellationIcs.includes('METHOD:')) {
      // Replace any existing METHOD
      cancellationIcs = cancellationIcs.replace(/METHOD:[^\r\n]+/i, 'METHOD:CANCEL');
    } else {
      // If no METHOD exists, add it after BEGIN:VCALENDAR
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VCALENDAR',
        'BEGIN:VCALENDAR\r\nMETHOD:CANCEL'
      );
    }
    
    // 2. Ensure STATUS:CANCELLED is present in the VEVENT component
    if (!cancellationIcs.includes('STATUS:CANCELLED')) {
      if (cancellationIcs.includes('STATUS:')) {
        // Replace any existing STATUS
        cancellationIcs = cancellationIcs.replace(/STATUS:[^\r\n]+/i, 'STATUS:CANCELLED');
      } else {
        // Add STATUS:CANCELLED after BEGIN:VEVENT if not present
        cancellationIcs = cancellationIcs.replace(
          'BEGIN:VEVENT',
          'BEGIN:VEVENT\r\nSTATUS:CANCELLED'
        );
      }
    }
    
    // 3. Ensure exact same UID is preserved (required by RFC 6638)
    // Replace any existing UID with the original one
    if (cancellationIcs.includes('UID:')) {
      cancellationIcs = cancellationIcs.replace(/UID:[^\r\n]+/i, `UID:${originalUid}`);
    } else {
      // Add UID if missing (should never happen)
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VEVENT',
        `BEGIN:VEVENT\r\nUID:${originalUid}`
      );
    }
    
    // 4. Increment SEQUENCE number as required by RFC 6638
    let newSequence = 1; // Default if no existing sequence
    const sequenceMatch = cancellationIcs.match(/SEQUENCE:(\d+)/i);
    if (sequenceMatch && sequenceMatch[1]) {
      newSequence = parseInt(sequenceMatch[1], 10) + 1;
      cancellationIcs = cancellationIcs.replace(
        /SEQUENCE:\d+/i,
        `SEQUENCE:${newSequence}`
      );
    } else {
      // Add SEQUENCE:1 if not present
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VEVENT',
        'BEGIN:VEVENT\r\nSEQUENCE:1'
      );
    }
    console.log(`Updated SEQUENCE to ${newSequence}`);
    
    // Update SUMMARY to have CANCELLED prefix if not already
    const summaryMatch = cancellationIcs.match(/SUMMARY:([^\r\n]+)/i);
    if (summaryMatch && summaryMatch[1]) {
      const summary = summaryMatch[1];
      if (!summary.startsWith('CANCELLED:') && !summary.startsWith('CANCELLED: ')) {
        cancellationIcs = cancellationIcs.replace(
          /SUMMARY:[^\r\n]+/i,
          `SUMMARY:CANCELLED: ${summary}`
        );
      }
    }
    
    // Update DTSTAMP to current time
    const now = new Date();
    const dtstamp = formatIcsDate(now);
    
    if (cancellationIcs.includes('DTSTAMP:')) {
      cancellationIcs = cancellationIcs.replace(
        /DTSTAMP:[^\r\n]+/i,
        `DTSTAMP:${dtstamp}`
      );
    } else {
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VEVENT',
        `BEGIN:VEVENT\r\nDTSTAMP:${dtstamp}`
      );
    }
    
    // Ensure resources are preserved
    if (eventData.resources && eventData.resources.length > 0) {
      console.log(`Ensuring all ${eventData.resources.length} resources are preserved`);
      
      // Extract all attendee lines to check which resources are already included
      const attendeePattern = /ATTENDEE[^:\r\n]*:[^\r\n]+/g;
      const existingAttendeeLines = cancellationIcs.match(attendeePattern) || [];
      const existingEmails = existingAttendeeLines.map(line => {
        const mailtoMatch = line.match(/mailto:([^>\r\n]+)/i);
        return mailtoMatch && mailtoMatch[1] ? mailtoMatch[1].toLowerCase() : '';
      });
      
      // Add any missing resource attendees
      let resourceLines = '';
      eventData.resources.forEach(resource => {
        if (resource.email && !existingEmails.includes(resource.email.toLowerCase())) {
          console.log(`Adding missing resource: ${resource.name || resource.email}`);
          
          const resourceLine = `ATTENDEE;CN=${resource.name || resource.email};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT` +
            (resource.type ? `;X-RESOURCE-TYPE=${resource.type}` : '') +
            (resource.capacity ? `;X-RESOURCE-CAPACITY=${resource.capacity}` : '') +
            (resource.adminName ? `;X-ADMIN-NAME=${resource.adminName}` : '') +
            (resource.remarks ? `;X-NOTES-REMARKS=${resource.remarks}` : '') +
            `:mailto:${resource.email}\r\n`;
          
          resourceLines += resourceLine;
        }
      });
      
      // Add any missing resources before END:VEVENT
      if (resourceLines) {
        cancellationIcs = cancellationIcs.replace(
          'END:VEVENT',
          `${resourceLines}END:VEVENT`
        );
      }
    }
    
    // Clean up common embedded errors found in some ICS files
    // 1. Fix case where embedded END:VEVENT or END:VCALENDAR appears in property values
    cancellationIcs = removeEmbeddedCalendarMarkers(cancellationIcs);
    
    // 2. Fix duplicate ATTENDEE entries
    cancellationIcs = deduplicateAttendees(cancellationIcs);
    
    // FINAL VERIFICATION - Ensure critical RFC 6638 properties are present
    // This is a failsafe to guarantee the file is RFC 6638 compliant
    const finalCheck = {
      hasMethodCancel: /METHOD:CANCEL/i.test(cancellationIcs),
      hasStatusCancelled: /STATUS:CANCELLED/i.test(cancellationIcs),
      hasSequence: /SEQUENCE:\d+/i.test(cancellationIcs),
      hasOriginalUid: new RegExp(`UID:${originalUid}`, 'i').test(cancellationIcs)
    };
    
    console.log('Final RFC 6638 compliance check:', finalCheck);
    
    if (!finalCheck.hasMethodCancel || !finalCheck.hasStatusCancelled || !finalCheck.hasSequence || !finalCheck.hasOriginalUid) {
      console.warn('⚠️ CRITICAL: Final ICS check failed, rebuilding with guaranteed RFC 6638 compliance');
      // If any required property is still missing, rebuild the ICS file
      return createMinimalCancellationIcs(eventData, originalUid);
    }
    
    console.log('Successfully generated RFC 6638 compliant cancellation ICS');
    return cancellationIcs;
    
  } catch (error) {
    console.error('Error generating cancellation ICS:', error);
    // Fallback to minimal ICS with guaranteed compliance
    return createMinimalCancellationIcs(eventData);
  }
}

/**
 * Creates a minimal cancellation ICS if we don't have the original
 * This is a fallback method only used in error scenarios
 */
/**
 * Creates a minimal RFC 6638 compliant cancellation ICS
 * This is either used as a fallback method or when rebuilding a non-compliant ICS
 * 
 * @param eventData Event data containing information about the event
 * @param forcedUid Optional UID to use (important for preserving original UID)
 */
function createMinimalCancellationIcs(eventData: EventInvitationData, forcedUid?: string): string {
  console.log('Creating minimal RFC 6638 compliant cancellation ICS');
  
  // Use the forced UID if provided, otherwise use the event UID or generate a fallback
  const uid = forcedUid || eventData.uid || `fallback-${Date.now()}@caldavclient.local`;
  
  // Per RFC 6638, these properties must be present for cancellation ICS files
  const dtstamp = formatIcsDate(new Date());
  const dtstart = formatIcsDate(eventData.startDate);
  const dtend = formatIcsDate(eventData.endDate);
  
  // Sequence should be incremented from the original event, or default to 1
  const sequence = (eventData.sequence ? parseInt(String(eventData.sequence), 10) + 1 : 1);
  
  // Construct the ICS with all required RFC 6638 properties
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Calendar Application//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:CANCEL', // This is critical for RFC 6638
    'BEGIN:VEVENT',
    `UID:${uid}`, // Must match the original event UID
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SEQUENCE:${sequence}`, // Increment sequence number per RFC 6638
    'STATUS:CANCELLED', // Must be set to CANCELLED per RFC 6638
    `SUMMARY:CANCELLED: ${eventData.title || 'Untitled Event'}`,
    `ORGANIZER;CN=${eventData.organizer?.name || eventData.organizer?.email || ''}:mailto:${eventData.organizer?.email || 'unknown@example.com'}`
  ];
  
  // Add attendees
  if (eventData.attendees && eventData.attendees.length > 0) {
    eventData.attendees.forEach(attendee => {
      ics.push(`ATTENDEE;CN=${attendee.name || attendee.email};ROLE=${attendee.role || 'REQ-PARTICIPANT'};PARTSTAT=NEEDS-ACTION:mailto:${attendee.email}`);
    });
  }
  
  // Add resources
  if (eventData.resources && eventData.resources.length > 0) {
    eventData.resources.forEach(resource => {
      const resourceLine = `ATTENDEE;CN=${resource.name || resource.email};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT` +
        (resource.type ? `;X-RESOURCE-TYPE=${resource.type}` : '') +
        (resource.capacity ? `;X-RESOURCE-CAPACITY=${resource.capacity}` : '') +
        (resource.adminName ? `;X-ADMIN-NAME=${resource.adminName}` : '') +
        (resource.remarks ? `;X-NOTES-REMARKS=${resource.remarks}` : '') +
        `:mailto:${resource.email}`;
      
      ics.push(resourceLine);
    });
  }
  
  // Close the ICS
  ics.push('END:VEVENT');
  ics.push('END:VCALENDAR');
  
  return ics.join('\r\n');
}

/**
 * Formats a Date object into the iCalendar date format
 */
function formatIcsDate(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, '')  // Remove dashes and colons
    .replace(/\.\d{3}/, '') // Remove milliseconds
    .replace(/Z$/, 'Z');    // Ensure Z stays at end
}

/**
 * Deletes an event from both local storage and server after cancellation
 * This function is called after all cancellation emails have been sent
 */
export async function deleteEventAfterCancellation(
  eventId: number,
  calendarId: number,
  serverUrl: string,
  credentials: ServerCredentials
): Promise<boolean> {
  try {
    console.log(`=== DELETING EVENT ID ${eventId} AFTER CANCELLATION ===`);
    // Storage is already imported
    
    // Get the event to ensure it exists and to retrieve URL
    const event = await storage.getEvent(eventId);
    if (!event) {
      console.error('Event not found for deletion');
      return false;
    }
    
    let serverDeleted = false;
    
    // 1. First try to delete from the server
    if (event.url) {
      try {
        console.log(`Deleting event from server at URL: ${event.url}`);
        
        const client = new DAVClient({
          serverUrl,
          credentials,
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        await client.login();
        
        await client.deleteObject({
          url: event.url,
          etag: event.etag || undefined
        });
        
        serverDeleted = true;
        console.log('Successfully deleted event from CalDAV server');
      } catch (serverError) {
        console.error('Error deleting event from server:', serverError);
        // Continue with local deletion even if server deletion fails
      }
    } else {
      console.warn('Event URL not available, could not delete from server');
    }
    
    // 2. Then delete from local storage
    try {
      await storage.deleteEvent(eventId);
      console.log('Successfully deleted event from local storage');
      return true;
    } catch (localError) {
      console.error('Error deleting event from local storage:', localError);
      return serverDeleted; // Return true if at least the server deletion worked
    }
    
  } catch (error) {
    console.error('Unexpected error during event deletion:', error);
    return false;
  }
}

/**
 * Removes any embedded calendar markers (like END:VEVENT) that might
 * be incorrectly embedded in property values
 */
function removeEmbeddedCalendarMarkers(icsData: string): string {
  // Check if there are embedded END:VEVENT or END:VCALENDAR markers
  // These typically happen when a property value contains these markers by accident
  
  // First, split the ICS into lines for processing
  const lines = icsData.split(/\r?\n/);
  const cleanedLines: string[] = [];
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip completely empty lines
    if (!line.trim()) continue;
    
    // Check if this is a property line (not a BEGIN or END marker)
    if (!line.startsWith('BEGIN:') && !line.startsWith('END:')) {
      // Check if this property value contains embedded calendar markers
      if (line.includes('\\r\\nEND:VEVENT') || 
          line.includes('\\r\\nEND:VCALENDAR') ||
          line.includes('\r\nEND:VEVENT') || 
          line.includes('\r\nEND:VCALENDAR')) {
        
        console.log(`Found embedded calendar markers in line: ${line}`);
        
        // Extract the property name and clean up the value
        const colonPos = line.indexOf(':');
        if (colonPos > 0) {
          const propName = line.substring(0, colonPos);
          let propValue = line.substring(colonPos + 1);
          
          // Clean up embedded markers
          propValue = propValue.replace(/\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR"?/g, '');
          propValue = propValue.replace(/\r\nEND:VEVENT\r\nEND:VCALENDAR"?/g, '');
          propValue = propValue.replace(/\\r\\nEND:VEVENT/g, '');
          propValue = propValue.replace(/\r\nEND:VEVENT/g, '');
          propValue = propValue.replace(/\\r\\nEND:VCALENDAR/g, '');
          propValue = propValue.replace(/\r\nEND:VCALENDAR/g, '');
          propValue = propValue.replace(/(?:"|\s)+$/, '');  // Remove trailing quotes and whitespace
          
          // Add the cleaned property
          cleanedLines.push(`${propName}:${propValue}`);
          console.log(`Cleaned to: ${propName}:${propValue}`);
          continue;
        }
      }
    }
    
    // Add normal lines unchanged
    cleanedLines.push(line);
  }
  
  // Always ensure we have exactly one BEGIN:VCALENDAR, BEGIN:VEVENT, END:VEVENT, and END:VCALENDAR
  // Count how many we have
  const beginVCal = cleanedLines.filter(l => l === 'BEGIN:VCALENDAR').length;
  const endVCal = cleanedLines.filter(l => l === 'END:VCALENDAR').length;
  const beginVEv = cleanedLines.filter(l => l === 'BEGIN:VEVENT').length;
  const endVEv = cleanedLines.filter(l => l === 'END:VEVENT').length;
  
  // If we don't have exactly one of each, rebuild the ICS structure
  if (beginVCal !== 1 || endVCal !== 1 || beginVEv !== 1 || endVEv !== 1) {
    console.log(`Invalid ICS structure detected. Rebuilding... (BEGIN:VCALENDAR=${beginVCal}, END:VCALENDAR=${endVCal}, BEGIN:VEVENT=${beginVEv}, END:VEVENT=${endVEv})`);
    
    // Extract all the properties except BEGIN/END markers
    const properties = cleanedLines.filter(l => 
      !l.startsWith('BEGIN:') && !l.startsWith('END:')
    );
    
    // Rebuild with proper structure
    return [
      'BEGIN:VCALENDAR',
      ...cleanedLines.filter(l => l.startsWith('VERSION:') || l.startsWith('PRODID:') || l.startsWith('CALSCALE:') || l.startsWith('METHOD:')),
      'BEGIN:VEVENT',
      ...properties.filter(l => !l.startsWith('VERSION:') && !l.startsWith('PRODID:') && !l.startsWith('CALSCALE:') && !l.startsWith('METHOD:')),
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  }
  
  return cleanedLines.join('\r\n');
}

/**
 * Removes duplicate ATTENDEE entries that might be present in the ICS data
 */
function deduplicateAttendees(icsData: string): string {
  // Extract all ATTENDEE lines
  const attendeeRegex = /ATTENDEE[^:\r\n]*:[^\r\n]+/g;
  const attendeeLines = icsData.match(attendeeRegex) || [];
  
  if (attendeeLines.length === 0) {
    return icsData; // No attendees to process
  }
  
  // Extract email from each attendee line for deduplication
  const uniqueAttendees = new Map<string, string>();
  
  attendeeLines.forEach(line => {
    const emailMatch = line.match(/mailto:([^>\r\n]+)/i);
    const email = emailMatch && emailMatch[1] ? emailMatch[1].toLowerCase() : null;
    
    if (email) {
      // Only keep the last occurrence of each email (which should be the most complete)
      // or keep the one without embedded newlines if present
      if (!uniqueAttendees.has(email) || 
          (line.indexOf('\r\n') === -1 && uniqueAttendees.get(email)?.indexOf('\r\n') !== -1)) {
        uniqueAttendees.set(email, line);
      }
    }
  });
  
  // If we found and removed duplicates
  if (uniqueAttendees.size < attendeeLines.length) {
    console.log(`Removed ${attendeeLines.length - uniqueAttendees.size} duplicate ATTENDEE entries`);
    
    // Replace all attendee lines with unique ones
    let result = icsData;
    
    // First remove all attendee lines
    attendeeLines.forEach(line => {
      result = result.replace(line, '');
    });
    
    // Clean up any empty lines created
    result = result.replace(/\r\n\r\n+/g, '\r\n');
    
    // Add unique attendees before END:VEVENT
    const uniqueAttendeeLines = Array.from(uniqueAttendees.values()).join('\r\n');
    result = result.replace('END:VEVENT', `${uniqueAttendeeLines}\r\nEND:VEVENT`);
    
    return result;
  }
  
  return icsData;
}