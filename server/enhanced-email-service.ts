/**
 * Enhanced Email Service
 * 
 * A more robust implementation of the email service that:
 * 1. Strictly follows RFC 5545 for iCalendar generation
 * 2. Ensures UID consistency throughout event lifecycle
 * 3. Properly formats all iCalendar components
 * 4. Handles PDF attachments correctly
 */

import nodemailer from 'nodemailer';
import { SmtpConfig } from '@shared/schema';
import { storage } from './memory-storage';
import { formatICalDate } from './ical-utils';
import { generateEventAgendaPDF } from './pdf-generator';
import { syncSmtpPasswordWithCalDAV } from './smtp-sync-utility';
import { 
  generateICalendarString, 
  updateICalendarString, 
  createCancellation,
  ICSEventData,
  ICSAttendee,
  ICSResource
} from '../shared/rfc5545-compliant-formatter';

export interface Attendee {
  email: string;
  name?: string;
  role?: string;
  status?: string;
}

export interface Resource {
  id: string;
  name?: string;
  subType: string;
  type?: string;
  capacity?: number;
  adminEmail: string;
  email?: string;
  adminName?: string;
  remarks?: string;
  displayName?: string;
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
  resources?: Resource[];
  icsData?: string;
  status?: string;
  recurrenceRule?: string | object;
  rawData?: string;
  sequence?: number;
  _originalResourceAttendees?: string[];
  calendarId?: number;
}

export class EnhancedEmailService {
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
      
      // Get the event ICS data using our RFC 5545 compliant formatter
      let icsData = data.icsData;
      if (!icsData) {
        if (data.rawData) {
          // If we have raw data, update it
          icsData = this.updateExistingICSData(data);
        } else {
          // Generate new ICS data
          icsData = this.generateNewICSData(data);
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
      recipients = Array.from(new Set(recipients));
      recipients = recipients.filter(email => email !== data.organizer.email);
      
      if (recipients.length === 0) {
        return { 
          success: false, 
          message: "No valid recipients found" 
        };
      }
      
      // Generate PDF attachment
      let pdfBuffer: Buffer | undefined;
      try {
        pdfBuffer = await generateEventAgendaPDF(data);
      } catch (pdfError) {
        console.error("Error generating PDF agenda:", pdfError);
        // Continue without PDF if generation fails
      }
      
      // Build the email with attachments
      const attachments = [
        {
          filename: `${data.uid || `event-${Date.now()}`}.ics`,
          content: icsData,
          contentType: 'text/calendar; method=REQUEST; charset=UTF-8'
        }
      ];
      
      // Add PDF attachment if successfully generated
      if (pdfBuffer) {
        attachments.push({
          filename: `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_agenda.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
          encoding: 'base64'
        });
      }
      
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Calendar Invitation: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments,
        headers: {
          'Content-Type': 'text/calendar; method=REQUEST; charset=UTF-8'
        }
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
          // Critical: Get the sequence number
          const sequenceMatch = data.rawData.match(/SEQUENCE:(\d+)/i);
          const currentSequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
          // Always increment sequence for cancellations
          const sequence = data.sequence !== undefined ? data.sequence : currentSequence + 1;
          
          icsData = createCancellation(
            data.rawData,
            data.uid,
            sequence
          );
        } else {
          // Generate new ICS data with cancelled status
          icsData = this.generateNewICSData({
            ...cancellationData,
            status: 'CANCELLED',
            method: 'CANCEL',
            sequence: (data.sequence || 0) + 1
          });
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
      recipients = Array.from(new Set(recipients));
      recipients = recipients.filter(email => email !== data.organizer.email);
      
      if (recipients.length === 0) {
        return { 
          success: false, 
          message: "No valid recipients found" 
        };
      }
      
      // Generate PDF attachment for cancellation
      let pdfBuffer: Buffer | undefined;
      try {
        pdfBuffer = await generateEventAgendaPDF({
          ...data,
          title: `CANCELLED: ${data.title}`
        });
      } catch (pdfError) {
        console.error("Error generating cancellation PDF:", pdfError);
        // Continue without PDF if generation fails
      }
      
      // Build the email with attachments
      const attachments = [
        {
          filename: `${data.uid || `event-${Date.now()}`}.ics`,
          content: icsData,
          contentType: 'text/calendar; method=CANCEL; charset=UTF-8'
        }
      ];
      
      // Add PDF attachment if successfully generated
      if (pdfBuffer) {
        attachments.push({
          filename: `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_cancellation.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
          encoding: 'base64'
        });
      }
      
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Event Cancelled: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments,
        headers: {
          'Content-Type': 'text/calendar; method=CANCEL; charset=UTF-8'
        }
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
   * Generate a new ICS file for an event
   * @param data The event invitation data
   * @returns RFC 5545 compliant iCalendar string
   */
  private generateNewICSData(data: EventInvitationData): string {
    console.log(`Generating new ICS data with UID ${data.uid}`);
    
    // Map our internal event to ICS format
    const icsEventData: ICSEventData = {
      uid: data.uid,
      summary: data.title,
      description: data.description,
      location: data.location,
      startDate: data.startDate,
      endDate: data.endDate,
      method: (data.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST') as any,
      status: data.status as any,
      sequence: data.sequence || 0,
      organizer: {
        email: data.organizer.email,
        name: data.organizer.name
      },
      attendees: this.mapAttendees(data.attendees),
      resources: this.mapResources(data.resources || []),
      recurrenceRule: typeof data.recurrenceRule === 'string' 
        ? data.recurrenceRule 
        : data.recurrenceRule 
          ? Object.entries(data.recurrenceRule)
              .map(([key, value]) => `${key}=${value}`)
              .join(';')
          : undefined
    };
    
    // Use the RFC 5545 compliant generator
    return generateICalendarString(icsEventData);
  }
  
  /**
   * Update an existing ICS file with new event data
   * @param data The event invitation data with original ICS in rawData
   * @returns RFC 5545 compliant updated iCalendar string
   */
  private updateExistingICSData(data: EventInvitationData): string {
    console.log(`Updating existing ICS data with UID ${data.uid}`);
    
    if (!data.rawData) {
      throw new Error('Cannot update ICS data without original raw data');
    }
    
    // Ensure we have the original UID
    const uidMatch = data.rawData.match(/UID:([^\r\n]+)/i);
    const originalUid = uidMatch ? uidMatch[1].trim() : data.uid;
    
    if (originalUid !== data.uid && data.uid) {
      console.warn(`UID mismatch between existing data (${originalUid}) and provided UID (${data.uid})`);
    }
    
    // Get the current sequence number
    const sequenceMatch = data.rawData.match(/SEQUENCE:(\d+)/i);
    const currentSequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
    
    // Map our internal event to ICS format
    const icsEventData: ICSEventData = {
      uid: originalUid,
      summary: data.title,
      description: data.description,
      location: data.location,
      startDate: data.startDate,
      endDate: data.endDate,
      method: (data.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST') as any,
      status: data.status as any,
      sequence: data.sequence !== undefined ? data.sequence : currentSequence + 1,
      organizer: {
        email: data.organizer.email,
        name: data.organizer.name
      },
      attendees: this.mapAttendees(data.attendees),
      resources: this.mapResources(data.resources || []),
      recurrenceRule: typeof data.recurrenceRule === 'string' 
        ? data.recurrenceRule 
        : data.recurrenceRule 
          ? Object.entries(data.recurrenceRule)
              .map(([key, value]) => `${key}=${value}`)
              .join(';')
          : undefined
    };
    
    // Use the RFC 5545 compliant updater
    return updateICalendarString(data.rawData, icsEventData);
  }
  
  /**
   * Map internal attendee format to ICS format
   * @param attendees Array of attendees
   * @returns Mapped attendees in ICS format
   */
  private mapAttendees(attendees: Attendee[]): ICSAttendee[] {
    if (!attendees || !Array.isArray(attendees)) return [];
    
    return attendees
      .filter(a => a && a.email && a.email.includes('@'))
      .map(attendee => ({
        email: attendee.email,
        name: attendee.name,
        role: attendee.role,
        partstat: attendee.status,
        rsvp: true,
        type: 'INDIVIDUAL'
      }));
  }
  
  /**
   * Map internal resource format to ICS format
   * @param resources Array of resources
   * @returns Mapped resources in ICS format
   */
  private mapResources(resources: Resource[]): ICSResource[] {
    if (!resources || !Array.isArray(resources)) return [];
    
    return resources
      .filter(r => r && (r.adminEmail || r.email) && r.id)
      .map(resource => ({
        id: resource.id,
        email: resource.adminEmail || resource.email || '',
        name: resource.name || resource.displayName,
        type: resource.subType || resource.type || 'ROOM',
        capacity: resource.capacity
      }));
  }
}

// Export a singleton instance
export const enhancedEmailService = new EnhancedEmailService();