/**
 * Enhanced Email Service With Central UID Service Integration
 * 
 * This version of the email service ensures that events have proper UIDs
 * by integrating with the Central UID Service to validate and retrieve
 * the correct UIDs before generating emails.
 */

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { validateICSData } from '../shared/rfc5545-compliant-formatter';
import { centralUIDService } from './central-uid-service';
import { 
  generateNewEventICS, 
  generateUpdatedEventICS, 
  generateCancelledEventICS 
} from '../shared/centralized-ics-service';

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
  private configPath = path.join(process.cwd(), 'email-config.json');

  constructor() {
    // Try to load config from file
    this.loadConfig();
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);
        
        if (this.initTransporter()) {
          this.initialized = true;
          console.log('Enhanced Email service initialized from config file');
        }
      } else {
        console.log('Enhanced Email config file not found');
      }
    } catch (error) {
      console.error('Error loading enhanced email config:', error);
    }
  }

  private initTransporter(): boolean {
    if (!this.config) {
      return false;
    }
    
    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.auth.user,
          pass: this.config.auth.pass
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error initializing enhanced email transporter:', error);
      return false;
    }
  }

  /**
   * Validate that the event has a proper UID
   * This is critical for ensuring event lifecycle integrity
   */
  private async validateEventUID(data: EventInvitationData): Promise<void> {
    if (!data.eventId) {
      throw new Error('Event must have an ID to validate UID');
    }
    
    try {
      // Use the central UID service to get the correct UID for this event
      const validUID = await centralUIDService.validateEventUID(data.eventId, data.uid);
      
      // Update the data with the validated UID (this might be different from what was passed in)
      data.uid = validUID;
      
      console.log(`[EnhancedEmailService] Validated UID ${validUID} for event ${data.eventId}`);
    } catch (error) {
      console.error('[EnhancedEmailService] Error validating event UID:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate event UID: ${errorMessage}`);
    }
  }

  /**
   * Update or configure the email service
   */
  public updateConfig(config: SmtpConfig): boolean {
    this.config = config;
    
    // Save to file for persistence
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving enhanced email config:', error);
    }
    
    if (this.initTransporter()) {
      this.initialized = true;
      return true;
    }
    
    return false;
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
   * This uses the centralized ICS generation service to ensure consistency
   */
  public generateICSData(data: EventInvitationData, preGeneratedICSData?: string): string {
    if (preGeneratedICSData) {
      console.log('Using pre-generated ICS data');
      
      // Still validate the pre-generated ICS data
      const validationResult = validateICSData(preGeneratedICSData);
      if (!validationResult.valid) {
        console.warn('Pre-generated ICS data has validation issues:', validationResult.errors);
      }
      
      return preGeneratedICSData;
    }
    
    console.log('Generating ICS data using centralized service');
    
    // Determine what type of ICS to generate based on the event's method or status
    const method = data.method || 'REQUEST';
    const status = data.status || 'CONFIRMED';
    
    let icsData: string;
    
    if (method === 'CANCEL' || status === 'CANCELLED') {
      icsData = generateCancelledEventICS(data, data.rawData || null);
    } else if ((data.sequence || 0) > 0) {
      // If sequence > 0, it's an update
      icsData = generateUpdatedEventICS(data, data.rawData || null);
    } else {
      // Otherwise it's a new event
      icsData = generateNewEventICS(data, data.rawData || null);
    }
    
    // Validate the generated ICS data
    const validationResult = validateICSData(icsData);
    if (!validationResult.valid) {
      console.warn('Generated ICS data has validation issues:', validationResult.errors);
    }
    
    return icsData;
  }

  /**
   * Send an event invitation email
   */
  public async sendEventInvitation(
    userId: number,
    data: EventInvitationData
  ): Promise<EmailResult> {
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service not initialized'
      };
    }

    try {
      // Ensure the event has a UID before sending emails
      await this.validateEventUID(data);
      
      // Default method for invitations is REQUEST
      const method = data.method || 'REQUEST';
      
      // Generate ICS data using the centralized ICS service
      const icsData = data.icsData || generateNewEventICS({
        ...data,
        method,
        sequence: data.sequence || 0
      }, data.rawData || null);
      
      // Extract UID from generated ICS data as a double-check
      const extractedUid = centralUIDService.extractUIDFromICS(icsData);
      if (extractedUid !== data.uid) {
        console.warn(`UID mismatch in generated ICS data. Expected: ${data.uid}, Got: ${extractedUid}`);
      }
      
      // Generate HTML content for the email
      const htmlContent = this.generateInvitationEmailContent(data);
      
      // Send emails to all attendees
      const sendPromises: Promise<any>[] = [];
      
      for (const attendee of data.attendees) {
        const mailOptions = {
          from: this.config?.from,
          to: attendee.email,
          subject: `Invitation: ${data.title}`,
          html: htmlContent,
          icalEvent: {
            filename: 'invite.ics',
            method,
            content: icsData
          }
        };
        
        if (this.transporter) {
          sendPromises.push(this.transporter.sendMail(mailOptions));
        }
      }
      
      // Send emails to resource admins if applicable
      if (data.resources && data.resources.length > 0) {
        for (const resource of data.resources) {
          const adminEmail = resource.adminEmail || resource.email;
          if (adminEmail) {
            const resourceHtml = this.generateResourceRequestEmailContent(data, resource);
            
            const resourceMailOptions = {
              from: this.config?.from,
              to: adminEmail,
              subject: `Resource Request: ${data.title}`,
              html: resourceHtml,
              icalEvent: {
                filename: 'resource_request.ics',
                method,
                content: icsData
              }
            };
            
            if (this.transporter) {
              sendPromises.push(this.transporter.sendMail(resourceMailOptions));
            }
          }
        }
      }
      
      if (sendPromises.length > 0) {
        await Promise.all(sendPromises);
      }
      
      return {
        success: true,
        message: 'Invitation emails sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event invitation emails:', error);
      return {
        success: false,
        message: `Failed to send invitation emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service not initialized'
      };
    }

    try {
      // Ensure the event has a UID before sending emails
      await this.validateEventUID(data);
      
      // Set the status to CANCELLED
      const cancelData = {
        ...data,
        status: 'CANCELLED',
        method: 'CANCEL',
        // Increment sequence for cancellation
        sequence: (data.sequence || 0) + 1
      };
      
      // Generate ICS data for the cancellation using the centralized ICS service
      const icsData = data.icsData || generateCancelledEventICS(cancelData, data.rawData || null);
      
      // Generate HTML content for the email
      const htmlContent = this.generateCancellationEmailContent(cancelData);
      
      // Send emails to all attendees
      const sendPromises: Promise<any>[] = [];
      
      for (const attendee of data.attendees) {
        const mailOptions = {
          from: this.config?.from,
          to: attendee.email,
          subject: `Cancelled: ${data.title}`,
          html: htmlContent,
          icalEvent: {
            filename: 'cancellation.ics',
            method: 'CANCEL',
            content: icsData
          }
        };
        
        if (this.transporter) {
          sendPromises.push(this.transporter.sendMail(mailOptions));
        }
      }
      
      // Send emails to resource admins if applicable
      if (data.resources && data.resources.length > 0) {
        for (const resource of data.resources) {
          const adminEmail = resource.adminEmail || resource.email;
          if (adminEmail) {
            const resourceHtml = this.generateResourceCancellationEmailContent(data, resource);
            
            const resourceMailOptions = {
              from: this.config?.from,
              to: adminEmail,
              subject: `Resource Cancellation: ${data.title}`,
              html: resourceHtml,
              icalEvent: {
                filename: 'resource_cancellation.ics',
                method: 'CANCEL',
                content: icsData
              }
            };
            
            if (this.transporter) {
              sendPromises.push(this.transporter.sendMail(resourceMailOptions));
            }
          }
        }
      }
      
      if (sendPromises.length > 0) {
        await Promise.all(sendPromises);
      }
      
      return {
        success: true,
        message: 'Cancellation emails sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event cancellation emails:', error);
      return {
        success: false,
        message: `Failed to send cancellation emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    if (!this.initialized) {
      return {
        success: false,
        message: 'Email service not initialized'
      };
    }

    try {
      // Ensure the event has a UID before sending emails
      await this.validateEventUID(data);
      
      // Set the method to REQUEST for updates
      const updateData = {
        ...data,
        method: 'REQUEST',
        // Increment sequence for updates
        sequence: (data.sequence || 0) + 1
      };
      
      // Generate ICS data for the update using the centralized ICS service
      const icsData = data.icsData || generateUpdatedEventICS(updateData, data.rawData || null);
      
      // Generate HTML content for the email
      const htmlContent = this.generateUpdateEmailContent(updateData);
      
      // Send emails to all attendees
      const sendPromises: Promise<any>[] = [];
      
      for (const attendee of data.attendees) {
        const mailOptions = {
          from: this.config?.from,
          to: attendee.email,
          subject: `Updated: ${data.title}`,
          html: htmlContent,
          icalEvent: {
            filename: 'update.ics',
            method: 'REQUEST',
            content: icsData
          }
        };
        
        if (this.transporter) {
          sendPromises.push(this.transporter.sendMail(mailOptions));
        }
      }
      
      // Send emails to resource admins if applicable
      if (data.resources && data.resources.length > 0) {
        for (const resource of data.resources) {
          const adminEmail = resource.adminEmail || resource.email;
          if (adminEmail) {
            const resourceHtml = this.generateResourceUpdateEmailContent(data, resource);
            
            const resourceMailOptions = {
              from: this.config?.from,
              to: adminEmail,
              subject: `Resource Update: ${data.title}`,
              html: resourceHtml,
              icalEvent: {
                filename: 'resource_update.ics',
                method: 'REQUEST',
                content: icsData
              }
            };
            
            if (this.transporter) {
              sendPromises.push(this.transporter.sendMail(resourceMailOptions));
            }
          }
        }
      }
      
      if (sendPromises.length > 0) {
        await Promise.all(sendPromises);
      }
      
      return {
        success: true,
        message: 'Update emails sent successfully',
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error('Error sending event update emails:', error);
      return {
        success: false,
        message: `Failed to send update emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      // Ensure the event has a UID before generating preview
      await this.validateEventUID(data);
      
      let icsData: string;
      let htmlContent: string;
      let method: string;
      
      switch (type) {
        case 'invitation':
          method = 'REQUEST';
          // Use centralized ICS service for invitation preview
          icsData = data.icsData || generateNewEventICS({
            ...data,
            method,
            sequence: data.sequence || 0
          }, data.rawData || null);
          htmlContent = this.generateInvitationEmailContent(data);
          break;
        case 'update':
          method = 'REQUEST';
          // Use centralized ICS service for update preview
          const updateData = {
            ...data,
            method,
            sequence: (data.sequence || 0) + 1
          };
          icsData = data.icsData || generateUpdatedEventICS(updateData, data.rawData || null);
          htmlContent = this.generateUpdateEmailContent(updateData);
          break;
        case 'cancellation':
          method = 'CANCEL';
          // Use centralized ICS service for cancellation preview
          const cancelData = {
            ...data,
            status: 'CANCELLED',
            method,
            sequence: (data.sequence || 0) + 1
          };
          icsData = data.icsData || generateCancelledEventICS(cancelData, data.rawData || null);
          htmlContent = this.generateCancellationEmailContent(cancelData);
          break;
        default:
          throw new Error('Invalid email preview type');
      }
      
      return {
        success: true,
        message: `${type} email preview generated successfully`,
        icsData,
        htmlContent
      };
    } catch (error) {
      console.error(`Error generating ${type} email preview:`, error);
      return {
        success: false,
        message: `Failed to generate ${type} email preview: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      };
    }
  }

  /**
   * Generate HTML content for an invitation email
   */
  private generateInvitationEmailContent(data: EventInvitationData): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #333;">Event Invitation: ${data.title}</h2>
        <p style="color: #666;">You have been invited to the following event:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>To accept or decline this invitation, please open the attached calendar invitation.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event is uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a cancellation email
   */
  private generateCancellationEmailContent(data: EventInvitationData): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #cc0000;">Event Cancelled: ${data.title}</h2>
        <p style="color: #666;">The following event has been cancelled:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; text-decoration: line-through;">
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>This event has been removed from your calendar.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event was uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for an update email
   */
  private generateUpdateEmailContent(data: EventInvitationData): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #0066cc;">Event Updated: ${data.title}</h2>
        <p style="color: #666;">The following event has been updated:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>Your calendar has been updated with these changes.</p>
          <p>To accept or decline this updated invitation, please open the attached calendar invitation.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event is uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource request email
   */
  private generateResourceRequestEmailContent(data: EventInvitationData, resource: Resource): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #333;">Resource Request: ${data.title}</h2>
        <p style="color: #666;">A resource you manage has been requested for the following event:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Resource:</strong> ${resource.name || resource.displayName || 'Unnamed Resource'} (${resource.subType || resource.type || 'Unknown Type'})</p>
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>To accept or decline this resource request, please open the attached calendar invitation.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event is uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource cancellation email
   */
  private generateResourceCancellationEmailContent(data: EventInvitationData, resource: Resource): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #cc0000;">Resource Cancellation: ${data.title}</h2>
        <p style="color: #666;">A resource you manage is no longer needed for the following cancelled event:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; text-decoration: line-through;">
          <p><strong>Resource:</strong> ${resource.name || resource.displayName || 'Unnamed Resource'} (${resource.subType || resource.type || 'Unknown Type'})</p>
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>This resource request has been removed from your calendar.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event was uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML content for a resource update email
   */
  private generateResourceUpdateEmailContent(data: EventInvitationData, resource: Resource): string {
    const startTime = this.formatDateTimeForEmail(data.startDate);
    const endTime = this.formatDateTimeForEmail(data.endDate);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #0066cc;">Resource Update: ${data.title}</h2>
        <p style="color: #666;">A resource you manage has been requested for an updated event:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Resource:</strong> ${resource.name || resource.displayName || 'Unnamed Resource'} (${resource.subType || resource.type || 'Unknown Type'})</p>
          <p><strong>When:</strong> ${startTime} - ${endTime}</p>
          ${data.location ? `<p><strong>Where:</strong> ${data.location}</p>` : ''}
          ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
          <p><strong>Organizer:</strong> ${data.organizer.name || data.organizer.email}</p>
        </div>
        
        <div style="margin-top: 20px;">
          <p>Your calendar has been updated with these changes.</p>
          <p>To accept or decline this updated resource request, please open the attached calendar invitation.</p>
        </div>
        
        <div style="margin-top: 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 10px;">
          <p>This event is uniquely identified as: ${data.uid}</p>
        </div>
      </div>
    `;
  }

  /**
   * Format a date and time for email display
   */
  private formatDateTimeForEmail(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    }).format(date);
  }
}

// Export a singleton instance
export const enhancedEmailService = new EnhancedEmailService();