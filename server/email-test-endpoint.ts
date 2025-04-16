/**
 * Email Test Endpoint
 * 
 * This file adds a test endpoint to help diagnose email sending issues.
 */

import express from 'express';
import { storage } from './storage';
import { emailService } from './email-service';
import { setupAuth } from './auth';

/**
 * Register the email test endpoints
 */
export function registerEmailTestEndpoints(app: express.Express) {
  // Get isAuthenticated middleware from auth
  const { isAuthenticated } = setupAuth(app);
  
  // Test email endpoint - sends a test email to the current user
  app.post('/api/test-email', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      
      // Get user information
      const user = await storage.getUser(userId);
      if (!user || !user.email) {
        return res.status(400).json({ 
          success: false, 
          message: 'User has no email address configured' 
        });
      }
      
      console.log(`Starting email test for user ${userId} (${user.email})`);
      
      // Initialize email service for this user
      const initialized = await emailService.initialize(userId);
      console.log(`Email service initialization result:`, initialized);
      
      if (!initialized) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to initialize email service. Check SMTP configuration.' 
        });
      }
      
      // Get SMTP configuration to include in response
      const smtpConfig = await storage.getSmtpConfig(userId);
      
      // Try to send a test email
      const result = await emailService.sendTestEmail(
        userId,
        user.email,
        'CalDAV Calendar - Test Email',
        'This is a test email from your CalDAV Calendar application. If you received this, email sending is working correctly.'
      );
      
      // Include detailed information in the response
      return res.status(result.success ? 200 : 500).json({
        ...result,
        smtpConfig: {
          host: smtpConfig?.host,
          port: smtpConfig?.port,
          secure: smtpConfig?.secure,
          username: smtpConfig?.username,
          // Don't include password
          from: smtpConfig?.fromEmail,
          fromName: smtpConfig?.fromName,
          enabled: smtpConfig?.enabled
        }
      });
    } catch (error) {
      console.error('Error sending test email:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Error sending test email: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // Endpoint to get current SMTP configuration (for debugging)
  app.get('/api/smtp-config', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      
      // Get SMTP configuration
      const smtpConfig = await storage.getSmtpConfig(userId);
      
      if (!smtpConfig) {
        return res.status(404).json({ 
          success: false, 
          message: 'No SMTP configuration found for this user' 
        });
      }
      
      return res.status(200).json({
        success: true,
        smtpConfig: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          // Don't include password
          from: smtpConfig.fromEmail,
          fromName: smtpConfig.fromName,
          enabled: smtpConfig.enabled
        }
      });
    } catch (error) {
      console.error('Error getting SMTP configuration:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Error getting SMTP configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  console.log('Registered email test endpoints: /api/test-email and /api/smtp-config');
}