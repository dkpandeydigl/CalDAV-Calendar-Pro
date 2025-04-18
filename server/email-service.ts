import nodemailer from 'nodemailer';
import { SmtpConfig } from '@shared/schema';
import { storage } from './memory-storage';
import { formatICalDate } from './ical-utils';
import { generateEventAgendaPDF } from './pdf-generator';
import { syncSmtpPasswordWithCalDAV } from './smtp-sync-utility';
import { 
  sanitizeAndFormatICS, 
  transformIcsForCancellation,
  deepCleanIcsData,
  cleanUidForFilename
} from '../shared/ics-formatter-fixed';

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
   * Apply proper line folding to ICS data according to RFC 5545
   * Lines longer than 75 characters should be folded
   * @param icsData The original ICS data
   * @returns Properly folded ICS data
   */
  private applyIcsLineFolding(icsData: string): string {
    if (!icsData) return '';
    
    try {
      const lines = icsData.split(/\r?\n/);
      const foldedLines: string[] = [];
      
      for (const line of lines) {
        if (line.length <= 75) {
          foldedLines.push(line);
          continue;
        }
        
        // Fold the line according to RFC 5545 (max 75 chars per line, continuation lines start with space)
        let currentLine = line;
        while (currentLine.length > 75) {
          const foldedPart = currentLine.substring(0, 75);
          currentLine = currentLine.substring(75);
          foldedLines.push(foldedPart);
          foldedLines.push(` ${currentLine}`);
          break; // Only fold once to avoid over-processing
        }
      }
      
      return foldedLines.join('\r\n');
    } catch (error) {
      console.error('Error applying ICS line folding:', error);
      return icsData; // Return original as fallback
    }
  }

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
      
      // CRITICAL FIX: Ensure we have a valid UID from centralUIDService before proceeding
      // This is essential for maintaining UID consistency across the entire application
      const validatedUid = await this.ensureValidUID(data);
      
      // CRITICAL: Double-check that the UID was properly set in the data object
      if (data.uid !== validatedUid) {
        console.error(`[EmailService] CRITICAL ERROR: UID mismatch in invitation`);
        console.error(`[EmailService] Data UID: ${data.uid}, Validated: ${validatedUid}`);
        // Force the correct UID
        data.uid = validatedUid;
      }
      
      console.log(`[EmailService] Using validated UID ${data.uid} for event ${data.eventId || 'without ID'}`);
      
      // Get the event ICS data
      let icsData = data.icsData;
      if (!icsData) {
        // Now generateICSData will use the validated UID
        icsData = await this.generateICSData(data);
      } else {
        // If we already have ICS data, validate the UID in it matches our validated UID
        const extractedUid = icsData.match(/UID:([^\r\n]+)/i)?.[1]?.trim();
        
        if (extractedUid && extractedUid !== data.uid) {
          console.warn(`[EmailService] UID mismatch in ICS data: ${extractedUid} vs validated ${data.uid}`);
          console.warn('[EmailService] Ensuring consistency by using validated UID from centralUIDService');
          
          // Replace the UID in the ICS data
          icsData = icsData.replace(/UID:[^\r\n]+/i, `UID:${data.uid}`);
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
      // Clean UID for filename to prevent showing complete ICS content in filename
      const cleanFilenameUid = cleanUidForFilename(data.uid || `event-${Date.now()}`);
      console.log(`[EmailService] Using cleaned UID for invitation filename: ${cleanFilenameUid}`);
      
      const attachments = [
        {
          filename: `${cleanFilenameUid}.ics`,
          content: icsData,
          contentType: 'text/calendar'
        }
      ];
      
      // Add PDF attachment if successfully generated
      if (pdfBuffer) {
        // Use type assertion to work around TypeScript limitation with nodemailer types
        attachments.push({
          filename: `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_agenda.pdf`,
          content: pdfBuffer.toString('base64'), // Convert Buffer to base64 string
          contentType: 'application/pdf',
          // Encoding is expected by nodemailer but not in our type definition
        } as any);
      }
      
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Calendar Invitation: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments
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
      
      // CRITICAL FIX: Ensure we have a valid UID from centralUIDService before proceeding
      // This is essential for maintaining UID consistency across the entire application
      const validatedUid = await this.ensureValidUID(data);
      
      // CRITICAL: Double-check that the UID was properly set in the data object
      if (data.uid !== validatedUid) {
        console.error(`[EmailService] CRITICAL ERROR: UID mismatch in cancellation`);
        console.error(`[EmailService] Data UID: ${data.uid}, Validated: ${validatedUid}`);
        // Force the correct UID
        data.uid = validatedUid;
      }
      
      console.log(`[EmailService] Using validated UID ${data.uid} for cancelling event ${data.eventId || 'without ID'}`);
      
      // Update status to CANCELLED if not already set
      const cancellationData = { 
        ...data, 
        status: 'CANCELLED',
        // Explicitly set UID here as well to ensure it's used in the cancellation
        uid: validatedUid 
      };
      
      // Get the event ICS data for cancellation
      let icsData = data.icsData;
      if (!icsData) {
        // If we have raw data, transform it for cancellation
        if (data.rawData) {
          // CRITICAL FIX: Use our robust deep cleaning function
          console.log('[EmailService] Deep cleaning raw ICS data for cancellation');
          
          // Convert to string and handle possible null/undefined
          const rawDataStr = String(data.rawData || '');
          
          // Use the dedicated deep cleaning function from shared library
          const cleanedRawData = deepCleanIcsData(rawDataStr);
          
          console.log('[EmailService] Successfully deep cleaned raw ICS data, now transforming for cancellation');
          
          // Now transform the deeply cleaned data
          icsData = this.transformIcsForCancellation(cleanedRawData, cancellationData);
          
          // Apply a final deep cleaning to the result to ensure no formatting issues remain
          icsData = deepCleanIcsData(icsData);
          
          // Final check to ensure the validated UID is used
          // But first, make sure that our data.uid is actually a clean, proper UID
          const cleanUid = data.uid.split(/[\s\\"\r\n]/)[0];
          
          if (!icsData.includes(`UID:${cleanUid}`)) {
            console.warn(`[EmailService] UID not found in transformed ICS, inserting cleaned UID: ${cleanUid}`);
            icsData = icsData.replace(/UID:[^\r\n]+/i, `UID:${cleanUid}`);
          } else {
            console.log(`[EmailService] Found valid UID in transformed ICS: ${cleanUid}`);
          }
        } else {
          // Generate new ICS data with cancelled status
          icsData = await this.generateICSData(cancellationData);
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
      // Clean UID for filename to prevent showing complete ICS content in filename
      const cleanFilenameUid = cleanUidForFilename(data.uid || `event-${Date.now()}`);
      console.log(`[EmailService] Using cleaned UID for cancellation filename: ${cleanFilenameUid}`);
      
      const attachments = [
        {
          filename: `${cleanFilenameUid}.ics`,
          content: icsData,
          contentType: 'text/calendar'
        }
      ];
      
      // Add PDF attachment if successfully generated
      if (pdfBuffer) {
        // Use type assertion to work around TypeScript limitation with nodemailer types
        attachments.push({
          filename: `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_cancellation.pdf`,
          content: pdfBuffer.toString('base64'), // Convert Buffer to base64 string
          contentType: 'application/pdf',
          // Encoding is expected by nodemailer but not in our type definition
        } as any);
      }
      
      const mailOptions = {
        from: this.config?.fromName 
          ? `"${this.config.fromName}" <${this.config.fromEmail}>` 
          : this.config?.fromEmail,
        to: recipients.join(', '),
        subject: `Event Cancelled: ${data.title}`,
        text: textBody,
        html: htmlBody,
        attachments
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
      // Use the standardized shared implementation from ics-formatter-fixed.ts
      console.log('[EmailService] Using RFC 5545 compliant cancellation formatter from shared/ics-formatter-fixed.ts');
      
      // Create the event data to pass to the shared function
      const cancellationData = {
        uid: data.uid,
        sequence: data.sequence,
        organizer: data.organizer
      };
      
      // Call the shared function that will handle all formatting concerns
      const cancellationIcs = transformIcsForCancellation(originalIcs, cancellationData);
      
      console.log('[EmailService] Successfully generated RFC-compliant cancellation ICS');
      return cancellationIcs;
    } catch (error: unknown) {
      console.error('Error transforming ICS for cancellation:', error);
      console.error('Original ICS:', originalIcs);
      
      try {
        // Even in the fallback case, use the proper RFC 5545 structure
        console.error('Creating fallback cancellation ICS with RFC 5545 compliant format');
        
        // Clean up the UID to avoid the issue with appending raw data
        let extractedUid = '';
        if (data.uid) {
          // Clean up the UID - just take the part before any whitespace or special chars
          extractedUid = data.uid.split(/[\s\\"\r\n]/)[0];
        } else {
          // Try to extract from original ICS with a safer regex
          const uidMatch = originalIcs.match(/UID:([^"\r\n]+)/i);
          if (uidMatch && uidMatch[1]) {
            extractedUid = uidMatch[1].trim().split(/[\s\\"\r\n]/)[0];
          } else {
            extractedUid = `cancel-${Date.now()}@caldavclient.local`;
          }
        }
        
        const uid = extractedUid;
        const sequence = (data.sequence ? parseInt(data.sequence.toString(), 10) : 0) + 1;
        
        // Build a clean, RFC-compliant cancellation ICS as fallback
        const lines = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
          'METHOD:CANCEL',
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `SUMMARY:${data.title || 'Cancelled Event'}`,
          `DTSTART:${formatICalDate(data.startDate)}`,
          `DTEND:${formatICalDate(data.endDate)}`,
          `DTSTAMP:${formatICalDate(new Date())}`,
          `SEQUENCE:${sequence}`,
          'STATUS:CANCELLED'
        ];
        
        // Add organizer if available
        if (data.organizer && data.organizer.email) {
          if (data.organizer.name) {
            lines.push(`ORGANIZER;CN=${data.organizer.name}:mailto:${data.organizer.email}`);
          } else {
            lines.push(`ORGANIZER:mailto:${data.organizer.email}`);
          }
        }
        
        // Add attendees if available
        if (data.attendees && data.attendees.length > 0) {
          data.attendees.forEach(att => {
            if (att && att.email) {
              let line = 'ATTENDEE';
              if (att.name) line += `;CN=${att.name}`;
              line += `;ROLE=${att.role || 'REQ-PARTICIPANT'};PARTSTAT=NEEDS-ACTION`;
              line += `:mailto:${att.email}`;
              lines.push(line);
            }
          });
        }
        
        // Close the components
        lines.push('END:VEVENT');
        lines.push('END:VCALENDAR');
        
        // Join with proper line breaks and return
        return lines.join('\r\n');
      } catch (fallbackError) {
        console.error('Critical error creating fallback cancellation ICS:', fallbackError);
        
        // Ultimate fallback - simplified but standards-compliant cancellation ICS
        // Make sure even in this emergency case we have a clean UID
        const emergencyUid = data.uid ? data.uid.split(/[\s\\"\r\n]/)[0] : `cancel-${Date.now()}@caldavclient.local`;
        return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:CANCEL\r\nBEGIN:VEVENT\r\nUID:${emergencyUid}\r\nSTATUS:CANCELLED\r\nSEQUENCE:1\r\nEND:VEVENT\r\nEND:VCALENDAR`;
      }
    }
  }
  
  public async generateEmailPreview(data: EventInvitationData): Promise<string> {
    // Generate a simple HTML preview of the email
    try {
      // Validate that we have the required data
      if (!data) {
        throw new Error('No event data provided');
      }
      
      // CRITICAL: Ensure we have a valid UID from centralUIDService before proceeding
      // This ensures preview UIDs match the ones that will be used in actual emails
      try {
        await this.ensureValidUID(data);
        console.log(`[EmailPreview] Using validated UID ${data.uid} for email preview`);
      } catch (uidError) {
        console.warn('[EmailPreview] Could not validate UID for preview:', uidError);
        // Preview can continue with potentially inconsistent UID
      }

      // Ensure we have a valid organizer structure
      if (!data.organizer) {
        // Try to extract organizer from raw data if available
        if (data.rawData) {
          const rawDataStr = String(data.rawData);
          const organizerMatch = rawDataStr.match(/ORGANIZER[^:]*:mailto:([^\r\n]+)/i);
          const organizerNameMatch = rawDataStr.match(/ORGANIZER;CN=([^:;]+)[^:]*:/i);
          
          if (organizerMatch && organizerMatch[1]) {
            data.organizer = {
              email: organizerMatch[1].trim(),
              name: organizerNameMatch && organizerNameMatch[1] ? organizerNameMatch[1].trim() : organizerMatch[1].trim()
            };
            console.log('Extracted organizer from raw data:', data.organizer);
          } else {
            // Default fallback
            data.organizer = {
              email: 'dk.pandey@xgenplus.com',
              name: 'DK Pandey'
            };
            console.warn('Could not extract organizer from raw data, using active user default');
          }
        } else {
          // Use active user default as backup
          data.organizer = {
            email: 'dk.pandey@xgenplus.com',
            name: 'DK Pandey'
          };
          console.warn('No organizer data or raw data provided, using active user default');
        }
      } else if (typeof data.organizer === 'string') {
        // Handle case where organizer is just an email string
        data.organizer = {
          email: data.organizer,
          name: data.organizer
        };
      } else if (!data.organizer.email) {
        // Try to extract from raw data first
        if (data.rawData) {
          const rawDataStr = String(data.rawData);
          const organizerMatch = rawDataStr.match(/ORGANIZER[^:]*:mailto:([^\r\n]+)/i);
          
          if (organizerMatch && organizerMatch[1]) {
            data.organizer.email = organizerMatch[1].trim();
            console.log('Extracted organizer email from raw data:', data.organizer.email);
          } else {
            // Default fallback
            data.organizer.email = 'dk.pandey@xgenplus.com';
            console.warn('Could not extract organizer email from raw data, using active user default');
          }
        } else {
          // Use active user default
          data.organizer.email = 'dk.pandey@xgenplus.com';
          console.warn('No organizer email or raw data provided, using active user default');
        }
      }

      // Ensure attendees is always an array
      if (!data.attendees) {
        data.attendees = [];
      } else if (typeof data.attendees === 'string') {
        try {
          data.attendees = JSON.parse(data.attendees);
          if (!Array.isArray(data.attendees)) {
            console.warn('Attendees parsed but is not an array, using empty array');
            data.attendees = [];
          }
        } catch (e) {
          console.warn('Failed to parse attendees JSON:', e);
          data.attendees = [];
        }
      } else if (!Array.isArray(data.attendees)) {
        data.attendees = [];
      }

      // Ensure resources is always an array
      if (!data.resources) {
        data.resources = [];
      } else if (typeof data.resources === 'string') {
        try {
          data.resources = JSON.parse(data.resources);
          if (!Array.isArray(data.resources)) {
            console.warn('Resources parsed but is not an array, using empty array');
            data.resources = [];
          }
        } catch (e) {
          console.warn('Failed to parse resources JSON:', e);
          data.resources = [];
        }
      } else if (!Array.isArray(data.resources)) {
        data.resources = [];
      }
      
      // Get the ICS data with error handling
      let icsData = '';
      try {
        icsData = await this.generateICSData(data);
      } catch (icsError: unknown) {
        console.error('Error generating ICS data:', icsError);
        icsData = 'Error generating ICS data: ' + (icsError instanceof Error ? icsError.message : String(icsError));
      }
      
      // Format start and end dates with error handling
      let formattedStart = 'Invalid date';
      let formattedEnd = 'Invalid date';
      
      try {
        const startDate = new Date(data.startDate || new Date());
        const endDate = new Date(data.endDate || new Date());
        
        // Format dates for display
        const dateOptions: Intl.DateTimeFormatOptions = { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        };
        
        if (!isNaN(startDate.getTime())) {
          formattedStart = startDate.toLocaleString(undefined, dateOptions);
        }
        
        if (!isNaN(endDate.getTime())) {
          formattedEnd = endDate.toLocaleString(undefined, dateOptions);
        }
      } catch (dateError) {
        console.error('Error formatting dates:', dateError);
      }
      
      // Create HTML template with safe defaults
      let html = `
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; color: #2c3e50; }
            .info { margin-bottom: 20px; }
            .label { font-weight: bold; margin-right: 5px; }
            .divider { border-top: 1px solid #eee; margin: 20px 0; }
            .description { white-space: pre-line; }
            .attendees { margin-top: 20px; }
            .footer { margin-top: 30px; font-size: 12px; color: #777; }
            pre { white-space: pre-wrap; font-family: monospace; background-color: #f9f9f9; padding: 10px; border-radius: 5px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${data.title || 'Untitled Event'}</div>
          </div>
          
          <div class="info">
            <p><span class="label">From:</span> ${formattedStart}</p>
            <p><span class="label">To:</span> ${formattedEnd}</p>
            <p><span class="label">Location:</span> ${data.location || 'No location specified'}</p>
            <p><span class="label">Organizer:</span> ${data.organizer.name || data.organizer.email} &lt;${data.organizer.email}&gt;</p>
          </div>
          
          <div class="divider"></div>
          
          <div class="description">
            <p><span class="label">Description:</span></p>
            <p>${data.description || 'No description provided'}</p>
          </div>
      `;
      
      // Add attendees if present
      if (Array.isArray(data.attendees) && data.attendees.length > 0) {
        html += `
          <div class="divider"></div>
          <div class="attendees">
            <p><span class="label">Attendees:</span></p>
            <ul>
        `;
        
        // Add each attendee with safe fallbacks
        data.attendees.forEach(attendee => {
          if (!attendee) return; // Skip null/undefined attendees
          
          try {
            // Handle missing email safely
            const email = attendee.email || 'No email';
            const name = attendee.name || email;
            const role = attendee.role || 'Required';
            const status = attendee.status || 'No status';
            
            html += `<li>${name} &lt;${email}&gt; (${role} - ${status})</li>`;
          } catch (attendeeError) {
            console.warn('Error processing attendee:', attendeeError);
            html += `<li>Error displaying attendee</li>`;
          }
        });
        
        html += `
            </ul>
          </div>
        `;
      }
      
      // Add resources if present
      if (Array.isArray(data.resources) && data.resources.length > 0) {
        html += `
          <div class="divider"></div>
          <div class="resources">
            <p><span class="label">Resources:</span></p>
            <ul>
        `;
        
        // Add each resource with safe fallbacks
        data.resources.forEach(resource => {
          if (!resource) return; // Skip null/undefined resources
          
          try {
            const id = resource.id || 'Unknown';
            const name = resource.name || resource.displayName || id;
            const type = resource.subType || resource.type || 'Resource';
            const capacity = resource.capacity ? `Capacity: ${resource.capacity}` : '';
            
            html += `<li>${name} (${type}) ${capacity}</li>`;
          } catch (resourceError) {
            console.warn('Error processing resource:', resourceError);
            html += `<li>Error displaying resource</li>`;
          }
        });
        
        html += `
            </ul>
          </div>
        `;
      }
      
      // Add status information if present
      if (data.status) {
        const statusClass = data.status === 'CANCELLED' ? 'color: red; font-weight: bold;' : '';
        html += `
          <div class="divider"></div>
          <div class="status" style="${statusClass}">
            <p><span class="label">Status:</span> ${data.status}</p>
          </div>
        `;
      }
      
      // Add ICS data at the bottom with error handling
      html += `
          <div class="divider"></div>
          <div class="attachment">
            <p><span class="label">Calendar Attachment (ICS):</span></p>
            <pre>${icsData}</pre>
          </div>
          
          <div class="footer">
            <p>This is a preview of the email that will be sent to attendees.</p>
            <p><small>Event UID: ${data.uid || 'No UID'}</small></p>
          </div>
        </body>
        </html>
      `;
      
      return html;
    } catch (error: unknown) {
      console.error('Error generating email preview:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `<html><body><p>Error generating email preview: ${errorMessage}</p></body></html>`;
    }
  }

  /**
   * Ensure we have a valid UID from centralUIDService before generating ICS data
   * This function returns a Promise that resolves once we have a valid UID
   */
  public async ensureValidUID(data: EventInvitationData): Promise<string> {
    try {
      // Import centralUIDService
      const { centralUIDService } = await import('./central-uid-service');
      
      // FIXED: Critical fix for ensuring proper UID consistency across email attachments
      // Each event must have a unique UID that persists throughout its lifecycle
      
      // If we have an eventId, ALWAYS get or generate a UID for it from central service
      // regardless of whether we already have a UID in data
      if (data.eventId) {
        // This is the critical fix: Always validate UID through central service even if data already has a UID
        const validatedUid = await centralUIDService.validateEventUID(data.eventId, data.uid);
        
        if (data.uid && data.uid !== validatedUid) {
          console.warn(`[EmailService] UID MISMATCH DETECTED: Event ${data.eventId}`);
          console.warn(`[EmailService] Provided: ${data.uid}, Validated: ${validatedUid}`);
          console.warn(`[EmailService] Using validated UID from centralUIDService for consistency`);
        }
        
        console.log(`[EmailService] Retrieved validated UID ${validatedUid} for event ${data.eventId}`);
        
        // CRITICAL: Update the data object with the correct UID to ensure it's used in all attachments
        data.uid = validatedUid;
        
        // Force a database update to ensure this UID is persisted
        try {
          await centralUIDService.storeUID(data.eventId, validatedUid);
          console.log(`[EmailService] Ensured UID ${validatedUid} is stored for event ${data.eventId}`);
        } catch (storeError) {
          console.error(`[EmailService] Error storing validated UID for event ${data.eventId}:`, storeError);
          // Continue even if storage fails - we still have the correct UID for this operation
        }
        
        return validatedUid;
      } else if (data.uid) {
        // If we don't have an eventId but do have a UID, use it but log a warning
        console.warn(`[EmailService] Using provided UID ${data.uid} for event without ID - cannot validate`);
        return data.uid;
      } else {
        // Generate a new UID if we don't have an eventId or a UID
        const newUid = centralUIDService.generateUID();
        console.log(`[EmailService] Generated new UID ${newUid} for event without ID`);
        data.uid = newUid;
        return newUid;
      }
    } catch (error) {
      console.error('[EmailService] Error ensuring valid UID:', error);
      
      // If we already have a UID, use it despite the validation error
      if (data.uid) {
        console.warn(`[EmailService] Using existing UID ${data.uid} after validation error`);
        return data.uid;
      }
      
      // Last resort fallback - this should never happen in production
      const emergencyUid = `event-emergency-${Date.now()}-${Math.random().toString(36).substring(2, 11)}@caldavclient.local`;
      console.error(`[EmailService] Using EMERGENCY fallback UID: ${emergencyUid}`);
      data.uid = emergencyUid;
      return emergencyUid;
    }
  }
  
  /**
   * Generate ICS data for an event
   * This method ensures a consistent UID is used throughout the event lifecycle
   */
  public async generateICSData(data: EventInvitationData): Promise<string> {
    // CRITICAL: The bug fix - ensure we have a valid UID before generating ICS
    // This ensures each event gets its own unique UID in email attachments
    const validatedUid = await this.ensureValidUID(data);
    
    // IMPORTANT: Double-check that the UID was properly set in the data object
    if (data.uid !== validatedUid) {
      console.error(`[EmailService] CRITICAL ERROR: UID mismatch after validation`);
      console.error(`[EmailService] Data UID: ${data.uid}, Validated: ${validatedUid}`);
      // Force the correct UID to ensure consistency
      data.uid = validatedUid;
    }
    
    console.log(`[EmailService] Using validated UID ${data.uid} for generating ICS data`);

    // If there's already raw data available, modify it directly instead of using formatter
    if (data.rawData) {
      // Extract the original UID from raw data
      const uidMatch = String(data.rawData).match(/UID:([^\r\n]+)/i);
      if (uidMatch) {
        const rawUid = uidMatch[1].trim();
        
        // Check if there's a mismatch between the validated UID and raw data UID
        if (rawUid !== data.uid) {
          console.warn(`[EmailService] UID mismatch detected in raw ICS data:`);
          console.warn(`[EmailService] Raw data UID: ${rawUid}, Validated UID: ${data.uid}`);
          console.warn(`[EmailService] Using validated UID from centralUIDService for consistency`);
        }
      } else {
        console.warn("[EmailService] Could not find UID in raw data, using validated UID");
      }
      
      // Create a modified version of the original ICS with only necessary changes
      const method = data.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST';
      const status = data.status || (method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED');
      
      // Get the sequence number - increment existing or use provided
      let newSequence = data.sequence || 0;
      const sequenceMatch = String(data.rawData).match(/SEQUENCE:(\d+)/i);
      if (sequenceMatch) {
        const currentSequence = parseInt(sequenceMatch[1], 10);
        newSequence = data.sequence !== undefined ? data.sequence : currentSequence + 1;
      }
      
      // Make direct modifications to preserve formatting
      let modifiedIcs = String(data.rawData);

      // Fix any double colons in mailto: references
      modifiedIcs = modifiedIcs.replace(/mailto::([^\r\n]+)/g, 'mailto:$1');
      
      // CRITICAL: Always update UID to use the validated one from centralUIDService
      modifiedIcs = modifiedIcs.replace(/UID:[^\r\n]+/i, `UID:${data.uid}`);
      
      // Update METHOD
      modifiedIcs = modifiedIcs.replace(/METHOD:[^\r\n]+/i, `METHOD:${method}`);
      
      // Add METHOD if it doesn't exist
      if (!modifiedIcs.includes('METHOD:')) {
        modifiedIcs = modifiedIcs.replace(
          /VERSION:[^\r\n]+(\r?\n)/i, 
          `VERSION:2.0$1METHOD:${method}$1`
        );
      }
      
      // Update STATUS
      modifiedIcs = modifiedIcs.replace(/STATUS:[^\r\n]+/i, `STATUS:${status}`);
      
      // Add STATUS if it doesn't exist (after SEQUENCE or UID if SEQUENCE doesn't exist)
      if (!modifiedIcs.includes('STATUS:')) {
        if (modifiedIcs.includes('SEQUENCE:')) {
          modifiedIcs = modifiedIcs.replace(
            /SEQUENCE:[^\r\n]+(\r?\n)/i,
            `SEQUENCE:${newSequence}$1STATUS:${status}$1`
          );
        } else {
          // Add after UID if SEQUENCE doesn't exist
          modifiedIcs = modifiedIcs.replace(
            /UID:[^\r\n]+(\r?\n)/i,
            `UID:${data.uid}$1SEQUENCE:${newSequence}$1STATUS:${status}$1`
          );
        }
      }
      
      // Update SEQUENCE
      modifiedIcs = modifiedIcs.replace(/SEQUENCE:\d+/i, `SEQUENCE:${newSequence}`);
      
      // Add SEQUENCE if it doesn't exist (after UID)
      if (!modifiedIcs.includes('SEQUENCE:')) {
        modifiedIcs = modifiedIcs.replace(
          /UID:[^\r\n]+(\r?\n)/i,
          `UID:${data.uid}$1SEQUENCE:${newSequence}$1`
        );
      }
      
      // Update the SUMMARY if it has changed
      if (data.title) {
        modifiedIcs = modifiedIcs.replace(/SUMMARY:[^\r\n]+/i, `SUMMARY:${data.title}`);
      }
      
      // Fix non-standard RESOURCE-TYPE to be X-RESOURCE-TYPE
      modifiedIcs = modifiedIcs.replace(/RESOURCE-TYPE=/g, 'X-RESOURCE-TYPE=');
      
      // Fix commas in LOCATION (don't need to be escaped in quoted values)
      modifiedIcs = modifiedIcs.replace(/(LOCATION:[^"\r\n]*?)\\,([^"\r\n]*?(?:\r?\n|$))/g, '$1,$2');
      
      // Apply proper line folding for RFC 5545 compliance
      return this.applyIcsLineFolding(modifiedIcs);
    }
    
    // Build a new ICS file from scratch (only for new events)
    const method = data.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST';
    const status = data.status || (method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED');
    const sequence = data.sequence || 0;
    
    console.log(`[EmailService] Generating new ICS with validated UID: ${data.uid}`);
    
    // Format dates according to iCalendar spec
    const startDate = formatICalDate(data.startDate);
    const endDate = formatICalDate(data.endDate);
    const now = formatICalDate(new Date());
    
    let icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Replit Calendar App//EN
CALSCALE:GREGORIAN
METHOD:${method}
BEGIN:VEVENT
UID:${data.uid}
DTSTAMP:${now}
DTSTART:${startDate}
DTEND:${endDate}
SEQUENCE:${sequence}
STATUS:${status}
SUMMARY:${data.title}`;

    if (data.description) {
      // Encode description properly for iCalendar (line folding and escaping)
      const escapedDescription = data.description
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
      
      // Add to ICS content with proper line folding
      icsContent += `
DESCRIPTION:${escapedDescription}`;
    }

    if (data.location) {
      // Escape location properly
      const escapedLocation = data.location
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
        
      icsContent += `
LOCATION:${escapedLocation}`;
    }

    // Add organizer
    if (data.organizer.email) {
      const organizerString = data.organizer.name 
        ? `ORGANIZER;CN=${data.organizer.name}:mailto:${data.organizer.email}`
        : `ORGANIZER:mailto:${data.organizer.email}`;
        
      icsContent += `
${organizerString}`;
    }

    // Add attendees
    if (data.attendees && data.attendees.length > 0) {
      for (const attendee of data.attendees) {
        if (!attendee.email) continue;
        
        let attendeeString = 'ATTENDEE';
        
        if (attendee.name) {
          attendeeString += `;CN=${attendee.name}`;
        }
        
        if (attendee.role) {
          attendeeString += `;ROLE=${attendee.role}`;
        }
        
        if (attendee.status) {
          attendeeString += `;PARTSTAT=${attendee.status}`;
        }
        
        attendeeString += `:mailto:${attendee.email}`;
        
        icsContent += `
${attendeeString}`;
      }
    }

    // Add resources if present
    if (data.resources && data.resources.length > 0) {
      // If we have preserved original resource attendee lines, use those
      if (data._originalResourceAttendees && data._originalResourceAttendees.length > 0) {
        for (const line of data._originalResourceAttendees) {
          icsContent += `
${line}`;
        }
      } else {
        // Otherwise create new resource attendee lines
        for (const resource of data.resources) {
          if (!resource.id || !resource.adminEmail) continue;
          
          let resourceString = 'ATTENDEE;CUTYPE=RESOURCE';
          
          if (resource.name) {
            resourceString += `;CN=${resource.name}`;
          }
          
          resourceString += `;X-RESOURCE-TYPE=${resource.subType || resource.type || 'ROOM'}`;
          resourceString += `;X-RESOURCE-ID=${resource.id}`;
          
          if (resource.capacity) {
            resourceString += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
          }
          
          resourceString += `:mailto:${resource.adminEmail}`;
          
          icsContent += `
${resourceString}`;
        }
      }
    }

    // Add recurrence rule if present
    if (data.recurrenceRule) {
      if (typeof data.recurrenceRule === 'string') {
        icsContent += `
RRULE:${data.recurrenceRule}`;
      } else {
        // Handle object recurrence rule
        const rrule = Object.entries(data.recurrenceRule)
          .map(([key, value]) => `${key}=${value}`)
          .join(';');
          
        icsContent += `
RRULE:${rrule}`;
      }
    }

    // Close out the ICS file
    icsContent += `
END:VEVENT
END:VCALENDAR`;

    // Process through our improved formatter to ensure proper formatting
    return sanitizeAndFormatICS(icsContent, {
      method: method,
      status: status,
      sequence: sequence
    });
  }
}

export const emailService = new EmailService();