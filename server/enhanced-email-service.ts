/**
 * Enhanced Email Service With UID Enforcement
 * 
 * This version of the email service ensures that events have proper UIDs
 * by checking for their existence before generating emails.
 */

import nodemailer from 'nodemailer';
import { formatRFC5545Event } from '../shared/rfc5545-compliant-formatter';
import { storage } from './storage';
import path from 'path';
import fs from 'fs';

// Email configuration
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

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
  resources?: Resource[];
  icsData?: string;
  status?: string;
  recurrenceRule?: string | object;
  rawData?: string;
  sequence?: number;
  _originalResourceAttendees?: string[];
  calendarId?: number;
  method?: string; // Added to support explicit METHOD in ICS
}

export interface EmailResult {
  success: boolean;
  message: string;
  error?: any;
  icsData?: string;
  htmlContent?: string;
}

export class EnhancedEmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: SmtpConfig | null = null;
  private initialized = false;

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    try {
      const configPath = path.resolve('config', 'email-config.json');
      if (fs.existsSync(configPath)) {
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.initialized = this.initTransporter();
      } else {
        console.log('Email config file not found, email service not initialized');
      }
    } catch (error) {
      console.error('Error loading email configuration:', error);
    }
  }

  private initTransporter(): boolean {
    try {
      if (!this.config) {
        console.log('No email configuration available, cannot initialize transporter');
        return false;
      }

      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth
      });

      return true;
    } catch (error) {
      console.error('Error initializing email transporter:', error);
      return false;
    }
  }

  /**
   * Validate that the event has a proper UID
   * This is critical for ensuring event lifecycle integrity
   */
  private validateEventUID(data: EventInvitationData): void {
    if (!data.uid) {
      throw new Error('Event UID is required for sending emails. Event ID: ' + data.eventId);
    }
    
    // UID should conform to RFC 5545 format
    const uidRegex = /^[a-zA-Z0-9._-]+-[0-9]+-[a-zA-Z0-9]+(@[a-zA-Z0-9.-]+)?$/;
    if (!uidRegex.test(data.uid)) {
      throw new Error(`Invalid UID format: ${data.uid}. UIDs must follow RFC 5545 format.`);
    }
  }

  /**
   * Update or configure the email service
   */
  public updateConfig(config: SmtpConfig): boolean {
    this.config = config;
    this.initialized = this.initTransporter();
    
    try {
      const configPath = path.resolve('config');
      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(configPath, { recursive: true });
      }
      
      fs.writeFileSync(
        path.resolve(configPath, 'email-config.json'),
        JSON.stringify(config, null, 2)
      );
      
      return this.initialized;
    } catch (error) {
      console.error('Error updating email configuration:', error);
      return false;
    }
  }

  /**
   * Get the current email configuration
   */
  public getConfig(): SmtpConfig | null {
    return this.config;
  }

  /**
   * Check if the email service is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Generate ICS data for an event
   * This uses the RFC 5545 compliant formatter
   */
  public generateICSData(data: EventInvitationData): string {
    // Validate UID before proceeding
    this.validateEventUID(data);
    
    try {
      // If we have pre-generated ICS data, use it
      if (data.icsData) {
        return data.icsData;
      }
      
      // Otherwise, generate compliant ICS using our formatter
      return formatRFC5545Event(data);
    } catch (error) {
      console.error('Error generating ICS data:', error);
      throw error;
    }
  }

  /**
   * Send an event invitation email
   */
  public async sendEventInvitation(
    userId: number,
    data: EventInvitationData
  ): Promise<EmailResult> {
    // Check if email service is initialized
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service is not initialized'
      };
    }

    try {
      // Validate the UID
      this.validateEventUID(data);
      
      // Check if the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          message: `User with ID ${userId} not found`
        };
      }

      // Generate the ICS data
      const icsData = this.generateICSData({
        ...data,
        method: 'REQUEST'  // Explicitly set METHOD:REQUEST for invitations
      });
      
      // Generate HTML content for the email
      const htmlContent = this.generateInvitationEmailContent(data);
      
      // Customize the subject based on event status
      let subject = `Invitation: ${data.title}`;
      
      // Send to each attendee
      for (const attendee of data.attendees) {
        if (!attendee.email) continue;
        
        await this.transporter?.sendMail({
          from: this.config?.from || user.email || 'noreply@example.com',
          to: attendee.email,
          subject,
          html: htmlContent,
          attachments: [
            {
              filename: 'event.ics',
              content: icsData,
              contentType: 'text/calendar'
            }
          ]
        });
      }

      // Also send to resource administrators if applicable
      if (data.resources) {
        for (const resource of data.resources) {
          if (resource.adminEmail) {
            await this.transporter?.sendMail({
              from: this.config?.from || user.email || 'noreply@example.com',
              to: resource.adminEmail,
              subject: `Resource Request: ${data.title}`,
              html: this.generateResourceRequestEmailContent(data, resource),
              attachments: [
                {
                  filename: 'event.ics',
                  content: icsData,
                  contentType: 'text/calendar'
                }
              ]
            });
          }
        }
      }

      return {
        success: true,
        message: 'Event invitation sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event invitation:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error sending invitation',
        error
      };
    }
  }

  /**
   * Send an event cancellation email
   */
  public async sendEventCancellation(
    userId: number,
    data: EventInvitationData
  ): Promise<EmailResult> {
    // Check if email service is initialized
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service is not initialized'
      };
    }

    try {
      // Validate the UID
      this.validateEventUID(data);
      
      // Check if the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          message: `User with ID ${userId} not found`
        };
      }

      // Ensure status is set to CANCELLED
      const cancellationData = {
        ...data,
        status: 'CANCELLED',
        method: 'CANCEL'  // Explicitly set METHOD:CANCEL for cancellations
      };
      
      // Generate the ICS data with cancellation status
      const icsData = this.generateICSData(cancellationData);
      
      // Generate HTML content for the email
      const htmlContent = this.generateCancellationEmailContent(cancellationData);
      
      // Send to each attendee
      for (const attendee of data.attendees) {
        if (!attendee.email) continue;
        
        await this.transporter?.sendMail({
          from: this.config?.from || user.email || 'noreply@example.com',
          to: attendee.email,
          subject: `Cancelled: ${data.title}`,
          html: htmlContent,
          attachments: [
            {
              filename: 'event-cancellation.ics',
              content: icsData,
              contentType: 'text/calendar'
            }
          ]
        });
      }

      // Also send to resource administrators if applicable
      if (data.resources) {
        for (const resource of data.resources) {
          if (resource.adminEmail) {
            await this.transporter?.sendMail({
              from: this.config?.from || user.email || 'noreply@example.com',
              to: resource.adminEmail,
              subject: `Resource Reservation Cancelled: ${data.title}`,
              html: this.generateResourceCancellationEmailContent(cancellationData, resource),
              attachments: [
                {
                  filename: 'event-cancellation.ics',
                  content: icsData,
                  contentType: 'text/calendar'
                }
              ]
            });
          }
        }
      }

      return {
        success: true,
        message: 'Event cancellation sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event cancellation:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error sending cancellation',
        error
      };
    }
  }

  /**
   * Send an event update email
   */
  public async sendEventUpdate(
    userId: number,
    data: EventInvitationData
  ): Promise<EmailResult> {
    // Check if email service is initialized
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service is not initialized'
      };
    }

    try {
      // Validate the UID
      this.validateEventUID(data);
      
      // Check if the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          message: `User with ID ${userId} not found`
        };
      }

      // Make sure the event has a sequence number and increment it
      const updateData = {
        ...data,
        sequence: (data.sequence ?? 0) + 1,
        method: 'REQUEST'  // Use METHOD:REQUEST for updates as per RFC 5546
      };
      
      // Generate the ICS data with updated sequence
      const icsData = this.generateICSData(updateData);
      
      // Generate HTML content for the email
      const htmlContent = this.generateUpdateEmailContent(updateData);
      
      // Send to each attendee
      for (const attendee of data.attendees) {
        if (!attendee.email) continue;
        
        await this.transporter?.sendMail({
          from: this.config?.from || user.email || 'noreply@example.com',
          to: attendee.email,
          subject: `Updated: ${data.title}`,
          html: htmlContent,
          attachments: [
            {
              filename: 'event-update.ics',
              content: icsData,
              contentType: 'text/calendar'
            }
          ]
        });
      }

      // Also send to resource administrators if applicable
      if (data.resources) {
        for (const resource of data.resources) {
          if (resource.adminEmail) {
            await this.transporter?.sendMail({
              from: this.config?.from || user.email || 'noreply@example.com',
              to: resource.adminEmail,
              subject: `Resource Reservation Updated: ${data.title}`,
              html: this.generateResourceUpdateEmailContent(updateData, resource),
              attachments: [
                {
                  filename: 'event-update.ics',
                  content: icsData,
                  contentType: 'text/calendar'
                }
              ]
            });
          }
        }
      }

      return {
        success: true,
        message: 'Event update sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event update:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error sending update',
        error
      };
    }
  }

  /**
   * Generate an email preview without sending
   */
  public async generateEmailPreview(
    userId: number,
    data: EventInvitationData,
    type: 'invitation' | 'update' | 'cancellation' = 'invitation'
  ): Promise<EmailResult> {
    try {
      // Validate the UID
      this.validateEventUID(data);
      
      // Check if the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          message: `User with ID ${userId} not found`
        };
      }

      let icsData: string;
      let htmlContent: string;
      
      // Process based on the type
      if (type === 'cancellation') {
        const cancellationData = {
          ...data,
          status: 'CANCELLED',
          method: 'CANCEL'
        };
        icsData = this.generateICSData(cancellationData);
        htmlContent = this.generateCancellationEmailContent(cancellationData);
      } else if (type === 'update') {
        const updateData = {
          ...data,
          sequence: (data.sequence ?? 0) + 1,
          method: 'REQUEST'
        };
        icsData = this.generateICSData(updateData);
        htmlContent = this.generateUpdateEmailContent(updateData);
      } else {
        // Default to invitation
        const invitationData = {
          ...data,
          method: 'REQUEST'
        };
        icsData = this.generateICSData(invitationData);
        htmlContent = this.generateInvitationEmailContent(invitationData);
      }

      return {
        success: true,
        message: `Email preview generated successfully for ${type}`,
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error(`Error generating ${type} email preview:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : `Unknown error generating ${type} preview`,
        error
      };
    }
  }

  /**
   * Generate HTML content for an invitation email
   */
  private generateInvitationEmailContent(data: EventInvitationData): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">${data.title}</h1>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="margin: 5px 0;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          ${data.location ? `<p style="margin: 5px 0;"><strong>Where:</strong> ${data.location}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
          
          ${data.attendees.length > 0 ? `
            <p style="margin: 15px 0 5px;"><strong>Attendees:</strong></p>
            <ul style="margin: 5px 0; padding-left: 25px;">
              ${data.attendees.map(att => `<li>${att.name || att.email}</li>`).join('')}
            </ul>
          ` : ''}
          
          ${data.resources && data.resources.length > 0 ? `
            <p style="margin: 15px 0 5px;"><strong>Resources:</strong></p>
            <ul style="margin: 5px 0; padding-left: 25px;">
              ${data.resources.map(res => `<li>${res.name || res.displayName || res.id} (${res.subType || res.type})</li>`).join('')}
            </ul>
          ` : ''}
        </div>
        
        ${data.description ? `
          <div style="margin-top: 20px;">
            <h2 style="color: #555; font-size: 18px; margin-bottom: 10px;">Description</h2>
            <div style="line-height: 1.5;">${data.description}</div>
          </div>
        ` : ''}
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This invitation was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file can be imported into your calendar application.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a cancellation email
   */
  private generateCancellationEmailContent(data: EventInvitationData): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #d9534f; font-size: 24px; margin-bottom: 20px;">CANCELLED: ${data.title}</h1>
        
        <div style="background-color: #f9f2f2; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #d9534f;">
          <p style="margin: 5px 0;"><strong>Event has been cancelled</strong></p>
          <p style="margin: 15px 0 5px;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          ${data.location ? `<p style="margin: 5px 0;"><strong>Where:</strong> ${data.location}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This cancellation was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file will automatically update your calendar.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for an update email
   */
  private generateUpdateEmailContent(data: EventInvitationData): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #5bc0de; font-size: 24px; margin-bottom: 20px;">UPDATED: ${data.title}</h1>
        
        <div style="background-color: #f0f9fc; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #5bc0de;">
          <p style="margin: 5px 0;"><strong>Event has been updated</strong> (Sequence: ${data.sequence})</p>
          <p style="margin: 15px 0 5px;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          ${data.location ? `<p style="margin: 5px 0;"><strong>Where:</strong> ${data.location}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
          
          ${data.attendees.length > 0 ? `
            <p style="margin: 15px 0 5px;"><strong>Attendees:</strong></p>
            <ul style="margin: 5px 0; padding-left: 25px;">
              ${data.attendees.map(att => `<li>${att.name || att.email}</li>`).join('')}
            </ul>
          ` : ''}
          
          ${data.resources && data.resources.length > 0 ? `
            <p style="margin: 15px 0 5px;"><strong>Resources:</strong></p>
            <ul style="margin: 5px 0; padding-left: 25px;">
              ${data.resources.map(res => `<li>${res.name || res.displayName || res.id} (${res.subType || res.type})</li>`).join('')}
            </ul>
          ` : ''}
        </div>
        
        ${data.description ? `
          <div style="margin-top: 20px;">
            <h2 style="color: #555; font-size: 18px; margin-bottom: 10px;">Description</h2>
            <div style="line-height: 1.5;">${data.description}</div>
          </div>
        ` : ''}
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This update was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file will automatically update your calendar.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource request email
   */
  private generateResourceRequestEmailContent(data: EventInvitationData, resource: Resource): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Resource Request: ${data.title}</h1>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="margin: 5px 0;"><strong>Resource:</strong> ${resource.name || resource.displayName || resource.id} (${resource.subType || resource.type})</p>
          <p style="margin: 5px 0;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          ${data.location ? `<p style="margin: 5px 0;"><strong>Where:</strong> ${data.location}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        ${data.description ? `
          <div style="margin-top: 20px;">
            <h2 style="color: #555; font-size: 18px; margin-bottom: 10px;">Event Description</h2>
            <div style="line-height: 1.5;">${data.description}</div>
          </div>
        ` : ''}
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This resource request was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file contains the full event details.</p>
          ${resource.remarks ? `<p><strong>Resource Notes:</strong> ${resource.remarks}</p>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource cancellation email
   */
  private generateResourceCancellationEmailContent(data: EventInvitationData, resource: Resource): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #d9534f; font-size: 24px; margin-bottom: 20px;">Resource Reservation Cancelled</h1>
        
        <div style="background-color: #f9f2f2; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #d9534f;">
          <p style="margin: 5px 0;"><strong>Event has been cancelled</strong></p>
          <p style="margin: 5px 0;"><strong>Resource:</strong> ${resource.name || resource.displayName || resource.id} (${resource.subType || resource.type})</p>
          <p style="margin: 5px 0;"><strong>Event:</strong> ${data.title}</p>
          <p style="margin: 5px 0;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This cancellation was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file contains the cancelled event details.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource update email
   */
  private generateResourceUpdateEmailContent(data: EventInvitationData, resource: Resource): string {
    const startFormatted = this.formatDateTimeForEmail(data.startDate);
    const endFormatted = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <h1 style="color: #5bc0de; font-size: 24px; margin-bottom: 20px;">Resource Reservation Updated</h1>
        
        <div style="background-color: #f0f9fc; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #5bc0de;">
          <p style="margin: 5px 0;"><strong>Event has been updated</strong> (Sequence: ${data.sequence})</p>
          <p style="margin: 5px 0;"><strong>Resource:</strong> ${resource.name || resource.displayName || resource.id} (${resource.subType || resource.type})</p>
          <p style="margin: 5px 0;"><strong>Event:</strong> ${data.title}</p>
          <p style="margin: 5px 0;"><strong>When:</strong> ${startFormatted} to ${endFormatted}</p>
          ${data.location ? `<p style="margin: 5px 0;"><strong>Where:</strong> ${data.location}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        ${data.description ? `
          <div style="margin-top: 20px;">
            <h2 style="color: #555; font-size: 18px; margin-bottom: 10px;">Event Description</h2>
            <div style="line-height: 1.5;">${data.description}</div>
          </div>
        ` : ''}
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; border-top: 1px solid #eaeaea; padding-top: 15px;">
          <p>This update was sent using CalDAV Client.</p>
          <p>The attached calendar (.ics) file contains the updated event details.</p>
          ${resource.remarks ? `<p><strong>Resource Notes:</strong> ${resource.remarks}</p>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Format a date and time for email display
   */
  private formatDateTimeForEmail(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }
}

// Create and export singleton instance
export const enhancedEmailService = new EnhancedEmailService();