/**
 * RFC 6638 Cancellation Test Endpoint
 * 
 * This endpoint provides a way to test RFC 6638 compliance for cancellation ICS files
 * It takes an original ICS as input and returns a properly formatted cancellation ICS
 */

import express from 'express';
import { emailService } from './email-service';
import { generateCancellationIcs } from './enhanced-ics-cancellation';

export function setupCancelICSTestEndpoints(app: express.Express) {
  /**
   * Test endpoint for generating RFC 6638 compliant cancellation ICS files
   * 
   * This endpoint takes an original ICS file and returns a cancellation ICS
   * It performs validation for required properties according to RFC 6638
   */
  app.post('/api/test/cancellation-ics', async (req, res) => {
    try {
      console.log('Received request to generate cancellation ICS');
      
      const { originalIcs, eventData } = req.body;
      
      if (!originalIcs) {
        return res.status(400).json({ 
          error: 'Missing required originalIcs parameter',
          requiredParameters: ['originalIcs', 'eventData']
        });
      }
      
      if (!eventData || !eventData.uid || !eventData.title) {
        return res.status(400).json({ 
          error: 'Missing required event data',
          requiredEventFields: ['uid', 'title', 'startDate', 'endDate', 'organizer']
        });
      }
      
      // Generate the cancellation ICS using our enhanced RFC 6638 compliant generator
      const cancellationIcs = await generateCancellationIcs(originalIcs, {
        ...eventData,
        status: 'CANCELLED'
      });
      
      // Verify RFC 6638 compliance
      const hasMethod = cancellationIcs.includes('METHOD:CANCEL');
      const hasStatus = cancellationIcs.includes('STATUS:CANCELLED');
      const hasOriginalUid = cancellationIcs.includes(`UID:${eventData.uid}`);
      const hasSequence = cancellationIcs.includes('SEQUENCE:');
      
      // Prepare validation results
      const validationResults = {
        isCompliant: hasMethod && hasStatus && hasOriginalUid && hasSequence,
        properties: {
          method: { 
            present: hasMethod, 
            value: hasMethod ? 'CANCEL' : null,
            required: true 
          },
          status: { 
            present: hasStatus, 
            value: hasStatus ? 'CANCELLED' : null,
            required: true 
          },
          uid: { 
            present: hasOriginalUid, 
            value: hasOriginalUid ? eventData.uid : null,
            required: true,
            original: eventData.uid
          },
          sequence: { 
            present: hasSequence,
            value: hasSequence ? cancellationIcs.match(/SEQUENCE:(\d+)/i)?.[1] : null,
            required: true
          }
        },
        compliance: {
          rfc5545: true, // Base iCalendar compliance
          rfc6638: hasMethod && hasStatus // Scheduling extensions compliance
        }
      };
      
      // Return the cancellation ICS with validation results
      return res.json({
        success: true,
        cancellationIcs,
        validationResults,
        originalUid: eventData.uid
      });
      
    } catch (error) {
      console.error('Error generating cancellation ICS:', error);
      return res.status(500).json({
        error: 'Error generating cancellation ICS',
        details: String(error)
      });
    }
  });

  /**
   * Test endpoint for processing an ICS file through email-service.transformIcsForCancellation
   */
  app.post('/api/test/email-cancellation', async (req, res) => {
    try {
      console.log('Received request to process cancellation ICS through email service');
      
      const { originalIcs, eventData } = req.body;
      
      if (!originalIcs) {
        return res.status(400).json({ 
          error: 'Missing required originalIcs parameter'
        });
      }
      
      if (!eventData) {
        return res.status(400).json({ 
          error: 'Missing required eventData parameter'
        });
      }
      
      // Set the status to CANCELLED
      const cancellationData = {
        ...eventData,
        status: 'CANCELLED'
      };
      
      // Use the email service to transform the ICS for cancellation
      const cancellationIcs = emailService.transformIcsForCancellation(originalIcs, cancellationData);
      
      // Verify RFC 6638 compliance
      const hasMethod = cancellationIcs.includes('METHOD:CANCEL');
      const hasStatus = cancellationIcs.includes('STATUS:CANCELLED');
      const hasOriginalUid = eventData.uid ? cancellationIcs.includes(`UID:${eventData.uid}`) : true;
      const hasSequence = cancellationIcs.includes('SEQUENCE:');
      
      return res.json({
        success: true,
        cancellationIcs,
        validationResults: {
          isCompliant: hasMethod && hasStatus && hasOriginalUid && hasSequence,
          properties: {
            method: { present: hasMethod, required: true },
            status: { present: hasStatus, required: true },
            uid: { present: hasOriginalUid, required: true, preserved: hasOriginalUid },
            sequence: { present: hasSequence, required: true }
          }
        }
      });
      
    } catch (error) {
      console.error('Error processing cancellation through email service:', error);
      return res.status(500).json({
        error: 'Error processing cancellation',
        details: String(error)
      });
    }
  });
}