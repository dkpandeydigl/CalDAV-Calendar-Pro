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

  /**
   * Initialize the email service with SMTP configuration for a specific user
   * @param userId The user ID to fetch SMTP configuration for
   * @returns A boolean indicating whether initialization was successful
   */
  async initialize(userId: number): Promise<boolean> {
    try {
      // Try to synchronize SMTP password with CalDAV password before proceeding
      await syncSmtpPasswordWithCalDAV(userId);
      console.log(`SMTP password synchronized with CalDAV password for user ${userId} before sending email`);
      
      // Get SMTP configuration for the user
      let smtpConfig = await storage.getSmtpConfig(userId);
      
      // If no SMTP config exists, try to create a default one
      if (!smtpConfig) {
        console.log(`No SMTP configuration found for user ${userId}, creating default configuration...`);
        
        // Get user details to use their email address
        const user = await storage.getUser(userId);
        if (!user || !user.email) {
          console.error(`Cannot create default SMTP config for user ${userId}: No email found`);
          return false;
        }
        
        try {
          // Create a default SMTP config
          smtpConfig = await storage.createSmtpConfig({
            userId,
            host: 'smtps.xgen.in',
            port: 465,
            secure: true,
            username: user.email,
            password: '', // Will be updated by syncSmtpPasswordWithCalDAV
            fromEmail: user.email,
            fromName: user.fullName || user.username,
            enabled: true
          });
          
          console.log(`Created default SMTP configuration for user ${userId}`);
          
          // Try to sync password again after creating config
          await syncSmtpPasswordWithCalDAV(userId);
        } catch (createError) {
          console.error(`Failed to create default SMTP config for user ${userId}:`, createError);
          return false;
        }
      }
      
      if (!smtpConfig) {
        console.error(`Still no SMTP configuration available for user ${userId}`);
        return false;
      }
      
      // Verify that required fields are present
      if (!smtpConfig.host || !smtpConfig.port) {
        console.error(`Invalid SMTP configuration for user ${userId}: Missing host or port`);
        return false;
      }
      
      // Check if SMTP is enabled
      if (smtpConfig.enabled === false) {
        console.error(`SMTP is disabled for user ${userId}`);
        return false;
      }
      
      // Initialize the transporter
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure === true,
        auth: {
          user: smtpConfig.username,
          pass: smtpConfig.password
        }
      });
      
      // Store the config
      this.config = smtpConfig;
      
      // Verify connection
      try {
        await this.transporter.verify();
        console.log('SMTP connection established successfully');
      } catch (verifyError) {
        console.error('SMTP connection verification failed:', verifyError);
        // We'll still return true since the configuration exists, even if verification fails
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to initialize email service for user ${userId}:`, error);
      return false;
    }
  }
  
  /**
   * Send a test email to confirm SMTP configuration is working
   */
  async sendTestEmail(userId: number, recipient: string, subject: string, body: string): Promise<{success: boolean, message: string, details?: any}> {
    try {
      if (!this.transporter || !this.config) {
        return { 
          success: false, 
          message: "Email service not initialized" 
        };
      }
      
      // Build the email
      const mailOptions = {
        from: this.config.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config.fromEmail,
        to: recipient,
        subject: subject,
        text: body,
        html: `<p>${body}</p>`
      };
      
      // Send the email
      const info = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        message: "Test email sent successfully",
        details: {
          messageId: info.messageId,
          response: info.response
        }
      };
    } catch (error) {
      console.error("Error sending test email:", error);
      return {
        success: false,
        message: `Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Send an event invitation email
   * @param userId The user ID to send the invitation from
   * @param data The event invitation data
   * @returns A result object with success/failure information
   */
  async sendEventInvitation(userId: number, data: EventInvitationData): Promise<{success: boolean, message: string, details?: any}> {
    try {
      // Initialize the email service if not already initialized
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { 
          success: false, 
          message: "Failed to initialize email service. Check SMTP configuration." 
        };
      }
      
      // Get the event ICS data
      let icsData = data.icsData;
      if (!icsData) {
        icsData = this.generateICSData(data);
      }
      
      // Get user info for sending the email
      const user = await storage.getUser(userId);
      if (!user || !user.email) {
        return { 
          success: false, 
          message: "Sender information not available" 
        };
      }
      
      // Prepare a friendly date format for the email body
      const startDate = data.startDate ? 
        new Date(data.startDate).toLocaleString(undefined, { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric'
        }) : 'Not specified';
      
      // Create basic HTML email body
      const htmlBody = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px; }
            .event-details { margin: 20px 0; }
            .footer { font-size: 12px; color: #777; margin-top: 30px; }
            h2 { color: #2c3e50; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Calendar Event Invitation</h2>
            </div>
            <div class="event-details">
              <p>You are invited to the following event:</p>
              <p><strong>Title:</strong> ${data.title}</p>
              <p><strong>When:</strong> ${startDate}</p>
              ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
              ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
              <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
            </div>
            <div class="footer">
              <p>This invitation was sent from the CalDAV Calendar application.</p>
              <p>Please find the attached calendar invitation file (.ics) to add this event to your calendar.</p>
            </div>
          </div>
        </body>
      </html>
      `;
      
      // Create a text-only version of the email body
      const textBody = `
      Calendar Event Invitation
      
      You are invited to the following event:
      
      Title: ${data.title}
      When: ${startDate}
      ${data.location ? `Location: ${data.location}\n` : ''}
      ${data.description ? `Description: ${data.description}\n` : ''}
      Organizer: ${data.organizer.name || data.organizer.email}
      
      This invitation was sent from the CalDAV Calendar application.
      Please find the attached calendar invitation file (.ics) to add this event to your calendar.
      `;
      
      // Recipients list - all attendees
      let recipients: string[] = [];
      if (data.attendees && Array.isArray(data.attendees)) {
        recipients = data.attendees
          .filter(a => a && a.email && a.email.includes('@'))
          .map(a => a.email);
      }
      
      // Add resource administrators
      if (data.resources && Array.isArray(data.resources)) {
        const resourceEmails = data.resources
          .filter(r => r && r.adminEmail && r.adminEmail.includes('@'))
          .map(r => r.adminEmail);
        recipients = [...recipients, ...resourceEmails];
      }
      
      // Remove duplicates and organizer's email from recipients
      recipients = [...new Set(recipients)];
      recipients = recipients.filter(email => email !== data.organizer.email);
      
      if (recipients.length === 0) {
        return { 
          success: false, 
          message: "No valid recipients found" 
        };
      }
      
      // Build the email
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Calendar Invitation: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments: [
          {
            filename: `${data.uid || `event-${Date.now()}`}.ics`,
            content: icsData,
            contentType: 'text/calendar'
          }
        ]
      };
      
      // Send the email
      const info = await this.transporter?.sendMail(mailOptions);
      
      return {
        success: true,
        message: `Invitation sent to ${recipients.length} recipients`,
        details: {
          messageId: info?.messageId,
          recipients: recipients
        }
      };
    } catch (error) {
      console.error("Error sending event invitation:", error);
      return {
        success: false,
        message: `Failed to send invitation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error: String(error) }
      };
    }
  }
  
  /**
   * Send an event cancellation email
   * @param userId The user ID to send the cancellation from
   * @param data The event invitation data with status set to 'CANCELLED'
   * @returns A result object with success/failure information
   */
  async sendEventCancellation(userId: number, data: EventInvitationData): Promise<{success: boolean, message: string, details?: any}> {
    try {
      // Initialize the email service if not already initialized
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { 
          success: false, 
          message: "Failed to initialize email service. Check SMTP configuration." 
        };
      }
      
      // Update status to CANCELLED if not already set
      const cancellationData = { 
        ...data, 
        status: 'CANCELLED' 
      };
      
      // Get the event ICS data for cancellation
      let icsData = data.icsData;
      if (!icsData) {
        // If we have raw data, transform it for cancellation
        if (data.rawData) {
          icsData = this.transformIcsForCancellation(data.rawData, cancellationData);
        } else {
          // Generate new ICS data with cancelled status
          icsData = this.generateICSData(cancellationData);
        }
      }
      
      // Get user info for sending the email
      const user = await storage.getUser(userId);
      if (!user || !user.email) {
        return { 
          success: false, 
          message: "Sender information not available" 
        };
      }
      
      // Prepare a friendly date format for the email body
      const startDate = data.startDate ? 
        new Date(data.startDate).toLocaleString(undefined, { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric'
        }) : 'Not specified';
      
      // Create HTML email body
      const htmlBody = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px; }
            .event-details { margin: 20px 0; }
            .footer { font-size: 12px; color: #777; margin-top: 30px; }
            h2 { color: #e74c3c; }
            .cancelled { color: #e74c3c; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Event Cancellation</h2>
            </div>
            <div class="event-details">
              <p class="cancelled">The following event has been cancelled:</p>
              <p><strong>Title:</strong> ${data.title}</p>
              <p><strong>When:</strong> ${startDate}</p>
              ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
              ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
              <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
            </div>
            <div class="footer">
              <p>This cancellation notice was sent from the CalDAV Calendar application.</p>
              <p>The attached calendar file (.ics) will update your calendar automatically.</p>
            </div>
          </div>
        </body>
      </html>
      `;
      
      // Create a text-only version of the email body
      const textBody = `
      Event Cancellation
      
      The following event has been cancelled:
      
      Title: ${data.title}
      When: ${startDate}
      ${data.location ? `Location: ${data.location}\n` : ''}
      ${data.description ? `Description: ${data.description}\n` : ''}
      Organizer: ${data.organizer.name || data.organizer.email}
      
      This cancellation notice was sent from the CalDAV Calendar application.
      The attached calendar file (.ics) will update your calendar automatically.
      `;
      
      // Recipients list - all attendees
      let recipients: string[] = [];
      if (data.attendees && Array.isArray(data.attendees)) {
        recipients = data.attendees
          .filter(a => a && a.email && a.email.includes('@'))
          .map(a => a.email);
      }
      
      // Add resource administrators
      if (data.resources && Array.isArray(data.resources)) {
        const resourceEmails = data.resources
          .filter(r => r && r.adminEmail && r.adminEmail.includes('@'))
          .map(r => r.adminEmail);
        recipients = [...recipients, ...resourceEmails];
      }
      
      // Remove duplicates and organizer's email from recipients
      recipients = [...new Set(recipients)];
      recipients = recipients.filter(email => email !== data.organizer.email);
      
      if (recipients.length === 0) {
        return { 
          success: false, 
          message: "No valid recipients found" 
        };
      }
      
      // Build the email
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Cancelled: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments: [
          {
            filename: `${data.uid || `event-cancellation-${Date.now()}`}.ics`,
            content: icsData,
            contentType: 'text/calendar'
          }
        ]
      };
      
      // Send the email
      const info = await this.transporter?.sendMail(mailOptions);
      
      return {
        success: true,
        message: `Cancellation notice sent to ${recipients.length} recipients`,
        details: {
          messageId: info?.messageId,
          recipients: recipients
        }
      };
    } catch (error) {
      console.error("Error sending event cancellation:", error);
      return {
        success: false,
        message: `Failed to send cancellation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error: String(error) }
      };
    }
  }
  
  /**
   * Transform an ICS file for cancellation
   * @param originalIcs The original ICS data
   * @param data Additional event data to include
   * @returns The transformed ICS data with cancellation information
   */
  transformIcsForCancellation(originalIcs: string, data: EventInvitationData): string {
    try {
      // First check if the ICS data already has a cancellation status
      if (originalIcs.includes('STATUS:CANCELLED')) {
        return originalIcs;
      }
      
      // Add or replace STATUS:CANCELLED in the VEVENT block
      let modified = originalIcs;
      
      // Find the VEVENT block
      const eventStart = modified.indexOf('BEGIN:VEVENT');
      const eventEnd = modified.indexOf('END:VEVENT', eventStart);
      
      if (eventStart === -1 || eventEnd === -1) {
        // If we can't find the VEVENT block, just use our standard generator
        return this.generateICSData(data);
      }
      
      // Extract the VEVENT block
      const eventBlock = modified.substring(eventStart, eventEnd);
      
      // Check if there's already a STATUS line
      if (eventBlock.includes('STATUS:')) {
        // Replace existing STATUS line
        modified = modified.replace(/STATUS:[^\r\n]+/g, 'STATUS:CANCELLED');
      } else {
        // Add STATUS:CANCELLED after UID
        modified = modified.replace(/(UID:[^\r\n]+)/g, '$1\r\nSTATUS:CANCELLED');
      }
      
      // Update METHOD to CANCEL if exists
      if (modified.includes('METHOD:')) {
        modified = modified.replace(/METHOD:[^\r\n]+/g, 'METHOD:CANCEL');
      } else {
        // Add METHOD:CANCEL after PRODID
        modified = modified.replace(/(PRODID:[^\r\n]+)/g, '$1\r\nMETHOD:CANCEL');
      }
      
      // Update SEQUENCE number if it exists
      const seqMatch = modified.match(/SEQUENCE:(\d+)/);
      if (seqMatch) {
        const currentSeq = parseInt(seqMatch[1], 10);
        modified = modified.replace(/SEQUENCE:\d+/g, `SEQUENCE:${currentSeq + 1}`);
      } else {
        // Add SEQUENCE after UID
        modified = modified.replace(/(UID:[^\r\n]+)/g, '$1\r\nSEQUENCE:1');
      }
      
      // Update DTSTAMP to current time
      const now = formatICalDate(new Date());
      if (modified.includes('DTSTAMP:')) {
        modified = modified.replace(/DTSTAMP:[^\r\n]+/g, `DTSTAMP:${now}`);
      } else {
        // Add DTSTAMP after UID
        modified = modified.replace(/(UID:[^\r\n]+)/g, `$1\r\nDTSTAMP:${now}`);
      }
      
      // Use the shared formatter to ensure proper formatting
      return sanitizeAndFormatICS(modified);
    } catch (error) {
      console.error('Error transforming ICS for cancellation:', error);
      
      // If transformation fails, fall back to generating new ICS
      return this.generateICSData({...data, status: 'CANCELLED'});
    }
  }
  
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