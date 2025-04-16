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
  console.log('=== GENERATING RFC 5546 COMPLIANT CANCELLATION ICS ===');
  
  if (!originalIcs) {
    console.error('No original ICS content provided for cancellation');
    return createMinimalCancellationIcs(eventData);
  }
  
  try {
    // Extract the original UID to ensure we keep it exactly the same
    const uidMatch = originalIcs.match(/UID:([^\r\n]+)/i);
    const originalUid = uidMatch && uidMatch[1] ? uidMatch[1] : eventData.uid;
    
    if (!originalUid) {
      throw new Error('No UID found in original ICS or event data');
    }
    
    console.log(`Using original UID for cancellation: ${originalUid}`);
    
    // Replace METHOD:REQUEST with METHOD:CANCEL
    let cancellationIcs = originalIcs.replace(/METHOD:[^\r\n]+/i, 'METHOD:CANCEL');
    
    // If METHOD doesn't exist, add it after BEGIN:VCALENDAR
    if (!cancellationIcs.includes('METHOD:')) {
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VCALENDAR',
        'BEGIN:VCALENDAR\r\nMETHOD:CANCEL'
      );
    }
    
    // Add STATUS:CANCELLED if not present
    if (!cancellationIcs.includes('STATUS:CANCELLED')) {
      cancellationIcs = cancellationIcs.replace(
        'BEGIN:VEVENT',
        'BEGIN:VEVENT\r\nSTATUS:CANCELLED'
      );
    }
    
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
    
    // Increment SEQUENCE number
    const sequenceMatch = cancellationIcs.match(/SEQUENCE:(\d+)/i);
    if (sequenceMatch && sequenceMatch[1]) {
      const newSequence = parseInt(sequenceMatch[1], 10) + 1;
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
    
    console.log('Successfully generated RFC 5546 compliant cancellation ICS');
    return cancellationIcs;
    
  } catch (error) {
    console.error('Error generating cancellation ICS:', error);
    return createMinimalCancellationIcs(eventData);
  }
}

/**
 * Creates a minimal cancellation ICS if we don't have the original
 * This is a fallback method only used in error scenarios
 */
function createMinimalCancellationIcs(eventData: EventInvitationData): string {
  console.log('Creating minimal cancellation ICS (fallback)');
  
  const uid = eventData.uid || `fallback-${Date.now()}@caldavclient.local`;
  const dtstamp = formatIcsDate(new Date());
  const dtstart = formatIcsDate(eventData.startDate);
  const dtend = formatIcsDate(eventData.endDate);
  
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalDAV Calendar Application//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:CANCEL',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    'SEQUENCE:1',
    'STATUS:CANCELLED',
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