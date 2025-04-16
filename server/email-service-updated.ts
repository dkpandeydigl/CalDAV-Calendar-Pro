/**
 * UPDATES:
 * 
 * This file contains the updated methods for the email-service.ts to handle
 * event cancellation in a RFC 5546 compliant way
 * 
 * These are the specific methods that need to be replaced in the main email-service.ts file:
 * - sendEventCancellation (line ~961)
 * - transformIcsForCancellation (line ~1146)
 */

  /**
   * Send a cancellation notification for an event
   * 
   * @param userId The ID of the user cancelling the event
   * @param data Event data
   * @returns Result of the cancellation operation
   */
  public async sendEventCancellation(userId: number, data: EventInvitationData): Promise<EmailResult> {
    try {
      // Initialize SMTP transport if not already done
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { 
          success: false, 
          message: "Failed to initialize email service. Please check your SMTP configuration."
        };
      }
      
      if (!this.transporter || !this.config) {
        return { 
          success: false, 
          message: "Email service not properly initialized"
        };
      }
      
      console.log(`=== SENDING EVENT CANCELLATION FOR "${data.title}" ===`);
      
      // Use our new cancellation system
      const { sendCancellationEmails } = require('./cancellation/email-sender');
      
      const success = await sendCancellationEmails(
        userId,
        data,
        this.transporter,
        this.config
      );
      
      if (success) {
        console.log(`Successfully sent cancellation emails for event "${data.title}"`);
        return {
          success: true,
          message: `Successfully sent cancellation emails for "${data.title}"`
        };
      } else {
        return {
          success: false,
          message: "Failed to send cancellation emails"
        };
      }
    } catch (error) {
      console.error("Error sending cancellation:", error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Unknown error sending cancellation"
      };
    }
  }

  /**
   * Transform an ICS file for cancellation (RFC 5546 compliant)
   * 
   * @param originalIcs Original ICS data
   * @param data Event data
   * @returns Transformed ICS data for cancellation
   */
  public transformIcsForCancellation(originalIcs: string, data: EventInvitationData): string {
    try {
      // Use our new cancellation handler
      const { generateCancellationIcs } = require('./cancellation/cancellation-handler');
      return generateCancellationIcs(originalIcs, data);
    } catch (error) {
      console.error('Error transforming ICS for cancellation:', error);
      
      // Fallback to basic approach if our sophisticated method fails
      let cancellationIcs = originalIcs;
      
      // Ensure METHOD is CANCEL
      cancellationIcs = cancellationIcs.replace(/METHOD:[^\r\n]+/i, 'METHOD:CANCEL');
      if (!cancellationIcs.includes('METHOD:CANCEL')) {
        cancellationIcs = cancellationIcs.replace('BEGIN:VCALENDAR', 'BEGIN:VCALENDAR\r\nMETHOD:CANCEL');
      }
      
      // Add STATUS:CANCELLED
      if (!cancellationIcs.includes('STATUS:CANCELLED')) {
        cancellationIcs = cancellationIcs.replace('BEGIN:VEVENT', 'BEGIN:VEVENT\r\nSTATUS:CANCELLED');
      }
      
      // Add CANCELLED prefix to summary
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
      
      return cancellationIcs;
    }
  }