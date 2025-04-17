/**
 * RFC 6638 Cancellation Test Endpoint
 * 
 * This endpoint provides a way to test RFC 6638 compliance for cancellation ICS files
 * It takes an original ICS as input and returns a properly formatted cancellation ICS
 */

import express from 'express';
import { emailService } from './email-service';

/**
 * Set up endpoints for testing ICS cancellation formatting compliance with RFC 6638
 */
export function setupCancelICSTestEndpoints(app: express.Express) {
  /**
   * Test endpoint for generating RFC 6638 compliant cancellation ICS files
   * 
   * This endpoint takes an original ICS file and returns a cancellation ICS
   * It performs validation for required properties according to RFC 6638
   */
  app.post('/api/test-rfc6638-cancel', async (req, res) => {
    try {
      const { icsData } = req.body;
      
      if (!icsData) {
        return res.status(400).json({ 
          error: 'Missing ICS data', 
          message: 'Please provide original ICS data to transform' 
        });
      }
      
      // Extract critical properties from the ICS for testing
      const uidMatch = icsData.match(/UID:([^\r\n]+)/i);
      const uid = uidMatch ? uidMatch[1].trim() : `test-${Date.now()}`;
      
      const summaryMatch = icsData.match(/SUMMARY:([^\r\n]+)/i);
      const title = summaryMatch ? summaryMatch[1].trim() : 'Test Event For Cancellation';
      
      const organizerMatch = icsData.match(/ORGANIZER[^:]*:mailto:([^\r\n]+)/i);
      const organizerEmail = organizerMatch ? organizerMatch[1].trim() : 'test@example.com';
      
      const organizerNameMatch = icsData.match(/ORGANIZER;CN=([^:;]+)[^:]*:/i);
      const organizerName = organizerNameMatch ? organizerNameMatch[1].trim() : 'Test User';
      
      // Extract attendees and resources for testing resource/attendee preservation
      const attendeeLines = icsData.match(/ATTENDEE[^:\r\n]+:[^\r\n]+/g) || [];
      
      // Create test data
      const testData = {
        uid,
        title,
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600000),
        organizer: {
          email: organizerEmail,
          name: organizerName
        },
        attendees: attendeeLines.map(line => {
          const emailMatch = line.match(/:mailto:([^\r\n]+)/i);
          const nameMatch = line.match(/CN=([^:;]+)/i);
          return {
            email: emailMatch ? emailMatch[1].trim() : 'attendee@example.com',
            name: nameMatch ? nameMatch[1].trim() : 'Attendee Name'
          };
        }),
        rawData: icsData,
        status: 'CANCELLED',
        sequence: 1
      };
      
      // Transform the ICS using our email service method
      const cancelledIcs = emailService.transformIcsForCancellation(icsData, testData);
      
      // Verify RFC 6638 compliance
      const hasMethod = /METHOD:CANCEL/i.test(cancelledIcs);
      const hasStatus = /STATUS:CANCELLED/i.test(cancelledIcs);
      const hasUid = new RegExp(`UID:${uid}`, 'i').test(cancelledIcs);
      
      // Check sequence increment
      const originalSequenceMatch = icsData.match(/SEQUENCE:(\d+)/i);
      const originalSequence = originalSequenceMatch ? parseInt(originalSequenceMatch[1], 10) : 0;
      
      const newSequenceMatch = cancelledIcs.match(/SEQUENCE:(\d+)/i);
      const newSequence = newSequenceMatch ? parseInt(newSequenceMatch[1], 10) : 0;
      
      const isSequenceIncremented = newSequence > originalSequence;
      
      // Return results with RFC 6638 compliance check
      return res.json({
        success: true,
        originalIcs: icsData,
        cancelledIcs,
        rfc6638Compliance: {
          hasMethodCancel: hasMethod,
          hasStatusCancelled: hasStatus,
          preservesOriginalUid: hasUid,
          sequenceIncremented: isSequenceIncremented,
          compliant: hasMethod && hasStatus && hasUid && isSequenceIncremented
        },
        details: {
          originalSequence,
          newSequence,
          uid
        }
      });
    } catch (error) {
      console.error('Error in RFC 6638 cancellation test endpoint:', error);
      return res.status(500).json({ 
        error: 'Server error', 
        message: String(error) 
      });
    }
  });
  
  /**
   * Test endpoint for processing an ICS file through email-service.transformIcsForCancellation
   */
  app.post('/api/test-ics-cancellation', async (req, res) => {
    try {
      const { icsData } = req.body;
      
      if (!icsData) {
        return res.status(400).json({ error: 'Missing ICS data' });
      }
      
      // Extract properties for test data
      const uidMatch = icsData.match(/UID:([^\r\n]+)/i);
      const uid = uidMatch ? uidMatch[1].trim() : `test-${Date.now()}`;
      
      // Create minimal test data
      const testData = {
        uid,
        title: 'Test Event',
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600000),
        organizer: {
          email: 'test@example.com',
          name: 'Test Organizer'
        },
        status: 'CANCELLED'
      };
      
      // Transform and return results
      const cancelledIcs = emailService.transformIcsForCancellation(icsData, testData);
      
      return res.json({
        success: true,
        originalIcs: icsData,
        cancelledIcs
      });
    } catch (error) {
      console.error('Error in ICS cancellation test endpoint:', error);
      return res.status(500).json({ error: String(error) });
    }
  });
}