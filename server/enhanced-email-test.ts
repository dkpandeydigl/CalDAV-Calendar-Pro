/**
 * Enhanced Email Test Endpoints
 * 
 * This module provides test endpoints for the enhanced email service
 * with RFC 5545 compliant ICS formatting.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { storage } from './memory-storage';
import { enhancedEmailService } from './enhanced-email-service';

// Authentication middleware
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function registerEnhancedEmailTestEndpoints(app: Express): void {
  // Test endpoint for enhanced email service
  app.post('/api/enhanced-test-email', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { recipient, subject = "Test Email", body = "This is a test email from the enhanced email service." } = req.body;
      
      if (!recipient) {
        return res.status(400).json({
          success: false,
          message: "Recipient email address is required"
        });
      }
      
      if (!isValidEmail(recipient)) {
        return res.status(400).json({
          success: false, 
          message: "Invalid recipient email address format"
        });
      }
      
      console.log(`=== TESTING ENHANCED EMAIL SERVICE FOR USER ${userId} ===`);
      
      // Initialize the email service
      const initialized = await enhancedEmailService.initialize(userId);
      
      if (!initialized) {
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
          message: `Failed to initialize enhanced email service. Check SMTP configuration.`,
          details: { configDetails }
        });
      }
      
      // Send a test email
      const result = await enhancedEmailService.sendTestEmail(
        userId,
        recipient,
        subject,
        body
      );
      
      return res.json({
        success: result.success,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error("Error in enhanced test email endpoint:", error);
      return res.status(500).json({
        success: false,
        message: `Error sending test email: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });
  
  // Test endpoint for RFC 5545 compliant event invitations
  app.post('/api/enhanced-test-invitation', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { eventId, useEnhancedService = true } = req.body;
      
      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required"
        });
      }
      
      console.log(`=== TESTING ENHANCED INVITATION EMAIL FOR EVENT ID ${eventId} ===`);
      
      // Get the event from storage
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found"
        });
      }
      
      // Parse attendees and resources
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
      
      // Get the user for organizer info
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      const organizer = {
        email: user.email || user.username,
        name: user.fullName || user.username
      };
      
      console.log(`Event has ${attendees.length} attendees and ${resources.length} resources`);
      
      // Prepare event data for invitation
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
        rawData: event.rawData
      };
      
      // Initialize the service
      const initialized = await enhancedEmailService.initialize(userId);
      
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: "Failed to initialize enhanced email service. Check SMTP configuration."
        });
      }
      
      // Send invitation email using our enhanced service
      const result = await enhancedEmailService.sendEventInvitation(userId, eventData);
      
      return res.json({
        success: result.success,
        message: result.message,
        details: result.details,
        event: {
          id: event.id,
          title: event.title,
          uid: event.uid
        }
      });
    } catch (error) {
      console.error("Error in enhanced test invitation endpoint:", error);
      return res.status(500).json({
        success: false,
        message: `Error sending invitation: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });
  
  // Test endpoint for RFC 5545 compliant event cancellations
  app.post('/api/enhanced-test-cancellation', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { eventId } = req.body;
      
      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required"
        });
      }
      
      console.log(`=== TESTING ENHANCED CANCELLATION EMAIL FOR EVENT ID ${eventId} ===`);
      
      // Get the event from storage
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found"
        });
      }
      
      // Parse attendees and resources
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
      
      // Get the user for organizer info
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      const organizer = {
        email: user.email || user.username,
        name: user.fullName || user.username
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
      
      // Initialize the service
      const initialized = await enhancedEmailService.initialize(userId);
      
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: "Failed to initialize enhanced email service. Check SMTP configuration."
        });
      }
      
      // Send cancellation email using our enhanced service
      const result = await enhancedEmailService.sendEventCancellation(userId, eventData);
      
      return res.json({
        success: result.success,
        message: result.message,
        details: result.details,
        event: {
          id: event.id,
          title: event.title,
          uid: event.uid
        }
      });
    } catch (error) {
      console.error("Error in enhanced test cancellation endpoint:", error);
      return res.status(500).json({
        success: false,
        message: `Error sending cancellation: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });
  
  console.log('Registered enhanced email test endpoints: /api/enhanced-test-email, /api/enhanced-test-invitation, and /api/enhanced-test-cancellation');
}