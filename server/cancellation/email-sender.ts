/**
 * Cancellation Email Sender
 * 
 * Handles sending RFC 5546 compliant cancellation emails with proper ICS attachments
 * and triggers deletion of the event after emails are sent
 */

import nodemailer from 'nodemailer';
// Import core email types
import { emailService, EventInvitationData, Attendee } from '../email-service';
import { generateCancellationIcs, deleteEventAfterCancellation } from './cancellation-handler';
import { storage } from '../storage';

// Define SmtpConfig interface since it's not exported from email-service
interface SmtpConfig {
  fromEmail: string;
  fromName?: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  requireTLS?: boolean;
  enabled?: boolean;
}

/**
 * Sends cancellation emails to all attendees and then deletes the event
 * 
 * @param userId The ID of the user sending the cancellation
 * @param eventData Information about the event being cancelled
 * @param transporter The configured nodemailer transporter
 * @param config SMTP configuration
 */
export async function sendCancellationEmails(
  userId: number,
  eventData: EventInvitationData,
  transporter: nodemailer.Transporter,
  config: SmtpConfig
): Promise<boolean> {
  if (!eventData.attendees || eventData.attendees.length === 0) {
    console.warn('No attendees to send cancellation emails to');
    return false;
  }
  
  try {
    console.log(`=== SENDING CANCELLATION EMAILS FOR EVENT "${eventData.title}" ===`);
    
    // Generate the cancellation ICS data
    const cancellationIcs = generateCancellationIcs(eventData.rawData || '', eventData);
    
    // Keep track of successful sends
    const sentResults: boolean[] = [];
    
    // Send to each attendee
    for (const attendee of eventData.attendees) {
      try {
        await sendCancellationToAttendee(
          eventData,
          attendee,
          cancellationIcs,
          transporter,
          config
        );
        sentResults.push(true);
      } catch (error) {
        console.error(`Error sending cancellation to ${attendee.email}:`, error);
        sentResults.push(false);
      }
    }
    
    // If we have server connection details and eventId, delete the event
    if (eventData.eventId && eventData.calendarId) {
      try {
        // Get server connection for this user
        const storage = getStorage();
        const serverConnection = await storage.getServerConnection(userId);
        
        if (serverConnection && serverConnection.url) {
          console.log(`Found server connection for user ${userId}, proceeding with event deletion`);
          
          // Delete the event both locally and from the server
          await deleteEventAfterCancellation(
            eventData.eventId,
            eventData.calendarId,
            serverConnection.url,
            {
              username: serverConnection.username,
              password: serverConnection.password
            }
          );
        } else {
          console.warn(`No server connection found for user ${userId}, cannot delete event from server`);
        }
      } catch (deleteError) {
        console.error('Error deleting event after cancellation:', deleteError);
        // Continue without failing - we still may have sent emails successfully
      }
    }
    
    // Return success if at least one email was sent
    return sentResults.some(result => result);
    
  } catch (error) {
    console.error('Error in sendCancellationEmails:', error);
    return false;
  }
}

/**
 * Sends a cancellation email to a single attendee
 */
async function sendCancellationToAttendee(
  eventData: EventInvitationData,
  attendee: Attendee,
  icsData: string,
  transporter: nodemailer.Transporter,
  config: SmtpConfig
): Promise<nodemailer.SentMessageInfo> {
  console.log(`Sending cancellation email to: ${attendee.email}`);
  
  const { startDate, endDate, title, description, location, resources } = eventData;
  
  // Format dates for display
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
          max-width: calc(100% - 110px); 
        }
        .description-content p { margin: 0 0 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Event Cancellation</h2>
        </div>
        <div class="content">
          <div class="cancelled-banner">
            THIS EVENT HAS BEEN CANCELLED
          </div>
          
          <p>Hello ${attendeeName},</p>
          
          <p>The following event has been <strong>cancelled</strong>:</p>
          
          <div class="event-details">
            <div class="detail-row">
              <span class="label">Event:</span> ${title}
            </div>
            
            ${description ? `
            <div class="detail-row description-container">
              <span class="label">Description:</span>
              <div class="description-content">${description}</div>
            </div>
            ` : ''}
            
            ${location ? `
            <div class="detail-row">
              <span class="label">Location:</span> ${location}
            </div>
            ` : ''}
            
            <div class="detail-row">
              <span class="label">Start:</span> ${formattedStart}
            </div>
            
            <div class="detail-row">
              <span class="label">End:</span> ${formattedEnd}
            </div>
            
            <div class="detail-row">
              <span class="label">Organizer:</span> ${eventData.organizer ? (eventData.organizer.name || eventData.organizer.email) : "Unknown"}
            </div>
            
            ${resources && resources.length > 0 ? `
            <div class="detail-row">
              <span class="label">Resources:</span>
              <div class="description-content">
                ${resources.map(resource => `
                  <p><strong>${resource.name || resource.subType}</strong>${(resource.name && resource.name !== resource.subType) ? ` (${resource.subType})` : ''}
                  ${resource.capacity ? `<br>Capacity: ${resource.capacity}` : ''}
                  ${resource.adminName ? `<br>Administrator: ${resource.adminName}` : ''}
                  ${resource.remarks ? `<br>Notes: ${resource.remarks}` : ''}</p>
                `).join('')}
              </div>
            </div>
            ` : ''}
          </div>
          
          <p>Your calendar will be updated automatically if you previously accepted this invitation.</p>
          
          <div class="footer">
            <p>This cancellation notice was sent using CalDAV Calendar Application.</p>
          </div>
        </div>
      </div>
    </body>
  </html>
  `;

  // Plain text version
  const textContent = `CANCELLED EVENT

Hello ${attendeeName},

The following event has been CANCELLED:

Event: ${title}
${description ? `Description: ${description.replace(/<[^>]*>/g, '')}\n` : ''}${location ? `Location: ${location}\n` : ''}
Start: ${formattedStart}
End: ${formattedEnd}
Organizer: ${eventData.organizer ? (eventData.organizer.name || eventData.organizer.email) : "Unknown"}
${resources && resources.length > 0 ? `
Resources:
${resources.map(resource => `- ${resource.name || resource.subType}${(resource.name && resource.name !== resource.subType) ? ` (${resource.subType})` : ''}${resource.capacity ? `\n  Capacity: ${resource.capacity}` : ''}${resource.adminName ? `\n  Administrator: ${resource.adminName}` : ''}${resource.remarks ? `\n  Notes: ${resource.remarks}` : ''}`).join('\n\n')}\n` : ''}

Your calendar will be updated automatically if you previously accepted this invitation.

This cancellation notice was sent using CalDAV Calendar Application.`;

  // Prepare the cancellation email
  const mailOptions = {
    from: {
      name: config.fromName || 'Calendar Application',
      address: config.fromEmail
    },
    to: attendee.name
      ? `"${attendee.name}" <${attendee.email}>`
      : attendee.email,
    subject: `Cancelled: ${title}`,
    html: htmlContent,
    text: textContent,
    attachments: [
      {
        filename: `cancellation-${eventData.uid}.ics`,
        content: icsData,
        contentType: 'text/calendar; method=CANCEL'
      }
    ]
  };

  // Verify UID in the ICS data matches the event UID
  if (eventData.uid) {
    const uidMatch = icsData.match(/UID:([^\r\n]+)/i);
    if (uidMatch && uidMatch[1] && uidMatch[1] !== eventData.uid) {
      console.warn(`⚠️ UID mismatch in ICS attachment! ICS has "${uidMatch[1]}" but event has "${eventData.uid}"`);
    }
  }

  // Send the email
  return transporter.sendMail(mailOptions);
}