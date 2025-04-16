/**
 * Enhanced Email Test Endpoints
 * 
 * This module provides test endpoints for the enhanced email service
 * that enforces UID requirements for RFC 5545 compliance.
 */

import express from 'express';
import { enhancedEmailService } from './enhanced-email-service';

export function registerEnhancedEmailTestEndpoints(app: express.Express) {
  // Configuration endpoint
  app.post('/api/enhanced-email-config', async (req, res) => {
    try {
      const config = req.body;
      
      if (!config.host || !config.port || !config.auth || !config.from) {
        return res.status(400).json({
          success: false,
          message: 'Invalid SMTP configuration'
        });
      }
      
      const result = enhancedEmailService.updateConfig(config);
      
      if (result) {
        return res.json({
          success: true,
          message: 'Enhanced email configuration updated successfully'
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to update enhanced email configuration'
        });
      }
    } catch (error) {
      console.error('Error updating enhanced email config:', error);
      return res.status(500).json({
        success: false,
        message: `Error updating enhanced email config: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });
  
  // Get configuration endpoint
  app.get('/api/enhanced-email-config', (req, res) => {
    try {
      const config = enhancedEmailService.getConfig();
      
      if (config) {
        // For security, return a version without the password
        const safeConfig = {
          ...config,
          auth: {
            ...config.auth,
            pass: '********' // Mask the password
          }
        };
        
        return res.json({
          success: true,
          config: safeConfig
        });
      } else {
        return res.json({
          success: false,
          message: 'No enhanced email configuration found'
        });
      }
    } catch (error) {
      console.error('Error getting enhanced email config:', error);
      return res.status(500).json({
        success: false,
        message: `Error getting enhanced email config: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // Test invitation email endpoint
  app.post('/api/enhanced-test-invitation', async (req, res) => {
    try {
      if (!enhancedEmailService.isInitialized()) {
        return res.status(400).json({
          success: false,
          message: 'Enhanced email service is not initialized. Please configure SMTP settings first.'
        });
      }
      
      const testData = req.body;
      
      // Validate essential fields
      if (!testData.uid) {
        return res.status(400).json({
          success: false,
          message: 'UID is required for RFC 5545 compliance'
        });
      }
      
      if (!testData.title || !testData.startDate || !testData.endDate || !testData.organizer) {
        return res.status(400).json({
          success: false,
          message: 'Required fields missing: title, startDate, endDate, and organizer are required'
        });
      }
      
      if (!testData.attendees || testData.attendees.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one attendee is required for sending an invitation'
        });
      }
      
      // Convert date strings to Date objects
      const startDate = new Date(testData.startDate);
      const endDate = new Date(testData.endDate);
      
      // Create invitation data
      const invitationData = {
        eventId: testData.eventId || 12345, // Use provided ID or fallback to a test ID
        uid: testData.uid,
        title: testData.title,
        description: testData.description || 'Test event description',
        location: testData.location || 'Test location',
        startDate,
        endDate,
        organizer: testData.organizer,
        attendees: testData.attendees,
        resources: testData.resources || [],
        recurrenceRule: testData.recurrenceRule,
        method: 'REQUEST'
      };
      
      // If this is just a preview, don't actually send emails
      if (testData.previewOnly) {
        const previewResult = await enhancedEmailService.generateEmailPreview(
          req.session.userId || 1, // Use session user ID or fallback to 1
          invitationData,
          'invitation'
        );
        
        return res.json({
          success: true,
          message: 'Invitation email preview generated',
          icsData: previewResult.icsData,
          htmlContent: previewResult.htmlContent
        });
      }
      
      // Send the actual invitation emails
      const result = await enhancedEmailService.sendEventInvitation(
        req.session.userId || 1, // Use session user ID or fallback to 1
        invitationData
      );
      
      return res.json({
        success: result.success,
        message: result.message,
        icsData: result.icsData,
        htmlContent: result.htmlContent
      });
    } catch (error) {
      console.error('Error testing enhanced invitation email:', error);
      return res.status(500).json({
        success: false,
        message: `Error testing enhanced invitation email: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });
  
  // Test update email endpoint
  app.post('/api/enhanced-test-update', async (req, res) => {
    try {
      if (!enhancedEmailService.isInitialized()) {
        return res.status(400).json({
          success: false,
          message: 'Enhanced email service is not initialized. Please configure SMTP settings first.'
        });
      }
      
      const testData = req.body;
      
      // Validate essential fields
      if (!testData.uid) {
        return res.status(400).json({
          success: false,
          message: 'UID is required for RFC 5545 compliance'
        });
      }
      
      if (!testData.title || !testData.startDate || !testData.endDate || !testData.organizer) {
        return res.status(400).json({
          success: false,
          message: 'Required fields missing: title, startDate, endDate, and organizer are required'
        });
      }
      
      if (!testData.attendees || testData.attendees.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one attendee is required for sending an update'
        });
      }
      
      // Convert date strings to Date objects
      const startDate = new Date(testData.startDate);
      const endDate = new Date(testData.endDate);
      
      // Create update data
      const updateData = {
        eventId: testData.eventId || 12345, // Use provided ID or fallback to a test ID
        uid: testData.uid,
        title: testData.title,
        description: testData.description || 'Updated event description',
        location: testData.location || 'Updated location',
        startDate,
        endDate,
        organizer: testData.organizer,
        attendees: testData.attendees,
        resources: testData.resources || [],
        recurrenceRule: testData.recurrenceRule,
        sequence: testData.sequence || 1, // Sequence number for updates
        method: 'REQUEST'
      };
      
      // If this is just a preview, don't actually send emails
      if (testData.previewOnly) {
        const previewResult = await enhancedEmailService.generateEmailPreview(
          req.session.userId || 1, // Use session user ID or fallback to 1
          updateData,
          'update'
        );
        
        return res.json({
          success: true,
          message: 'Update email preview generated',
          icsData: previewResult.icsData,
          htmlContent: previewResult.htmlContent
        });
      }
      
      // Send the actual update emails
      const result = await enhancedEmailService.sendEventUpdate(
        req.session.userId || 1, // Use session user ID or fallback to 1
        updateData
      );
      
      return res.json({
        success: result.success,
        message: result.message,
        icsData: result.icsData,
        htmlContent: result.htmlContent
      });
    } catch (error) {
      console.error('Error testing enhanced update email:', error);
      return res.status(500).json({
        success: false,
        message: `Error testing enhanced update email: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });
  
  // Test cancellation email endpoint
  app.post('/api/enhanced-test-cancellation', async (req, res) => {
    try {
      if (!enhancedEmailService.isInitialized()) {
        return res.status(400).json({
          success: false,
          message: 'Enhanced email service is not initialized. Please configure SMTP settings first.'
        });
      }
      
      const testData = req.body;
      
      // Validate essential fields
      if (!testData.uid) {
        return res.status(400).json({
          success: false,
          message: 'UID is required for RFC 5545 compliance'
        });
      }
      
      if (!testData.title || !testData.startDate || !testData.endDate || !testData.organizer) {
        return res.status(400).json({
          success: false,
          message: 'Required fields missing: title, startDate, endDate, and organizer are required'
        });
      }
      
      if (!testData.attendees || testData.attendees.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one attendee is required for sending a cancellation'
        });
      }
      
      // Convert date strings to Date objects
      const startDate = new Date(testData.startDate);
      const endDate = new Date(testData.endDate);
      
      // Create cancellation data
      const cancellationData = {
        eventId: testData.eventId || 12345, // Use provided ID or fallback to a test ID
        uid: testData.uid,
        title: testData.title,
        description: testData.description || 'Cancelled event description',
        location: testData.location || 'Cancelled location',
        startDate,
        endDate,
        organizer: testData.organizer,
        attendees: testData.attendees,
        resources: testData.resources || [],
        recurrenceRule: testData.recurrenceRule,
        sequence: testData.sequence || 1, // Sequence number for cancellations
        method: 'CANCEL',
        status: 'CANCELLED'
      };
      
      // If this is just a preview, don't actually send emails
      if (testData.previewOnly) {
        const previewResult = await enhancedEmailService.generateEmailPreview(
          req.session.userId || 1, // Use session user ID or fallback to 1
          cancellationData,
          'cancellation'
        );
        
        return res.json({
          success: true,
          message: 'Cancellation email preview generated',
          icsData: previewResult.icsData,
          htmlContent: previewResult.htmlContent
        });
      }
      
      // Send the actual cancellation emails
      const result = await enhancedEmailService.sendEventCancellation(
        req.session.userId || 1, // Use session user ID or fallback to 1
        cancellationData
      );
      
      return res.json({
        success: result.success,
        message: result.message,
        icsData: result.icsData,
        htmlContent: result.htmlContent
      });
    } catch (error) {
      console.error('Error testing enhanced cancellation email:', error);
      return res.status(500).json({
        success: false,
        message: `Error testing enhanced cancellation email: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  console.log('Registered enhanced email test endpoints: /api/enhanced-test-email, /api/enhanced-test-invitation, and /api/enhanced-test-cancellation');
}