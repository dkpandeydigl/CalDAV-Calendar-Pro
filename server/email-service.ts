import nodemailer from 'nodemailer';
import { SmtpConfig } from '@shared/schema';
import { storage } from './memory-storage';
import { formatICalDate } from './ical-utils';
import { generateEventAgendaPDF } from './pdf-generator';
import { syncSmtpPasswordWithCalDAV } from './smtp-sync-utility';
import { sanitizeAndFormatICS } from '../shared/ics-formatter';

export interface Attendee {
  email: string;
  name?: string;
  role?: string;
  status?: string;
}

export interface Resource {
  id: string;
  name?: string;         // Display name of the resource
  subType: string;       // Resource type (Conference Room, Projector, etc.)
  type?: string;         // Alternative type field for compatibility
  capacity?: number;     // Optional capacity (e.g., 10 people)
  adminEmail: string;    // Email of resource administrator
  email?: string;        // Alternative email field for compatibility
  adminName?: string;    // Name of resource administrator
  remarks?: string;      // Optional remarks or notes
  displayName?: string;  // For backward compatibility
}

export interface EventInvitationData {
  eventId: number;
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  organizer: {
    email: string;
    name?: string;
  };
  attendees: Attendee[];
  resources?: Resource[]; // Optional resources array
  icsData?: string; // Optional pre-generated ICS data
  status?: string; // Optional status for events (e.g. 'CANCELLED')
  recurrenceRule?: string | object; // Recurrence rule as string or object
  rawData?: string; // Original raw iCalendar data
  sequence?: number; // Sequence number for versioning events (RFC 5545)
  _originalResourceAttendees?: string[]; // Preserved original resource attendee lines for RFC 5546 compliance
  calendarId?: number; // Calendar ID the event belongs to
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: SmtpConfig | null = null;

  // Placeholder for all the existing methods
  // We'll only implement the generateICSData method with our fix

  public generateICSData(data: EventInvitationData): string {
    const { uid, title, description, location, startDate, endDate, organizer, attendees, resources, status, rawData, sequence, _originalResourceAttendees } = data;
    
    // CRITICAL FIX: If raw server data is available, use it as the source of truth for proper RFC compliance
    // This ensures we preserve the exact same UID throughout the event lifecycle
    if (rawData && typeof rawData === 'string') {
      console.log(`Using original raw server data for ICS generation (${rawData.length} bytes)`);
      
      try {
        // First, extract original UID to log it for debugging purposes
        const uidMatch = rawData.match(/UID:([^\r\n]+)/);
        if (uidMatch && uidMatch[1]) {
          const originalUid = uidMatch[1];
          console.log(`Preserving original UID from raw data: ${originalUid}`);
        } else {
          console.log(`No UID found in raw data - will preserve provided UID: ${uid}`);
        }
        
        // For regular events (not cancellations), use the shared formatter for proper RFC compliance
        if (status !== 'CANCELLED') {
          console.log('Using shared ICS formatter for email attachment generation - ensuring UID consistency');
          
          // Update METHOD to REQUEST if needed for email invitations
          let processedIcs = rawData;
          if (!processedIcs.includes('METHOD:REQUEST')) {
            if (processedIcs.includes('METHOD:')) {
              // Replace existing METHOD
              processedIcs = processedIcs.replace(/METHOD:[^\r\n]+/g, 'METHOD:REQUEST');
            } else {
              // Add METHOD after PRODID
              processedIcs = processedIcs.replace(/PRODID:[^\r\n]+/g, match => match + '\r\nMETHOD:REQUEST');
            }
          }
          
          // Use the shared formatter to ensure proper RFC compliance
          return sanitizeAndFormatICS(processedIcs);
        }
      } catch (error) {
        console.error('Error processing raw data for ICS generation:', error);
        // Fall through to standard method if there was an error
      }
    }
    
    // If no raw data or failed to process it, generate a standard ICS file
    console.log('No raw data available or processing failed - generating ICS from scratch');
    
    // Format dates for iCalendar
    const startDateStr = formatICalDate(startDate);
    const endDateStr = formatICalDate(endDate);
    const now = formatICalDate(new Date());
    
    // Use the original UID if provided, or generate a new one
    const eventId = uid || `event-${Date.now()}@caldavclient.local`;
    
    // Build basic ICS content with RFC 5545 compliance
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CalDAV Calendar Application//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${eventId}`,
      `DTSTAMP:${now}`,
      `DTSTART:${startDateStr}`,
      `DTEND:${endDateStr}`,
      `SUMMARY:${title}`,
    ];
    
    // Add optional fields
    if (description) icsContent.push(`DESCRIPTION:${description.replace(/\n/g, '\\n')}`);
    if (location) icsContent.push(`LOCATION:${location}`);
    
    // Add organizer
    if (organizer && organizer.email) {
      icsContent.push(`ORGANIZER;CN=${organizer.name || organizer.email}:mailto:${organizer.email}`);
    }
    
    // Add attendees
    if (attendees && Array.isArray(attendees)) {
      attendees.forEach(attendee => {
        if (attendee && attendee.email) {
          icsContent.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=${attendee.role || 'REQ-PARTICIPANT'};PARTSTAT=${attendee.status || 'NEEDS-ACTION'};CN=${attendee.name || attendee.email}:mailto:${attendee.email}`);
        }
      });
    }
    
    // Add resources as attendees
    if (resources && Array.isArray(resources)) {
      resources.forEach(resource => {
        let resourceStr = `ATTENDEE;CN=${resource.name || resource.subType || 'Resource'};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT`;
        if (resource.subType) {
          resourceStr += `;X-RESOURCE-TYPE=${resource.subType}`;
        }
        if (resource.capacity !== undefined) {
          resourceStr += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
        }
        resourceStr += `:mailto:${resource.adminEmail}`;
        icsContent.push(resourceStr);
      });
    }
    
    // Close the event and calendar
    icsContent.push(
      'END:VEVENT',
      'END:VCALENDAR'
    );
    
    try {
      // Use our shared formatter for consistent formatting
      return sanitizeAndFormatICS(icsContent.join('\r\n'));
    } catch (error) {
      console.error('Error formatting ICS content:', error);
      return icsContent.join('\r\n'); // Return unformatted as fallback
    }
  }
}

// Create a singleton instance of the email service
export const emailService = new EmailService();