import nodemailer from 'nodemailer';
import { SmtpConfig } from '@shared/schema';
import { storage } from './database-storage';
import { formatICalDate } from './ical-utils';

interface Attendee {
  email: string;
  name?: string;
  role?: string;
  status?: string;
}

interface Resource {
  id: string;
  subType: string;       // Conference Room, Projector, etc.
  capacity?: number;     // Optional capacity (e.g., 10 people)
  adminEmail: string;    // Email of resource administrator
  adminName?: string;    // Name of resource administrator
  remarks?: string;      // Optional remarks or notes
}

interface EventInvitationData {
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
      // Get SMTP configuration for the user
      let smtpConfig = await storage.getSmtpConfig(userId);
      
      // If no SMTP config exists, try to create a default one
      if (!smtpConfig) {
        console.log(`No SMTP configuration found for user ${userId}, creating default config`);
        
        // Get user to retrieve their email
        const user = await storage.getUser(userId);
        if (!user?.email) {
          console.log(`User ${userId} doesn't have an email address to use as From address`);
          return false;
        }
        
        try {
          // Create a default SMTP config
          smtpConfig = await storage.createSmtpConfig({
            userId,
            host: 'smtps.xgen.in',
            port: 465,
            secure: true,  // SSL/TLS
            username: user.email,
            password: '',  // This will need to be set by the user
            fromEmail: user.email,
            fromName: user.username || undefined
          });
          
          console.log(`Created default SMTP configuration for user ${userId}`);
        } catch (error) {
          console.error('Failed to create default SMTP configuration:', error);
          return false;
        }
      }

      // Store the config for later use
      this.config = smtpConfig;

      // Create the transporter
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: {
          user: smtpConfig.username,
          pass: smtpConfig.password,
        },
      } as nodemailer.TransportOptions);

      // Verify the connection if password is set
      if (smtpConfig.password) {
        try {
          await this.transporter.verify();
          console.log('SMTP connection established successfully');
        } catch (verifyError) {
          console.error('SMTP connection verification failed:', verifyError);
          // We'll still return true since the configuration exists, even if verification fails
        }
      } else {
        console.log('SMTP password not set, skipping connection verification');
      }
      
      return true;
    } catch (error) {
      console.error('Failed to initialize email service:', error);
      this.transporter = null;
      this.config = null;
      return false;
    }
  }

  /**
   * Send an event invitation to all attendees
   * @param userId The user ID sending the invitation
   * @param data Event invitation data
   * @returns A result object with success status and details
   */
  async sendEventInvitation(
    userId: number, 
    data: EventInvitationData
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // Initialize email service if not already initialized
      if (!this.transporter || !this.config || this.config.userId !== userId) {
        const initSuccess = await this.initialize(userId);
        if (!initSuccess) {
          return { 
            success: false, 
            message: 'Failed to initialize email service. Please check your SMTP configuration.' 
          };
        }
      }

      // Generate ICS data if not provided
      const icsData = data.icsData || this.generateICSData(data);

      // Prepare arrays to track results
      let allResults: PromiseSettledResult<any>[] = [];
      let allRecipients: string[] = [];
      
      // Send email to each attendee
      if (data.attendees && data.attendees.length > 0) {
        const attendeePromises = data.attendees.map(attendee => {
          return this.sendInvitationEmail(data, attendee, icsData);
        });

        // Wait for all attendee emails to be sent
        const attendeeResults = await Promise.allSettled(attendeePromises);
        allResults = [...allResults, ...attendeeResults];
        allRecipients = [...allRecipients, ...data.attendees.map(a => a.email)];
      }
      
      // Send email to each resource admin if resources are present
      if (data.resources && data.resources.length > 0) {
        const resourcePromises = data.resources.map(resource => {
          return this.sendResourceBookingNotification(data, resource, icsData);
        });

        // Wait for all resource booking emails to be sent
        const resourceResults = await Promise.allSettled(resourcePromises);
        allResults = [...allResults, ...resourceResults];
        allRecipients = [...allRecipients, ...data.resources.map(r => r.adminEmail)];
      }
      
      // Count successful deliveries
      const successful = allResults.filter(r => r.status === 'fulfilled').length;
      const failed = allResults.filter(r => r.status === 'rejected').length;
      
      // Detailed results for debugging
      const detailedResults = allResults.map((result, index) => {
        return {
          recipient: allRecipients[index],
          success: result.status === 'fulfilled',
          details: result.status === 'rejected' ? (result as PromiseRejectedResult).reason : undefined
        };
      });

      if (failed > 0) {
        return {
          success: successful > 0, // Consider partially successful if at least one email was sent
          message: `Sent notifications to ${successful} out of ${allRecipients.length} recipients.`,
          details: detailedResults
        };
      }

      return {
        success: true,
        message: `Successfully sent all ${successful} notifications.`,
        details: detailedResults
      };
    } catch (error) {
      console.error('Error sending event invitations:', error);
      return {
        success: false,
        message: `Failed to send invitations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: error
      };
    }
  }
  
  /**
   * Send a resource booking notification to a resource administrator
   * @param data Event data
   * @param resource Resource information
   * @param icsData The ICS calendar data
   * @returns Promise resolving to the send info
   */
  private async sendResourceBookingNotification(
    data: EventInvitationData,
    resource: Resource,
    icsData: string
  ): Promise<nodemailer.SentMessageInfo> {
    if (!this.transporter || !this.config) {
      throw new Error('Email service not initialized');
    }

    const { startDate, endDate, title, description, location } = data;
    
    // Format the date for display in email
    const dateFormat = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    });
    
    const formattedStart = dateFormat.format(startDate);
    const formattedEnd = dateFormat.format(endDate);
    
    // Create a more readable display name for the resource admin
    const adminName = resource.adminName || resource.adminEmail.split('@')[0];
    
    // Create the email content
    const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px 5px 0 0; }
          .header h2 { margin: 0; color: #333; }
          .content { padding: 20px 15px; }
          .event-details { margin-bottom: 20px; }
          .detail-row { margin-bottom: 10px; }
          .label { font-weight: bold; display: inline-block; width: 100px; vertical-align: top; }
          /* Rich text styling */
          .description-container { display: flex; align-items: start; }
          .description-content { 
            display: inline-block; 
            margin-left: 10px; 
            max-width: 450px; 
          }
          .description-content p { margin-top: 0; margin-bottom: 0.5rem; }
          .description-content strong, .description-content b { font-weight: bold; }
          .description-content em, .description-content i { font-style: italic; }
          .description-content ul { list-style-type: disc; margin-left: 20px; padding-left: 0; }
          .description-content ol { list-style-type: decimal; margin-left: 20px; padding-left: 0; }
          .description-content a { color: #0066cc; text-decoration: underline; }
          .description-content h1, .description-content h2, .description-content h3 { 
            font-weight: bold; 
            margin-top: 0.5rem;
            margin-bottom: 0.5rem; 
          }
          .footer { font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; }
          .resource-details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Resource Booking Notification</h2>
          </div>
          <div class="content">
            <p>Hello ${adminName},</p>
            <p>The following event has reserved your resource:</p>
            
            <div class="event-details">
              <div class="detail-row">
                <span class="label">Event:</span> ${title}
              </div>
              ${description ? `
              <div class="detail-row">
                <span class="label">Description:</span>
                <div class="description-content">${description}</div>
              </div>` : ''}
              ${location ? `
              <div class="detail-row">
                <span class="label">Location:</span> ${location}
              </div>` : ''}
              <div class="detail-row">
                <span class="label">Start:</span> ${formattedStart}
              </div>
              <div class="detail-row">
                <span class="label">End:</span> ${formattedEnd}
              </div>
              <div class="detail-row">
                <span class="label">Organizer:</span> ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}
              </div>
            </div>
            
            <div class="resource-details">
              <h3>Resource Information</h3>
              <div class="detail-row">
                <span class="label">Resource:</span> ${resource.subType}
              </div>
              <div class="detail-row">
                <span class="label">Capacity:</span> ${resource.capacity !== undefined ? resource.capacity : 'Not specified'}
              </div>
              ${resource.remarks ? `
              <div class="detail-row">
                <span class="label">Remarks:</span> ${resource.remarks}
              </div>` : ''}
            </div>
            
            <p>The event details are attached in an iCalendar file that you can import into your calendar application.</p>
          </div>
          <div class="footer">
            <p>This notification was sent using CalDAV Calendar Application.</p>
          </div>
        </div>
      </body>
    </html>
    `;

    const plainText = `Hello ${adminName},

The following event has reserved your resource:

Event: ${title}
${description ? `Description: ${description}\n` : ''}${location ? `Location: ${location}\n` : ''}
Start: ${formattedStart}
End: ${formattedEnd}
Organizer: ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}

Resource Information:
Resource: ${resource.subType}
Capacity: ${resource.capacity !== undefined ? resource.capacity : 'Not specified'}\n${resource.remarks ? `Remarks: ${resource.remarks}\n` : ''}

The event details are attached in an iCalendar file that you can import into your calendar application.

This notification was sent using CalDAV Calendar Application.`;

    // Prepare the email
    const mailOptions = {
      from: {
        name: this.config.fromName || 'Calendar Application',
        address: this.config.fromEmail
      },
      to: resource.adminName 
        ? `"${resource.adminName}" <${resource.adminEmail}>`
        : resource.adminEmail,
      subject: `Resource Booking Notification: ${title}`,
      html: htmlContent,
      text: plainText,
      attachments: [
        {
          filename: `resource-booking-${data.uid}.ics`,
          content: icsData,
          contentType: 'text/calendar; method=REQUEST'
        }
      ]
    };

    // Send the email
    return this.transporter.sendMail(mailOptions);
  }

  /**
   * Send a single invitation email to an attendee
   * @param data Event data
   * @param attendee Attendee information
   * @param icsData The ICS calendar data
   * @returns Promise resolving to the send info
   */
  private async sendInvitationEmail(
    data: EventInvitationData,
    attendee: Attendee,
    icsData: string
  ): Promise<nodemailer.SentMessageInfo> {
    if (!this.transporter || !this.config) {
      throw new Error('Email service not initialized');
    }

    const { startDate, endDate, title, description, location } = data;
    
    // Format the date for display in email
    const dateFormat = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    });
    
    const formattedStart = dateFormat.format(startDate);
    const formattedEnd = dateFormat.format(endDate);
    
    // Create a more readable display name for the attendee
    const attendeeName = attendee.name || attendee.email.split('@')[0];
    
    // Create the email content
    const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px 5px 0 0; }
          .header h2 { margin: 0; color: #333; }
          .content { padding: 20px 15px; }
          .event-details { margin-bottom: 20px; }
          .detail-row { margin-bottom: 10px; }
          .label { font-weight: bold; display: inline-block; width: 100px; }
          .footer { font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; }
          /* Rich text styling */
          .description-container { display: flex; align-items: start; }
          .description-content { 
            display: inline-block; 
            margin-left: 10px; 
            max-width: 450px; 
          }
          .description-content p { margin-top: 0; margin-bottom: 0.5rem; }
          .description-content strong, .description-content b { font-weight: bold; }
          .description-content em, .description-content i { font-style: italic; }
          .description-content ul { list-style-type: disc; margin-left: 20px; padding-left: 0; }
          .description-content ol { list-style-type: decimal; margin-left: 20px; padding-left: 0; }
          .description-content a { color: #0066cc; text-decoration: underline; }
          .description-content h1, .description-content h2, .description-content h3 { 
            font-weight: bold; 
            margin-top: 0.5rem;
            margin-bottom: 0.5rem; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Calendar Invitation</h2>
          </div>
          <div class="content">
            <p>Hello ${attendeeName},</p>
            <p>You have been invited to the following event:</p>
            
            <div class="event-details">
              <div class="detail-row">
                <span class="label">Event:</span> ${title}
              </div>
              ${description ? `
              <div class="detail-row">
                <span class="label">Description:</span> ${description}
              </div>` : ''}
              ${location ? `
              <div class="detail-row">
                <span class="label">Location:</span> ${location}
              </div>` : ''}
              <div class="detail-row">
                <span class="label">Start:</span> ${formattedStart}
              </div>
              <div class="detail-row">
                <span class="label">End:</span> ${formattedEnd}
              </div>
              <div class="detail-row">
                <span class="label">Organizer:</span> ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}
              </div>
            </div>
            
            <p>The event details are attached in an iCalendar file that you can import into your calendar application.</p>
          </div>
          <div class="footer">
            <p>This invitation was sent using CalDAV Calendar Application.</p>
          </div>
        </div>
      </body>
    </html>
    `;

    // Prepare the email
    const mailOptions = {
      from: {
        name: this.config.fromName || 'Calendar Application',
        address: this.config.fromEmail
      },
      to: attendee.name 
        ? `"${attendee.name}" <${attendee.email}>`
        : attendee.email,
      subject: `Invitation: ${title}`,
      html: htmlContent,
      text: `Hello ${attendeeName},\n\nYou have been invited to the following event:\n\nEvent: ${title}\n${description ? `Description: ${description}\n` : ''}${location ? `Location: ${location}\n` : ''}Start: ${formattedStart}\nEnd: ${formattedEnd}\nOrganizer: ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}\n\nThe event details are attached in an iCalendar file that you can import into your calendar application.\n\nThis invitation was sent using CalDAV Calendar Application.`,
      attachments: [
        {
          filename: `invitation-${data.uid}.ics`,
          content: icsData,
          contentType: 'text/calendar; method=REQUEST'
        }
      ]
      // Removed the global headers that were causing the whole email to be treated as calendar data
    };

    // Send the email
    return this.transporter.sendMail(mailOptions);
  }

  /**
   * Send a test email to verify SMTP configuration
   * @param recipientEmail The email address to send the test to
   * @returns Promise resolving to the send info
   */
  async sendTestEmail(recipientEmail: string): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      if (!this.transporter || !this.config) {
        throw new Error('Email service not initialized');
      }

      // Create the email content
      const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px 5px 0 0; }
            .header h2 { margin: 0; color: #333; }
            .content { padding: 20px 15px; }
            .footer { font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>SMTP Test Email</h2>
            </div>
            <div class="content">
              <p>This is a test email to verify your SMTP configuration.</p>
              <p>If you're receiving this email, your SMTP settings are working correctly!</p>
              <p>You can now use email notifications and calendar invitations in the CalDAV Calendar Application.</p>
            </div>
            <div class="footer">
              <p>Sent from CalDAV Calendar Application</p>
              <p>Configuration: ${this.config.host}:${this.config.port} (${this.config.secure ? 'Secure' : 'Unsecure'})</p>
            </div>
          </div>
        </body>
      </html>
      `;

      const plainText = `This is a test email to verify your SMTP configuration.
If you're receiving this email, your SMTP settings are working correctly!
You can now use email notifications and calendar invitations in the CalDAV Calendar Application.

Sent from CalDAV Calendar Application
Configuration: ${this.config.host}:${this.config.port} (${this.config.secure ? 'Secure' : 'Unsecure'})`;

      // Prepare the email
      const mailOptions = {
        from: {
          name: this.config.fromName || 'Calendar Application',
          address: this.config.fromEmail
        },
        to: recipientEmail,
        subject: 'SMTP Configuration Test',
        html: htmlContent,
        text: plainText
      };

      // Send the email
      const info = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        message: 'Test email sent successfully',
        details: {
          messageId: info.messageId,
          response: info.response
        }
      };
    } catch (error) {
      console.error('Error sending test email:', error);
      return {
        success: false,
        message: `Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: error
      };
    }
  }

  /**
   * Generate an email preview for an event invitation
   * @param data Event invitation data
   * @returns HTML content for the email preview
   */
  public generateEmailPreview(data: EventInvitationData): string {
    const { title, description, location, startDate, endDate, organizer, attendees, resources } = data;
    
    // Get valid date objects for handling edge cases
    let validStartDate: Date;
    let validEndDate: Date;
    
    try {
      validStartDate = startDate instanceof Date ? startDate : new Date(startDate);
      validEndDate = endDate instanceof Date ? endDate : new Date(endDate);
      
      // Check for invalid dates and use fallbacks
      if (isNaN(validStartDate.getTime())) {
        console.warn("Invalid start date in email preview, using current time");
        validStartDate = new Date();
      }
      
      if (isNaN(validEndDate.getTime())) {
        console.warn("Invalid end date in email preview, using start time + 1 hour");
        validEndDate = new Date(validStartDate);
        validEndDate.setHours(validEndDate.getHours() + 1);
      }
    } catch (error) {
      console.warn("Error parsing dates for email preview:", error);
      validStartDate = new Date();
      validEndDate = new Date();
      validEndDate.setHours(validEndDate.getHours() + 1);
    }
    
    // Format the date for display in email
    const dateFormat = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    });
    
    const formattedStart = dateFormat.format(validStartDate);
    const formattedEnd = dateFormat.format(validEndDate);
    
    // Create the email content similar to what we'd send
    const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px 5px 0 0; }
          .header h2 { margin: 0; color: #333; }
          .content { padding: 20px 15px; }
          .event-details { margin-bottom: 20px; }
          .detail-row { margin-bottom: 10px; }
          .label { font-weight: bold; display: inline-block; width: 100px; vertical-align: top; }
          .footer { font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; }
          .preview-note { background-color: #fff3cd; padding: 10px; border-radius: 5px; margin-bottom: 20px; border: 1px solid #ffeeba; }
          .attendees-list { margin-top: 15px; }
          .attendee-item { margin-bottom: 5px; }
          
          /* Rich text styling */
          .description-container { display: flex; align-items: start; }
          .description-content { 
            display: inline-block; 
            margin-left: 10px; 
            max-width: 450px; 
          }
          .description-content p { margin-top: 0; margin-bottom: 0.5rem; }
          .description-content strong, .description-content b { font-weight: bold; }
          .description-content em, .description-content i { font-style: italic; }
          .description-content ul { list-style-type: disc; margin-left: 20px; padding-left: 0; }
          .description-content ol { list-style-type: decimal; margin-left: 20px; padding-left: 0; }
          .description-content a { color: #0066cc; text-decoration: underline; }
          .description-content h1, .description-content h2, .description-content h3 { 
            font-weight: bold; 
            margin-top: 0.5rem;
            margin-bottom: 0.5rem; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="preview-note">
            <strong>Email Preview:</strong> This is how your invitation will appear to recipients. No emails have been sent yet.
          </div>
          
          <div class="header">
            <h2>Calendar Invitation</h2>
          </div>
          
          <div class="content">
            <p>Hello [Recipient],</p>
            <p>You have been invited to the following event:</p>
            
            <div class="event-details">
              <div class="detail-row">
                <span class="label">Event:</span> ${title}
              </div>
              ${description ? `
              <div class="detail-row">
                <span class="label">Description:</span>
                <div class="description-content">${description}</div>
              </div>` : ''}
              ${location ? `
              <div class="detail-row">
                <span class="label">Location:</span> ${location}
              </div>` : ''}
              <div class="detail-row">
                <span class="label">Start:</span> ${formattedStart}
              </div>
              <div class="detail-row">
                <span class="label">End:</span> ${formattedEnd}
              </div>
              <div class="detail-row">
                <span class="label">Organizer:</span> ${organizer ? (organizer.name || organizer.email) : 'Unknown'}
              </div>
              
              <div class="detail-row">
                <span class="label">Attendees:</span> 
                <div class="attendees-list">
                  ${attendees && attendees.length > 0 ? attendees.map(attendee => `
                    <div class="attendee-item">
                      ${attendee.name ? `${attendee.name} (${attendee.email})` : attendee.email} 
                      - Role: ${attendee.role || 'Participant'}
                    </div>
                  `).join('') : '<div class="attendee-item">No attendees</div>'}
                </div>
              </div>
              
              ${resources && resources.length > 0 ? `
              <div class="detail-row">
                <span class="label">Resources:</span> 
                <div class="resources-list">
                  ${resources.map((resource: Resource) => `
                    <div class="resource-item">
                      ${resource.subType} (Capacity: ${resource.capacity !== undefined ? resource.capacity : 'Not specified'}) 
                      ${resource.remarks ? `<br><em>Notes: ${resource.remarks}</em>` : ''}
                      <br>Admin: ${resource.adminName || resource.adminEmail}
                    </div>
                  `).join('')}
                </div>
              </div>
              ` : ''}
            </div>
            
            <p>The event details will be attached in an iCalendar file that recipients can import into their calendar application.</p>
          </div>
          
          <div class="footer">
            <p>This invitation will be sent using CalDAV Calendar Application.</p>
            <p>SMTP Server: ${this.config?.host || 'No SMTP server configured'}</p>
            <p>From: ${this.config?.fromName ? `${this.config.fromName} <${this.config.fromEmail}>` : this.config?.fromEmail || 'Email not configured'}</p>
          </div>
        </div>
      </body>
    </html>
    `;
    
    return htmlContent;
  }

  /**
   * Generate ICS data for calendar invitations
   * @param data Event data
   * @returns ICS formatted string
   */
  /**
   * Send cancellation notices to all attendees for a cancelled event
   * @param userId The user ID sending the cancellation
   * @param data Event data with cancellation status
   * @returns A result object with success status and details
   */
  async sendEventCancellation(
    userId: number,
    data: EventInvitationData
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // Initialize email service if not already initialized
      if (!this.transporter || !this.config || this.config.userId !== userId) {
        const initSuccess = await this.initialize(userId);
        if (!initSuccess) {
          return {
            success: false,
            message: 'Failed to initialize email service. Please check your SMTP configuration.'
          };
        }
      }

      // Generate ICS data with CANCELLED status
      const icsData = this.generateICSData(data);

      // Send email to each attendee
      const sendPromises = data.attendees.map(attendee => {
        return this.sendCancellationEmail(data, attendee, icsData);
      });

      // Wait for all emails to be sent
      const results = await Promise.allSettled(sendPromises);
      
      // Count successful deliveries
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      // Detailed results for debugging
      const detailedResults = results.map((result, index) => {
        return {
          attendee: data.attendees[index].email,
          success: result.status === 'fulfilled',
          details: result.status === 'rejected' ? (result as PromiseRejectedResult).reason : undefined
        };
      });

      if (failed > 0) {
        return {
          success: successful > 0, // Consider partially successful if at least one email was sent
          message: `Sent cancellation notices to ${successful} out of ${data.attendees.length} attendees.`,
          details: detailedResults
        };
      }

      return {
        success: true,
        message: `Successfully sent cancellation notices to all ${successful} attendees.`,
        details: detailedResults
      };
    } catch (error) {
      console.error('Error sending event cancellations:', error);
      return {
        success: false,
        message: `Failed to send cancellations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: error
      };
    }
  }

  /**
   * Send a cancellation email to an attendee
   * @param data Event data
   * @param attendee Attendee information
   * @param icsData The ICS calendar data with CANCEL method
   * @returns Promise resolving to the send info
   */
  private async sendCancellationEmail(
    data: EventInvitationData,
    attendee: Attendee,
    icsData: string
  ): Promise<nodemailer.SentMessageInfo> {
    if (!this.transporter || !this.config) {
      throw new Error('Email service not initialized');
    }

    const { startDate, endDate, title, description, location } = data;
    
    // Format the date for display in email
    const dateFormat = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    });
    
    const formattedStart = dateFormat.format(startDate);
    const formattedEnd = dateFormat.format(endDate);
    
    // Create a more readable display name for the attendee
    const attendeeName = attendee.name || attendee.email.split('@')[0];
    
    // Create the email content for cancellation
    const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px 5px 0 0; }
          .header h2 { margin: 0; color: #333; }
          .content { padding: 20px 15px; }
          .cancelled-banner { background-color: #ffeeee; color: #990000; padding: 10px; border-radius: 5px; margin-bottom: 20px; text-align: center; font-weight: bold; }
          .event-details { margin-bottom: 20px; }
          .detail-row { margin-bottom: 10px; }
          .label { font-weight: bold; display: inline-block; width: 100px; vertical-align: top; }
          .footer { font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; }
          
          /* Rich text styling */
          .description-container { display: flex; align-items: start; }
          .description-content { 
            display: inline-block; 
            margin-left: 10px; 
            max-width: 450px; 
          }
          .description-content p { margin-top: 0; margin-bottom: 0.5rem; }
          .description-content strong, .description-content b { font-weight: bold; }
          .description-content em, .description-content i { font-style: italic; }
          .description-content ul { list-style-type: disc; margin-left: 20px; padding-left: 0; }
          .description-content ol { list-style-type: decimal; margin-left: 20px; padding-left: 0; }
          .description-content a { color: #0066cc; text-decoration: underline; }
          .description-content h1, .description-content h2, .description-content h3 { 
            font-weight: bold; 
            margin-top: 0.5rem;
            margin-bottom: 0.5rem; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Event Cancellation</h2>
          </div>
          <div class="content">
            <div class="cancelled-banner">THIS EVENT HAS BEEN CANCELLED</div>
            
            <p>Hello ${attendeeName},</p>
            <p>The following event has been <strong>cancelled</strong>:</p>
            
            <div class="event-details">
              <div class="detail-row">
                <span class="label">Event:</span> ${title}
              </div>
              ${description ? `
              <div class="detail-row">
                <span class="label">Description:</span>
                <div class="description-content">${description}</div>
              </div>` : ''}
              ${location ? `
              <div class="detail-row">
                <span class="label">Location:</span> ${location}
              </div>` : ''}
              <div class="detail-row">
                <span class="label">Start:</span> ${formattedStart}
              </div>
              <div class="detail-row">
                <span class="label">End:</span> ${formattedEnd}
              </div>
              <div class="detail-row">
                <span class="label">Organizer:</span> ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}
              </div>
            </div>
            
            <p>Your calendar will be updated automatically if you previously accepted this invitation.</p>
          </div>
          <div class="footer">
            <p>This cancellation notice was sent using CalDAV Calendar Application.</p>
          </div>
        </div>
      </body>
    </html>
    `;

    // Prepare the cancellation email
    const mailOptions = {
      from: {
        name: this.config.fromName || 'Calendar Application',
        address: this.config.fromEmail
      },
      to: attendee.name
        ? `"${attendee.name}" <${attendee.email}>`
        : attendee.email,
      subject: `Cancelled: ${title}`,
      html: htmlContent,
      text: `CANCELLED EVENT\n\nHello ${attendeeName},\n\nThe following event has been CANCELLED:\n\nEvent: ${title}\n${description ? `Description: ${description}\n` : ''}${location ? `Location: ${location}\n` : ''}Start: ${formattedStart}\nEnd: ${formattedEnd}\nOrganizer: ${data.organizer ? (data.organizer.name || data.organizer.email) : "Unknown"}\n\nYour calendar will be updated automatically if you previously accepted this invitation.\n\nThis cancellation notice was sent using CalDAV Calendar Application.`,
      attachments: [
        {
          filename: `cancellation-${data.uid}.ics`,
          content: icsData,
          contentType: 'text/calendar; method=CANCEL'
        }
      ]
    };

    // Send the email
    return this.transporter.sendMail(mailOptions);
  }

  public generateICSData(data: EventInvitationData): string {
    const { uid, title, description, location, startDate, endDate, organizer, attendees, resources, status } = data;
    
    // Format dates for iCalendar
    const startDateStr = formatICalDate(startDate);
    const endDateStr = formatICalDate(endDate);
    const now = formatICalDate(new Date());
    
    // Generate unique identifier for the event
    const eventId = uid || `event-${Date.now()}@caldav-app`;
    
    // Start building the ICS content
    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CalDAV Calendar Application//EN',
      'CALSCALE:GREGORIAN',
      // Use REQUEST method for invitations and CANCEL method for cancellations
      `METHOD:${status === 'CANCELLED' ? 'CANCEL' : 'REQUEST'}`,
      'BEGIN:VEVENT',
      `UID:${eventId}`,
      `DTSTAMP:${now}`,
      `DTSTART:${startDateStr}`,
      `DTEND:${endDateStr}`,
      `SUMMARY:${title}`,
    ];
    
    // Add STATUS field for cancellations
    if (status === 'CANCELLED') {
      icsContent.push('STATUS:CANCELLED');
      icsContent.push('TRANSP:TRANSPARENT');
    }
    
    // Add optional fields if they exist
    if (description) icsContent.push(`DESCRIPTION:${description.replace(/\\n/g, '\\n')}`);
    if (location) icsContent.push(`LOCATION:${location}`);
    
    // Add organizer if exists
    if (organizer && organizer.email) {
      icsContent.push(`ORGANIZER;CN=${organizer.name || organizer.email}:mailto:${organizer.email}`);
    }
    
    // Handle recurrence rules if present
    interface RecurrenceRule {
      pattern: string;
      interval?: number;
      weekdays?: string[];
      endType?: string;
      occurrences?: number;
      untilDate?: string;
    }
    
    if (data.recurrenceRule) {
      console.log('Adding recurrence rule to ICS:', data.recurrenceRule);
      
      try {
        let rule: RecurrenceRule | null = null;
        
        // If recurrenceRule is a string, try to parse it
        if (typeof data.recurrenceRule === 'string') {
          // Check if it's already a formatted RRULE string
          if (data.recurrenceRule.startsWith('RRULE:')) {
            icsContent.push(data.recurrenceRule);
          } else {
            try {
              // Try to parse as JSON
              rule = JSON.parse(data.recurrenceRule);
            } catch (e) {
              // If not valid JSON, just use as plain text with RRULE: prefix
              icsContent.push(`RRULE:${data.recurrenceRule}`);
            }
          }
        } else if (data.recurrenceRule && typeof data.recurrenceRule === 'object') {
          // It's already an object
          rule = data.recurrenceRule as unknown as RecurrenceRule;
        }
        
        // If we have a valid rule object, convert it to RRULE format
        if (rule && rule.pattern) {
          let rruleString = 'RRULE:';
          
          // Convert pattern to FREQ
          switch (rule.pattern.toLowerCase()) {
            case 'daily':
              rruleString += 'FREQ=DAILY';
              break;
            case 'weekly':
              rruleString += 'FREQ=WEEKLY';
              break;
            case 'monthly':
              rruleString += 'FREQ=MONTHLY';
              break;
            case 'yearly':
              rruleString += 'FREQ=YEARLY';
              break;
            default:
              rruleString += `FREQ=${rule.pattern.toUpperCase()}`;
          }
          
          // Add interval if specified
          if (rule.interval && rule.interval > 1) {
            rruleString += `;INTERVAL=${rule.interval}`;
          }
          
          // Add weekdays for weekly recurrence
          if (rule.weekdays && rule.weekdays.length > 0 && rule.pattern.toLowerCase() === 'weekly') {
            const dayMap: Record<string, string> = {
              'sunday': 'SU', 'monday': 'MO', 'tuesday': 'TU', 'wednesday': 'WE',
              'thursday': 'TH', 'friday': 'FR', 'saturday': 'SA'
            };
            
            const byDays = rule.weekdays
              .map(day => dayMap[day.toLowerCase()] || day)
              .join(',');
            
            if (byDays) {
              rruleString += `;BYDAY=${byDays}`;
            }
          }
          
          // Add count or until based on end type
          if (rule.endType === 'After' && rule.occurrences) {
            rruleString += `;COUNT=${rule.occurrences}`;
          } else if (rule.endType === 'Until' && rule.untilDate) {
            try {
              // Format the date as required for UNTIL (YYYYMMDDTHHMMSSZ)
              const untilDate = new Date(rule.untilDate);
              const formattedUntil = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
              rruleString += `;UNTIL=${formattedUntil}`;
            } catch (e) {
              console.error("Error formatting UNTIL date:", e);
            }
          }
          
          console.log("Adding RRULE to ICS:", rruleString);
          icsContent.push(rruleString);
        }
      } catch (error) {
        console.error('Error processing recurrence rule for ICS:', error);
      }
    }
    
    // Add human attendees if they exist
    if (attendees && Array.isArray(attendees) && attendees.length > 0) {
      attendees.forEach(attendee => {
        if (attendee && attendee.email) {
          let attendeeStr = `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=${attendee.role || 'REQ-PARTICIPANT'};PARTSTAT=${attendee.status || 'NEEDS-ACTION'};CN=${attendee.name || attendee.email}:mailto:${attendee.email}`;
          icsContent.push(attendeeStr);
        }
      });
    }
    
    // Add resource attendees if they exist
    if (resources && Array.isArray(resources) && resources.length > 0) {
      resources.forEach(resource => {
        let resourceStr = `ATTENDEE;CUTYPE=RESOURCE;CN=${resource.subType};ROLE=NON-PARTICIPANT;RSVP=FALSE`;
        
        // Add capacity if specified
        if (resource.capacity !== undefined) {
          resourceStr += `;X-CAPACITY=${resource.capacity}`;
        }
        
        // Add remarks if specified (properly escape for iCalendar format)
        if (resource.remarks) {
          // Escape special characters according to iCalendar spec
          const escapedRemarks = resource.remarks
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
          
          resourceStr += `;X-REMARKS="${escapedRemarks}"`;
        }
        
        // Add the email as mailto
        resourceStr += `:mailto:${resource.adminEmail}`;
        
        icsContent.push(resourceStr);
      });
    }
    
    // Close the event and calendar
    icsContent.push(
      'END:VEVENT',
      'END:VCALENDAR'
    );
    
    return icsContent.join('\r\n');
  }
}

// Create a singleton instance of the email service
export const emailService = new EmailService();