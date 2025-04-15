/**
 * Common SMTP Configuration Endpoint Script
 * 
 * This script sets up an API endpoint to run the common SMTP setup on demand.
 * It allows administrators to ensure all users have consistent SMTP settings.
 */
import express from 'express';
import { setupCommonSmtp } from './setup-common-smtp';
import { storage } from '../server/database-storage';

export function registerCommonSmtpEndpoint(app: express.Express) {
  app.post('/api/admin/setup-common-smtp', async (req, res) => {
    try {
      // Check if the requester is an authenticated admin user
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
      }
      
      // Specifically check for admin user or user ID 1 (first user is typically admin)
      const userId = req.user.id;
      if (userId !== 1) {
        return res.status(403).json({ 
          success: false, 
          message: 'Admin privileges required' 
        });
      }
      
      // Run the common SMTP setup
      const result = await setupCommonSmtp();
      
      res.json({
        success: true,
        message: 'Common SMTP configuration completed successfully',
        details: result
      });
    } catch (error) {
      console.error('Error in setup-common-smtp endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to setup common SMTP configuration',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Get endpoint to check which users have SMTP configured
  app.get('/api/admin/smtp-status', async (req, res) => {
    try {
      // Check if the requester is an authenticated admin user
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
      }
      
      // Specifically check for admin user or user ID 1 (first user is typically admin)
      const userId = req.user.id;
      if (userId !== 1) {
        return res.status(403).json({ 
          success: false, 
          message: 'Admin privileges required' 
        });
      }
      
      // Get all users
      const users = await storage.getAllUsers();
      
      // For each user, check if they have SMTP configured
      const userSmtpStatus = await Promise.all(
        users.map(async (user) => {
          const smtpConfig = await storage.getSmtpConfig(user.id);
          return {
            userId: user.id,
            username: user.username,
            fullName: user.fullName,
            hasSmtpConfig: !!smtpConfig,
            smtpEnabled: smtpConfig?.enabled || false
          };
        })
      );
      
      res.json({
        success: true,
        userCount: users.length,
        usersWithSmtp: userSmtpStatus.filter(user => user.hasSmtpConfig).length,
        usersWithEnabledSmtp: userSmtpStatus.filter(user => user.smtpEnabled).length,
        users: userSmtpStatus
      });
    } catch (error) {
      console.error('Error in smtp-status endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch SMTP status',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}