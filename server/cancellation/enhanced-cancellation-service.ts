/**
 * Enhanced Event Cancellation Service
 * 
 * This module provides a complete RFC 5546 compliant implementation for handling event cancellations.
 * It ensures that:
 * 1. The cancellation ICS file maintains the exact same UID as the original event
 * 2. All properties required by the RFC are properly set
 * 3. All attendees and resources are preserved
 * 4. The event is properly deleted after cancellation
 */

import { getStorage } from '../storage';
import { DAVClient } from 'tsdav';

interface EventData {
  uid: string;
  title?: string;
  resources?: any[];
  eventId?: number;
  calendarId?: number;
  [key: string]: any;
}

interface ServerCredentials {
  username: string;
  password: string;
}

/**
 * Generates a cancellation ICS file based on the original ICS content
 * Strictly follows RFC 5546 standards for cancellation
 * 
 * @param originalIcs The original ICS file content
 * @param eventData Basic event data for reference (title, uid, etc.)
 * @returns RFC 5546 compliant cancellation ICS file content
 */
export function generateCancellationIcs(originalIcs: string, eventData: EventData): string {
  console.log('=== GENERATING RFC 5546 COMPLIANT CANCELLATION ICS ===');
  
  // 1. Extract core elements from the original ICS file
  const originalUid = extractUid(originalIcs) || eventData.uid;
  const originalSequence = extractSequence(originalIcs);
  const newSequence = originalSequence + 1;
  console.log(`Using original UID: ${originalUid}, incrementing sequence from ${originalSequence} to ${newSequence}`);
  
  // 2. Extract all relevant lines from the original ICS
  const vCalendarLines = extractVCalendarLines(originalIcs);
  const vEventLines = extractVEventLines(originalIcs);
  const allAttendeeLines = extractAttendeeLines(originalIcs);
  const resourceAttendeeLines = filterResourceAttendeeLines(allAttendeeLines);
  
  console.log(`Found ${allAttendeeLines.length} attendee lines, including ${resourceAttendeeLines.length} resource lines`);
  
  // 3. Modify or set the core properties for cancellation
  let cancellationLines = [];
  
  // Start with the VCALENDAR part (changing METHOD to CANCEL)
  const modifiedVCalendarLines = vCalendarLines.map(line => {
    if (line.startsWith('METHOD:')) {
      return 'METHOD:CANCEL';
    }
    return line;
  });
  
  cancellationLines.push(...modifiedVCalendarLines);
  cancellationLines.push('BEGIN:VEVENT');
  
  // Add the exact same UID
  const hasUidLine = vEventLines.some(line => line.startsWith('UID:'));
  if (hasUidLine) {
    // Keep the UID line from the original event
    const uidLine = vEventLines.find(line => line.startsWith('UID:'));
    cancellationLines.push(uidLine as string);
  } else {
    // If there somehow wasn't a UID line, add it
    cancellationLines.push(`UID:${originalUid}`);
  }
  
  // Add DTSTAMP for the current time
  cancellationLines.push(`DTSTAMP:${formatDateToIcsDate(new Date())}`);
  
  // Add incremented sequence number
  cancellationLines.push(`SEQUENCE:${newSequence}`);
  
  // Add STATUS:CANCELLED
  cancellationLines.push('STATUS:CANCELLED');
  
  // Add all the other necessary properties from the original event
  // but update the SUMMARY to have CANCELLED: prefix
  vEventLines.forEach(line => {
    // Skip lines we've already handled or don't want
    if (line.startsWith('BEGIN:VEVENT') || 
        line.startsWith('END:VEVENT') || 
        line.startsWith('UID:') || 
        line.startsWith('SEQUENCE:') ||
        line.startsWith('STATUS:') ||
        line.startsWith('DTSTAMP:')) {
      return;
    }
    
    // Add CANCELLED: prefix to SUMMARY if it doesn't already have it
    if (line.startsWith('SUMMARY:')) {
      const summaryValue = line.substring(8);
      if (!summaryValue.startsWith('CANCELLED:') && !summaryValue.startsWith('CANCELLED: ')) {
        cancellationLines.push(`SUMMARY:CANCELLED: ${summaryValue}`);
      } else {
        cancellationLines.push(line);
      }
    } else {
      // Add all other lines unchanged
      cancellationLines.push(line);
    }
  });
  
  // Ensure all attendee lines are included, especially resource attendees
  const attendeeLineUids = new Set(allAttendeeLines.map(extractAttendeeUid));
  
  // Add any resource attendee lines that weren't included yet
  resourceAttendeeLines.forEach(line => {
    const attendeeUid = extractAttendeeUid(line);
    if (!cancellationLines.some(l => l.includes(attendeeUid))) {
      cancellationLines.push(line);
    }
  });
  
  // Add END:VEVENT and END:VCALENDAR
  cancellationLines.push('END:VEVENT');
  cancellationLines.push('END:VCALENDAR');
  
  // Join all lines with proper line endings
  const cancellationIcs = cancellationLines.join('\r\n');
  console.log('Successfully generated RFC 5546 compliant cancellation ICS');
  
  return cancellationIcs;
}

/**
 * Delete event from both local storage and server
 * This function should be called after sending cancellation emails
 * 
 * @param eventId The ID of the event to delete
 * @param calendarId The ID of the calendar containing the event
 * @param serverUrl The URL of the CalDAV server
 * @param credentials Authentication credentials for the server
 */
export async function deleteEventAfterCancellation(
  eventId: number,
  calendarId: number,
  serverUrl: string,
  credentials: ServerCredentials
): Promise<boolean> {
  try {
    console.log(`Deleting event ID ${eventId} from calendar ${calendarId} after cancellation`);
    const storage = getStorage();
    
    // 1. First delete from the server
    let serverDeleteSuccess = false;
    try {
      const event = await storage.getEvent(eventId);
      if (!event) {
        throw new Error('Event not found');
      }
      
      // Only try server deletion if we have the event URL
      if (event.url) {
        console.log(`Deleting event from server at URL: ${event.url}`);
        
        const client = new DAVClient({
          serverUrl,
          credentials,
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        // Initialize the client
        await client.login();
        
        // Delete the event using its URL
        await client.deleteObject({
          url: event.url,
          etag: event.etag || undefined
        });
        
        serverDeleteSuccess = true;
        console.log('Successfully deleted event from CalDAV server');
      } else {
        console.warn('Event URL not available, could not delete from server');
      }
    } catch (serverError) {
      console.error('Error deleting event from server:', serverError);
      // Continue with local deletion even if server deletion fails
    }
    
    // 2. Then delete from local storage
    try {
      await storage.deleteEvent(eventId);
      console.log('Successfully deleted event from local storage');
      return true;
    } catch (localError) {
      console.error('Error deleting event from local storage:', localError);
      return serverDeleteSuccess; // Return true if at least the server deletion worked
    }
  } catch (error) {
    console.error('Unexpected error in deleteEventAfterCancellation:', error);
    return false;
  }
}

// Helper function to extract UID from ICS
function extractUid(ics: string): string | null {
  const uidMatch = ics.match(/UID:([^\r\n]+)/i);
  return uidMatch && uidMatch[1] ? uidMatch[1] : null;
}

// Helper to extract sequence number from ICS
function extractSequence(ics: string): number {
  const sequenceMatch = ics.match(/SEQUENCE:(\d+)/i);
  return sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
}

// Helper to extract all lines between BEGIN:VCALENDAR and first BEGIN:VEVENT
function extractVCalendarLines(ics: string): string[] {
  const lines = ics.split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim() === 'BEGIN:VCALENDAR');
  const endIndex = lines.findIndex(line => line.trim() === 'BEGIN:VEVENT');
  
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Enhanced Cancellation Generator//EN', 'CALSCALE:GREGORIAN'];
  }
  
  return lines.slice(startIndex, endIndex);
}

// Helper to extract all lines between BEGIN:VEVENT and END:VEVENT
function extractVEventLines(ics: string): string[] {
  const lines = ics.split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim() === 'BEGIN:VEVENT');
  const endIndex = lines.findIndex(line => line.trim() === 'END:VEVENT');
  
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return [];
  }
  
  return lines.slice(startIndex + 1, endIndex); // +1 to skip BEGIN:VEVENT
}

// Helper to extract all ATTENDEE lines
function extractAttendeeLines(ics: string): string[] {
  const attendeePattern = /ATTENDEE[^:\r\n]+:[^\r\n]+/g;
  return ics.match(attendeePattern) || [];
}

// Helper to filter resource attendee lines
function filterResourceAttendeeLines(attendeeLines: string[]): string[] {
  return attendeeLines.filter(line => 
    line.includes('CUTYPE=RESOURCE') || 
    line.includes('X-RESOURCE-TYPE') || 
    line.includes('RESOURCE-TYPE') ||
    line.includes('X-RESOURCE-CAPACITY') || 
    line.includes('RESOURCE-CAPACITY')
  );
}

// Helper to extract the email/UID from an attendee line
function extractAttendeeUid(attendeeLine: string): string {
  const mailtoMatch = attendeeLine.match(/mailto:([^>\r\n]+)/i);
  if (mailtoMatch && mailtoMatch[1]) {
    return mailtoMatch[1];
  }
  return '';
}

// Helper to format Date to ICS date format
function formatDateToIcsDate(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, '')  // Remove dashes and colons
    .replace(/\.\d{3}/, '') // Remove milliseconds
    .replace(/Z$/, 'Z');    // Ensure Z stays at end
}