/**
 * RFC 6638 Cancellation Test Endpoint
 * 
 * This module provides test endpoints for verifying the RFC 6638 compliant
 * event cancellation implementation, focusing on proper .ics file formatting 
 * for email attachments.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { storage } from './memory-storage';

// Simple authentication middleware
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ message: "Not authenticated" });
}
import { emailService } from './email-service';
import { generateCancellationIcs } from './enhanced-ics-cancellation-fixed';

/**
 * Register endpoints for testing RFC 6638 compliant event cancellation
 * 
 * @param app Express application instance
 */
export function registerRFC6638TestEndpoints(app: Express) {
  console.log('Registering RFC 6638 compliant cancellation test endpoints');
  
  // Test endpoint to generate and examine RFC 6638 cancellation ICS file
  app.post('/api/test-rfc6638-cancel', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { eventId } = req.body;
      
      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required"
        });
      }
      
      // Get the event from the database
      const event = await storage.getEvent(Number(eventId));
      
      if (!event) {
        return res.status(404).json({
          success: false,
          message: `Event with ID ${eventId} not found`
        });
      }
      
      // Get the calendar to find the owner
      const calendar = await storage.getCalendar(event.calendarId);
      
      if (!calendar) {
        return res.status(404).json({
          success: false,
          message: `Calendar with ID ${event.calendarId} not found`
        });
      }
      
      // Get the organizer user
      const user = await storage.getUser(calendar.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: `User with ID ${calendar.userId} not found`
        });
      }
      
      // Get event resources and attendees from the event object directly
      let resources = [];
      let attendees = [];
      
      // Try to extract resources from the event
      try {
        if ((event as any).resources) {
          resources = typeof (event as any).resources === 'string' 
            ? JSON.parse((event as any).resources) 
            : (event as any).resources;
        }
      } catch (error) {
        console.warn(`Failed to parse resources for event ${event.id}:`, error);
      }
      
      // Try to extract attendees from the event
      try {
        if ((event as any).attendees) {
          attendees = typeof (event as any).attendees === 'string' 
            ? JSON.parse((event as any).attendees) 
            : (event as any).attendees;
        }
      } catch (error) {
        console.warn(`Failed to parse attendees for event ${event.id}:`, error);
      }
      
      // Prepare event data for cancellation
      const eventData = {
        eventId: event.id,
        uid: event.uid,
        title: event.title,
        description: event.description,
        location: event.location,
        startDate: event.startDate,
        endDate: event.endDate,
        organizer: {
          email: user.email || user.username,
          name: user.fullName || user.username
        },
        attendees: attendees.map(attendee => ({
          email: attendee.email,
          name: attendee.name,
          role: attendee.role || 'REQ-PARTICIPANT',
          status: attendee.status || 'NEEDS-ACTION'
        })),
        resources: resources.map(resource => ({
          id: resource.id.toString(),
          name: resource.name,
          email: resource.email,
          adminEmail: resource.adminEmail,
          type: resource.type,
          subType: resource.subType,
          capacity: resource.capacity
        })),
        rawData: event.rawData,
        status: 'CANCELLED',
        sequence: (event.sequence || 0) + 1
      };
      
      console.log(`Preparing RFC 6638 cancellation for event ${event.id} (${event.title})`);
      
      // Original ICS data (if available)
      const originalIcs = event.rawData ? String(event.rawData) : null;
      
      // Generate the cancellation ICS
      let cancellationIcs;
      let filename;
      
      if (originalIcs) {
        // Use original ICS as a base
        console.log('Using original ICS data as a base for cancellation');
        cancellationIcs = emailService.transformIcsForCancellation(originalIcs, eventData);
        
        // Format filename for the cancellation ICS
        const formattedDate = emailService.formatDateForFilename(event.startDate);
        const sanitizedTitle = (event.title || 'event')
          .replace(/[^a-zA-Z0-9]/g, '-')
          .replace(/-{2,}/g, '-')
          .toLowerCase()
          .substring(0, 30);
        
        filename = `cancelled-${sanitizedTitle}-${formattedDate}.ics`;
      } else {
        // Generate from scratch using our RFC 6638 generator
        console.log('No original ICS data, generating cancellation ICS from scratch');
        cancellationIcs = generateCancellationIcs('', eventData);
        
        // Simple filename
        filename = `cancelled-event-${event.id}.ics`;
      }
      
      // Process the ICS to ensure proper formatting
      const processedIcs = emailService.processIcsForAttachment(cancellationIcs);
      
      // Check if the result has quotes
      const hasQuotes = 
        (processedIcs.startsWith('"') && processedIcs.endsWith('"')) || 
        (processedIcs.startsWith("'") && processedIcs.endsWith("'"));
      
      // Check if METHOD:CANCEL is present
      const hasMethod = processedIcs.includes('METHOD:CANCEL');
      
      // Check if STATUS:CANCELLED is present
      const hasStatus = processedIcs.includes('STATUS:CANCELLED');
      
      // Check if UID matches
      const uidMatch = processedIcs.match(/UID:([^\r\n]+)/i);
      const extractedUid = uidMatch ? uidMatch[1] : null;
      const uidMatches = extractedUid === event.uid;
      
      // Get the sequence number
      const sequenceMatch = processedIcs.match(/SEQUENCE:(\d+)/i);
      const sequenceNumber = sequenceMatch ? parseInt(sequenceMatch[1], 10) : null;
      
      // Check if all required properties are present according to RFC 6638
      const requiredProperties = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:CANCEL',  // RFC 6638 requires METHOD:CANCEL
        'BEGIN:VEVENT',
        `UID:${event.uid}`,  // Original UID must be preserved
        'DTSTART:',  // Event must have start time
        'DTSTAMP:',  // Current timestamp required
        'SEQUENCE:',  // Sequence should be incremented
        'STATUS:CANCELLED',  // Status must be set to CANCELLED
        'ORGANIZER',  // Organizer information required
        'END:VEVENT',
        'END:VCALENDAR'
      ];
      
      // Enhanced RFC 6638 checking - more specific validation
      const missingProperties = requiredProperties.filter(prop => {
        if (prop.endsWith(':')) {
          // Just check if the property name exists for these (partial match)
          return !processedIcs.includes(prop);
        } else {
          // For others, look for exact match or includes match
          return !processedIcs.includes(prop);
        }
      });
      
      // Return result with details
      return res.json({
        success: true,
        eventId: event.id,
        title: event.title,
        uid: event.uid,
        filename,
        rfc6638_compliance: {
          hasMethod, // Has METHOD:CANCEL header
          hasStatus, // Has STATUS:CANCELLED
          uidMatches, // Original UID preserved
          hasQuotes: hasQuotes, // No surrounding quotes (should be false)
          sequenceNumber, // Sequence number should be incremented
          // Has all required RFC 6638 properties
          missingProperties,
          // Additional RFC 6638 specific checks
          hasMethodCancel: processedIcs.includes('METHOD:CANCEL'),
          hasStatusCancelled: processedIcs.includes('STATUS:CANCELLED'),
          hasTimestamps: processedIcs.includes('DTSTAMP:') && 
            (processedIcs.includes('CREATED:') || processedIcs.includes('LAST-MODIFIED:')),
          // Overall compliance status
          isFullyCompliant: hasMethod && 
            hasStatus && 
            uidMatches && 
            !hasQuotes && 
            sequenceNumber !== null && 
            missingProperties.length === 0 &&
            processedIcs.includes('METHOD:CANCEL') &&
            processedIcs.includes('STATUS:CANCELLED')
        },
        originalIcsAvailable: !!originalIcs,
        cancellationIcs: processedIcs
      });
      
    } catch (error) {
      console.error('Error in RFC 6638 cancellation test:', error);
      return res.status(500).json({
        success: false,
        message: `Error generating RFC 6638 cancellation: ${error instanceof Error ? error.message : String(error)}`,
        error: String(error)
      });
    }
  });
  
  // Test endpoint to actually send a cancellation email with the RFC 6638 ICS
  app.post('/api/test-rfc6638-cancel-email', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { eventId, recipientEmail } = req.body;
      
      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required"
        });
      }
      
      if (!recipientEmail) {
        return res.status(400).json({
          success: false,
          message: "Recipient email is required"
        });
      }
      
      // Get the event from the database
      const event = await storage.getEvent(Number(eventId));
      
      if (!event) {
        return res.status(404).json({
          success: false,
          message: `Event with ID ${eventId} not found`
        });
      }
      
      // Get the calendar to find the owner
      const calendar = await storage.getCalendar(event.calendarId);
      
      if (!calendar) {
        return res.status(404).json({
          success: false,
          message: `Calendar with ID ${event.calendarId} not found`
        });
      }
      
      // Get the organizer user
      const user = await storage.getUser(calendar.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: `User with ID ${calendar.userId} not found`
        });
      }
      
      // Get event resources from the event object directly
      let resources = [];
      
      // Try to extract resources from the event
      try {
        if ((event as any).resources) {
          resources = typeof (event as any).resources === 'string' 
            ? JSON.parse((event as any).resources) 
            : (event as any).resources;
        }
      } catch (error) {
        console.warn(`Failed to parse resources for event ${event.id}:`, error);
      }
      
      // Include the test recipient in attendees
      let attendees = [{
        email: recipientEmail,
        name: recipientEmail.split('@')[0],
        role: 'REQ-PARTICIPANT',
        status: 'NEEDS-ACTION'
      }];
      
      // Try to extract attendees from the event
      try {
        if ((event as any).attendees) {
          const existingAttendees = typeof (event as any).attendees === 'string' 
            ? JSON.parse((event as any).attendees) 
            : (event as any).attendees;
            
          // Add additional attendees if they exist
          if (existingAttendees && existingAttendees.length > 0) {
            existingAttendees.forEach((att: any) => {
              if (att.email !== recipientEmail) {
                attendees.push({
                  email: att.email,
                  name: att.name,
                  role: att.role || 'REQ-PARTICIPANT',
                  status: att.status || 'NEEDS-ACTION'
                });
              }
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to parse attendees for event ${event.id}:`, error);
      }
      
      // Prepare event data for cancellation
      const eventData = {
        eventId: event.id,
        uid: event.uid,
        title: event.title,
        description: event.description,
        location: event.location,
        startDate: event.startDate,
        endDate: event.endDate,
        organizer: {
          email: user.email || user.username,
          name: user.fullName || user.username
        },
        attendees,
        resources: resources.map(resource => ({
          id: resource.id.toString(),
          name: resource.name,
          email: resource.email,
          adminEmail: resource.adminEmail,
          type: resource.type,
          subType: resource.subType,
          capacity: resource.capacity
        })),
        rawData: event.rawData,
        status: 'CANCELLED',
        sequence: (event.sequence || 0) + 1
      };
      
      console.log(`Sending RFC 6638 cancellation email for event ${event.id} (${event.title}) to ${recipientEmail}`);
      
      // Send the cancellation email
      const result = await emailService.sendEventCancellation(calendar.userId, eventData);
      
      // Return result with details
      return res.json({
        success: result.success,
        message: result.message,
        emailDetails: result.details,
        eventData: {
          id: event.id,
          title: event.title,
          uid: event.uid
        }
      });
      
    } catch (error) {
      console.error('Error sending RFC 6638 cancellation email:', error);
      return res.status(500).json({
        success: false,
        message: `Error sending cancellation email: ${error instanceof Error ? error.message : String(error)}`,
        error: String(error)
      });
    }
  });
}