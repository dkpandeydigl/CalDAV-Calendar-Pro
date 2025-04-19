import { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage"; // Using standardized storage import
import { registerCancellationTestEndpoint } from './cancellation/test-endpoint';
import { 
  insertEventSchema, 
  insertCalendarSchema,
  insertServerConnectionSchema,
  insertCalendarSharingSchema,
  insertSmtpConfigSchema,
  insertNotificationSchema,
  notificationFilterSchema,
  type Event,
  type Notification
} from "@shared/schema";
import { WebSocketServer, WebSocket } from "ws";
import { setupAuth } from "./auth";
import { DAVClient } from "tsdav";
import { emailService } from "./email-service";
import { enhancedEmailService } from "./enhanced-email-service";
import { centralUIDService } from "./central-uid-service";
import { syncSmtpPasswordWithCalDAV } from "./smtp-sync-utility";
import { z } from "zod";
import { registerExportRoutes } from "./export-routes";
import { registerImportRoutes } from "./import-routes";
import { registerUserLookupRoutes } from "./user-lookup-routes";
import { registerTestPermissionEndpoints } from "./test-permissions";
import fetch from "node-fetch";
import { escapeICalString, formatICalDate, formatContentLine, generateICalEvent } from "./ical-utils";
import { syncService } from "./sync-service";
import { webdavSyncService } from "./webdav-sync";
import { notifyCalendarChanged, notifyEventChanged } from "./websocket-handler";
import { notificationService } from "./memory-notification-service";
import { registerEmailTestEndpoints } from "./email-test-endpoint";
import { registerEnhancedEmailTestEndpoints } from "./enhanced-email-test";
import { initializeWebSocketServer } from "./websocket-handler";
import { initializeWebSocketNotificationService, WebSocketNotificationService, WebSocketNotification } from "./websocket-notifications";
import { setupCommonSmtp, getSmtpStatus } from './smtp-controller';
import { enhancedSyncService } from './enhanced-sync-service';

// Initialize the WebSocket notification service for use throughout the app
let websocketNotificationService: WebSocketNotificationService;

// Helper function to broadcast messages to users
function broadcastToUser(userId: number, message: any) {
  if (websocketNotificationService) {
    // Create a properly formatted notification object
    const notification: WebSocketNotification = {
      type: message.type || 'system', 
      action: message.action || 'info',
      timestamp: Date.now(),
      data: message
    };
    websocketNotificationService.broadcastToUser(userId, notification);
  } else {
    console.warn('WebSocket notification service not initialized yet');
  }
}

// Using directly imported syncService
import type { SyncService as SyncServiceType } from "./sync-service";

// Type for tracking deleted events
interface DeletedEventInfo {
  id: number;
  uid?: string;
  url?: string;
  timestamp: string;
}

declare module 'express-session' {
  interface SessionData {
    recentlyDeletedEvents?: number[];
    deletedEventDetails?: DeletedEventInfo[];
  }
}

declare module 'express' {
  interface User {
    id: number;
    username: string;
  }
  
  interface Request {
    session: session.Session & {
      recentlyDeletedEvents?: number[];
      deletedEventDetails?: DeletedEventInfo[];
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);
  
  // Create the HTTP server
  const httpServer = createServer(app);
  
  // Initialize WebSocket server for real-time notifications
  // This internally initializes the WebSocket notification service
  initializeWebSocketServer(httpServer);
  
  // Initialize the WebSocket notification service for use with the broadcast function
  websocketNotificationService = initializeWebSocketNotificationService(httpServer);
  
  console.log('[express] WebSocket server initialization handled in routes.ts');
  
  // Register the export, import, user lookup, and test routes
  registerExportRoutes(app);
  registerImportRoutes(app);
  registerUserLookupRoutes(app);
  registerTestPermissionEndpoints(app, storage);

  // Direct calendar export endpoint with robustness to storage backend changes
  // NOTE: This endpoint bypasses auth verification to work reliably with both PostgreSQL and IndexedDB
  app.get("/api/direct-export", async (req, res) => {
    try {
      // Debug log with timestamp
      console.log(`[${new Date().toISOString()}] Direct export request received`);
      
      // Attempt to get user from session, but don't require auth
      const user = req.user || { id: null };
      console.log(`User from session: ${user.id ? `ID: ${user.id}` : 'Not authenticated'}`);
      
      // Parse the calendar IDs from the query parameter
      const rawIds = req.query.ids || '';
      const calendarIds = String(rawIds)
        .split(',')
        .map((id: string) => {
          const num = parseInt(id.trim(), 10);
          return isNaN(num) ? null : num;
        })
        .filter((id): id is number => id !== null);
      
      console.log(`Direct export requested for calendar IDs: ${calendarIds.join(', ')}`);
      
      if (calendarIds.length === 0) {
        return res.status(400).json({ message: 'No calendars selected for export' });
      }
      
      // Get the events for each calendar - don't rely on user authentication
      const allEvents: any[] = [];
      const calendarNames: string[] = [];
      
      for (const calendarId of calendarIds) {
        // Directly fetch calendar by ID without auth checks
        let calendar;
        try {
          calendar = await storage.getCalendar(calendarId);
          console.log(`Found calendar ${calendar?.name || 'Unknown'} (ID: ${calendarId})`);
        } catch (error) {
          console.error(`Error fetching calendar ${calendarId}:`, error);
          continue;
        }
        
        if (!calendar) {
          console.warn(`Calendar with ID ${calendarId} not found`);
          continue;
        }
        
        // Add to calendar names list
        calendarNames.push(calendar.name);
        
        // Directly fetch events by calendar ID
        let events = [];
        try {
          events = await storage.getEvents(calendarId);
          console.log(`Found ${events.length} events in calendar ${calendar.name} (ID: ${calendarId})`);
        } catch (error) {
          console.error(`Error fetching events for calendar ${calendarId}:`, error);
          continue;
        }
        
        // Add calendar info to each event
        const eventsWithCalendarInfo = events.map(event => ({
          ...event,
          calendarName: calendar.name,
          calendarColor: calendar.color
        }));
        
        allEvents.push(...eventsWithCalendarInfo);
      }
      
      if (allEvents.length === 0) {
        console.warn('No events found in the selected calendars');
        return res.status(404).json({ message: 'No events found in the selected calendars' });
      }
      
      // Generate the ICS file with standardized date formatting
      const formatDate = (date: Date): string => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };
      
      const now = formatDate(new Date());
      let displayName = calendarNames.join(', ');
      if (displayName.length > 30) {
        displayName = `${calendarNames.length} Calendars`;
      }
      
      // Build ICS content
      let lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${displayName}`,
        'X-WR-CALDESC:Calendar Export'
      ];
      
      // Add each event with complete information
      for (const event of allEvents) {
        const safeUid = event.uid?.includes('@') ? event.uid : `${event.uid || `event-${Date.now()}`}@caldavclient.local`;
        
        // Format dates properly
        const startDate = formatDate(new Date(event.startDate));
        const endDate = formatDate(new Date(event.endDate));
        const creationDate = event.createdAt ? formatDate(new Date(event.createdAt)) : now;
        const modifiedDate = event.updatedAt ? formatDate(new Date(event.updatedAt)) : now;
        
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${safeUid}`);
        lines.push(`DTSTAMP:${now}`);
        lines.push(`CREATED:${creationDate}`);
        lines.push(`LAST-MODIFIED:${modifiedDate}`);
        lines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}`);
        lines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}`);
        lines.push(`SUMMARY:${event.title}`);
        
        // Add calendar category
        if (event.calendarName) {
          lines.push(`CATEGORIES:${event.calendarName}`);
        }
        
        // Add description with proper formatting
        if (event.description) {
          const formattedDesc = event.description
            .replace(/\n/g, '\\n')  // Line breaks
            .replace(/,/g, '\\,')   // Commas
            .replace(/;/g, '\\;');  // Semicolons
          
          lines.push(`DESCRIPTION:${formattedDesc}`);
        }
        
        // Add location if available
        if (event.location) {
          lines.push(`LOCATION:${event.location.replace(/,/g, '\\,').replace(/;/g, '\\;')}`);
        }
        
        // Add all-day flag
        if (event.allDay) {
          lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
        }
        
        // Add sequence number
        const sequence = event.sequence || 0;
        lines.push(`SEQUENCE:${sequence}`);
        
        // Add recurrence rule if present
        if (event.recurrenceRule) {
          // Clean any potentially malformed RRULE
          let cleanedRule = event.recurrenceRule;
          
          // Properly clean RRULE of any mailto or other invalid content
          if (cleanedRule.includes('mailto:') || cleanedRule.includes('mailto')) {
            cleanedRule = cleanedRule.split(/mailto:|mailto/)[0];
          }
          
          if (cleanedRule.includes(';CN=')) {
            cleanedRule = cleanedRule.split(';CN=')[0];
          }
          
          // Additional check to ensure RRULE only contains valid RFC 5545 parameters
          const validRRulePattern = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;.*)?$/;
          if (!validRRulePattern.test(cleanedRule)) {
            // Extract just the part that matches valid RRULE structure
            const match = cleanedRule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[^;]*)*$/);
            if (match) {
              cleanedRule = match[0];
            }
          }
          
          lines.push(`RRULE:${cleanedRule}`);
        }
        
        // Add organizer if available
        if (event.organizer) {
          const organizerEmail = event.organizer.email || 'unknown@example.com';
          const organizerName = event.organizer.name || '';
          if (organizerName) {
            lines.push(`ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`);
          } else {
            lines.push(`ORGANIZER:mailto:${organizerEmail}`);
          }
        }
        
        // Add attendees
        if (event.attendees && Array.isArray(event.attendees)) {
          for (const attendee of event.attendees) {
            if (!attendee || !attendee.email) continue;
            
            const role = attendee.role || 'REQ-PARTICIPANT';
            const name = attendee.name || '';
            const status = attendee.status || 'NEEDS-ACTION';
            
            let attendeeLine = `ATTENDEE`;
            if (name) attendeeLine += `;CN=${name}`;
            attendeeLine += `;ROLE=${role};PARTSTAT=${status}`;
            attendeeLine += `:mailto:${attendee.email}`;
            
            lines.push(attendeeLine);
          }
        }
        
        // Add resources
        if (event.resources && Array.isArray(event.resources)) {
          for (const resource of event.resources) {
            if (!resource) continue;
            
            const email = resource.email || resource.adminEmail || '';
            if (!email) continue;
            
            let resourceLine = `ATTENDEE`;
            if (resource.name) resourceLine += `;CN=${resource.name}`;
            resourceLine += `;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT`;
            
            if (resource.type || resource.subType) {
              resourceLine += `;X-RESOURCE-TYPE=${resource.type || resource.subType}`;
            }
            
            if (resource.capacity) {
              resourceLine += `;X-RESOURCE-CAPACITY=${resource.capacity}`;
            }
            
            if (resource.adminName) {
              resourceLine += `;X-ADMIN-NAME=${resource.adminName}`;
            }
            
            resourceLine += `:mailto:${email}`;
            
            lines.push(resourceLine);
          }
        }
        
        // Add additional custom properties from raw data if needed
        // But be careful to avoid including the entire raw data as a property
        if (event.rawData && typeof event.rawData === 'string' && !event.rawData.startsWith('"BEGIN:VCALENDAR')) {
          try {
            // Only process rawData if it looks like valid ICS content
            if (event.rawData.includes('BEGIN:VCALENDAR') || event.rawData.includes('BEGIN:VEVENT')) {
              // Extract any properties from rawData that we might have missed
              const rawLines = event.rawData.split(/\r?\n/);
              const includedProps = new Set([
                'UID', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 
                'CREATED', 'DTSTAMP', 'LAST-MODIFIED', 'SEQUENCE', 'RRULE',
                'ORGANIZER', 'ATTENDEE', 'CATEGORIES', 'BEGIN', 'END'
              ]);
              
              for (const line of rawLines) {
                // Skip empty lines
                if (!line.trim()) continue;
                
                // Extract the property name (before any parameters)
                const propName = line.split(':')[0]?.split(';')[0];
                
                // Only include properties we haven't already added
                // and skip any BEGIN: or END: markers to avoid nesting issues
                if (propName && 
                    !includedProps.has(propName) && 
                    !line.startsWith('BEGIN:') && 
                    !line.startsWith('END:') &&
                    !line.includes('"BEGIN:VCALENDAR')) {
                  lines.push(line);
                }
              }
            }
          } catch (err) {
            console.log(`Could not parse raw data for event ${event.id}: ${err}`);
          }
        }
        
        lines.push('END:VEVENT');
      }
      
      lines.push('END:VCALENDAR');
      
      // Join the lines with proper line breaks for ICS format
      const icalContent = lines.join('\r\n') + '\r\n';
      
      // Set the appropriate headers for file download
      let filename = 'calendar_export.ics';
      if (calendarIds.length === 1) {
        const safeCalendarName = calendarNames[0].replace(/[^a-z0-9]/gi, '_').toLowerCase();
        filename = `calendar_${safeCalendarName}.ics`;
      }
      
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(icalContent);
      
      console.log(`Successfully exported ${allEvents.length} events from direct-export endpoint`);
      
    } catch (error) {
      console.error('Error in direct-export:', error);
      res.status(500).json({ 
        message: 'Failed to export calendars', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });
  
  // Register email test endpoints
  registerEmailTestEndpoints(app);
  console.log('Registered email test endpoints');

  // Register enhanced email test endpoints with RFC 5545 compliance
  registerEnhancedEmailTestEndpoints(app);
  console.log('Registered enhanced RFC 5545 compliant email test endpoints');
  
  // Test endpoint for verifying cancellation ICS transformation (no auth required)
  app.post('/api/test-cancellation-ics', async (req, res) => {
    try {
      const originalIcs = req.body.originalIcs;
      if (!originalIcs) {
        return res.status(400).json({ error: 'Original ICS data required' });
      }
      
      console.log('=== TESTING CANCELLATION ICS TRANSFORMATION ===');
      console.log('Original ICS sample:', originalIcs.substring(0, 100) + '...');
      
      // Extract resource attendees from the original ICS for verification
      const originalAttendeePattern = /ATTENDEE[^:\r\n]+:[^\r\n]+/g;
      const originalAttendeeLines = originalIcs.match(originalAttendeePattern) || [];
      const originalResourceLines = originalAttendeeLines.filter(line => 
        line.includes('CUTYPE=RESOURCE') || 
        line.includes('X-RESOURCE-TYPE') || 
        line.includes('RESOURCE-TYPE')
      );
      
      console.log(`Original ICS contains ${originalAttendeeLines.length} attendees and ${originalResourceLines.length} resources`);
      
      // Create a test event data object that matches the original ICS
      const uidMatch = originalIcs.match(/UID:([^\r\n]+)/i);
      const uid = uidMatch ? uidMatch[1] : 'test-uid-12345';
      
      const summaryMatch = originalIcs.match(/SUMMARY:([^\r\n]+)/i);
      const title = summaryMatch ? summaryMatch[1] : 'Test Event For Cancellation';
      
      const organizerMatch = originalIcs.match(/ORGANIZER[^:]*:mailto:([^\r\n]+)/i);
      const organizerEmail = organizerMatch ? organizerMatch[1] : 'test@example.com';
      
      const organizerNameMatch = originalIcs.match(/ORGANIZER;CN=([^:;]+)[^:]*:/i);
      const organizerName = organizerNameMatch ? organizerNameMatch[1] : 'Test Organizer';
      
      const eventData: any = {
        uid: uid,
        title: title,
        startDate: new Date(),  // Actual dates don't matter for cancellation test
        endDate: new Date(Date.now() + 3600000),
        organizer: { 
          email: organizerEmail, 
          name: organizerName 
        },
        attendees: originalAttendeeLines
          .filter(line => !line.includes('CUTYPE=RESOURCE'))
          .map(line => {
            const emailMatch = line.match(/:mailto:([^\r\n]+)/i);
            const nameMatch = line.match(/CN=([^:;]+)/i);
            return {
              email: emailMatch ? emailMatch[1] : 'attendee@example.com',
              name: nameMatch ? nameMatch[1] : undefined
            };
          }),
        resources: originalResourceLines.length > 0 ? 
          originalResourceLines.map(line => {
            const emailMatch = line.match(/:mailto:([^\r\n]+)/i);
            const nameMatch = line.match(/CN=([^:;]+)/i);
            const typeMatch = line.match(/X-RESOURCE-TYPE=([^:;]+)/i) || line.match(/RESOURCE-TYPE=([^:;]+)/i);
            return {
              email: emailMatch ? emailMatch[1] : 'resource@example.com',
              adminEmail: emailMatch ? emailMatch[1] : 'resource@example.com',
              name: nameMatch ? nameMatch[1] : 'Resource',
              type: typeMatch ? typeMatch[1] : 'Resource',
              subType: typeMatch ? typeMatch[1] : 'Resource'
            };
          }) : undefined,
        _originalResourceAttendees: originalResourceLines.length > 0 ? originalResourceLines : undefined,
        rawData: originalIcs
      };
      
      console.log(`Created test event data with ${eventData.attendees.length} attendees and ${eventData.resources ? eventData.resources.length : 0} resources`);
      
      // Transform using our unified method
      console.log('Transforming ICS for cancellation...');
      const cancelled = emailService.transformIcsForCancellation(originalIcs, eventData);
      
      // Extract the resource attendees from the cancelled ICS
      const cancelledAttendeePattern = /ATTENDEE[^:\r\n]+:[^\r\n]+/g;
      const cancelledAttendeeLines = cancelled.match(cancelledAttendeePattern) || [];
      const cancelledResourceLines = cancelledAttendeeLines.filter(line => 
        line.includes('CUTYPE=RESOURCE') || 
        line.includes('X-RESOURCE-TYPE') || 
        line.includes('RESOURCE-TYPE')
      );
      
      console.log(`Cancelled ICS contains ${cancelledAttendeeLines.length} attendees and ${cancelledResourceLines.length} resources`);
      
      // Check if all resource attendees are preserved
      const allResourcesPreserved = originalResourceLines.every(original => 
        cancelledResourceLines.some(cancelled => 
          cancelled.includes(original.split(':mailto:')[1])
        )
      );
      
      // Compare before/after
      const result = {
        success: true,
        preserved: {
          originalUid: originalIcs.match(/UID:([^\r\n]+)/i)?.[1],
          cancelledUid: cancelled.match(/UID:([^\r\n]+)/i)?.[1],
          uidsMatch: originalIcs.match(/UID:([^\r\n]+)/i)?.[1] === cancelled.match(/UID:([^\r\n]+)/i)?.[1],
          originalResourceCount: originalResourceLines.length,
          cancelledResourceCount: cancelledResourceLines.length,
          allResourcesPreserved: allResourcesPreserved
        },
        changed: {
          originalMethod: originalIcs.match(/METHOD:([^\r\n]+)/i)?.[1] || 'none',
          cancelledMethod: cancelled.match(/METHOD:([^\r\n]+)/i)?.[1] || 'none',
          originalStatus: originalIcs.match(/STATUS:([^\r\n]+)/i)?.[1] || 'none',
          cancelledStatus: cancelled.match(/STATUS:([^\r\n]+)/i)?.[1] || 'none',
          originalSequence: originalIcs.match(/SEQUENCE:(\d+)/i)?.[1] || '0',
          cancelledSequence: cancelled.match(/SEQUENCE:(\d+)/i)?.[1] || '0'
        },
        resourceLines: {
          original: originalResourceLines,
          cancelled: cancelledResourceLines
        },
        originalIcs,
        cancelledIcs: cancelled
      };
      
      console.log('Cancellation transformation result:', JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      console.error('Error in cancellation test:', error);
      return res.status(500).json({ error: String(error) });
    }
  });
  
  // Test endpoint for cancellation emails with resource preservation
  app.post('/api/test-cancellation-email', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { eventId, sendRealEmails = false } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ error: 'Event ID is required' });
      }
      
      // Get the event from storage
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      console.log(`=== TESTING CANCELLATION EMAIL FOR EVENT ID ${eventId} ===`);
      console.log(`Event title: ${event.title}, UID: ${event.uid}`);
      
      // Parse attendees and resources from event
      let attendees = [];
      let resources = [];
      
      try {
        attendees = event.attendees ? 
          (typeof event.attendees === 'string' ? 
            JSON.parse(event.attendees) : event.attendees) : [];
      } catch (e) {
        console.error('Error parsing attendees:', e);
        attendees = [];
      }
      
      try {
        resources = event.resources ? 
          (typeof event.resources === 'string' ? 
            JSON.parse(event.resources) : event.resources) : [];
      } catch (e) {
        console.error('Error parsing resources:', e);
        resources = [];
      }
      
      const organizer = {
        email: req.user!.email || req.user!.username,
        name: req.user!.fullName || req.user!.username
      };
      
      console.log(`Event has ${attendees.length} attendees and ${resources.length} resources`);
      
      // Prepare event data for cancellation
      const eventData = {
        eventId: event.id,
        uid: event.uid,
        title: event.title,
        description: event.description,
        location: event.location,
        startDate: event.startDate,
        endDate: event.endDate,
        organizer,
        attendees,
        resources,
        rawData: event.rawData,
        status: 'CANCELLED'
      };
      
      // If not sending real emails, just do the ICS transformation and return
      if (!sendRealEmails) {
        console.log('Test mode - not sending actual emails');
        
        if (!event.rawData) {
          return res.status(400).json({ 
            error: 'Event has no raw ICS data, cannot test resource preservation',
            event: {
              id: event.id,
              title: event.title,
              hasRawData: false,
              attendeeCount: attendees.length,
              resourceCount: resources.length
            }
          });
        }
        
        // Transform the ICS for cancellation
        const cancellationIcs = emailService.transformIcsForCancellation(
          event.rawData as string,
          eventData
        );
        
        // Extract attendee and resource lines
        const originalAttendeePattern = /ATTENDEE[^:\r\n]+:[^\r\n]+/g;
        const originalAttendeeLines = (event.rawData as string).match(originalAttendeePattern) || [];
        const originalResourceLines = originalAttendeeLines.filter(line => 
          line.includes('CUTYPE=RESOURCE') || 
          line.includes('X-RESOURCE-TYPE') || 
          line.includes('RESOURCE-TYPE')
        );
        
        const cancelledAttendeeLines = cancellationIcs.match(originalAttendeePattern) || [];
        const cancelledResourceLines = cancelledAttendeeLines.filter(line => 
          line.includes('CUTYPE=RESOURCE') || 
          line.includes('X-RESOURCE-TYPE') || 
          line.includes('RESOURCE-TYPE')
        );
        
        // Check if all resource attendees are preserved
        const allResourcesPreserved = originalResourceLines.every(original => {
          // Extract email from original line
          const originalEmail = original.match(/:mailto:([^\r\n]+)/i)?.[1];
          if (!originalEmail) return false;
          
          // Check if any cancelled line contains this email
          return cancelledResourceLines.some(cancelled => 
            cancelled.includes(`:mailto:${originalEmail}`)
          );
        });
        
        // Count and compare
        const result = {
          success: true,
          tested: 'cancellation-ics-transformation',
          event: {
            id: event.id,
            title: event.title,
            uid: event.uid,
            hasRawData: true
          },
          originalIcs: {
            attendeeCount: originalAttendeeLines.length,
            resourceCount: originalResourceLines.length,
            resourceLines: originalResourceLines
          },
          cancellationIcs: {
            attendeeCount: cancelledAttendeeLines.length,
            resourceCount: cancelledResourceLines.length,
            resourceLines: cancelledResourceLines,
            method: cancellationIcs.match(/METHOD:([^\r\n]+)/i)?.[1],
            status: cancellationIcs.match(/STATUS:([^\r\n]+)/i)?.[1],
            sequence: cancellationIcs.match(/SEQUENCE:(\d+)/i)?.[1]
          },
          preservation: {
            resourcesPreserved: originalResourceLines.length === cancelledResourceLines.length,
            allResourcesExactlyPreserved: allResourcesPreserved,
            uidsMatch: event.uid === cancellationIcs.match(/UID:([^\r\n]+)/i)?.[1]
          }
        };
        
        return res.json(result);
      }
      
      // Send actual cancellation emails
      console.log('Sending actual cancellation emails');
      const result = await emailService.sendEventCancellation(userId, eventData);
      
      res.json({
        success: result.success,
        tested: 'cancellation-email-sending',
        message: result.message,
        details: result.details
      });
      
    } catch (error) {
      console.error('Error testing cancellation email:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error testing cancellation email',
        error: String(error)
      });
    }
  });
  
  // Test endpoint for SMTP configuration and email sending
  app.post('/api/test-email', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { recipient, useSmtpConfig = true } = req.body;
      
      if (!recipient) {
        return res.status(400).json({ error: 'Recipient email address is required' });
      }
      
      console.log(`=== TESTING EMAIL SERVICE FOR USER ${userId} ===`);
      
      // Initialize the email service with the user's SMTP configuration
      let initialized = false;
      
      if (useSmtpConfig) {
        console.log(`Initializing email service with SMTP config for user ${userId}`);
        initialized = await emailService.initialize(userId);
      }
      
      if (!initialized && useSmtpConfig) {
        // Try to fetch the SMTP config to provide more details about the failure
        const config = await storage.getSmtpConfig(userId);
        
        let configDetails = 'No SMTP configuration found';
        if (config) {
          configDetails = `SMTP Config: ${config.host}:${config.port}, From: ${config.fromEmail}`;
          if (config.fromName) {
            configDetails += ` (${config.fromName})`;
          }
        }
        
        return res.status(400).json({
          success: false,
          message: `Failed to initialize email service with user's SMTP configuration`,
          details: {
            userId,
            smtpConfigured: !!config,
            smtpDetails: configDetails
          }
        });
      }
      
      // Send a test email
      console.log(`Sending test email to ${recipient}`);
      const result = await emailService.sendTestEmail(
        userId,
        recipient,
        'CalDAV Calendar - Test Email',
        'This is a test email from your CalDAV Calendar application. If you received this, email sending is working correctly.'
      );
      
      return res.json({
        success: result.success,
        message: result.message,
        details: result.details || {}
      });
    } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({
        success: false,
        message: 'Error sending test email',
        error: String(error)
      });
    }
  });
  
  function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    // Enhanced logging for authentication debugging
    const path = req.path;
    const method = req.method;
    console.log(`Auth check [${method} ${path}]`, {
      isAuthenticated: req.isAuthenticated(),
      hasSession: !!req.session,
      sessionID: req.sessionID,
      hasUser: !!req.user,
      userID: req.user?.id,
      username: req.user?.username,
      cookies: req.headers.cookie ? 'Present' : 'None',
      cookieCount: req.headers.cookie ? req.headers.cookie.split(';').length : 0,
    });
    
    if (req.isAuthenticated()) {
      // Log successful authentication with more details
      console.log(`User ${req.user!.id} (${req.user!.username}) authenticated for ${method} ${path}`);
      return next();
    }
    
    // Enhanced error handling and debugging for failed authentication
    console.log(`Authentication failed for ${method} ${path}`);
    
    // Check for specific authentication issues
    if (!req.session) {
      console.error("No session object found");
      return res.status(401).json({ message: "Session error. Please try again." });
    }
    
    if (!req.headers.cookie) {
      console.error("No cookies present in request");
      return res.status(401).json({ message: "No session cookies found. Please enable cookies in your browser." });
    }
    
    // Try to recover the session if it exists but user is not logged in
    if (req.session && req.sessionID) {
      console.log(`Attempting to recover session: ${req.sessionID}`);
      
      // Regenerate the session to clear any corrupt state
      req.session.regenerate((err) => {
        if (err) {
          console.error("Failed to regenerate session:", err);
        } else {
          console.log("Session regenerated successfully");
        }
        res.status(401).json({ message: "Not authenticated. Please log in again." });
      });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  }
  
  function handleZodError(err: unknown, res: Response) {
    // Always set content type to ensure proper JSON response
    res.setHeader('Content-Type', 'application/json');
    
    try {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ errors: err.errors });
      }
      
      // Handle other error types
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      return res.status(500).json({ message: errorMessage });
    } catch (formatError) {
      // Final fallback if JSON formatting itself fails
      console.error("Error while formatting error response:", formatError);
      return res.status(500).json({ message: "Server error occurred" });
    }
  }
  
  // USERS API
  // The /api/user endpoint is already defined in auth.ts
  // This duplicate definition has been removed to prevent conflicts
  
  app.put("/api/user/fullname", isAuthenticated, async (req, res) => {
    try {
      const { fullName } = req.body;
      
      if (!fullName || typeof fullName !== 'string') {
        return res.status(400).json({ message: "Full name is required and must be a string" });
      }
      
      // Update the user's full name
      const updatedUser = await storage.updateUser(req.user!.id, { fullName });
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Also update the user's SMTP configuration to use this full name as fromName
      try {
        // First get the existing SMTP config
        const smtpConfig = await storage.getSmtpConfig(req.user!.id);
        
        if (smtpConfig) {
          // Update the fromName in the SMTP config
          await storage.updateSmtpConfig(smtpConfig.id, { fromName: fullName });
          console.log(`Updated SMTP configuration for user ${req.user!.id} with new full name: ${fullName}`);
        } else {
          console.log(`No SMTP configuration found for user ${req.user!.id}, skipping SMTP update`);
        }
      } catch (smtpError) {
        // Don't fail the entire operation if SMTP update fails, just log it
        console.error(`Failed to update SMTP configuration for user ${req.user!.id}:`, smtpError);
      }
      
      res.json(updatedUser);
    } catch (err) {
      console.error("Error updating user's full name:", err);
      res.status(500).json({ message: "Failed to update user's full name" });
    }
  });
  
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.filter((user: { id: number }) => user.id !== req.user!.id)); // Don't include the current user
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  
  // CALENDARS API
  
  // Check if a calendar name already exists (for duplication prevention)
  app.get("/api/check-calendar-name", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { name, excludeId } = req.query;
      
      if (!name) {
        return res.status(400).json({ message: "Calendar name is required" });
      }

      // First check local calendars
      const userCalendars = await storage.getCalendars(userId);
      
      // Check if there's a local calendar with the same name (case-insensitive)
      // Exclude the current calendar if we're editing and excludeId is provided
      const excludeCalendarId = excludeId ? parseInt(excludeId as string) : undefined;
      const localDuplicate = userCalendars.find(cal => 
        cal.name.toLowerCase() === (name as string).toLowerCase() && 
        (!excludeCalendarId || cal.id !== excludeCalendarId)
      );
      
      if (localDuplicate) {
        return res.json({ 
          exists: true, 
          message: "A calendar with this name already exists in your account" 
        });
      }
      
      // If no local duplicate, check the server if a connection exists
      try {
        const connection = await storage.getServerConnection(userId);
        
        if (connection && connection.status === 'connected') {
          // Create a DAV client
          const { DAVClient } = await import('tsdav');
          const davClient = new DAVClient({
            serverUrl: connection.url,
            credentials: {
              username: connection.username,
              password: connection.password
            },
            authMethod: 'Basic',
            defaultAccountType: 'caldav'
          });
          
          // Login to the server
          await davClient.login();
          
          // Fetch all calendars from server
          const davCalendars = await davClient.fetchCalendars();
          console.log(`Retrieved ${davCalendars.length} calendars from CalDAV server to check for name duplication`);
          
          // Check for duplicate names on the server (case-insensitive)
          const serverDuplicate = davCalendars.find(cal => {
            if (typeof cal.displayName === 'string') {
              return cal.displayName.toLowerCase() === (name as string).toLowerCase();
            }
            return false;
          });
          
          if (serverDuplicate) {
            return res.json({ 
              exists: true, 
              message: "A calendar with this name already exists on the CalDAV server" 
            });
          }
        }
      } catch (serverCheckError) {
        console.error("Error checking for calendar name on server:", serverCheckError);
        // We'll still allow creation if server check fails - just log the error
      }
      
      // No duplicates found
      res.json({ exists: false });
    } catch (err) {
      console.error("Error checking calendar name:", err);
      res.status(500).json({ message: "Failed to check calendar name" });
    }
  });
  
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      console.log(`Fetching calendars for user ID: ${userId}, username: ${req.user?.username || 'unknown'}`);
      
      // Try to retrieve calendars from storage
      let calendars = await storage.getCalendars(userId);
      console.log(`Initially found ${calendars.length} calendars for user ${userId}`);
      
      // If no calendars found but user has a server connection, force a sync
      if (calendars.length === 0) {
        console.log(`No calendars found for user ${userId}. Checking for CalDAV server connection...`);
        
        try {
          // Check if user has a CalDAV server connection
          const serverConnection = await storage.getServerConnection(userId);
          
          if (serverConnection && serverConnection.status === 'connected') {
            console.log(`User ${userId} has active CalDAV connection. Forcing immediate sync...`);
            
            try {
              // Import sync service and force an immediate sync
              const { syncService } = await import('./sync-service');
              await syncService.syncNow(userId, { 
                forceRefresh: true,
                calendarId: null,
                isGlobalSync: true,
                preserveLocalEvents: true,
                preserveLocalDeletes: true
              });
              
              // Get calendars again after the sync
              calendars = await storage.getCalendars(userId);
              console.log(`After forced sync, found ${calendars.length} calendars for user ${userId}`);
            } catch (syncError) {
              console.error(`Error during emergency sync for user ${userId}:`, syncError);
              // Continue with empty calendar list if sync fails
            }
          } else {
            console.log(`User ${userId} has no active CalDAV connection. Can't sync.`);
          }
        } catch (connectionCheckError) {
          console.error(`Error checking server connection for user ${userId}:`, connectionCheckError);
        }
      }
      
      // Log calendar information
      if (calendars.length > 0) {
        console.log(`Returning ${calendars.length} calendars for user ${userId}`);
        calendars.forEach((cal, idx) => {
          console.log(`Calendar ${idx+1}: ID=${cal.id}, Name="${cal.name}", Color=${cal.color}, UserID=${cal.userId}, URL=${cal.url || 'None'}`);
        });
      } else {
        console.log(`No calendars available for user ${userId} even after sync attempt`);
        
        // Detailed debugging - check if calendars exist for other users
        try {
          // Try to get all calendars to help debug
          const allCalendars = await storage.getAllCalendars();
          console.log(`Total calendars in storage for all users: ${allCalendars.length}`);
          if (allCalendars.length > 0) {
            // Log the user IDs to help debugging
            const userIds = [...new Set(allCalendars.map(cal => cal.userId))];
            console.log(`Calendars exist for user IDs: ${userIds.join(', ')}`);
          }
        } catch (debugError) {
          console.error("Error while trying to debug calendar issues:", debugError);
        }
      }
      
      // Send response
      res.json(calendars);
    } catch (err) {
      console.error("Error fetching calendars:", err);
      res.status(500).json({ message: "Failed to fetch calendars" });
    }
  });
  
  app.post("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertCalendarSchema.parse(calendarData);
      
      // First check if the user has a server connection
      const connection = await storage.getServerConnection(userId);
      
      if (connection && connection.status === 'connected') {
        try {
          // Create the calendar on the server first
          const { DAVClient } = await import('tsdav');
          const davClient = new DAVClient({
            serverUrl: connection.url,
            credentials: {
              username: connection.username,
              password: connection.password
            },
            authMethod: 'Basic',
            defaultAccountType: 'caldav'
          });
          
          // Login to the server
          await davClient.login();
          
          // Get the calendars from the server to determine the base URL structure
          const calendars = await davClient.fetchCalendars();
          if (calendars && calendars.length > 0) {
            // Extract the base URL from the first calendar's URL
            // For davical, this is usually something like /caldav.php/username/
            let homeUrl = '';
            
            for (const cal of calendars) {
              if (cal.url && cal.url.includes('/caldav.php/')) {
                const parts = cal.url.split('/');
                // Find the index of caldav.php
                const caldavIndex = parts.findIndex(p => p === 'caldav.php');
                if (caldavIndex >= 0 && caldavIndex + 1 < parts.length) {
                  // Extract up to the username part (which is usually after caldav.php)
                  homeUrl = parts.slice(0, caldavIndex + 2).join('/') + '/';
                  break;
                }
              }
            }
            
            if (!homeUrl) {
              // If we couldn't parse from existing calendars, try to construct from username
              homeUrl = `${connection.url.replace(/\/?$/, '')}/caldav.php/${connection.username}/`;
            }
            
            console.log(`Attempting to create calendar "${validatedData.name}" on CalDAV server at ${homeUrl}`);
            
            // For DaviCal, which is the server we're using, we need to construct the URL correctly
            // The URL pattern is usually /caldav.php/username/calendarname/
            if (homeUrl.includes('/caldav.php/')) {
              // Extract the base URL up to the username part
              const baseUrl = homeUrl.substring(0, homeUrl.lastIndexOf('/') + 1);
              
              // Create a URL-safe version of the calendar name
              const safeCalendarName = encodeURIComponent(validatedData.name.toLowerCase().replace(/\s+/g, '-'));
              
              // Construct the new calendar URL
              const newCalendarUrl = `${baseUrl}${safeCalendarName}/`;
              
              try {
                // Create the calendar on the server
                await davClient.makeCalendar({
                  url: newCalendarUrl,
                  props: {
                    displayname: validatedData.name,
                    color: validatedData.color
                  }
                });
                
                console.log(`Successfully created calendar "${validatedData.name}" on CalDAV server at ${newCalendarUrl}`);
                
                // Save the URL in our database
                validatedData.url = newCalendarUrl;
              } catch (makeCalendarError) {
                console.error(`Error creating calendar on server:`, makeCalendarError);
                // Continue with local creation even if server creation fails
              }
            } else {
              console.log(`Calendar home URL does not match expected DaviCal pattern: ${homeUrl}`);
            }
          } else {
            console.log('Could not find calendar home set');
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local creation even if server connection fails
        }
      }
      
      // Check if this calendar should be created on the server
      let serverCreationSuccessful = true;
      let serverCalendarUrl: string | null = null;
      
      if (calendarData.url || (!calendarData.isLocal && calendarData.name)) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            console.log(`Attempting to create or verify calendar on server before creating locally`);
            // Create a DAV client
            const { DAVClient } = await import('tsdav');
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            // Login to the server
            await davClient.login();
            
            // If this is a custom URL, verify it exists before creating
            if (calendarData.url) {
              console.log(`Verifying custom calendar URL: ${calendarData.url}`);
              
              try {
                // Create auth header
                const authHeader = 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64');
                
                // Check if the URL is accessible
                const response = await fetch(calendarData.url, {
                  method: 'PROPFIND',
                  headers: {
                    'Authorization': authHeader,
                    'Depth': '0',
                    'Content-Type': 'application/xml'
                  }
                });
                
                if (response.ok || response.status === 207) {
                  console.log(`Custom calendar URL verified successfully`);
                  serverCalendarUrl = calendarData.url;
                } else {
                  console.error(`Custom calendar URL is not accessible, status: ${response.status}`);
                  serverCreationSuccessful = false;
                  return res.status(400).json({ 
                    message: `The calendar URL could not be accessed. Status: ${response.status}`
                  });
                }
              } catch (urlError) {
                console.error(`Error verifying custom calendar URL:`, urlError);
                serverCreationSuccessful = false;
                return res.status(400).json({ 
                  message: `Error verifying calendar URL: ${urlError.message || 'Unknown error'}`
                });
              }
            } 
            // Otherwise try to create a new calendar on the server
            else if (!calendarData.isLocal) {
              console.log(`Attempting to create new calendar "${calendarData.name}" on server`);
              
              try {
                // Get calendars first to determine the base URL structure
                const davCalendars = await davClient.fetchCalendars();
                
                if (davCalendars && davCalendars.length > 0) {
                  // Extract the base URL pattern
                  let calendarHome = '';
                  for (const cal of davCalendars) {
                    if (cal.url) {
                      const basePath = cal.url.split('/').slice(0, -2).join('/') + '/';
                      calendarHome = basePath;
                      break;
                    }
                  }
                  
                  if (calendarHome) {
                    console.log(`Using calendar home URL: ${calendarHome}`);
                    
                    // Create a new calendar with sanitized name for the URL
                    const sanitizedName = calendarData.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
                    
                    try {
                      const newCalendarUrl = await davClient.makeCalendar({
                        url: `${calendarHome}${sanitizedName}/`,
                        displayName: calendarData.name, 
                        description: calendarData.description || '',
                        color: calendarData.color || '#0078d4'
                      });
                      
                      if (newCalendarUrl) {
                        console.log(`Successfully created calendar on server: ${newCalendarUrl}`);
                        serverCalendarUrl = newCalendarUrl;
                      } else {
                        console.error(`Server did not return URL for created calendar`);
                        serverCreationSuccessful = false;
                        return res.status(500).json({ 
                          message: 'Server did not return calendar URL after creation'
                        });
                      }
                    } catch (createError) {
                      console.error(`Error creating calendar on server:`, createError);
                      serverCreationSuccessful = false;
                      return res.status(400).json({ 
                        message: `Failed to create calendar on server: ${createError.message || 'Unknown error'}`
                      });
                    }
                  } else {
                    console.error(`Could not determine calendar home URL`);
                    serverCreationSuccessful = false;
                    return res.status(500).json({ 
                      message: 'Could not determine where to create the calendar on the server'
                    });
                  }
                } else {
                  console.error(`No existing calendars found to determine URL structure`);
                  serverCreationSuccessful = false;
                  return res.status(500).json({ 
                    message: 'Could not find existing calendars to determine server structure'
                  });
                }
              } catch (serverError) {
                console.error(`Server calendar creation error:`, serverError);
                serverCreationSuccessful = false;
                return res.status(500).json({ 
                  message: `Server error during calendar creation: ${serverError.message || 'Unknown error'}`
                });
              }
            }
          } else {
            console.warn(`No server connection available or not connected`);
            
            // For non-local calendars, require server connection
            if (!calendarData.isLocal) {
              serverCreationSuccessful = false;
              return res.status(400).json({ 
                message: 'Cannot create a server calendar without an active server connection'
              });
            }
          }
        } catch (serverCheckError) {
          console.error(`Error during server calendar verification/creation:`, serverCheckError);
          serverCreationSuccessful = false;
          
          // If not explicitly local, fail when server operations fail
          if (!calendarData.isLocal) {
            return res.status(500).json({
              message: `Failed to create calendar on server: ${serverCheckError.message || 'Unknown error'}`
            });
          }
        }
      }
      
      // Only create locally if the calendar is meant to be local-only OR server creation was successful
      if (calendarData.isLocal || serverCreationSuccessful) {
        // Update with server URL if available
        if (serverCalendarUrl) {
          calendarData.url = serverCalendarUrl;
          calendarData.isLocal = false;
        }
        
        // Create the calendar locally
        const newCalendar = await storage.createCalendar(calendarData);
        return res.status(201).json(newCalendar);
      }
      
      // This is a fallback that should not be reached due to the early returns above
      return res.status(500).json({ message: 'Calendar creation failed' });
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });

  // Update a calendar
  app.put("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      const userId = req.user!.id;
      console.log(`Calendar update request for calendar ID ${calendarId} by user ${userId}`);
      console.log(`Update data:`, req.body);
      
      // Get the existing calendar to check ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        console.log(`Calendar ${calendarId} not found`);
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if the user owns this calendar
      if (existingCalendar.userId !== userId) {
        console.log(`User ${userId} does not own calendar ${calendarId} (owned by ${existingCalendar.userId})`);
        return res.status(403).json({ message: "You don't have permission to modify this calendar" });
      }
      
      // Set content type header explicitly to ensure JSON response
      res.setHeader('Content-Type', 'application/json');
      
      // Log existing calendar details before update
      console.log(`Existing calendar:`, {
        id: existingCalendar.id,
        name: existingCalendar.name,
        color: existingCalendar.color,
        url: existingCalendar.url,
        syncToken: existingCalendar.syncToken
      });
      
      // If this calendar exists on the CalDAV server and we're changing its properties
      // Note that some properties (like color) can be changed locally without affecting the server
      if (existingCalendar.url && 
          (req.body.name !== undefined && req.body.name !== existingCalendar.name)) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client using import
            const { DAVClient } = await import('tsdav');
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            // Login to the server
            await davClient.login();
            
            // Try to update the calendar on the server
            // Note: Not all CalDAV servers support renaming calendars through the API
            // We can try but we'll continue with the local update even if it fails
            try {
              // Attempt to update properties
              console.log(`Attempting to update calendar "${existingCalendar.name}" to "${req.body.name}" on CalDAV server`);
              let isDaviCal = false;
              let updateSuccessful = false;
              
              // Check if this is a DaviCal server (which requires special handling)
              if (existingCalendar.url.includes('/caldav.php/')) {
                console.log(`Server is DaviCal-based, using DaviCal-specific update approach`);
                isDaviCal = true;
                
                // For DaviCal servers, we need to create a new calendar with the new name
                // and copy all events from the old calendar to the new one
                try {
                  // First build the HTTP Basic Auth header
                  const authHeader = 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64');
                  
                  // Extract the principal URL and calendar path
                  const davicalUrlParts = existingCalendar.url.split('/caldav.php/');
                  
                  if (davicalUrlParts.length !== 2) {
                    console.error('Invalid DaviCal URL format, cannot parse for calendar operations');
                    throw new Error('Invalid DaviCal URL format');
                  }
                  
                  const serverBase = davicalUrlParts[0] + '/caldav.php/';
                  const pathParts = davicalUrlParts[1].split('/');
                  
                  if (pathParts.length < 2) {
                    console.error('Invalid DaviCal path format, cannot determine principal and calendar');
                    throw new Error('Invalid DaviCal path format');
                  }
                  
                  const principal = decodeURIComponent(pathParts[0]);
                  const oldCalendarName = decodeURIComponent(pathParts[1]);
                  // Create new calendar name - replace spaces with hyphens for the URL path only
                  const newUrlCalendarName = req.body.name.replace(/\s+/g, '-').toLowerCase();
                  
                  console.log(`DaviCal principal: ${principal}`);
                  console.log(`DaviCal old calendar name: ${oldCalendarName}`);
                  console.log(`DaviCal new calendar name for URL: ${newUrlCalendarName}`);
                  
                  // Check if the new calendar already exists
                  const newCalendarUrl = `${serverBase}${encodeURIComponent(principal)}/${encodeURIComponent(newUrlCalendarName)}/`;
                  console.log(`Checking if the new calendar already exists at: ${newCalendarUrl}`);
                  
                  let newCalendarExists = false;
                  try {
                    const checkResponse = await fetch(newCalendarUrl, {
                      method: 'PROPFIND',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        'Authorization': authHeader,
                        'Depth': '0'
                      },
                      body: `<?xml version="1.0" encoding="utf-8" ?>
                        <D:propfind xmlns:D="DAV:">
                          <D:prop>
                            <D:resourcetype/>
                          </D:prop>
                        </D:propfind>`
                    });
                    
                    if (checkResponse.status === 200 || checkResponse.status === 207) {
                      console.log(`Warning: A calendar already exists at the new URL path: ${newCalendarUrl}`);
                      newCalendarExists = true;
                    }
                  } catch (checkError) {
                    // Expected 404 if calendar doesn't exist
                    console.log(`New calendar doesn't exist yet: ${newCalendarUrl}`);
                  }
                  
                  // If a calendar already exists at that path, use a different approach
                  if (newCalendarExists) {
                    console.warn(`Cannot create new calendar - a calendar already exists at ${newCalendarUrl}`);
                  } else {
                    // Create a new calendar with the new name
                    console.log(`DaviCal: Creating new calendar with name: ${req.body.name}`);
                    
                    const createResponse = await fetch(newCalendarUrl, {
                      method: 'MKCALENDAR',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        'Authorization': authHeader
                      },
                      body: `<?xml version="1.0" encoding="utf-8" ?>
                        <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                          <D:set>
                            <D:prop>
                              <D:displayname>${req.body.name}</D:displayname>
                              <C:calendar-color>${req.body.color || existingCalendar.color}</C:calendar-color>
                              <C:calendar-description>${existingCalendar.description || ''}</C:calendar-description>
                            </D:prop>
                          </D:set>
                        </C:mkcalendar>`
                    });
                    
                    console.log(`Create calendar response status: ${createResponse.status}`);
                    
                    if (createResponse.status >= 200 && createResponse.status < 300) {
                      // Now copy all events from old calendar to the new one
                      console.log(`Successfully created new calendar at ${newCalendarUrl}, now copying events`);
                      
                      // Get all events from the old calendar
                      const getAllEventsResponse = await fetch(existingCalendar.url, {
                        method: 'PROPFIND',
                        headers: {
                          'Content-Type': 'application/xml; charset=utf-8',
                          'Authorization': authHeader,
                          'Depth': '1'
                        },
                        body: `<?xml version="1.0" encoding="utf-8" ?>
                          <D:propfind xmlns:D="DAV:">
                            <D:prop>
                              <D:resourcetype/>
                              <D:getcontenttype/>
                              <D:getetag/>
                            </D:prop>
                          </D:propfind>`
                      });
                      
                      const allEventsText = await getAllEventsResponse.text();
                      
                      // Extract event URLs from response
                      const eventUrlMatches = allEventsText.match(/<D:href>([^<]+\.ics)<\/D:href>/g) || [];
                      const eventUrls = eventUrlMatches.map(match => {
                        const urlMatch = match.match(/<D:href>([^<]+)<\/D:href>/);
                        return urlMatch ? urlMatch[1] : null;
                      }).filter(url => url !== null);
                      
                      console.log(`Found ${eventUrls.length} events to copy to the new calendar`);
                      
                      // Copy each event to the new calendar
                      let successfulCopies = 0;
                      for (const eventUrl of eventUrls) {
                        try {
                          // Get event data
                          const getEventResponse = await fetch(serverBase + eventUrl, {
                            method: 'GET',
                            headers: {
                              'Authorization': authHeader
                            }
                          });
                          
                          if (getEventResponse.status === 200) {
                            const eventData = await getEventResponse.text();
                            
                            // Create event in new calendar
                            const newEventUrl = eventUrl.replace(
                              encodeURIComponent(oldCalendarName), 
                              encodeURIComponent(newUrlCalendarName)
                            );
                            
                            const putEventResponse = await fetch(serverBase + newEventUrl, {
                              method: 'PUT',
                              headers: {
                                'Content-Type': 'text/calendar; charset=utf-8',
                                'Authorization': authHeader
                              },
                              body: eventData
                            });
                            
                            if (putEventResponse.status >= 200 && putEventResponse.status < 300) {
                              successfulCopies++;
                            } else {
                              console.error(`Failed to copy event to new calendar: ${putEventResponse.status}`);
                            }
                          }
                        } catch (eventCopyError) {
                          console.error('Error copying event:', eventCopyError);
                        }
                      }
                      
                      console.log(`Successfully copied ${successfulCopies} of ${eventUrls.length} events`);
                      
                      // Update the URL in the database to point to the new calendar
                      const oldCalendarUrl = existingCalendar.url;
                      existingCalendar.url = newCalendarUrl;
                      req.body.url = newCalendarUrl;
                      
                      // Also update sync token to force a full resync
                      req.body.syncToken = null;
                      
                      updateSuccessful = true;
                      console.log('DaviCal calendar rename successful with create+copy approach');
                      
                      // Now attempt to delete the old calendar to clean up
                      console.log(`Cleaning up - attempting to delete old calendar at ${oldCalendarUrl}`);
                      try {
                        // Use DELETE with infinity depth to delete the calendar and all its contents
                        const deleteResponse = await fetch(oldCalendarUrl, {
                          method: 'DELETE',
                          headers: {
                            'Authorization': authHeader,
                            'Depth': 'infinity'
                          }
                        });
                        
                        console.log(`Old calendar deletion response: ${deleteResponse.status}`);
                        
                        if (deleteResponse.status >= 200 && deleteResponse.status < 300) {
                          console.log('Successfully deleted old calendar');
                        } else {
                          console.log('Could not delete old calendar - server response:', deleteResponse.status);
                          
                          // Try alternate approach - mark it as disabled to hide it from UI
                          try {
                            console.log('Attempting to disable old calendar instead');
                            const disableResponse = await fetch(oldCalendarUrl, {
                              method: 'PROPPATCH',
                              headers: {
                                'Content-Type': 'application/xml; charset=utf-8',
                                'Authorization': authHeader
                              },
                              body: `<?xml version="1.0" encoding="utf-8" ?>
                                <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                                  <D:set>
                                    <D:prop>
                                      <C:calendar-enabled>false</C:calendar-enabled>
                                    </D:prop>
                                  </D:set>
                                </D:propertyupdate>`
                            });
                            
                            console.log(`Disable calendar response: ${disableResponse.status}`);
                          } catch (disableError) {
                            console.error('Error trying to disable old calendar:', disableError);
                          }
                        }
                      } catch (deleteError) {
                        console.error('Error deleting old calendar:', deleteError);
                      }
                    } else {
                      console.error(`Failed to create new calendar: ${createResponse.status}`);
                      console.error('Will try standard PROPPATCH approach as fallback');
                    }
                  }
                  const xmlBody1 = `<?xml version="1.0" encoding="utf-8" ?>
                    <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                      <D:set>
                        <D:prop>
                          <D:displayname>${req.body.name}</D:displayname>
                        </D:prop>
                      </D:set>
                    </D:propertyupdate>`;
                  
                  console.log('DaviCal update attempt #1: Standard PROPPATCH');
                  const response1 = await fetch(existingCalendar.url, {
                    method: 'PROPPATCH',
                    headers: {
                      'Content-Type': 'application/xml; charset=utf-8',
                      'Authorization': authHeader
                    },
                    body: xmlBody1
                  });
                  
                  console.log(`DaviCal update response #1: Status ${response1.status}`);
                  
                  if (response1.status >= 200 && response1.status < 300) {
                    console.log('DaviCal calendar rename successful with attempt #1');
                    updateSuccessful = true;
                  } else {
                    // Second attempt: Simplified format with just DAV namespace
                    const xmlBody2 = `<?xml version="1.0" encoding="utf-8" ?>
                      <D:propertyupdate xmlns:D="DAV:">
                        <D:set>
                          <D:prop>
                            <D:displayname>${req.body.name}</D:displayname>
                          </D:prop>
                        </D:set>
                      </D:propertyupdate>`;
                    
                    console.log('DaviCal update attempt #2: Simplified namespace');
                    const response2 = await fetch(existingCalendar.url, {
                      method: 'PROPPATCH',
                      headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        'Authorization': authHeader
                      },
                      body: xmlBody2
                    });
                    
                    console.log(`DaviCal update response #2: Status ${response2.status}`);
                    
                    if (response2.status >= 200 && response2.status < 300) {
                      console.log('DaviCal calendar rename successful with attempt #2');
                      updateSuccessful = true;
                    } else {
                      // Third attempt: With no XML declaration
                      const xmlBody3 = `<D:propertyupdate xmlns:D="DAV:">
                        <D:set>
                          <D:prop>
                            <D:displayname>${req.body.name}</D:displayname>
                          </D:prop>
                        </D:set>
                      </D:propertyupdate>`;
                      
                      console.log('DaviCal update attempt #3: No XML declaration');
                      const response3 = await fetch(existingCalendar.url, {
                        method: 'PROPPATCH',
                        headers: {
                          'Content-Type': 'text/xml',
                          'Authorization': authHeader
                        },
                        body: xmlBody3
                      });
                      
                      console.log(`DaviCal update response #3: Status ${response3.status}`);
                      
                      if (response3.status >= 200 && response3.status < 300) {
                        console.log('DaviCal calendar rename successful with attempt #3');
                        updateSuccessful = true;
                      } else {
                        // For DaviCal servers, we may need to try one more strategy
                        // Using a different URL structure
                        if (existingCalendar.url.endsWith('/')) {
                          const propsUrl = existingCalendar.url + '.properties';
                          console.log(`DaviCal update attempt #4: Using alternative URL: ${propsUrl}`);
                          
                          const response4 = await fetch(propsUrl, {
                            method: 'PROPPATCH',
                            headers: {
                              'Content-Type': 'application/xml',
                              'Authorization': authHeader
                            },
                            body: xmlBody1
                          });
                          
                          console.log(`DaviCal update response #4: Status ${response4.status}`);
                          
                          if (response4.status >= 200 && response4.status < 300) {
                            console.log('DaviCal calendar rename successful with alternative URL structure');
                            updateSuccessful = true;
                          }
                        }
                      }
                    }
                  }
                  
                  if (!updateSuccessful) {
                    console.log('All DaviCal update attempts failed. Falling back to tsdav library...');
                  }
                } catch (fetchError) {
                  console.error('Error during direct fetch for DaviCal update:', fetchError);
                  // Continue to try tsdav approach
                }
              }
              
              // If DaviCal-specific approaches failed or for other server types
              if (!updateSuccessful) {
                try {
                  // Use davRequest with PROPPATCH to update display name
                  console.log('Trying tsdav library PROPPATCH approach...');
                  const response = await davClient.davRequest({
                    url: existingCalendar.url,
                    init: {
                      method: 'PROPPATCH',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                      },
                      body: `<?xml version="1.0" encoding="utf-8" ?>
                        <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                          <D:set>
                            <D:prop>
                              <D:displayname>${req.body.name}</D:displayname>
                            </D:prop>
                          </D:set>
                        </D:propertyupdate>`
                    }
                  });
                  
                  // Check if response is an array (as specified in the DAVResponse type)
                  const responseArray = Array.isArray(response) ? response : [response];
                  
                  // Check response status - handle both array and non-array responses safely
                  let status = 0;
                  
                  if (Array.isArray(response) && response.length > 0) {
                    // Try to get status from array response
                    status = response[0]?.status || 0;
                  } else if (typeof response === 'object' && response !== null) {
                    // Try to get status from single object response
                    status = (response as any)?.status || 0;
                  }
                  
                  console.log(`tsdav PROPPATCH response status: ${status}`);
                  
                  if (status >= 200 && status < 300) {
                    console.log(`Successfully updated calendar name with tsdav library`);
                    updateSuccessful = true;
                  } else {
                    console.warn(`Server responded with status ${status}, tsdav update may not have worked`);
                  }
                } catch (proppatchError) {
                  console.error('Error during tsdav PROPPATCH operation:', proppatchError);
                }
              }
              
              if (updateSuccessful) {
                console.log(`Calendar successfully renamed on server from "${existingCalendar.name}" to "${req.body.name}"`);
              } else {
                console.warn(`Unable to confirm calendar rename on server despite multiple attempts.`);
              }
            } catch (calendarUpdateError) {
              console.error(`Error updating calendar on server:`, calendarUpdateError);
              // Continue with local update even if server update fails
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't update calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local update even if server connection fails
        }
      }
      
      // Update the calendar locally
      console.log(`Updating calendar locally with data:`, req.body);
      const updatedCalendar = await storage.updateCalendar(calendarId, req.body);
      
      // Return the updated calendar
      if (updatedCalendar) {
        console.log(`Calendar update successful. Updated calendar:`, {
          id: updatedCalendar.id,
          name: updatedCalendar.name,
          color: updatedCalendar.color,
          url: updatedCalendar.url,
          syncToken: updatedCalendar.syncToken
        });
        res.json(updatedCalendar);
      } else {
        console.error(`Failed to update calendar ${calendarId} in database`);
        res.status(500).json({ message: "Failed to update calendar" });
      }
    } catch (err) {
      console.error("Error updating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // Delete a calendar
  app.delete("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      const userId = req.user!.id;
      
      // Get the existing calendar to check ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if the user owns this calendar
      if (existingCalendar.userId !== userId) {
        return res.status(403).json({ message: "You don't have permission to delete this calendar" });
      }
      
      // Set content type header explicitly to ensure JSON response
      res.setHeader('Content-Type', 'application/json');
      
      // If this calendar has a URL, try to delete it from the CalDAV server first
      if (existingCalendar.url) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client using import
            const { DAVClient } = await import('tsdav');
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            // Login to the server
            await davClient.login();
            
            // Try to delete the calendar on the server
            // Note: This is dependent on the server supporting calendar deletion
            // Some CalDAV servers might restrict this operation
            try {
              console.log(`Attempting to delete calendar "${existingCalendar.name}" from CalDAV server`);
              
              // For a full calendar deletion, we need to delete all events first
              const calendarEvents = await storage.getEvents(calendarId);
              console.log(`Found ${calendarEvents.length} events to remove from server`);
              
              // Delete each event that has a URL and etag
              for (const event of calendarEvents) {
                if (event.url && event.etag) {
                  try {
                    await davClient.deleteCalendarObject({
                      calendarObject: {
                        url: event.url,
                        etag: event.etag
                      }
                    });
                    console.log(`Deleted event "${event.title}" (ID: ${event.id}) from server`);
                  } catch (eventDeleteError) {
                    console.error(`Error deleting event ${event.id} from server:`, eventDeleteError);
                    // Continue with other events even if one fails
                  }
                }
              }
              
              // Some servers support calendar deletion, but it's not universally supported
              // This might throw an error on servers that don't allow it
              // DIRECT DELETION APPROACH - Handle all CalDAV server types with specialized methods
              console.log(`Attempting to delete calendar: ${existingCalendar.url}`);
              
              // Flag to track successful server-side deletion
              let serverDeletionSuccessful = false;
              
              try {
                // First, check if the calendar has any restrictions that would prevent deletion
                console.log('Checking calendar permissions and restrictions...');
                try {
                  const props = await davClient.propfind({
                    url: existingCalendar.url,
                    props: [
                      '{DAV:}current-user-privilege-set',
                      '{DAV:}resourcetype',
                      '{urn:ietf:params:xml:ns:caldav}calendar-home-set'
                    ],
                    depth: '0'
                  });
                  
                  // Extract privilege information
                  const privileges = props?.[0]?.props?.['current-user-privilege-set'] || [];
                  const hasWriteContent = privileges.some((p: any) => 
                    (p?.privilege?.['write-content'] !== undefined) || 
                    (p?.privilege?.['all'] !== undefined));
                    
                  console.log(`Calendar permissions check: hasWriteContent=${hasWriteContent}`);
                  
                  if (!hasWriteContent) {
                    console.log('WARNING: User may not have permission to delete this calendar');
                  }
                } catch (permError) {
                  console.log('Could not check calendar permissions:', permError);
                }
                
                // For more reliable deletion, first delete ALL events in calendar
                console.log(`First ensuring all events are deleted from the server`);
                
                // Step 1: Find all events in this calendar on the server
                const calendarObjects = await davClient.fetchCalendarObjects({
                  calendar: { url: existingCalendar.url }
                });
                
                console.log(`Found ${calendarObjects.length} objects to delete on server`);
                
                // Step 2: Delete each calendar object individually with retry logic
                for (const calObject of calendarObjects) {
                  try {
                    if (calObject.url) {
                      console.log(`Deleting object: ${calObject.url}`);
                      await davClient.deleteCalendarObject({
                        calendarObject: {
                          url: calObject.url,
                          etag: calObject.etag || ""
                        }
                      });
                    }
                  } catch (objDelErr) {
                    console.log(`Failed to delete individual object: ${objDelErr.message}`);
                    // Try direct DAV request as fallback
                    try {
                      await davClient.davRequest({
                        url: calObject.url,
                        init: {
                          method: 'DELETE',
                          headers: {
                            'Content-Type': 'text/plain',
                          },
                          body: ''
                        }
                      });
                    } catch (directDelErr) {
                      console.log(`Also failed with direct request: ${directDelErr.message}`);
                    }
                  }
                }
                
                console.log(`All calendar objects deletion attempts completed`);
                
                // Step 3: Double-check for any remaining hidden .ics files
                let remainingObjects = [];
                try {
                  remainingObjects = await davClient.fetchCalendarObjects({
                    calendar: { url: existingCalendar.url }
                  });
                  
                  if (remainingObjects.length > 0) {
                    console.log(`WARNING: ${remainingObjects.length} objects still remain in the calendar`);
                    // Try one more forceful deletion pass with a different approach
                    for (const obj of remainingObjects) {
                      try {
                        if (obj.url) {
                          // Direct DELETE with Depth header
                          await davClient.davRequest({
                            url: obj.url,
                            init: {
                              method: 'DELETE',
                              headers: {
                                'Content-Type': 'text/plain',
                                'Depth': 'infinity'
                              },
                              body: ''
                            }
                          });
                        }
                      } catch (hiddenObjErr) {
                        console.log(`Failed to remove hidden object: ${obj.url}`);
                      }
                    }
                  } else {
                    console.log('No remaining objects in calendar - ready for collection deletion');
                  }
                } catch (checkErr) {
                  console.log('Could not verify remaining objects:', checkErr);
                }
                
                // Step 4: Now try to delete the actual calendar with multiple approaches
                // Track raw responses to confirm server acceptance
                let deleteResponse = null;
                
                // Try DELETE with specially crafted XML body and infinity depth - works on some servers
                try {
                  console.log('Attempting DELETE with XML body and Depth: infinity');
                  deleteResponse = await davClient.davRequest({
                    url: existingCalendar.url,
                    init: {
                      method: 'DELETE',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        'Depth': 'infinity'
                      },
                      body: '<?xml version="1.0" encoding="utf-8" ?><D:remove xmlns:D="DAV:"/>'
                    }
                  });
                  
                  console.log(`Response status: ${deleteResponse?.status}`);
                  if (deleteResponse?.status >= 200 && deleteResponse?.status < 300) {
                    console.log('Server confirmed calendar deletion with status code:', deleteResponse.status);
                    serverDeletionSuccessful = true;
                  } else {
                    throw new Error(`Unexpected response status: ${deleteResponse?.status}`);
                  }
                } catch (xmlDelError) {
                  console.log(`XML DELETE failed: ${xmlDelError.message}`);
                  
                  // Try standard empty DELETE request with infinity depth
                  try {
                    console.log('Attempting standard DELETE with Depth: infinity');
                    deleteResponse = await davClient.davRequest({
                      url: existingCalendar.url,
                      init: {
                        method: 'DELETE',
                        headers: {
                          'Content-Type': 'text/plain',
                          'Depth': 'infinity'
                        },
                        body: ''
                      }
                    });
                    
                    console.log(`Response status: ${deleteResponse?.status}`);
                    if (deleteResponse?.status >= 200 && deleteResponse?.status < 300) {
                      console.log('Server confirmed calendar deletion with status code:', deleteResponse.status);
                      serverDeletionSuccessful = true;
                    } else {
                      throw new Error(`Unexpected response status: ${deleteResponse?.status}`);
                    }
                  } catch (stdDelError) {
                    console.log(`Standard DELETE with infinity depth failed: ${stdDelError.message}`);
                    
                    // Last resort: try different DELETE variants
                    try {
                      console.log('Attempting DELETE with Depth: 0');
                      deleteResponse = await davClient.davRequest({
                        url: existingCalendar.url,
                        init: {
                          method: 'DELETE',
                          headers: {
                            'Depth': '0'
                          }
                        }
                      });
                      
                      console.log(`Response status: ${deleteResponse?.status}`);
                      if (deleteResponse?.status >= 200 && deleteResponse?.status < 300) {
                        console.log('Server confirmed calendar deletion with status code:', deleteResponse.status);
                        serverDeletionSuccessful = true;
                      } else {
                        throw new Error(`Unexpected response status: ${deleteResponse?.status}`);
                      }
                    } catch (depthZeroError) {
                      console.log(`DELETE with Depth: 0 failed: ${depthZeroError.message}`);
                      
                      // If DELETE failed, try marking as disabled/hidden
                      try {
                        console.log('All DELETE attempts failed, trying to disable via PROPPATCH');
                        const propResponse = await davClient.davRequest({
                          url: existingCalendar.url,
                          init: {
                            method: 'PROPPATCH',
                            headers: {
                              'Content-Type': 'application/xml; charset=utf-8',
                            },
                            body: `<?xml version="1.0" encoding="utf-8" ?>
                              <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                                <D:set>
                                  <D:prop>
                                    <C:calendar-enabled>false</C:calendar-enabled>
                                  </D:prop>
                                </D:set>
                              </D:propertyupdate>`
                          }
                        });
                        
                        console.log(`PROPPATCH response status: ${propResponse?.status}`);
                        if (propResponse?.status >= 200 && propResponse?.status < 300) {
                          console.log('Calendar successfully disabled via PROPPATCH');
                          // Not a true deletion, but the best we could do
                          serverDeletionSuccessful = true;
                        }
                      } catch (propError) {
                        console.log(`All deletion approaches failed for this calendar: ${propError.message}`);
                      }
                    }
                  }
                }
                
                // Step 5: Verify the calendar is actually gone by attempting to fetch it
                if (serverDeletionSuccessful) {
                  try {
                    console.log('Verifying calendar deletion by attempting to fetch it...');
                    const verifyResponse = await davClient.davRequest({
                      url: existingCalendar.url,
                      init: {
                        method: 'PROPFIND',
                        headers: {
                          'Content-Type': 'application/xml; charset=utf-8',
                          'Depth': '0'
                        },
                        body: '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>'
                      }
                    });
                    
                    if (verifyResponse.status === 404) {
                      console.log('Verification confirmed: Calendar is gone (404 Not Found)');
                    } else {
                      console.log(`Warning: Calendar may still exist (status ${verifyResponse.status})`);
                      serverDeletionSuccessful = false;
                    }
                  } catch (verifyError) {
                    if (verifyError.message && verifyError.message.includes('404')) {
                      console.log('Verification confirmed: Calendar is gone (404 Not Found)');
                    } else {
                      console.log(`Verification error: ${verifyError.message}`);
                    }
                  }
                }
              } catch (calErr) {
                console.error(`Error during calendar deletion process: ${calErr.message}`);
                serverDeletionSuccessful = false;
              }
              
              if (!serverDeletionSuccessful) {
                console.log('WARNING: Could not confirm successful server-side calendar deletion');
              }
            } catch (calendarDeleteError) {
              console.error(`Error deleting calendar from server:`, calendarDeleteError);
              // Continue with local deletion even if server deletion fails
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
          // Continue with local deletion even if server connection fails
        }
      }
      
      // Delete the calendar and all its events locally
      const result = await storage.deleteCalendar(calendarId);
      
      if (result.success) {
        res.json({ message: "Calendar deleted successfully" });
      } else {
        res.status(500).json({ 
          message: "Failed to delete calendar", 
          error: result.error,
          details: result.details
        });
      }
    } catch (err) {
      console.error("Error deleting calendar:", err);
      res.status(500).json({ message: "Failed to delete calendar" });
    }
  });
  
  // EVENTS API
  
  // Cancel event endpoint
  app.post('/api/cancel-event/:id', isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: 'Invalid event ID' });
      }
      
      console.log(`Received request to cancel event with ID ${eventId} from user ${req.user!.id}`);
      
      // Get the event to be canceled
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: 'Event not found' });
      }
      
      // Get the calendar to check permissions
      const calendar = await storage.getCalendar(event.calendarId);
      if (!calendar) {
        return res.status(404).json({ message: 'Calendar not found' });
      }
      
      // Check if this user has permission to cancel the event
      let hasPermission = false;
      
      // User owns the calendar
      if (calendar.userId === req.user!.id) {
        hasPermission = true;
      } else {
        // Check if the calendar is shared with the user with edit permissions
        const sharedCalendars = await storage.getSharedCalendars(req.user!.id);
        const sharedCalendar = sharedCalendars.find(cal => cal.id === calendar.id);
        
        if (sharedCalendar && sharedCalendar.permissionLevel === 'edit') {
          hasPermission = true;
        }
      }
      
      // Special case for admin users like DK Pandey
      if (req.user!.id === 4 && req.user!.username === 'dk.pandey@xgenplus.com') {
        hasPermission = true;
        console.log('Admin user granted special permission to cancel event');
      }
      
      if (!hasPermission) {
        return res.status(403).json({ 
          message: 'You do not have permission to cancel this event'
        });
      }
      
      // Only try to send cancellation if there are attendees
      let cancellationResult = { success: true, message: 'No attendees to notify' };
      
      // Process attendees array - handle both string and object formats
      let attendees: any[] = [];
      
      if (event.attendees) {
        // Handle both string (JSON) and array formats
        if (typeof event.attendees === 'string') {
          try {
            attendees = JSON.parse(event.attendees);
          } catch (err) {
            console.warn(`Failed to parse attendees JSON: ${err}`);
            attendees = [];
          }
        } else if (Array.isArray(event.attendees)) {
          attendees = event.attendees;
        }
      }
      
      // If we have attendees, send cancellation emails
      if (attendees.length > 0) {
        console.log(`Sending cancellation emails to ${attendees.length} attendees`);
        
        try {
          const user = await storage.getUser(req.user!.id);
          if (!user) {
            return res.status(404).json({ message: 'User not found' });
          }
          
          // Extract sequence number from event data if available
          let sequenceNumber = 0;
          if (event.rawData) {
            try {
              // Try to extract SEQUENCE from raw data using our utility function
              const { extractSequenceFromICal } = require('./ical-utils');
              sequenceNumber = extractSequenceFromICal(event.rawData);
              console.log(`Extracted sequence number for cancellation: ${sequenceNumber}`);
            } catch (seqError) {
              console.warn('Error extracting sequence number:', seqError);
              // Continue with sequence 0 if we can't extract it
            }
          }
          
          // Extract original UID from rawData if available, to ensure matching UID in cancellation
          let originalUid = event.uid;
          if (event.rawData && typeof event.rawData === 'string') {
            const uidMatch = event.rawData.match(/UID:([^\r\n]+)/);
            if (uidMatch && uidMatch[1]) {
              originalUid = uidMatch[1];
              console.log(`Using exact UID from raw data for event cancellation: ${originalUid}`);
            }
          }
          
          // Extract resources from event rawData if available
          let extractedResources: any[] = [];
          if (event.rawData && typeof event.rawData === 'string') {
            // Try to extract resource attendees from the raw data with multiple patterns
            const resourcePatterns = [
              /ATTENDEE;[^:]*CUTYPE=RESOURCE[^:]*:mailto:([^\r\n]+)/gi,
              /ATTENDEE;[^:]*CN=([^;:]+)[^:]*CUTYPE=RESOURCE[^:]*:mailto:([^\r\n]+)/gi,
              /ATTENDEE;[^:]*X-RESOURCE-TYPE=[^:]*:mailto:([^\r\n]+)/gi
            ];
            
            for (const pattern of resourcePatterns) {
              const matches = Array.from(event.rawData.matchAll(pattern));
              if (matches && matches.length > 0) {
                console.log(`Found ${matches.length} resource attendees in raw data for cancellation`);
                
                // Parse resources into structured format
                const resources = matches.map((match: any) => {
                  const resourceStr = match[0];
                  
                  // Extract email
                  const emailMatch = resourceStr.match(/:mailto:([^\r\n]+)/);
                  const email = emailMatch ? emailMatch[1] : '';
                  
                  // Extract name/subType
                  const nameMatch = resourceStr.match(/CN=([^;:]+)/);
                  const subType = nameMatch ? nameMatch[1] : 'Resource';
                  
                  // Extract type from X-RESOURCE-TYPE or fallback to standard parameters
                  const typeMatches = [
                    resourceStr.match(/X-RESOURCE-TYPE=([^;:]+)/),
                    resourceStr.match(/RESOURCE-TYPE=([^;:]+)/),
                    resourceStr.match(/X-TYPE=([^;:]+)/)
                  ];
                  const typeMatch = typeMatches.find(match => match !== null);
                  const resourceType = typeMatch ? typeMatch[1] : 'Resource';
                  
                  // Extract capacity with multiple patterns
                  const capacityMatches = [
                    resourceStr.match(/X-RESOURCE-CAPACITY=(\d+)/),
                    resourceStr.match(/RESOURCE-CAPACITY=(\d+)/),
                    resourceStr.match(/X-CAPACITY=(\d+)/),
                    resourceStr.match(/CAPACITY=(\d+)/)
                  ];
                  const capacityMatch = capacityMatches.find(match => match !== null);
                  const capacity = capacityMatch ? parseInt(capacityMatch[1], 10) : undefined;
                  
                  // Extract admin name
                  const adminNameMatches = [
                    resourceStr.match(/X-ADMIN-NAME=([^;:]+)/),
                    resourceStr.match(/ADMIN-NAME=([^;:]+)/),
                    resourceStr.match(/X-ADMIN=([^;:]+)/)
                  ];
                  const adminNameMatch = adminNameMatches.find(match => match !== null);
                  const adminName = adminNameMatch ? adminNameMatch[1] : undefined;
                  
                  // Final resource object
                  return {
                    name: subType,
                    email: email,
                    adminEmail: email,
                    adminName: adminName || subType,
                    type: resourceType,
                    subType,
                    capacity
                  };
                });
                
                if (resources.length > 0) {
                  extractedResources = resources;
                  console.log(`Successfully extracted ${extractedResources.length} resources for cancellation`);
                  break; // Once we have resources, stop trying patterns
                }
              }
            }
          }
          
          // Create event data for cancellation with STATUS=CANCELLED
          const eventData = {
            eventId: event.id,
            uid: originalUid, // Use the extracted original UID
            title: event.title,
            description: event.description,
            location: event.location,
            startDate: new Date(event.startDate),
            endDate: new Date(event.endDate),
            organizer: {
              email: user.email || user.username,
              name: user.fullName || user.username
            },
            attendees: attendees.map(a => {
              // Normalize attendee format
              if (typeof a === 'string') {
                return { email: a };
              }
              return a;
            }),
            resources: extractedResources.length > 0 ? extractedResources : undefined, // Include extracted resources
            status: 'CANCELLED', // This is crucial for cancellation
            rawData: event.rawData || null, // Pass raw data to use for recurrence extraction
            sequence: sequenceNumber, // Pass sequence number for proper versioning
            recurrenceRule: event.recurrenceRule // Pass recurrence rule if available
          };
          
          cancellationResult = await emailService.sendEventCancellation(req.user!.id, eventData);
          
          // Log the result for debugging
          console.log('Cancellation email result:', cancellationResult);
          
          // Create cancellation notifications
          for (const attendee of attendees) {
            const attendeeEmail = typeof attendee === 'string' ? attendee : (attendee.email || '');
            if (attendeeEmail) {
              try {
                // Check if the notification table exists before trying to create notifications
                try {
                  await notificationService.createEventCancellationNotification(
                    req.user!.id, // userId (we'll send to the organizer too)
                    event.id,
                    event.uid,
                    event.title,
                    req.user!.id,
                    user.fullName || user.username,
                    user.email || user.username
                  );
                  
                  // Also try to find if the attendee is a registered user to notify them
                  const attendeeUser = await storage.getUserByUsername(attendeeEmail);
                  if (attendeeUser && attendeeUser.id !== req.user!.id) {
                    await notificationService.createEventCancellationNotification(
                      attendeeUser.id,
                      event.id,
                      event.uid,
                      event.title,
                      req.user!.id,
                      user.fullName || user.username,
                      user.email || user.username
                    );
                  }
                } catch (notificationErr) {
                  // If error is "relation 'notifications' does not exist", log it but continue
                  if (notificationErr.message && notificationErr.message.includes("relation \"notifications\" does not exist")) {
                    console.warn('Notifications table does not exist. Skipping notification creation.');
                    console.warn('Run the migration script: scripts/create-notifications-table.ts to create the table.');
                  } else {
                    // Rethrow for other errors
                    throw notificationErr;
                  }
                }
              } catch (notifyErr) {
                console.error('Error creating cancellation notification:', notifyErr);
                // Continue even if notification fails
              }
            }
          }
          
          // Send WebSocket notification about event cancellation
          try {
            // Check if the WebSocket notification handler is properly initialized
            if (typeof createAndSendNotification === 'function') {
              try {
                createAndSendNotification({
                  userId: req.user!.id,
                  type: 'event_cancellation',
                  title: 'Event Cancelled',
                  message: `You cancelled "${event.title}"`,
                  relatedEventId: event.id
                });
                
                console.log('Sent WebSocket notification about event cancellation');
              } catch (notificationError) {
                // Handle the case where the notification database table doesn't exist
                if (notificationError.message && notificationError.message.includes("relation \"notifications\" does not exist")) {
                  console.warn('WebSocket notification not sent - notifications table does not exist');
                  console.warn('Run the migration script: scripts/create-notifications-table.ts to create the table');
                } else {
                  // Rethrow for other errors
                  throw notificationError;
                }
              }
            } else {
              console.warn('WebSocket notification not sent - createAndSendNotification function not available');
            }
          } catch (wsError) {
            console.error('Failed to send WebSocket notification:', wsError);
            // Continue even if WebSocket notification fails
          }
        } catch (emailError) {
          console.error('Error sending cancellation emails:', emailError);
          // We'll still delete the event even if emails fail
          cancellationResult = { 
            success: false, 
            message: `Failed to send cancellation emails: ${emailError.message || 'Unknown error'}` 
          };
        }
      }
      
      // Now delete the event from the database
      const deleteResult = await storage.deleteEvent(eventId);
      
      if (!deleteResult) {
        return res.status(500).json({ 
          message: 'Failed to delete event',
          emailStatus: cancellationResult
        });
      }
      
      // Add event to session's recently deleted list for tracking
      if (!req.session.recentlyDeletedEvents) {
        req.session.recentlyDeletedEvents = [];
      }
      
      // Push the event ID to the list of deleted events
      req.session.recentlyDeletedEvents.push(eventId);
      
      // Ensure proper synchronization to respect deletion
      if (req.user) {
        syncService.syncNow(req.user.id, {
          forceRefresh: true,
          preserveLocalDeletes: true // Ensure the sync respects local deletions
        }).catch(err => {
          console.error('Error during sync after event deletion:', err);
        });
      }
      
      // Notify clients about the deleted event
      try {
        notifyEventChanged(event, 'deleted');
      } catch (notifyError) {
        console.error('Error notifying clients of event deletion:', notifyError);
        // Continue even if notification fails
      }
      
      // Return success response with email status
      return res.status(200).json({
        success: true,
        message: 'Event cancelled successfully',
        deleted: true,
        emailStatus: cancellationResult
      });
      
    } catch (error) {
      console.error('Error cancelling event:', error);
      res.status(500).json({ 
        success: false,
        message: `Error cancelling event: ${error.message || 'Unknown error'}`
      });
    }
  });

  // Endpoint for attendees to respond to event invitations
  app.post("/api/events/:id/respond", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }

      // Get the existing event
      const existingEvent = await storage.getEvent(eventId);
      if (!existingEvent) {
        return res.status(404).json({ message: "Event not found" });
      }

      // Validate the response data
      const { status, comment, proposedStart, proposedEnd } = req.body;
      
      if (!status || !['ACCEPTED', 'DECLINED', 'TENTATIVE'].includes(status)) {
        return res.status(400).json({ message: "Invalid response status" });
      }

      // Get the current user's information
      const currentUser = req.user!;
      const userDetails = await storage.getUser(currentUser.id);
      
      if (!userDetails) {
        return res.status(404).json({ message: "User not found" });
      }

      // Determine the attendee email to update (use email if available, otherwise username)
      const attendeeEmail = userDetails.email || userDetails.username;
      
      // Parse the current attendees
      let attendees = [];
      if (existingEvent.attendees) {
        if (typeof existingEvent.attendees === 'string') {
          try {
            attendees = JSON.parse(existingEvent.attendees);
          } catch (e) {
            console.error("Error parsing attendees from JSON string:", e);
          }
        } else if (Array.isArray(existingEvent.attendees)) {
          attendees = existingEvent.attendees;
        }
      }

      // Find if the current user is in the attendees list
      let attendeeFound = false;
      const updatedAttendees = attendees.map(attendee => {
        if (
          (typeof attendee === 'string' && attendee === attendeeEmail) ||
          (typeof attendee === 'object' && 
           attendee.email && 
           attendee.email.toLowerCase() === attendeeEmail.toLowerCase())
        ) {
          attendeeFound = true;
          // Update the attendee's status and add comment if provided
          return {
            ...attendee,
            email: typeof attendee === 'string' ? attendee : attendee.email,
            name: typeof attendee === 'string' ? attendee.split('@')[0] : (attendee.name || attendee.email.split('@')[0]),
            status: status,
            comment: comment || undefined,
            proposedStart: proposedStart || undefined,
            proposedEnd: proposedEnd || undefined
          };
        }
        return attendee;
      });

      // If the user isn't in the attendee list, we can't process the response
      if (!attendeeFound) {
        return res.status(403).json({ 
          message: "You are not listed as an attendee for this event" 
        });
      }

      // Update the event with the new attendees list
      const updatedEvent = await storage.updateEvent(eventId, {
        attendees: updatedAttendees,
        // Increment the sequence number to indicate a change
        rawData: {
          ...existingEvent.rawData,
          SEQUENCE: existingEvent.rawData?.SEQUENCE 
            ? parseInt(existingEvent.rawData.SEQUENCE) + 1 
            : 1
        }
      });

      // Construct and send an iTIP REPLY
      try {
        // Get the calendar for this event
        const calendar = await storage.getCalendar(existingEvent.calendarId);
        if (!calendar) {
          throw new Error("Calendar not found");
        }

        // Get the user's server connection
        const connection = await storage.getServerConnection(userDetails.id);
        if (!connection) {
          throw new Error("Server connection not found");
        }

        // Create iTIP REPLY object and update CalDAV server
        // This is a simplified version - a real implementation would use a CalDAV client library
        // to construct a proper iTIP REPLY and send it to the server

        // Send email notification to the organizer
        const eventData = {
          eventId: existingEvent.id,
          uid: existingEvent.uid,
          title: existingEvent.title,
          description: existingEvent.description,
          location: existingEvent.location,
          startDate: new Date(existingEvent.startDate),
          endDate: new Date(existingEvent.endDate),
          organizer: {
            email: typeof existingEvent.attendees === 'object' && Array.isArray(existingEvent.attendees) 
              ? existingEvent.attendees.find(att => 
                  typeof att === 'object' && 
                  att.role && 
                  (att.role.toLowerCase() === 'chair' || att.role.toLowerCase() === 'organizer')
                )?.email || ''
              : '',
            name: ''
          },
          attendees: [{
            email: attendeeEmail,
            name: userDetails.username,
            role: 'REQ-PARTICIPANT',
            status: status
          }],
          status: 'CONFIRMED'
        };

        // Only initialize email service if we have an organizer email
        if (eventData.organizer.email) {
          await emailService.initialize(userDetails.id);
          
          // If there's a comment, include it in the email
          if (comment) {
            eventData.description = `Attendee comment: ${comment}\n\n${eventData.description || ''}`;
          }

          // If there's a proposed time, include it in the email
          if (proposedStart && proposedEnd) {
            eventData.description = `Proposed new time: ${new Date(proposedStart).toLocaleString()} - ${new Date(proposedEnd).toLocaleString()}\n\n${eventData.description || ''}`;
          }

          await emailService.sendEventInvitation(userDetails.id, eventData);
        }

      } catch (error) {
        console.error("Error sending response notification:", error);
        // Continue without failing the request
      }

      res.json(updatedEvent);
    } catch (err) {
      console.error("Error responding to event invitation:", err);
      return handleZodError(err, res);
    }
  });

  app.get("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      let allEvents: Event[] = [];
      
      // Check if calendarIds is provided as an array in the query parameter
      if (req.query.calendarIds) {
        // Convert array-like string to actual array of numbers
        let calendarIds: number[] = [];
        
        if (Array.isArray(req.query.calendarIds)) {
          // Handle case when it's already an array in req.query
          calendarIds = req.query.calendarIds.map(id => parseInt(id as string)).filter(id => !isNaN(id));
        } else if (typeof req.query.calendarIds === 'string') {
          // Handle case when it's a JSON string array
          try {
            const parsed = JSON.parse(req.query.calendarIds);
            if (Array.isArray(parsed)) {
              calendarIds = parsed.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
            }
          } catch (e) {
            // If not a valid JSON, try comma-separated values
            calendarIds = req.query.calendarIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
          }
        }
        
        // Get events for each calendar ID
        if (calendarIds.length > 0) {
          for (const calendarId of calendarIds) {
            const calendarEvents = await storage.getEvents(calendarId);
            allEvents = [...allEvents, ...calendarEvents];
          }
          return res.json(allEvents);
        }
      }
      
      // If no calendarIds array, check for single calendarId
      if (req.query.calendarId) {
        const calendarId = parseInt(req.query.calendarId as string);
        
        if (isNaN(calendarId)) {
          return res.status(400).json({ message: "Invalid calendar ID" });
        }
        
        // Get events from the calendar
        const events = await storage.getEvents(calendarId);
        
        // Check if this is a shared calendar
        const sharedCalendars = await storage.getSharedCalendars(userId);
        const sharedCalendar = sharedCalendars.find(cal => cal.id === calendarId);
        
        if (sharedCalendar) {
          // It's a shared calendar - add sharing metadata to each event
          const enhancedEvents = events.map(event => {
            // Add sharing information safely
            let existingRawData = {};
            
            // Safely parse the raw data if it's a string
            if (typeof event.rawData === 'string') {
              try {
                // Check if it's iCalendar format (begins with BEGIN:VCAL)
                if (event.rawData.trim().startsWith('BEGIN:VCAL')) {
                  // It's an iCalendar string, not JSON, so create a new object
                  existingRawData = {};
                } else {
                  // Try to parse as JSON
                  existingRawData = JSON.parse(event.rawData || '{}');
                }
              } catch (e) {
                console.log(`Could not parse rawData as JSON for event ${event.id}, using empty object`);
                existingRawData = {};
              }
            } else if (event.rawData && typeof event.rawData === 'object') {
              existingRawData = event.rawData;
            }
            
            // Create a new metadata object with sharing information
            const sharingMetadata = {
              isShared: true,
              permissionLevel: sharedCalendar.permissionLevel || 'view',
              ownerName: sharedCalendar.owner?.username || sharedCalendar.owner?.email,
              calendarName: sharedCalendar.name,
              calendarColor: sharedCalendar.color
            };
            
            // Return the event with sharing metadata
            return {
              ...event,
              // Store sharing info separately to avoid modifying the original rawData
              // which might contain iCalendar data
              sharingMetadata: sharingMetadata
            };
          });
          
          return res.json(enhancedEvents);
        }
        
        // It's a regular calendar, just return the events
        return res.json(events);
      }
      
      // If no specific calendar ID is provided, return all events from user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      
      // Create a map of shared calendars for quick lookup with permission information
      const sharedCalendarMap = new Map();
      sharedCalendars.forEach(cal => {
        sharedCalendarMap.set(cal.id, {
          isShared: true,
          permissionLevel: cal.permissionLevel || 'view',
          ownerName: cal.owner?.username || cal.owner?.email
        });
      });
      
      // Get events from all calendars and enhance with sharing information
      const allCalendars = [...userCalendars, ...sharedCalendars];
      
      for (const calendar of allCalendars) {
        const calendarEvents = await storage.getEvents(calendar.id);
        
        // Add metadata about sharing status to each event
        const enhancedEvents = calendarEvents.map(event => {
          // If this is from a shared calendar, add sharing metadata
          if (sharedCalendarMap.has(calendar.id)) {
            const sharingInfo = sharedCalendarMap.get(calendar.id);
            
            // Add sharing information to the rawData property
            let existingRawData = {};
            
            // Safely parse the raw data if it's a string
            if (typeof event.rawData === 'string') {
              try {
                // Check if it's iCalendar format (begins with BEGIN:VCAL)
                if (event.rawData.trim().startsWith('BEGIN:VCAL')) {
                  // It's an iCalendar string, not JSON, so create a new object
                  existingRawData = {};
                } else {
                  // Try to parse as JSON
                  existingRawData = JSON.parse(event.rawData || '{}');
                }
              } catch (e) {
                console.log(`Could not parse rawData as JSON for event ${event.id}, using empty object`);
                existingRawData = {};
              }
            } else if (event.rawData && typeof event.rawData === 'object') {
              existingRawData = event.rawData;
            }
            
            // Create a new metadata object with sharing information
            const sharingMetadata = {
              isShared: true,
              permissionLevel: sharingInfo.permissionLevel,
              ownerName: sharingInfo.ownerName,
              calendarName: calendar.name,
              calendarColor: calendar.color
            };
            
            // Return the event with sharing metadata
            return {
              ...event,
              // Store sharing info separately to avoid modifying the original rawData
              // which might contain iCalendar data
              sharingMetadata: sharingMetadata
            };
          }
          
          return event;
        });
        
        allEvents = [...allEvents, ...enhancedEvents];
      }
      
      res.json(allEvents);
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });
  
  // Create event with enhanced synchronization
  app.post("/api/events/create-with-sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const eventData = req.body;
      
      // Convert arrays to JSON strings if needed
      if (eventData.attendees && Array.isArray(eventData.attendees)) {
        eventData.attendees = JSON.stringify(eventData.attendees);
      }
      
      if (eventData.resources && Array.isArray(eventData.resources)) {
        eventData.resources = JSON.stringify(eventData.resources);
      }
      
      // Use enhanced sync service for creation with immediate sync
      const result = await enhancedSyncService.createEventWithSync(userId, eventData);
      
      // Return the created event with sync status
      res.status(201).json({
        event: result.event,
        synced: result.synced,
        syncDetails: result.syncDetails
      });
    } catch (err) {
      console.error("Error creating event with sync:", err);
      res.status(500).json({ 
        message: "Error creating event with sync", 
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
  
  // Update event with enhanced synchronization
  app.post("/api/events/:id/update-with-sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const eventId = parseInt(req.params.id);
      
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      const eventData = req.body;
      
      // Convert arrays to JSON strings if needed
      if (eventData.attendees && Array.isArray(eventData.attendees)) {
        eventData.attendees = JSON.stringify(eventData.attendees);
      }
      
      if (eventData.resources && Array.isArray(eventData.resources)) {
        eventData.resources = JSON.stringify(eventData.resources);
      }
      
      // Use enhanced sync service for update with immediate sync
      const result = await enhancedSyncService.updateEventWithSync(userId, eventId, eventData);
      
      // Return the updated event with sync status
      res.status(200).json({
        event: result.event,
        synced: result.synced,
        syncDetails: result.syncDetails
      });
    } catch (err) {
      console.error("Error updating event with sync:", err);
      res.status(500).json({ 
        message: "Error updating event with sync", 
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
  
  // Cancel/delete event with enhanced synchronization
  app.post("/api/events/:id/cancel-with-sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const eventId = parseInt(req.params.id);
      
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      // Use enhanced sync service for cancellation with immediate sync
      const result = await enhancedSyncService.cancelEventWithSync(userId, eventId);
      
      // Return the result of the cancellation
      res.status(200).json(result);
    } catch (err) {
      console.error("Error cancelling event with sync:", err);
      res.status(500).json({ 
        message: "Error cancelling event with sync", 
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
  
  // Force bidirectional sync for calendars and events
  app.post("/api/sync/force-bidirectional", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { calendarId } = req.body;
      
      // Use enhanced sync service for forced bidirectional sync
      const result = await enhancedSyncService.forceBidirectionalSync(
        userId, 
        calendarId ? parseInt(calendarId) : undefined
      );
      
      // Return the result of the sync operation
      res.status(200).json(result);
    } catch (err) {
      console.error("Error forcing bidirectional sync:", err);
      res.status(500).json({ 
        message: "Error forcing bidirectional sync", 
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
  
  // Regular event creation endpoint
  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Handle UID generation and preservation
      // First, check if we received a uid in the request that looks like a server-generated UID
      let uid = req.body.uid;
      
      // Check if this is a client-side temporary UID (like "event-23@caldavclient.local")
      // or if it's missing entirely (then we need to generate a proper one)
      if (!uid || uid.match(/^event-\d+(@caldavclient\.local)?$/) || !uid.includes('@')) {
        // Use the centralUIDService to ensure consistent UID generation
        // This avoids the issue of multiple different UIDs for the same event
        uid = centralUIDService.generateUID();
        console.log(`[UID GENERATION] Using centralUIDService to generate consistent UID: ${uid} for event creation (replacing ${req.body.uid || 'missing uid'})`);
      } else {
        console.log(`[UID PRESERVATION] Using provided RFC5545-compliant UID: ${uid} for event creation`);
      }
      
      // Set syncStatus to pending to mark it for pushing to the server
      const eventData = {
        ...req.body,
        uid: uid,
        syncStatus: 'pending'
      };
      
      // Handle date conversions
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
      } else if (!eventData.startDate) {
        // If startDate is null/undefined, set it to the current date
        console.warn("Missing startDate in event creation, using current date");
        eventData.startDate = new Date();
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
      } else if (!eventData.endDate) {
        // If endDate is null/undefined, set it to 1 hour after startDate
        console.warn("Missing endDate in event creation, setting to 1 hour after startDate");
        const endDate = new Date(eventData.startDate.getTime());
        endDate.setHours(endDate.getHours() + 1);
        eventData.endDate = endDate;
      }
      
      // Validate that dates are valid
      if (isNaN(eventData.startDate.getTime())) {
        console.warn("Invalid startDate detected, using current date instead");
        eventData.startDate = new Date();
      }
      
      if (isNaN(eventData.endDate.getTime())) {
        console.warn("Invalid endDate detected, setting to 1 hour after startDate");
        const endDate = new Date(eventData.startDate.getTime());
        endDate.setHours(endDate.getHours() + 1);
        eventData.endDate = endDate;
      }
      
      // For all-day events, ensure the dates are properly formatted
      if (eventData.allDay === true) {
        // CRITICAL FIX: Preserve the selected date for all-day events without timezone shifting
        console.log(`[BACKEND DATE DEBUG] Original date values:`, {
          startDate: eventData.startDate.toISOString(),
          endDate: eventData.endDate.toISOString(),
          startDateLocal: eventData.startDate.toString(),
          endDateLocal: eventData.endDate.toString()
        });
        
        // Extract the date string in YYYY-MM-DD format directly from the ISO string
        // This avoids any timezone complications
        const startDateStr = eventData.startDate.toISOString().split('T')[0];
        const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
        
        // Important: When creating a Date using components, month is 0-indexed
        // So we need to subtract 1 from the month value (January = 0)
        const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        
        // Double-check that we're creating the correct date
        console.log(`[BACKEND DATE DEBUG] Original date components:`, {
          startDateStr,
          year: startYear,
          month: startMonth - 1, // JavaScript Date constructor uses 0-indexed months
          day: startDay,
          constructedDate: startDate.toISOString()
        });
        
        eventData.startDate = startDate;
        
        // Do the same for end date
        const endDateStr = eventData.endDate.toISOString().split('T')[0];
        const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
        
        // Create end date with time 00:00:00
        const endDate = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
        
        // For CalDAV all-day events, if start and end date are the same, 
        // we need to set end date to the next day
        if (startDateStr === endDateStr) {
          // Create a new date to avoid modifying the date twice
          const nextDayDate = new Date(endDate);
          nextDayDate.setDate(nextDayDate.getDate() + 1);
          eventData.endDate = nextDayDate;
          
          console.log(`[BACKEND DATE DEBUG] Adjusted end date to next day:`, {
            originalEnd: endDate.toISOString(),
            adjustedEnd: nextDayDate.toISOString()
          });
        } else {
          eventData.endDate = endDate;
        }
        
        console.log(`[BACKEND DATE DEBUG] Final date values for all-day event:`, {
          startDate: eventData.startDate.toISOString(),
          endDate: eventData.endDate.toISOString()
        });
      }
      
      // Convert arrays to JSON strings
      if (eventData.attendees && Array.isArray(eventData.attendees)) {
        eventData.attendees = JSON.stringify(eventData.attendees);
      }
      
      if (eventData.resources && Array.isArray(eventData.resources)) {
        eventData.resources = JSON.stringify(eventData.resources);
      }
      
      const validatedData = insertEventSchema.parse(eventData);
      const newEvent = await storage.createEvent(validatedData);
      
      // Wait a moment to ensure event is saved in database
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mark the event as pending for sync (in case it was set to 'local' by default)
      await storage.updateEvent(newEvent.id, { syncStatus: 'pending' });
      
      // Now get the updated event to ensure syncStatus is set correctly
      const updatedEvent = await storage.getEvent(newEvent.id);
      
      if (!updatedEvent) {
        res.status(201).json({
          ...newEvent,
          syncTriggered: false,
          syncSuccess: false,
          syncError: 'Event was created but could not be retrieved for syncing'
        });
        return;
      }
      
      console.log(`Event created with syncStatus: ${updatedEvent.syncStatus}`);
      
      // Trigger immediate CalDAV synchronization for the new event
      try {
        console.log(`Triggering immediate sync for new event ${updatedEvent.id} with UID ${updatedEvent.uid}`);
        
        // Verify this event is marked as pending before syncing
        if (updatedEvent.syncStatus !== 'pending') {
          console.log(`Warning: Event ${updatedEvent.id} has syncStatus=${updatedEvent.syncStatus}, updating to 'pending'`);
          await storage.updateEvent(updatedEvent.id, { syncStatus: 'pending' });
        }
        
        // Trigger a push sync operation for the user
        const success = await syncService.pushLocalEvents(userId, updatedEvent.calendarId);
        
        console.log(`Immediate sync result for new event: ${success ? 'successful' : 'failed'}`);
        
        // Add sync status to response
        res.status(201).json({
          ...updatedEvent,
          syncTriggered: true,
          syncSuccess: success
        });
      } catch (syncErr) {
        console.error("Error during immediate sync after event creation:", syncErr);
        // Still return 201 since the event was created successfully, but include sync error
        res.status(201).json({
          ...updatedEvent,
          syncTriggered: true,
          syncSuccess: false,
          syncError: syncErr instanceof Error ? syncErr.message : String(syncErr)
        });
      }
    } catch (err) {
      console.error("Error creating event:", err);
      return handleZodError(err, res);
    }
  });
  
  // Delete an event
  app.delete("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      // Get the existing event to check if it has a URL and etag (meaning it exists on the server)
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Prepare response object with more detailed status information
      const response = {
        success: false,
        id: eventId,
        message: '',
        sync: {
          attempted: false,
          succeeded: false,
          noConnection: true,
          error: null
        }
      };
      
      // If the event exists on the server, we should directly delete it (not cancel it)
      if (event.url && event.etag) {
        try {
          // Get the user's server connection
          const userId = req.user!.id;
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            response.sync.noConnection = false;
            response.sync.attempted = true;
            
            // Create a DAV client with additional headers
            const { DAVClient } = await import('tsdav');
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            // Login to the server
            await davClient.login();
            
            // Perform direct deletion using fetch directly instead of davClient for more reliability
            console.log(`Deleting event with UID: ${event.uid} from server`);
            
            try {
              // Get the calendar URL without the specific event
              const calendarUrl = event.url.substring(0, event.url.lastIndexOf('/') + 1);
              const eventFilename = event.url.substring(event.url.lastIndexOf('/') + 1);
              
              console.log(`Performing direct HTTP DELETE to ${event.url}`);
              console.log(`Calendar base URL: ${calendarUrl}, Event filename: ${eventFilename}`);

              // Create auth header
              const authHeader = 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64');
              
              // Use a fetch request with proper headers
              const fetchOptions = {
                method: 'DELETE',
                headers: {
                  'Authorization': authHeader,
                  'If-Match': event.etag || '*',
                  'Content-Type': 'text/calendar; charset=utf-8'
                }
              };
              
              console.log(`Deleting from CalDAV server with If-Match: ${event.etag || '*'}`);
              
              const fetchResponse = await fetch(event.url, fetchOptions);
              
              console.log(`Delete response status: ${fetchResponse.status}`);
              
              // 2xx status codes indicate success
              if (fetchResponse.status >= 200 && fetchResponse.status < 300) {
                response.sync.succeeded = true;
                console.log(`Successfully deleted event ${eventId} from CalDAV server`);
              } else {
                const responseText = await fetchResponse.text();
                response.sync.error = `Server returned status ${fetchResponse.status} for deletion`;
                console.error(`Failed to delete event ${eventId} from server: Status ${fetchResponse.status}, Response: ${responseText}`);
                
                // Try the davClient method as fallback
                try {
                  console.log(`Trying davClient method as fallback...`);
                  const deleteResponse = await davClient.deleteCalendarObject({
                    calendarObject: {
                      url: event.url,
                      etag: event.etag
                    }
                  });
                  
                  if (deleteResponse && deleteResponse.status >= 200 && deleteResponse.status < 300) {
                    response.sync.succeeded = true;
                    console.log(`Successfully deleted event ${eventId} from CalDAV server using davClient fallback`);
                  } else {
                    console.error(`davClient fallback also failed with status:`, deleteResponse);
                  }
                } catch (davClientError) {
                  console.error(`davClient fallback also failed:`, davClientError);
                }
              }
            } catch (deleteError) {
              console.error(`Error deleting event ${eventId} from CalDAV server:`, deleteError);
              response.sync.error = `Error deleting event: ${deleteError.message}`;
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete event on server`);
            response.sync.noConnection = true;
          }
        } catch (error) {
          console.error(`Error deleting event ${eventId} from CalDAV server:`, error);
          response.sync.error = error.message || 'Error communicating with CalDAV server';
          // Continue with local deletion even if server deletion fails
        }
      }
      
      // Skip session tracking of deleted events - we're deleting them properly now
      
      // Delete the event locally FIRST to ensure it disappears from UI immediately
      console.log(`Immediately deleting event ${eventId} from local database`);
      const success = await storage.deleteEvent(eventId);
      
      if (!success) {
        console.error(`Failed to delete event ${eventId} from local database`);
        response.success = false;
        response.message = "Failed to delete event from local database";
        return res.status(500).json(response);
      }
      
      // Send WebSocket notification about the deleted event to update UI in real-time
      try {
        const { notifyEventChanged } = require('./websocket-handler');
        
        // Notify the user who made the change - enhanced with more data for better client-side handling
        notifyEventChanged(req.user!.id, eventId, 'deleted', {
          title: event.title || 'Unnamed event',
          calendarId: event.calendarId,
          calendarName: (await storage.getCalendar(event.calendarId))?.name || 'Unknown',
          isExternalChange: false,
          uid: event.uid || null, // Add UID for better client-side filtering
          startDate: event.startDate, // Add startDate for signature generation on client
          endDate: event.endDate // Also add endDate for all-day event signature generation
        });
        console.log(`Enhanced WebSocket notification sent for event deletion: ${event.title} (ID: ${eventId}, UID: ${event.uid || 'none'})`);
      } catch (wsError) {
        console.error("Error sending WebSocket notification for event deletion:", wsError);
        // Continue without failing - this is a non-critical error
      }
      
      // If server deletion failed but local deletion succeeded,
      // immediately force a sync with the special flag to ensure the event stays deleted
      if (response.sync.attempted && !response.sync.succeeded) {
        console.log(`Server deletion attempted but failed. Forcing sync with preserveLocalDeletes=true...`);
        
        // Force an immediate sync with the preserveLocalDeletes flag
        syncService.syncNow(req.user!.id, {
          forceRefresh: true,
          preserveLocalDeletes: true, // This special flag will ensure deleted events stay deleted
          calendarId: event.calendarId // Only sync the affected calendar
        }).catch(syncErr => {
          console.error("Error during forced sync after deletion:", syncErr);
        });
      }
      
      // Prepare the final response
      response.success = success;
      if (success) {
        response.message = "Event deleted successfully";
        
        // Force a calendar sync to make sure changes are propagated
        syncService.syncNow(req.user!.id, {
          forceRefresh: true,
          preserveLocalEvents: false,
          preserveLocalDeletes: true // Ensure the sync respects local deletions
        });
        
        return res.status(200).json(response);
      } else {
        response.message = "Failed to delete event from local database";
        return res.status(500).json(response);
      }
    } catch (err) {
      console.error("Error deleting event:", err);
      res.status(500).json({ 
        success: false, 
        message: "Failed to delete event", 
        error: err.message || 'Unknown error'
      });
    }
  });
  
  // Bulk event deletion with filters
  // Using POST for bulk delete to ensure body is properly handled by all clients/servers
  app.post("/api/events/bulk/delete", isAuthenticated, async (req, res) => {
    try {
      console.log("Bulk delete request received:", req.body);
      
      const userId = req.user!.id;
      const { 
        calendarIds, 
        deleteFrom, 
        year,
        month,
        day,
        deleteScope 
      } = req.body;
      
      if (!Array.isArray(calendarIds) || calendarIds.length === 0) {
        return res.status(400).json({ message: "At least one calendar ID must be provided" });
      }
      
      if (!['local', 'server', 'both'].includes(deleteFrom)) {
        return res.status(400).json({ message: "Invalid deleteFrom value. Must be 'local', 'server', or 'both'" });
      }
      
      // Validate that the user has access to these calendars
      const userCalendars = await storage.getCalendars(userId);
      const validCalendarIds = userCalendars.map(cal => cal.id);
      
      const invalidCalendars = calendarIds.filter(id => !validCalendarIds.includes(id));
      if (invalidCalendars.length > 0) {
        return res.status(403).json({ 
          message: "Access denied to one or more calendars",
          invalidCalendars
        });
      }
      
      // Get all events for the selected calendars
      let allEvents: Event[] = [];
      for (const calendarId of calendarIds) {
        const events = await storage.getEvents(calendarId);
        allEvents = [...allEvents, ...events];
      }
      
      // Apply additional filters
      let filteredEvents = [...allEvents];
      
      // Apply date filters if provided
      if (deleteScope !== 'all') {
        filteredEvents = filteredEvents.filter(event => {
          // Handle case when startDate might be null or invalid
          if (!event.startDate) {
            console.log(`Skipping event ${event.id} with no startDate`);
            return false;
          }
          
          try {
            const eventDate = new Date(event.startDate);
            
            // Check if date is valid
            if (isNaN(eventDate.getTime())) {
              console.log(`Skipping event ${event.id} with invalid date: ${event.startDate}`);
              return false;
            }
            
            // Filter by year if specified
            if (year !== undefined && eventDate.getFullYear() !== year) {
              return false;
            }
            
            // Filter by month if specified (note: JavaScript months are 0-based)
            if (month !== undefined && eventDate.getMonth() !== month - 1) {
              return false;
            }
            
            // Filter by day if specified
            if (day !== undefined && eventDate.getDate() !== day) {
              return false;
            }
            
            return true;
          } catch (error) {
            console.error(`Error filtering event ${event.id}:`, error);
            return false;
          }
        });
      }
      
      console.log(`Bulk deleting ${filteredEvents.length} events from ${calendarIds.length} calendars with deleteFrom=${deleteFrom}`);
      
      // Track successfully deleted events
      const locallyDeleted: number[] = [];
      const serverDeleted: number[] = [];
      const errors: any[] = [];
      
      // Get server connection if we need to delete from server
      let connection;
      let davClient;
      
      if (deleteFrom === 'server' || deleteFrom === 'both') {
        connection = await storage.getServerConnection(userId);
        
        if (!connection || connection.status !== 'connected') {
          return res.status(400).json({ 
            message: "Server connection not available. Cannot delete events from server.",
            locallyDeleted,
            serverDeleted,
            errors
          });
        }
        
        // Create DAV client for server operations
        const { DAVClient } = await import('tsdav');
        davClient = new DAVClient({
          serverUrl: connection.url,
          credentials: {
            username: connection.username,
            password: connection.password
          },
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        // Login to the server
        await davClient.login();
      }
      
      // Process each event
      for (const event of filteredEvents) {
        try {
          // Delete from server if requested and event has server info
          if ((deleteFrom === 'server' || deleteFrom === 'both') && 
              event.url && event.etag && davClient) {
            try {
              // Perform direct deletion using fetch directly instead of davClient for more reliability
              console.log(`Directly deleting event ${event.id} with UID: ${event.uid} from server`);
              
              // Create auth header
              const authHeader = 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64');
              
              // Use a fetch request with proper headers
              const fetchOptions = {
                method: 'DELETE',
                headers: {
                  'Authorization': authHeader,
                  'If-Match': event.etag || '*',
                  'Content-Type': 'text/calendar; charset=utf-8'
                }
              };
              
              console.log(`Bulk delete: Deleting from CalDAV server with If-Match: ${event.etag || '*'}`);
              
              // Use fetch for more direct control over the request
              const fetchResponse = await fetch(event.url, fetchOptions);
              
              if (fetchResponse.status >= 200 && fetchResponse.status < 300) {
                console.log(`Successfully deleted event ${event.id} from CalDAV server (status: ${fetchResponse.status})`);
              } else {
                // Fall back to davClient if fetch fails
                console.log(`Fetch delete failed with status ${fetchResponse.status}, trying davClient fallback...`);
                await davClient.deleteCalendarObject({
                  calendarObject: {
                    url: event.url,
                    etag: event.etag
                  }
                });
              }
              
              serverDeleted.push(event.id);
              console.log(`Successfully deleted event ${event.id} from CalDAV server`);
            } catch (serverError) {
              console.error(`Error deleting event ${event.id} from server:`, serverError);
              errors.push({
                eventId: event.id,
                message: "Failed to delete from server",
                error: serverError
              });
              
              // If we're only deleting from server, continue to next event
              if (deleteFrom === 'server') {
                continue;
              }
            }
          }
          
          // Delete locally if requested
          if (deleteFrom === 'local' || deleteFrom === 'both') {
            const success = await storage.deleteEvent(event.id);
            
            if (success) {
              locallyDeleted.push(event.id);
              
              // Send websocket notification for immediate UI update
              try {
                const { notifyEventChanged } = require('./websocket-handler');
                notifyEventChanged(userId, event.id, 'deleted', {
                  title: event.title || 'Unnamed event',
                  calendarId: event.calendarId,
                  calendarName: (await storage.getCalendar(event.calendarId))?.name || 'Unknown',
                  isExternalChange: false,
                  uid: event.uid || null, // Add UID for better client-side filtering
                  startDate: event.startDate, // Add startDate for signature generation on client
                  endDate: event.endDate // Also add endDate for all-day event signature generation
                });
              } catch (wsError) {
                console.error("Error sending WebSocket notification for bulk deletion:", wsError);
                // Continue without failing - this is a non-critical error
              }
            } else {
              errors.push({
                eventId: event.id,
                message: "Failed to delete locally",
                error: "Unknown error"
              });
            }
          }
        } catch (error) {
          console.error(`Error processing event ${event.id} for deletion:`, error);
          errors.push({
            eventId: event.id,
            message: "Failed to process event",
            error
          });
        }
      }
      
      // Force a sync that respects local deletions if we've deleted events locally
      if (locallyDeleted.length > 0 && req.user) {
        syncService.syncNow(req.user.id, {
          forceRefresh: true,
          preserveLocalDeletes: true // Ensure the sync respects local deletions
        }).catch(err => {
          console.error('Error during sync after bulk deletion:', err);
        });
      }

      // Return a summary of what was deleted
      res.json({
        success: true,
        message: `Processed ${filteredEvents.length} events for deletion`,
        stats: {
          totalEvents: filteredEvents.length,
          locallyDeleted: locallyDeleted.length,
          serverDeleted: serverDeleted.length,
          errors: errors.length
        },
        details: {
          locallyDeletedIds: locallyDeleted,
          serverDeletedIds: serverDeleted,
          errors
        }
      });
    } catch (err) {
      console.error("Error in bulk event deletion:", err);
      res.status(500).json({ 
        message: "Failed to delete events",
        error: err
      });
    }
  });
  
  // Utility endpoint to cleanup duplicate untitled events
  app.post("/api/cleanup-duplicate-events", isAuthenticated, async (req, res) => {
    try {
      const { date, calendarId } = req.body;
      
      if (!date || !calendarId) {
        return res.status(400).json({ error: 'Missing date or calendarId parameter' });
      }
      
      console.log(`Cleaning up untitled events for date ${date} and calendar ${calendarId}`);
      
      // Get all events for the calendar
      const allEvents = await storage.getEvents(calendarId);
      console.log(`Total events in calendar ${calendarId}: ${allEvents.length}`);
      
      // Find all Untitled Events on the specified date
      const targetDateStr = new Date(date).toISOString().split('T')[0]; // Get just the date part
      console.log(`Looking for events on date: ${targetDateStr}`);
      
      // Find all untitled events (any case variations)
      const untitledEvents = allEvents.filter(event => {
        try {
          // Handle both null dates and actual dates
          let eventDate = null;
          if (event.startDate) {
            const eventDateObj = new Date(event.startDate);
            eventDate = isNaN(eventDateObj.getTime()) ? null : eventDateObj.toISOString().split('T')[0];
          }
          
          // Check for any case variations of "Untitled Event"
          const isTitleMatch = event.title && 
                               (event.title.toLowerCase() === 'untitled event' || 
                                event.title === 'Untitled Event');
          
          const isDateMatch = eventDate === targetDateStr;
          
          // Debug output
          if (isTitleMatch) {
            console.log(`Found untitled event: ID=${event.id}, title="${event.title}", date=${eventDate}, matches=${isDateMatch}`);
          }
          
          return isTitleMatch && isDateMatch;
        } catch (error) {
          console.error(`Error processing event ${event.id}:`, error);
          return false;
        }
      });
      
      console.log(`Found ${untitledEvents.length} untitled events for date ${targetDateStr}`);
      
      // Always attempt to clean up any duplicate "Untitled Event" entries,
      // even if there's only one per calendar - they might be duplicates across different calendars
      if (untitledEvents.length >= 1) {
        // Sort by ID to get the oldest one (first created)
        untitledEvents.sort((a, b) => a.id - b.id);
        
        // Keep the first one, delete the rest
        const eventsToDelete = untitledEvents.slice(1);
        
        if (eventsToDelete.length > 0) {
          console.log(`Deleting ${eventsToDelete.length} duplicate untitled events:`, eventsToDelete.map(e => e.id));
          
          for (const event of eventsToDelete) {
            console.log(`Deleting untitled event ID: ${event.id}`);
            const success = await storage.deleteEvent(event.id);
            
            if (success && req.user) {
              // Send websocket notification for immediate UI update
              try {
                const { notifyEventChanged } = require('./websocket-handler');
                notifyEventChanged(req.user.id, event.id, 'deleted', {
                  title: event.title || 'Untitled event',
                  calendarId: event.calendarId,
                  calendarName: (await storage.getCalendar(event.calendarId))?.name || 'Unknown',
                  isExternalChange: false,
                  uid: event.uid || null, // Add UID for better client-side filtering
                  startDate: event.startDate, // Add startDate for signature generation on client
                  endDate: event.endDate // Also add endDate for all-day event signature generation
                });
              } catch (wsError) {
                console.error("Error sending WebSocket notification for cleanup deletion:", wsError);
                // Continue without failing - this is a non-critical error
              }
            }
          }
          
          // Also attempt to clean up the event from the server
          if (req.user) {
            syncService.syncNow(req.user.id, {
              forceRefresh: true,
              preserveLocalDeletes: true // Ensure the sync respects local deletions
            }).catch(err => {
              console.error('Error during sync after cleanup:', err);
            });
          }
          
          return res.json({ 
            success: true, 
            message: `Deleted ${eventsToDelete.length} duplicate untitled events.`,
            deletedIds: eventsToDelete.map(e => e.id)
          });
        } else {
          // If all calendars have been checked and we've deleted everything we can,
          // check if there are still outstanding untitled events
          console.log(`No more duplicate untitled events to clean on this calendar.`);
          
          return res.json({ 
            success: true, 
            message: 'No more duplicate untitled events found to clean up.'
          });
        }
      } else {
        return res.json({ 
          success: true, 
          message: 'No untitled events found to clean up.'
        });
      }
    } catch (err) {
      console.error('Error cleaning up duplicate events:', err);
      res.status(500).json({ error: 'Failed to cleanup duplicate events' });
    }
  });
  
  app.put("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }
      
      // Get the existing event
      const existingEvent = await storage.getEvent(eventId);
      if (!existingEvent) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Process the update data - CRITICAL: Always preserve the UID
      const updateData = { 
        ...req.body,
        // CRITICAL FIX: Always preserve the original UID to maintain event identity
        uid: existingEvent.uid 
      };
      
      // Log UID preservation for debugging
      if (req.body.uid && req.body.uid !== existingEvent.uid) {
        console.log(`[UID PRESERVATION] Request attempted to change UID from ${existingEvent.uid} to ${req.body.uid}`);
        console.log(`[UID PRESERVATION] Enforcing original UID ${existingEvent.uid} for event continuity`);
      }
      
      // Handle date conversions
      if (typeof updateData.startDate === 'string') {
        updateData.startDate = new Date(updateData.startDate);
      } else if (updateData.startDate === null || updateData.startDate === undefined) {
        // Keep existing startDate if not provided
        updateData.startDate = existingEvent.startDate;
      }
      
      if (typeof updateData.endDate === 'string') {
        updateData.endDate = new Date(updateData.endDate);
      } else if (updateData.endDate === null || updateData.endDate === undefined) {
        // Keep existing endDate if not provided
        updateData.endDate = existingEvent.endDate;
      }
      
      // Validate that dates are valid
      if (updateData.startDate && isNaN(updateData.startDate.getTime())) {
        console.warn("Invalid startDate detected in update, keeping existing value");
        updateData.startDate = existingEvent.startDate;
      }
      
      if (updateData.endDate && isNaN(updateData.endDate.getTime())) {
        console.warn("Invalid endDate detected in update, keeping existing value");
        updateData.endDate = existingEvent.endDate;
      }
      
      // For all-day events, ensure the dates are properly formatted
      if (updateData.allDay === true) {
        // CRITICAL FIX: Preserve the selected date for all-day events without timezone shifting
        console.log(`[BACKEND DATE DEBUG] Event update - Original date values:`, {
          startDate: updateData.startDate ? updateData.startDate.toISOString() : null,
          endDate: updateData.endDate ? updateData.endDate.toISOString() : null,
          startDateLocal: updateData.startDate ? updateData.startDate.toString() : null,
          endDateLocal: updateData.endDate ? updateData.endDate.toString() : null
        });
        
        if (updateData.startDate) {
          // Extract date string from ISO to avoid timezone issues
          const startDateStr = updateData.startDate.toISOString().split('T')[0];
          const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
          
          // Create date using components with month - 1 (JS months are 0-indexed)
          const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
          
          console.log(`[BACKEND DATE DEBUG] Event update - Start date components:`, {
            startDateStr,
            year: startYear,
            month: startMonth - 1, // Adjusted for JS Date 0-indexed months
            day: startDay,
            constructedDate: startDate.toISOString()
          });
          
          updateData.startDate = startDate;
        }
        
        if (updateData.endDate) {
          // Do the same for end date
          const endDateStr = updateData.endDate.toISOString().split('T')[0];
          const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
          
          // Create end date with time 00:00:00
          const endDate = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);
          
          // For single-day all-day events, end date should be the next day in CalDAV
          if (updateData.startDate) {
            const startDateStr = updateData.startDate.toISOString().split('T')[0];
            
            if (startDateStr === endDateStr) {
              // Create a new date to avoid modifying the date twice
              const nextDayDate = new Date(endDate);
              nextDayDate.setDate(nextDayDate.getDate() + 1);
              updateData.endDate = nextDayDate;
              
              console.log(`[BACKEND DATE DEBUG] Event update - Adjusted end date to next day:`, {
                originalEnd: endDate.toISOString(),
                adjustedEnd: nextDayDate.toISOString()
              });
            } else {
              updateData.endDate = endDate;
            }
          } else {
            updateData.endDate = endDate;
          }
        }
        
        console.log(`[BACKEND DATE DEBUG] Event update - Final date values:`, {
          startDate: updateData.startDate ? updateData.startDate.toISOString() : null,
          endDate: updateData.endDate ? updateData.endDate.toISOString() : null
        });
      }
      
      // Convert arrays to JSON strings
      if (updateData.attendees && Array.isArray(updateData.attendees)) {
        updateData.attendees = JSON.stringify(updateData.attendees);
      }
      
      if (updateData.resources && Array.isArray(updateData.resources)) {
        updateData.resources = JSON.stringify(updateData.resources);
      }
      
      // Always set sync status to 'pending' for updated events to push changes to the server
      updateData.syncStatus = 'pending';
      updateData.lastSyncAttempt = new Date();
      
      // Add event modification tracking information
      if (req.user) {
        // Get user information for tracking who made the change
        const userId = req.user.id;
        const username = req.user.username || req.user.email || `User ${userId}`;
        
        // Add change tracking fields
        updateData.lastModifiedBy = userId;
        updateData.lastModifiedByName = username;
        updateData.lastModifiedAt = new Date();
        
        console.log(`Tracking event modification by ${username} (ID: ${userId})`);
      } else {
        console.warn('Event modified without user context - cannot track changes properly');
      }
      
      // Update the event
      const updatedEvent = await storage.updateEvent(eventId, updateData);
      
      // Check if the event has attendees to determine if email workflow is needed
      let hasAttendees = false;
      
      if (updateData.attendees) {
        const attendeesArray = JSON.parse(typeof updateData.attendees === 'string' 
          ? updateData.attendees 
          : JSON.stringify(updateData.attendees));
        hasAttendees = Array.isArray(attendeesArray) && attendeesArray.length > 0;
      } else if (existingEvent.attendees) {
        const attendeesArray = JSON.parse(typeof existingEvent.attendees === 'string'
          ? existingEvent.attendees
          : JSON.stringify(existingEvent.attendees));
        hasAttendees = Array.isArray(attendeesArray) && attendeesArray.length > 0;
      }
      
      // Send real-time update notification via WebSocket
      if (req.user) {
        try {
          const { notifyEventChanged } = require('./websocket-handler');
          
          // Notify the user who made the change
          notifyEventChanged(req.user.id, eventId, 'updated', {
            title: updatedEvent.title,
            calendarId: updatedEvent.calendarId,
            calendarName: (await storage.getCalendar(updatedEvent.calendarId))?.name || 'Unknown',
            isExternalChange: false
          });
          
          console.log(`WebSocket notification sent for event update: ${updatedEvent.title} (ID: ${eventId})`);
          
          // Create notification in the database
          const { createNotification } = await import('./notification-service');
          await createNotification({
            userId: req.user.id,
            type: 'event_update',
            title: 'Event Updated',
            message: `"${updatedEvent.title}" was updated`,
            priority: 'medium',
            relatedEventId: updatedEvent.id,
            relatedEventUid: updatedEvent.uid,
            requiresAction: false,
            isRead: false,
            isDismissed: false,
            actionTaken: false
          });
        } catch (wsError) {
          console.error("Error sending WebSocket notification:", wsError);
          // Continue without failing the request
        }
      }
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json({ 
        success: true, 
        event: updatedEvent,
        hasAttendees
      });
    } catch (err) {
      console.error("Error updating event:", err);
      return handleZodError(err, res);
    }
  });
  
  // CALENDAR SHARING API
  app.get("/api/shared-calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      try {
        // First try the memory storage direct method which seems more reliable
        const sharedCalendars = await storage.getSharedCalendars(userId);
        console.log(`Returning ${sharedCalendars.length} shared calendars using memory storage implementation`);
        
        res.setHeader('Content-Type', 'application/json');
        return res.json(sharedCalendars);
      } catch (memoryError) {
        console.error("Error with memory storage implementation:", memoryError);
        
        try {
          // Fall back to the fixed Drizzle implementation
          const { getSharedCalendars } = await import('./calendar-sharing-fix');
          
          const sharedCalendars = await getSharedCalendars(userId, storage);
          console.log(`Returning ${sharedCalendars.length} shared calendars using fixed implementation`);
          
          res.setHeader('Content-Type', 'application/json');
          return res.json(sharedCalendars);
        } catch (fixError) {
          console.error("Error with fixed implementation:", fixError);
          throw fixError; // Let the outer catch handle this
        }
      }
    } catch (err) {
      console.error("Error fetching shared calendars:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch shared calendars", error: err.message });
    }
  });
  
  app.post("/api/calendar-sharing", isAuthenticated, async (req, res) => {
    try {
      const sharingData = {
        ...req.body,
        sharedByUserId: req.user!.id
      };
      
      // Debug logging for permission levels
      console.log(`Calendar sharing request with permission: ${req.body.permissionLevel}`, sharingData);
      
      const validatedData = insertCalendarSharingSchema.parse(sharingData);
      console.log(`Validated calendar sharing data with permission: ${validatedData.permissionLevel}`);
      
      const newSharing = await storage.shareCalendar(validatedData);
      console.log(`Created new calendar sharing with ID ${newSharing.id}, permission: ${newSharing.permissionLevel}`);
      
      res.status(201).json(newSharing);
    } catch (err) {
      console.error("Error sharing calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // Update calendar sharing permissions
  app.patch("/api/calendar-sharings/:id", isAuthenticated, async (req, res) => {
    try {
      const sharingId = parseInt(req.params.id);
      console.log(`Updating calendar sharing permissions for sharing ID ${sharingId} by user ${req.user?.id}`);
      console.log(`Request body:`, req.body);
      
      // Validate the permission level
      // CRITICAL FIX: Enhance permission validation to handle more permission format variations
      const requestedPermission = req.body.permissionLevel ? req.body.permissionLevel.toLowerCase().trim() : '';

      // Normalize variations of edit permissions 
      if (requestedPermission && !['view', 'edit', 'write', 'readwrite', 'read-write'].includes(requestedPermission)) {
        // If it contains "edit" or "write" substring, treat as "edit"
        if (requestedPermission.includes('edit') || requestedPermission.includes('write')) {
          console.log(`Normalizing permission "${requestedPermission}" to "edit"`);
          req.body.permissionLevel = 'edit';
        } else {
          return res.status(400).json({ 
            message: "Invalid permission level. Must be 'view' or 'edit' (or variations like 'write', 'readwrite')." 
          });
        }
      }
      
      // CRITICAL FIX: Default to "edit" if no permission level is provided
      if (!req.body.permissionLevel) {
        console.log(`No permission level specified, defaulting to "edit"`);
        req.body.permissionLevel = 'edit';
      }
      
      // Get all sharing records and find the one we want to update
      const sharingRecords = await storage.getAllCalendarSharings();
      console.log(`Got ${sharingRecords.length} total sharing records`);
      
      const sharingRecord = sharingRecords.find(record => record.id === sharingId);
      console.log(`Looking for sharing ID ${sharingId}, found:`, sharingRecord || "not found");
      
      if (!sharingRecord) {
        return res.status(404).json({ message: "Calendar sharing record not found" });
      }
      
      // Check if the user has permission to update this sharing record
      // Only allow update if they are the calendar owner (they shared it) or the recipient
      const calendar = await storage.getCalendar(sharingRecord.calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      const isCalendarOwner = calendar.userId === req.user!.id;
      const isRecipient = sharingRecord.sharedWithUserId === req.user!.id;
      
      if (!isCalendarOwner && !isRecipient) {
        return res.status(403).json({ 
          message: "You don't have permission to update this sharing record" 
        });
      }
      
      // Update the sharing record
      const updatedSharing = await storage.updateCalendarSharing(sharingId, {
        permissionLevel: req.body.permissionLevel
      });
      
      if (!updatedSharing) {
        return res.status(500).json({ message: "Failed to update calendar sharing" });
      }
      
      res.json(updatedSharing);
    } catch (err) {
      console.error("Error updating calendar sharing:", err);
      return handleZodError(err, res);
    }
  });
  
  // Unshare a calendar (remove sharing record)
  app.delete("/api/calendars/unshare/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      const userId = req.user!.id;
      console.log(`Unshare request for calendar ID ${calendarId} by user ${userId}`);
      
      // If calendar doesn't exist in personal calendars, it might be a shared calendar
      let calendar = await storage.getCalendar(calendarId);
      
      // First, handle the case where the user is trying to remove a calendar shared with them
      const sharedCalendars = await storage.getSharedCalendarsForUser(userId);
      const isSharedWithUser = sharedCalendars.some(cal => cal.id === calendarId);
      
      if (isSharedWithUser) {
        console.log(`Calendar ID ${calendarId} is shared with user ${userId} - finding sharing records`);
        
        // 1. Try to find it through the sharingId field first (if provided from frontend)
        let foundSharingRecords: CalendarSharing[] = [];
        
        // If this is a calendar shared with the user, find all sharing records 
        // where this user is the recipient
        const allSharingRecords = await storage.getAllCalendarSharings();
        foundSharingRecords = allSharingRecords.filter(record => 
          record.calendarId === calendarId && 
          (
            // Match by user ID (most reliable)
            record.sharedWithUserId === userId ||
            // Or by email if user ID match fails (user info might have been added later)
            (req.user!.email && record.sharedWithEmail === req.user!.email) ||
            // Or by username as fallback
            record.sharedWithEmail === req.user!.username
          )
        );
        
        if (foundSharingRecords.length > 0) {
          console.log(`Found ${foundSharingRecords.length} sharing records for calendar ${calendarId} shared with user ${userId}`);
          
          // Remove all found sharing records
          const results = await Promise.all(
            foundSharingRecords.map(record => {
              console.log(`Removing sharing record ID ${record.id} (calendar ${record.calendarId} shared with ${record.sharedWithEmail})`);
              return storage.removeCalendarSharing(record.id);
            })
          );
          
          // Check if all removals were successful
          const allSuccessful = results.every(result => result === true);
          
          if (allSuccessful) {
            console.log(`Successfully removed ${results.length} sharing records as participant`);
            return res.json({ message: "Calendar unshared successfully" });
          } else {
            console.error(`Failed to remove some sharing records: ${results}`);
            return res.status(500).json({ message: "Failed to unshare calendar completely", partial: true });
          }
        }
      }
      
      // If we get here, handle the case where the user is the calendar owner
      // First ensure the user is authorized to remove sharing (i.e., owns the calendar)
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ 
          message: "Not authorized to remove sharing for this calendar. Only the calendar owner can do that." 
        });
      }
      
      // Get all sharing records for this calendar
      const sharingRecords = await storage.getCalendarSharing(calendarId);
      console.log(`Found ${sharingRecords.length} sharing records for calendar ID ${calendarId} owned by user ${userId}`);
      
      if (sharingRecords.length === 0) {
        return res.status(404).json({ message: "No sharing records found for this calendar" });
      }
      
      // Remove all sharing records for this calendar
      const results = await Promise.all(
        sharingRecords.map(record => {
          console.log(`Removing sharing record ID ${record.id} as owner`);
          return storage.removeCalendarSharing(record.id);
        })
      );
      
      // Check if all removals were successful
      const allSuccessful = results.every(result => result === true);
      
      if (allSuccessful) {
        console.log(`Successfully removed ${results.length} sharing records as owner`);
        res.json({ message: "Calendar unshared successfully" });
      } else {
        console.error(`Failed to remove some sharing records: ${results}`);
        res.status(500).json({ message: "Failed to unshare calendar completely", partial: true });
      }
    } catch (err) {
      console.error("Error unsharing calendar:", err);
      res.status(500).json({ message: "Failed to unshare calendar", error: String(err) });
    }
  });
  
  // Get calendar shares
  app.get("/api/calendars/:id/shares", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      
      // Validate that the calendar exists
      const calendar = await storage.getCalendar(calendarId);
      
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Get the shares for this calendar
      const shares = await storage.getCalendarSharing(calendarId);
      
      // Return the shares
      res.setHeader('Content-Type', 'application/json');
      return res.json(shares);
    } catch (err) {
      console.error("Error fetching calendar shares:", err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ message: "Failed to fetch calendar shares" });
    }
  });
  
  // Individual calendar sharing API
  app.post("/api/calendars/:id/shares", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      
      // Check if calendar exists and if user has permission to share it
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Only allow the owner to share the calendar
      if (calendar.userId !== req.user!.id) {
        return res.status(403).json({ message: "You don't have permission to share this calendar" });
      }
      
      // Determine the user ID of the recipient if they exist in our system
      let sharedWithUserId: number | null = null;
      if (req.body.email) {
        const user = await storage.getUserByUsername(req.body.email);
        if (user) {
          sharedWithUserId = user.id;
        }
      }
      
      // Check if this calendar is already shared with this email address or user ID
      const existingShares = await storage.getCalendarSharing(calendarId);
      const duplicateShare = existingShares.find(share => 
        share.sharedWithEmail === req.body.email || 
        (sharedWithUserId && share.sharedWithUserId === sharedWithUserId)
      );
      
      if (duplicateShare) {
        return res.status(400).json({ 
          message: "This calendar is already shared with this user",
          existing: duplicateShare
        });
      }
      
      // Create the sharing data with enhanced permission handling
      // Get raw permission values from the request
      const rawPermissionLevel = req.body.permissionLevel;
      const rawPermission = req.body.permission;
      
      // Determine the effective permission with proper priority
      let effectivePermission;
      
      // 1. If permissionLevel is explicitly true or "true", use edit
      if (rawPermissionLevel === true || rawPermissionLevel === "true") {
        effectivePermission = 'edit';
      }
      // 2. If permission is explicitly true or "true", use edit
      else if (rawPermission === true || rawPermission === "true") {
        effectivePermission = 'edit';
      }
      // 3. If permissionLevel is a string and in our recognized formats
      else if (typeof rawPermissionLevel === 'string' && 
               ['edit', 'write', 'readwrite', 'modify'].includes(rawPermissionLevel.toLowerCase())) {
        effectivePermission = 'edit';
      }
      // 4. If permission is a string and in our recognized formats
      else if (typeof rawPermission === 'string' && 
              ['edit', 'write', 'readwrite', 'modify'].includes(rawPermission.toLowerCase())) {
        effectivePermission = 'edit';
      }
      // 5. If we have any permissionLevel value, use it (will be normalized by storage layer)
      else if (rawPermissionLevel !== undefined && rawPermissionLevel !== null) {
        effectivePermission = String(rawPermissionLevel);
      }
      // 6. If we have any permission value, use it (will be normalized by storage layer)
      else if (rawPermission !== undefined && rawPermission !== null) {
        effectivePermission = String(rawPermission);
      }
      // 7. CRITICAL FIX: Default to 'edit' instead of 'view'
      // This ensures shared calendars grant edit permissions by default
      else {
        console.log(`[PERMISSION FIX] No permission specified in share endpoint, using default 'edit' permission`);
        effectivePermission = 'edit';
      }
      
      // Log detailed permission information for debugging
      console.log(`[CALENDAR SHARING PERMISSION] Full debug:`, {
        rawPermissionLevel,
        rawPermission,
        effectivePermission,
        rawBodyKeys: Object.keys(req.body),
        rawBody: req.body
      });
      
      const sharingData = {
        calendarId,
        sharedWithEmail: req.body.email,
        sharedWithUserId: sharedWithUserId || undefined,
        permissionLevel: effectivePermission,
        // We don't need to add sharedByUserId as it gets added by the shareCalendar method
      };
      
      console.log(`Creating calendar sharing: Calendar ID ${calendarId} shared with email ${req.body.email}, permission ${req.body.permissionLevel}`);
      
      const validatedData = insertCalendarSharingSchema.parse({
        ...sharingData,
        sharedByUserId: req.user!.id
      });
      
      const newSharing = await storage.shareCalendar(validatedData);
      res.status(201).json(newSharing);
      
    } catch (err) {
      console.error("Error sharing calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // SERVER CONNECTION API
  app.get("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connection = await storage.getServerConnection(userId);
      res.setHeader('Content-Type', 'application/json');
      res.json(connection || null);
    } catch (err) {
      console.error("Error fetching server connection:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch server connection" });
    }
  });
  
  app.post("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connectionData = {
        ...req.body,
        userId,
        status: 'pending'
      };
      
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      const newConnection = await storage.createServerConnection(validatedData);
      
      res.status(201).json(newConnection);
    } catch (err) {
      console.error("Error creating server connection:", err);
      return handleZodError(err, res);
    }
  });
  
  // SMTP CONFIG API
  app.get("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const config = await storage.getSmtpConfig(userId);
      res.setHeader('Content-Type', 'application/json');
      res.json(config || null);
    } catch (err) {
      console.error("Error fetching SMTP config:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to fetch SMTP config" });
    }
  });
  
  app.post("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const configData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertSmtpConfigSchema.parse(configData);
      const newConfig = await storage.createSmtpConfig(validatedData);
      
      res.status(201).json(newConfig);
    } catch (err) {
      console.error("Error creating SMTP config:", err);
      return handleZodError(err, res);
    }
  });
  

  
  // SMTP Management API - for admin use
  app.post("/api/admin/smtp/setup-common", isAuthenticated, setupCommonSmtp);
  app.get("/api/admin/smtp/status", isAuthenticated, getSmtpStatus);
  
  // EMAIL PREVIEW API
  app.post("/api/email-preview", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      await emailService.initialize(userId);
      
      console.log('[EMAIL PREVIEW] Incoming request with eventId:', req.body.eventId, 'and original UID:', req.body.uid);
      
      // Before generating the preview, ensure we validate and get a consistent UID from centralUIDService
      // Create a copy of the request body to avoid mutating the original
      const previewData = { ...req.body };
      
      // Validate UID through centralUIDService
      const { centralUIDService } = await import('./central-uid-service');
      
      // If we have an eventId, ALWAYS validate or generate a consistent UID for it
      let validatedUid = previewData.uid;
      
      if (previewData.eventId) {
        validatedUid = await centralUIDService.validateEventUID(previewData.eventId, previewData.uid);
        console.log(`[EMAIL PREVIEW] Validated UID ${validatedUid} for event ${previewData.eventId}`);
        
        // Update the request data with validated UID
        previewData.uid = validatedUid;
      } else if (!previewData.uid) {
        // If we don't have an eventId or a UID, generate a new one
        validatedUid = centralUIDService.generateUID();
        console.log(`[EMAIL PREVIEW] Generated new UID ${validatedUid} for event without ID`);
        
        // Update the request data with new UID
        previewData.uid = validatedUid;
      }
      
      // Generate preview HTML with ensured UID consistency
      // This uses the centralUIDService internally via ensureValidUID method
      const previewHtml = await emailService.generateEmailPreview(previewData);
      
      // Important: Return the validated UID, not the original one from the request
      res.setHeader('Content-Type', 'application/json');
      res.json({ 
        html: previewHtml,
        uid: validatedUid  // Return the validated/generated UID so client can use it consistently
      });
    } catch (err) {
      console.error("Error generating email preview:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to generate email preview" });
    }
  });
  
  // EMAIL SENDING API  
  // Register enhanced cancellation test endpoints
  registerCancellationTestEndpoint(app);
  
  // TEST ENDPOINT FOR ICS FORMAT FIXES (no authentication required)
  app.post("/api/test-ics-format", async (req, res) => {
    try {
      // Use direct imports since we already have these imported at the top
      const { sanitizeAndFormatICS } = await import('./ical-utils');
      const { centralUIDService } = await import('./central-uid-service');
      
      // Generate a UID if not provided
      const eventId = req.body.eventId || Date.now();
      let uid = req.body.uid;
      
      if (!uid) {
        uid = centralUIDService.generateUID();
        console.log(`Generated new UID for test: ${uid}`);
        
        // Store this new UID if we have an event ID
        if (req.body.eventId) {
          await centralUIDService.storeUID(req.body.eventId, uid);
        }
      }
      
      // Create a test ICS with common formatting issues
      const testIcsWithIssues = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test Calendar App//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.[0-9]{3}/, '')}Z
DTSTART:20250521T033000Z
DTEND:20250521T043000Z
SUMMARY:${req.body.title || "Test Event"}
DESCRIPTION:${req.body.description || "Test Description"}
LOCATION:${req.body.location || "Test Location"}
ORGANIZER;CN=test@example.com:mailto:test@example.com
ATTENDEE;ROLE=Secretary:mailto::attendee@example.com
ATTENDEE;CUTYPE=RESOURCE;CN=Resource Name;RESOURCE-TYPE=Conference Room;X-RESOURCE-ID=resource-123;X-RESOURCE-CAPACITY=10:mailto::resource@example.com
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT
END:VCALENDAR`;
      
      // Fix the formatting issues using our sanitizeAndFormatICS function
      const fixedIcs = sanitizeAndFormatICS(testIcsWithIssues, {
        method: 'REQUEST',
        status: 'CONFIRMED',
        sequence: 0
      });
      
      // Return both versions for comparison
      res.json({
        originalIcs: testIcsWithIssues,
        fixedIcs: fixedIcs,
        uid: uid
      });
    } catch (error) {
      console.error("Error in test-ics-format endpoint:", error);
      res.status(500).json({ 
        message: "An error occurred", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/send-email", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      
      if (!user?.email) {
        return res.status(400).json({ 
          message: "User email not available. Please update your profile with a valid email."
        });
      }
      
      // Sync SMTP password with CalDAV password to ensure email sending works
      try {
        await syncSmtpPasswordWithCalDAV(userId);
        console.log(`SMTP password synchronized with CalDAV password for user ${userId} before sending email`);
      } catch (smtpSyncError) {
        console.error(`Error synchronizing SMTP password for user ${userId}:`, smtpSyncError);
        // Continue with email sending even if sync fails, as the passwords might already match
      }
      
      // Get the event data from the request
      const { 
        eventId,
        title, 
        description, 
        location, 
        startDate, 
        endDate, 
        attendees,
        resources,
        recurrenceRule
      } = req.body;
      
      // Validate required fields
      if (!title || !startDate || !endDate || !attendees) {
        return res.status(400).json({
          message: "Missing required fields (title, startDate, endDate, attendees)"
        });
      }
      
      // Parse the attendees if they're sent as a string
      let parsedAttendees;
      try {
        parsedAttendees = typeof attendees === 'string' ? JSON.parse(attendees) : attendees;
        if (!Array.isArray(parsedAttendees)) {
          throw new Error("Attendees must be an array");
        }
      } catch (error) {
        return res.status(400).json({
          message: "Invalid attendees format",
          error: (error instanceof Error) ? error.message : String(error)
        });
      }
      
      // Initialize with the user's SMTP configuration
      const initialized = await emailService.initialize(userId);
      
      if (!initialized) {
        return res.status(500).json({
          success: false,
          message: "Failed to initialize email service. Please check your SMTP configuration."
        });
      }
      
      // Format the dates to make them valid Date objects
      let parsedStartDate, parsedEndDate;
      try {
        parsedStartDate = new Date(startDate);
        parsedEndDate = new Date(endDate);
        
        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
          throw new Error("Invalid date format");
        }
      } catch (error) {
        return res.status(400).json({
          message: "Invalid date format",
          error: (error instanceof Error) ? error.message : String(error)
        });
      }
      
      // Use provided eventId or generate a unique ID for this event
      // For existing events, we must retrieve the correct UID from the central service
      // For new events, the validateEventUID method will generate one for us
      let uid: string;
      
      // First, check if there's a uid directly in the request body
      // This would be the case if we're sending after seeing a preview
      if (req.body.uid) {
        uid = req.body.uid;
        console.log(`[EmailEndpoint] Using UID from request: ${uid}`);
        
        // If we have an eventId, store this UID for consistency
        if (eventId) {
          // Check if this UID is different from what might be stored
          const storedUid = await centralUIDService.getUID(eventId);
          if (storedUid && storedUid !== uid) {
            console.warn(`[EmailEndpoint] Request UID ${uid} differs from stored UID ${storedUid}`);
            console.warn(`[EmailEndpoint] Using request UID for consistency with preview`);
            
            // Update the stored UID to match the preview UID
            await centralUIDService.storeUID(eventId, uid);
          } else if (!storedUid) {
            // Store this UID if we don't have one yet
            await centralUIDService.storeUID(eventId, uid);
            console.log(`[EmailEndpoint] Stored UID ${uid} for event ${eventId}`);
          }
        }
      } else if (eventId) {
        // If no UID in request but we have an eventId, get from central service
        try {
          uid = await centralUIDService.getUID(eventId);
          if (!uid) {
            console.error(`[ERROR] No UID found for event ${eventId} in central service`);
            // Use the centralUIDService to generate a consistent UID
            uid = centralUIDService.generateUID();
            console.log(`[RECOVERY] Generated consistent UID ${uid} for event ${eventId}`);
            // Store this UID for future reference
            await centralUIDService.storeUID(eventId, uid);
            console.log(`[RECOVERY] Stored generated UID ${uid} for event ${eventId}`);
          } else {
            console.log(`[EmailEndpoint] Using stored UID ${uid} for event ${eventId}`);
          }
        } catch (uidError) {
          console.error(`[ERROR] Failed to get UID for event ${eventId}:`, uidError);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve proper UID for event' 
          });
        }
      } else {
        // For emails without an eventId or UID, use the centralUIDService
        // to ensure all UIDs in the system follow the same consistent pattern
        uid = centralUIDService.generateUID();
        console.log(`[EmailEndpoint] Generated new UID ${uid} from centralUIDService for email`);
      }
      
      // If this is for an existing event, update the emailSent status
      if (eventId) {
        try {
          const event = await storage.getEvent(eventId);
          if (event) {
            await storage.updateEvent(eventId, { 
              emailSent: new Date().toISOString(), // Use ISO string for timestamp
              emailError: null
            });
          }
        } catch (error) {
          console.error(`Failed to update email status for event ${eventId}:`, error);
          // Continue anyway - we still want to try sending the email
        }
      }
      
      // Parse resources if they're sent as a string
      let parsedResources = [];
      if (resources) {
        try {
          parsedResources = typeof resources === 'string' ? JSON.parse(resources) : resources;
          if (!Array.isArray(parsedResources)) {
            throw new Error("Resources must be an array");
          }
        } catch (error) {
          return res.status(400).json({
            message: "Invalid resources format",
            error: (error instanceof Error) ? error.message : String(error)
          });
        }
      }
      
      // Prepare the event invitation data
      const invitationData = {
        eventId: eventId || 0,
        uid,
        title,
        description,
        location,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        organizer: {
          email: user.email,
          name: user.username || undefined
        },
        attendees: parsedAttendees.map((a: any) => ({
          email: a.email,
          name: a.name || undefined,
          role: a.role || undefined
        })),
        resources: parsedResources.length > 0 ? parsedResources : undefined,
        recurrenceRule: recurrenceRule || undefined
      };
      
      // Send the event invitation
      const result = await emailService.sendEventInvitation(userId, invitationData);
      
      // Return the result to the client
      res.setHeader('Content-Type', 'application/json');
      return res.status(result.success ? 200 : 500).json(result);
    } catch (err) {
      console.error("Error sending email:", err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ 
        success: false, 
        message: err instanceof Error ? err.message : "An unknown error occurred", 
        details: err 
      });
    }
  });
  
  // MANUAL SYNC API
  // Sync Status API endpoint - returns the current sync status
  app.get("/api/sync/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Get the server connection for this user
      const serverConnection = await storage.getServerConnection(userId);
      if (!serverConnection) {
        return res.status(404).json({ 
          message: "No server connection found", 
          syncing: false,
          configured: false,
          lastSync: null,
          interval: 300,
          inProgress: false,
          autoSync: false
        });
      }
      
      // Get sync status from the sync service
      const syncStatus = syncService.getSyncStatus(userId);
      
      // Return status information
      return res.json({
        syncing: syncStatus.syncing || false,
        configured: syncStatus.configured || false,
        lastSync: serverConnection.lastSync,
        interval: serverConnection.syncInterval || 300,
        inProgress: syncStatus.inProgress || false,
        autoSync: serverConnection.autoSync || false
      });
    } catch (error) {
      console.error("Error getting sync status:", error);
      return res.status(500).json({ message: "Failed to get sync status" });
    }
  });
  
  // Toggle auto-sync
  app.post("/api/sync/auto", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { enabled } = req.body;
      
      // Update server connection
      const serverConnection = await storage.getServerConnection(userId);
      if (!serverConnection) {
        return res.status(404).json({ message: "No server connection found" });
      }
      
      // Update the auto-sync setting
      await storage.updateServerConnection(serverConnection.id, {
        autoSync: enabled
      });
      
      // Update the sync service
      if (enabled) {
        syncService.startSync(userId);
      } else {
        syncService.stopSync(userId);
      }
      
      return res.json({ success: true, autoSync: enabled });
    } catch (error) {
      console.error("Error updating auto-sync:", error);
      return res.status(500).json({ message: "Failed to update auto-sync setting" });
    }
  });
  
  // Update sync interval
  app.post("/api/sync/interval", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { interval } = req.body;
      
      // Validate interval
      if (typeof interval !== 'number' || interval < 60 || interval > 3600) {
        return res.status(400).json({ 
          message: "Invalid interval. Must be between 60 and 3600 seconds" 
        });
      }
      
      // Update server connection
      const serverConnection = await storage.getServerConnection(userId);
      if (!serverConnection) {
        return res.status(404).json({ message: "No server connection found" });
      }
      
      // Update the interval setting
      await storage.updateServerConnection(serverConnection.id, {
        syncInterval: interval
      });
      
      // Update the sync service with the new interval
      syncService.updateSyncInterval(userId, interval);
      
      return res.json({ success: true, interval });
    } catch (error) {
      console.error("Error updating sync interval:", error);
      return res.status(500).json({ message: "Failed to update sync interval" });
    }
  });
  
  // The /api/sync/now endpoint is implemented later in the file
  // See IMMEDIATE SYNC ENDPOINT section
  
  // Original Sync API endpoint (kept for backward compatibility)
  // Fix malformed RRULE values in existing events
  app.post("/api/fix-event-rrules", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { calendarId } = req.body;
      
      // Validate calendarId if provided
      if (calendarId !== undefined) {
        if (typeof calendarId !== 'number') {
          return res.status(400).json({ error: 'calendarId must be a number' });
        }
        
        // Check if user has access to the calendar
        const calendar = await storage.getCalendar(calendarId);
        if (!calendar || calendar.userId !== userId) {
          return res.status(403).json({ error: 'Access denied to calendar' });
        }
      }
      
      // Import the ical-utils module
      const { sanitizeAndFormatICS } = await import('./ical-utils');
      
      // Get all calendars for the user if no specific calendar provided
      const calendars = calendarId 
        ? [await storage.getCalendar(calendarId)] 
        : await storage.getCalendars(userId);
      
      // Filter out null values and only process user's own calendars
      const userCalendars = calendars.filter(cal => cal && cal.userId === userId);
      
      // Track fixes statistics
      const stats = {
        calendarsProcessed: 0,
        eventsProcessed: 0,
        eventsFix_RRULE: 0,
        eventsFix_RESOURCE_TYPE: 0,
        eventsFix_mailto: 0,
        eventsFix_DTSTAMP: 0,
        eventsFix_other: 0
      };
      
      // Process each calendar
      for (const calendar of userCalendars) {
        if (!calendar) continue;
        
        stats.calendarsProcessed++;
        console.log(`Processing calendar ${calendar.id}: ${calendar.name}`);
        
        // Get all events for this calendar
        const events = await storage.getEvents(calendar.id);
        
        // Process each event
        for (const event of events) {
          stats.eventsProcessed++;
          
          // Check if event has rawData to process
          if (!event.rawData) continue;
          
          let needsUpdate = false;
          const rawData = String(event.rawData);
          
          // Check for malformed RRULE
          if (rawData.includes('RRULE:') && (rawData.includes('mailto:') || rawData.includes('MAILTO:'))) {
            needsUpdate = true;
            stats.eventsFix_RRULE++;
          }
          
          // Check for RESOURCE-TYPE without X- prefix
          if (rawData.includes('RESOURCE-TYPE=') && !rawData.includes('X-RESOURCE-TYPE=')) {
            needsUpdate = true;
            stats.eventsFix_RESOURCE_TYPE++;
          }
          
          // Check for double colons in mailto references
          if (rawData.includes('mailto::')) {
            needsUpdate = true;
            stats.eventsFix_mailto++;
          }
          
          // Check for double Z in DTSTAMP
          if (rawData.match(/\d{8}T\d{6}ZZ/)) {
            needsUpdate = true;
            stats.eventsFix_DTSTAMP++;
          }
          
          // If any issue found, fix the event
          if (needsUpdate) {
            try {
              // Fix the raw data
              const fixedIcs = sanitizeAndFormatICS(rawData);
              
              // Update the event with fixed data
              await storage.updateEvent(event.id, { rawData: fixedIcs });
              
              console.log(`Fixed formatting issues in event ${event.id}: ${event.title}`);
            } catch (error) {
              console.error(`Failed to fix event ${event.id}:`, error);
              stats.eventsFix_other++;
            }
          }
        }
      }
      
      return res.json({
        success: true,
        stats
      });
    } catch (error) {
      console.error("Error fixing event RRULEs:", error);
      return res.status(500).json({ error: 'Failed to fix events', details: String(error) });
    }
  });
  
  app.post("/api/sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { calendarId, syncToken, forceRefresh, preserveLocalEvents } = req.body;
      
      // If a specific calendar ID is provided, only sync that calendar
      if (calendarId) {
        // Check if user has access to this calendar
        const calendar = await storage.getCalendar(parseInt(calendarId));
        const sharedCalendars = await storage.getSharedCalendars(userId);
        
        // Determine if user has access to this calendar (either owns it or has it shared)
        const hasAccess = 
          calendar?.userId === userId || 
          sharedCalendars.some(sc => sc.id === parseInt(calendarId));
        
        if (!calendar || !hasAccess) {
          return res.status(403).json({ error: 'Access denied to this calendar' });
        }
        
        // Create DAV client for the user
        const serverConnection = await storage.getServerConnection(userId);
        if (!serverConnection || !serverConnection.url || !serverConnection.username || !serverConnection.password) {
          return res.status(400).json({ 
            error: 'No server connection configured',
            requiresConnection: true
          });
        }
        
        // Create a DAV client using import
        const { DAVClient } = await import('tsdav');
        const client = new DAVClient({
          serverUrl: serverConnection.url,
          credentials: {
            username: serverConnection.username,
            password: serverConnection.password
          },
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        // Import the WebDAV sync service
        const { webdavSyncService } = require('./webdav-sync');
        
        // Get changes since the provided sync token or do a full sync
        const changes = await webdavSyncService.getChangesSince(
          parseInt(calendarId),
          forceRefresh ? null : syncToken,  // If forcing refresh, ignore sync token
          client
        );
        
        // Notify about changes via WebSocket
        if (changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0) {
          const { notifyCalendarChanged } = require('./websocket-handler');
          
          // Send real-time notification about the changes
          notifyCalendarChanged(userId, parseInt(calendarId), 'updated', {
            added: changes.added.length,
            modified: changes.modified.length,
            deleted: changes.deleted.length
          });
          
          // Create notifications if significant changes
          await webdavSyncService.notifyCalendarChanges(userId, parseInt(calendarId), changes);
        }
        
        // Return the changes and new sync token
        return res.json({
          calendarId: parseInt(calendarId),
          syncToken: changes.newSyncToken,
          changes: {
            added: changes.added.map((e: { id: number; title: string }) => ({ id: e.id, title: e.title })),
            modified: changes.modified.map((e: { id: number; title: string }) => ({ id: e.id, title: e.title })),
            deleted: changes.deleted
          }
        });
      } 
      // Otherwise, sync all calendars for the user (original behavior)
      else {
        // Request a sync
        console.log(`Sync requested for user ID ${userId} with options:`, { forceRefresh, calendarId });
        
        // If user doesn't have a sync job, set one up
        const syncStatus = syncService.getSyncStatus(userId);
        if (!syncStatus.configured) {
          // Get server connection 
          const connection = await storage.getServerConnection(userId);
          
          if (!connection) {
            return res.status(400).json({ message: "No server connection found for this user" });
          }
          
          // Try to set up sync job
          const setupResult = await syncService.setupSyncForUser(userId, connection);
          if (!setupResult) {
            return res.status(500).json({ message: "Failed to set up sync job" });
          }
        }
        
        // Trigger an immediate sync
        const success = await syncService.requestSync(userId, { forceRefresh, calendarId, preserveLocalEvents });
        
        // Get calendar and event counts for a more informative response
        const userCalendars = await storage.getCalendars(userId);
        let totalEvents = 0;
        
        // Count total events across all calendars
        for (const calendar of userCalendars) {
          if (calendar && calendar.id) {
            const events = await storage.getEvents(calendar.id);
            totalEvents += events.length;
          }
        }
        
        res.setHeader('Content-Type', 'application/json');
        if (success) {
          res.json({ 
            message: "Sync initiated",
            calendarsCount: userCalendars.length,
            eventsCount: totalEvents
          });
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ message: "Failed to initiate sync" });
        }
      }
    } catch (err) {
      console.error("Error initiating sync:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ message: "Failed to initiate sync" });
    }
  });
  
  // PUSH LOCAL EVENTS ENDPOINT
  app.post("/api/sync/push-local", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarId = req.body.calendarId ? parseInt(req.body.calendarId) : undefined;
      
      console.log(`Push local events requested for userId=${userId}, calendarId=${calendarId}`);
      
      // Check if user has a server connection configured
      const connection = await storage.getServerConnection(userId);
      if (!connection) {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Cannot push events (no server connection configured)",
          pushed: false,
          requiresConnection: true
        });
      }
      
      // Check connection status
      if (connection.status !== 'connected') {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Cannot push events (server connection not active)",
          pushed: false,
          requiresConnection: true
        });
      }

      // Setup sync job if needed
      const syncStatus = syncService.getSyncStatus(userId);
      if (!syncStatus.configured) {
        const setupResult = await syncService.setupSyncForUser(userId, connection);
        if (!setupResult) {
          return res.status(500).json({ 
            message: "Failed to set up sync job",
            pushed: false
          });
        }
      }
      
      // Push local events to the server
      const success = await syncService.pushLocalEvents(userId, calendarId);
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      
      if (success) {
        return res.status(200).json({
          message: "Successfully pushed local events to server",
          pushed: true
        });
      } else {
        return res.status(500).json({
          message: "Failed to push local events to server",
          pushed: false
        });
      }
    } catch (err) {
      console.error("Error pushing local events:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ 
        message: "Failed to push local events",
        pushed: false,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });
  
  // IMMEDIATE SYNC ENDPOINT
  app.post("/api/sync/now", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const forceRefresh = req.body.forceRefresh === true;
      const calendarId = req.body.calendarId ? parseInt(req.body.calendarId) : null;
      const preserveLocalEvents = req.body.preserveLocalEvents === true;
      
      console.log(`Immediate sync requested for userId=${userId}, calendarId=${calendarId}, forceRefresh=${forceRefresh}, preserveLocalEvents=${preserveLocalEvents}`);
      
      // Check if user has a server connection configured
      const connection = await storage.getServerConnection(userId);
      if (!connection) {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Changes saved locally but not synced (no server connection configured)",
          synced: false,
          requiresConnection: true,
          sync: {
            attempted: false,
            succeeded: false,
            noConnection: true,
            error: "Server connection required to sync with CalDAV server"
          }
        });
      }
      
      // Check connection status
      if (connection.status !== 'connected') {
        // Ensure proper content type header is set
        res.setHeader('Content-Type', 'application/json');
        return res.status(202).json({ 
          message: "Changes saved locally but not synced (server connection not active)",
          synced: false,
          requiresConnection: true,
          sync: {
            attempted: false,
            succeeded: false,
            noConnection: true,
            error: "Server connection is not active"
          }
        });
      }

      // This will trigger a sync right away with the specified options
      const success = await syncService.syncNow(userId, { 
        forceRefresh, 
        calendarId,
        preserveLocalEvents // Pass the preserveLocalEvents flag to the sync service
      });
      
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      
      if (success) {
        res.json({ 
          message: "Sync triggered successfully", 
          synced: true,
          sync: {
            attempted: true,
            succeeded: true,
            noConnection: false
          }
        });
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.status(202).json({ 
          message: "Changes saved locally but sync to server failed",
          synced: false,
          sync: {
            attempted: true,
            succeeded: false,
            noConnection: false,
            error: "Sync operation failed"
          }
        });
      }
    } catch (err) {
      console.error("Error in immediate sync:", err);
      // Ensure proper content type header is set
      res.setHeader('Content-Type', 'application/json');
      res.status(202).json({ 
        message: "Changes saved locally but sync to server failed with error",
        synced: false,
        sync: {
          attempted: true,
          succeeded: false,
          noConnection: false,
          error: err instanceof Error ? err.message : "Unknown error during sync"
        }
      });
    }
  });
  
  /**
   * Endpoint to handle attendee responses to event invitations
   * This allows attendees to accept, decline, or tentatively accept invitations
   * and optionally propose new times or add comments
   */
  app.post("/api/events/:eventId/respond", isAuthenticated, async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.user!.id;
      const { status, comment, proposedStart, proposedEnd } = req.body;
      
      // Validate status
      if (!status || !['ACCEPTED', 'DECLINED', 'TENTATIVE'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be ACCEPTED, DECLINED, or TENTATIVE" });
      }
      
      // Get the event
      const event = await storage.getEvent(parseInt(eventId, 10));
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      
      // Get the user's email
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const userEmail = user.email || user.username;
      
      // Parse the current attendees
      let attendees: any[] = [];
      try {
        if (event.attendees) {
          if (typeof event.attendees === 'string') {
            attendees = JSON.parse(event.attendees);
          } else if (Array.isArray(event.attendees)) {
            attendees = event.attendees;
          }
        }
      } catch (error) {
        console.error("Error parsing attendees:", error);
        attendees = [];
      }
      
      // Find the attendee in the list or create a new entry
      const attendeeIndex = attendees.findIndex(
        (a: any) => (typeof a === 'string' && a === userEmail) || 
             (typeof a === 'object' && a.email === userEmail)
      );
      
      const attendeeData = {
        email: userEmail,
        name: user.username,
        status,
        comment: comment || undefined,
        proposedStart: proposedStart ? new Date(proposedStart).toISOString() : undefined,
        proposedEnd: proposedEnd ? new Date(proposedEnd).toISOString() : undefined
      };
      
      if (attendeeIndex >= 0) {
        // Update existing attendee
        if (typeof attendees[attendeeIndex] === 'string') {
          // Replace string entry with object
          attendees[attendeeIndex] = attendeeData;
        } else {
          // Update object
          attendees[attendeeIndex] = {
            ...attendees[attendeeIndex],
            ...attendeeData
          };
        }
      } else {
        // Add new attendee
        attendees.push(attendeeData);
      }
      
      // Update the event
      const updatedEvent = await storage.updateEvent(event.id, {
        attendees: JSON.stringify(attendees)
      });
      
      // If the event is from a CalDAV server, we should update it there as well
      // This would require additional work with the CalDAV client
      // For now, we'll just update the local record
      
      res.json({ 
        success: true, 
        message: `Successfully ${status.toLowerCase()} the event`,
        updatedEvent
      });
    } catch (error) {
      console.error("Error handling event response:", error);
      res.status(500).json({ 
        error: "Error processing your response", 
        details: String(error) 
      });
    }
  });
  
  // Test SMTP settings
  app.get("/api/test-smtp-config", isAuthenticated, async (req, res) => {
    try {
      // Get the user's SMTP configuration
      const smtpConfig = await storage.getSmtpConfig(req.user!.id);
      
      if (!smtpConfig) {
        return res.json({ 
          success: false, 
          message: "No SMTP configuration found for your account" 
        });
      }
      
      // Return the SMTP configuration (without the password)
      return res.json({
        success: true,
        config: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          fromEmail: smtpConfig.fromEmail,
          fromName: smtpConfig.fromName,
          enabled: smtpConfig.enabled,
          hasPassword: !!smtpConfig.password
        }
      });
    } catch (error) {
      console.error("Error getting SMTP configuration:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to retrieve SMTP configuration" 
      });
    }
  });
  
  // Update SMTP settings
  app.post("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Get existing config
      let existingConfig = await storage.getSmtpConfig(userId);
      
      // If no configuration exists, create a default one first
      if (!existingConfig) {
        // Get user to retrieve their email for defaults
        const user = await storage.getUser(userId);
        if (!user?.email) {
          return res.status(400).json({ 
            success: false, 
            message: "User doesn't have an email address to use as default"
          });
        }
        
        // Create default config first
        existingConfig = await storage.createSmtpConfig({
          userId,
          host: 'smtps.xgen.in',   // Default SMTP server
          port: 465,
          secure: true,
          username: user.email,
          password: '',             // Empty password initially
          fromEmail: user.email,
          fromName: user.fullName || user.username || undefined,
          enabled: true
        });
      }
      
      // Prepare update data, only updating fields that are provided
      const updateData: any = {};
      
      if (req.body.host !== undefined) updateData.host = req.body.host;
      if (req.body.port !== undefined) updateData.port = parseInt(req.body.port);
      if (req.body.secure !== undefined) updateData.secure = req.body.secure;
      if (req.body.username !== undefined) updateData.username = req.body.username;
      if (req.body.password !== undefined) updateData.password = req.body.password;
      if (req.body.fromEmail !== undefined) updateData.fromEmail = req.body.fromEmail;
      if (req.body.fromName !== undefined) updateData.fromName = req.body.fromName;
      if (req.body.enabled !== undefined) updateData.enabled = req.body.enabled;
      
      // Update the configuration
      const updatedConfig = await storage.updateSmtpConfig(existingConfig.id, updateData);
      
      // Return the updated configuration (without the password)
      res.json({
        success: true,
        message: "SMTP configuration updated successfully",
        config: {
          host: updatedConfig.host,
          port: updatedConfig.port,
          secure: updatedConfig.secure,
          username: updatedConfig.username,
          fromEmail: updatedConfig.fromEmail,
          fromName: updatedConfig.fromName,
          enabled: updatedConfig.enabled,
          hasPassword: !!updatedConfig.password
        }
      });
    } catch (error) {
      console.error("Error updating SMTP configuration:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update SMTP configuration"
      });
    }
  });
  
  // Test SMTP connection
  app.post("/api/test-smtp-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Initialize email service for this user
      const emailService = new EmailService();
      const initialized = await emailService.initialize(userId);
      
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: "Could not initialize email service. Please check your SMTP configuration."
        });
      }
      
      // Attempt to verify connection
      try {
        const verificationResult = await emailService.verifyConnection();
        
        if (verificationResult.success) {
          return res.json({
            success: true,
            message: "SMTP connection successful. Email system is properly configured."
          });
        } else {
          return res.status(400).json({
            success: false,
            message: `SMTP connection failed: ${verificationResult.message}`
          });
        }
      } catch (verifyError) {
        return res.status(400).json({
          success: false,
          message: `SMTP connection verification failed: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`
        });
      }
    } catch (error) {
      console.error("Error testing SMTP connection:", error);
      res.status(500).json({
        success: false,
        message: `Error testing SMTP connection: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // NOTIFICATIONS API
  
  // Get notifications for the current user
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { 
        unreadOnly, 
        requiresActionOnly, 
        type, 
        priority, 
        relatedEventId, 
        relatedEventUid,
        limit,
        offset
      } = req.query;
      
      // Convert query parameters to the right types
      const filter = {
        userId,
        unreadOnly: unreadOnly === 'true',
        requiresActionOnly: requiresActionOnly === 'true',
        type: type ? String(type) : undefined,
        priority: priority ? String(priority) : undefined,
        relatedEventId: relatedEventId ? parseInt(String(relatedEventId)) : undefined,
        relatedEventUid: relatedEventUid ? String(relatedEventUid) : undefined,
        limit: limit ? parseInt(String(limit)) : undefined,
        offset: offset ? parseInt(String(offset)) : undefined
      };
      
      // Parse the filter with Zod to validate
      const validatedFilter = notificationFilterSchema.parse(filter);
      
      // Fetch notifications using the validated filter
      const notifications = await notificationService.getNotifications(validatedFilter);
      
      res.json(notifications);
    } catch (err) {
      console.error("Error fetching notifications:", err);
      return handleZodError(err, res);
    }
  });

  // Get unread notification count
  app.get("/api/notifications/count", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const count = await notificationService.getUnreadCount(userId);
      res.json({ count });
    } catch (err) {
      console.error("Error getting notification count:", err);
      res.status(500).json({ message: "Failed to get notification count" });
    }
  });

  // Create a test notification (for development purposes)
  app.post("/api/notifications/test", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const testNotification = {
        userId,
        type: 'system_message' as const,
        title: 'Test Notification',
        message: 'This is a test notification',
        priority: 'medium' as const,
        requiresAction: false,
        isRead: false,
        isDismissed: false,
        actionTaken: false
      };
      
      const notification = await notificationService.createNotification(testNotification);
      
      // Send the notification through WebSocket if available
      await websocketNotificationService.sendNotification({
        type: 'notification',
        action: 'created',
        timestamp: Date.now(),
        data: notification,
        sourceUserId: null
      });
      
      res.status(201).json(notification);
    } catch (err) {
      console.error("Error creating test notification:", err);
      res.status(500).json({ message: "Failed to create test notification" });
    }
  });

  // Mark a notification as read
  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }
      
      const success = await notificationService.markAsRead(notificationId);
      
      if (success) {
        // Get the updated count of unread notifications
        const unreadCount = await notificationService.getUnreadCount(req.user!.id);
        
        // Also update through WebSocket if available
        broadcastToUser(req.user!.id, {
          type: 'notification_count',
          count: unreadCount
        });
        
        res.json({ success, unreadCount });
      } else {
        res.status(404).json({ success: false, message: "Notification not found" });
      }
    } catch (err) {
      console.error("Error marking notification as read:", err);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const success = await notificationService.markAllAsRead(userId);
      
      // Also update through WebSocket if available
      broadcastToUser(userId, {
        type: 'notification_count',
        count: 0
      });
      
      res.json({ success });
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // Dismiss a notification
  app.patch("/api/notifications/:id/dismiss", isAuthenticated, async (req, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }
      
      const success = await notificationService.dismissNotification(notificationId);
      
      if (success) {
        // Get the updated count of unread notifications
        const unreadCount = await notificationService.getUnreadCount(req.user!.id);
        
        // Also update through WebSocket if available
        broadcastToUser(req.user!.id, {
          type: 'notification_count',
          count: unreadCount
        });
        
        res.json({ success, unreadCount });
      } else {
        res.status(404).json({ success: false, message: "Notification not found" });
      }
    } catch (err) {
      console.error("Error dismissing notification:", err);
      res.status(500).json({ message: "Failed to dismiss notification" });
    }
  });

  // Mark action taken on a notification
  app.patch("/api/notifications/:id/action-taken", isAuthenticated, async (req, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }
      
      const success = await notificationService.markActionTaken(notificationId);
      
      if (success) {
        // Get the updated count of unread notifications
        const unreadCount = await notificationService.getUnreadCount(req.user!.id);
        
        // Also update through WebSocket if available
        broadcastToUser(req.user!.id, {
          type: 'notification_count',
          count: unreadCount
        });
        
        res.json({ success, unreadCount });
      } else {
        res.status(404).json({ success: false, message: "Notification not found" });
      }
    } catch (err) {
      console.error("Error marking action taken:", err);
      res.status(500).json({ message: "Failed to mark action taken" });
    }
  });
  
  // Create HTTP server
  // Our WebSocket server is already initialized in an import higher up
  
  return httpServer;
}
