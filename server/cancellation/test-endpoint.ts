/**
 * Test endpoint for cancellation functionality
 * 
 * This module exports a function to register a test endpoint for RFC 5546 compliant 
 * cancellation functionality, allowing for testing without authentication
 */

import express from 'express';
import { generateCancellationIcs, deleteEventAfterCancellation } from './cancellation-handler';
import { storage } from '../storage';

/**
 * Register test endpoint for cancellation
 * 
 * @param app Express application
 */
export function registerCancellationTestEndpoint(app: express.Express): void {
  app.get('/api/test-cancellation', async (req, res) => {
    try {
      console.log("TEST: Generating sample event cancellation");
      
      // Create a sample event data
      const eventData = {
        eventId: 12345,
        uid: "test-event-1744794000000@caldavclient.local",
        title: "Test Event for Cancellation",
        description: "<p>This is a test event for cancellation</p>",
        location: "Test Location",
        startDate: new Date("2025-05-10T10:00:00Z"),
        endDate: new Date("2025-05-10T11:00:00Z"),
        organizer: {
          email: "test-organizer@example.com",
          name: "Test Organizer"
        },
        attendees: [
          {
            email: "test-attendee@example.com",
            name: "Test Attendee",
            role: "REQ-PARTICIPANT",
            status: "NEEDS-ACTION"
          }
        ],
        resources: [
          {
            id: "test-resource@example.com",
            email: "test-resource@example.com",
            name: "Test Resource",
            type: "test-type",
            capacity: 10,
            adminEmail: "admin@example.com",
            adminName: "Resource Admin",
            remarks: "Test remarks",
            displayName: "Test Resource Display"
          }
        ],
        recurrenceRule: "FREQ=DAILY;COUNT=2",
        rawData: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Calendar Application//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:test-event-1744794000000@caldavclient.local
DTSTAMP:20250416T100000Z
DTSTART:20250510T100000Z
DTEND:20250510T110000Z
SUMMARY:Test Event for Cancellation
DESCRIPTION:<p>This is a test event for cancellation</p>
LOCATION:Test Location
ORGANIZER;CN=Test Organizer:mailto:test-organizer@example.com
RRULE:FREQ=DAILY;COUNT=2
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Test Attendee:mailto:test-attendee@example.com
ATTENDEE;CN=Test Resource;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT;X-RESOURCE-TYPE=test-type;X-RESOURCE-CAPACITY=10;X-ADMIN-NAME=Resource Admin;X-NOTES-REMARKS=Test remarks:mailto:test-resource@example.com
END:VEVENT
END:VCALENDAR`
      };
      
      // Generate cancellation
      console.log("TEST: Generating cancellation ICS");
      const cancellationIcsData = generateCancellationIcs(eventData.rawData, eventData);
      
      // Check for key elements in the generated ICS
      const hasMethod = cancellationIcsData.includes('METHOD:CANCEL');
      const hasStatus = cancellationIcsData.includes('STATUS:CANCELLED');
      const hasOriginalUid = cancellationIcsData.includes(`UID:${eventData.uid}`);
      const hasCancelledPrefix = cancellationIcsData.includes('SUMMARY:CANCELLED:') || cancellationIcsData.includes('SUMMARY:CANCELLED: ');
      const hasResourceAttendee = cancellationIcsData.includes('CUTYPE=RESOURCE') && cancellationIcsData.includes('test-resource@example.com');
      
      // Return the validation results and the generated ICS
      return res.json({
        success: true,
        message: "Generated cancellation ICS for testing",
        validation: {
          hasMethod,
          hasStatus,
          hasOriginalUid,
          hasCancelledPrefix,
          hasResourceAttendee,
          isFullyRFC5546Compliant: hasMethod && hasStatus && hasOriginalUid && hasCancelledPrefix && hasResourceAttendee
        },
        icsData: cancellationIcsData
      });
    } catch (error) {
      console.error("Error in test-cancellation endpoint:", error);
      return res.status(500).json({
        success: false,
        message: "Error generating cancellation ICS",
        error: String(error)
      });
    }
  });
  
  // Test endpoint to delete an event (real events from DB)
  app.get('/api/test-delete-event/:eventId', async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ success: false, message: "Invalid event ID" });
      }
      
      // Use the imported storage instance
      
      // Get the event
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ success: false, message: "Event not found" });
      }
      
      // Get the first user from the database for testing
      const users = await storage.getAllUsers();
      if (!users || users.length === 0) {
        return res.status(500).json({ success: false, message: "No users found in database" });
      }
      
      const testUser = users[0];
      
      // Get server connection for that user
      const serverConnection = await storage.getServerConnection(testUser.id);
      if (!serverConnection) {
        return res.status(500).json({ 
          success: false, 
          message: "No server connection found for test user",
          event
        });
      }
      
      // Use the imported deletion function from cancellation-handler
      // Function is already imported at the top of the file
      
      // Try to delete the event
      const deleteResult = await deleteEventAfterCancellation(
        eventId,
        event.calendarId,
        serverConnection.url,
        {
          username: serverConnection.username,
          password: serverConnection.password
        }
      );
      
      return res.json({
        success: deleteResult,
        message: deleteResult ? "Event deleted successfully" : "Failed to delete event",
        event: {
          id: event.id,
          title: event.title,
          calendarId: event.calendarId,
          uid: event.uid
        }
      });
    } catch (error) {
      console.error("Error in test-delete-event endpoint:", error);
      return res.status(500).json({
        success: false,
        message: "Error deleting event",
        error: String(error)
      });
    }
  });
  
  console.log("Registered cancellation test endpoints: /api/test-cancellation and /api/test-delete-event/:eventId");
}