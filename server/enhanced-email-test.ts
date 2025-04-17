/**
 * Enhanced Email Configuration Endpoints
 * 
 * This module provides configuration endpoints for the enhanced email service.
 * All test email endpoints have been removed to ensure consistent UID generation.
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

  console.log('Registered enhanced email configuration endpoints: /api/enhanced-email-config');
}