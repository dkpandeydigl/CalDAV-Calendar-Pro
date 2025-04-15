/**
 * SMTP Controller
 * 
 * This module provides functions for managing SMTP configurations
 * and includes utilities for setting up common SMTP configurations
 * across all users in the system.
 */

import { Request, Response, NextFunction } from 'express';
import { storage } from './database-storage';
import { insertSmtpConfigSchema, SmtpConfig } from '@shared/schema';

// The default SMTP server configuration
const DEFAULT_SMTP_SERVER = 'smtps.xgen.in';
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_SMTP_SECURE = true;

/**
 * Sets up a common SMTP configuration for all users
 * Uses the common SMTP server with user-specific credentials
 */
export async function setupCommonSmtpConfig(): Promise<{ 
  success: boolean; 
  updated: number; 
  created: number; 
  errors: number;
  details?: any;
}> {
  try {
    // Get all users
    const users = await storage.getAllUsers();
    
    let updated = 0;
    let created = 0;
    let errors = 0;
    
    // Process each user
    for (const user of users) {
      try {
        // Check if user already has SMTP config
        const existingConfig = await storage.getSmtpConfig(user.id);
        
        if (existingConfig) {
          // Update existing config
          await storage.updateSmtpConfig(existingConfig.id, {
            host: DEFAULT_SMTP_SERVER,
            port: DEFAULT_SMTP_PORT,
            secure: DEFAULT_SMTP_SECURE,
            fromEmail: user.email || user.username,
            fromName: user.fullName || user.username,
            enabled: true
          });
          updated++;
        } else {
          // Create new config
          await storage.createSmtpConfig({
            userId: user.id,
            username: user.email || user.username,
            password: '', // Password will need to be set manually by user
            host: DEFAULT_SMTP_SERVER,
            port: DEFAULT_SMTP_PORT,
            secure: DEFAULT_SMTP_SECURE,
            fromEmail: user.email || user.username,
            fromName: user.fullName || user.username,
            enabled: true
          });
          created++;
        }
      } catch (error) {
        console.error(`Error setting up SMTP config for user ${user.id}:`, error);
        errors++;
      }
    }
    
    return {
      success: true,
      updated,
      created,
      errors
    };
  } catch (error) {
    console.error('Error in setupCommonSmtpConfig:', error);
    return {
      success: false,
      updated: 0,
      created: 0,
      errors: 1,
      details: error
    };
  }
}

/**
 * Controller function to handle setting up common SMTP configuration
 */
export async function setupCommonSmtp(req: Request, res: Response) {
  try {
    // Check if user is authenticated and is admin
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    // Run the common SMTP setup
    const result = await setupCommonSmtpConfig();
    
    res.json({
      success: result.success,
      message: result.success 
        ? `SMTP configuration completed: ${result.created} created, ${result.updated} updated, ${result.errors} errors` 
        : 'Failed to setup common SMTP configuration',
      details: result
    });
  } catch (error) {
    console.error('Error in setupCommonSmtp controller:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to setup common SMTP configuration',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Controller function to get SMTP configuration status
 */
export async function getSmtpStatus(req: Request, res: Response) {
  try {
    // Check if user is authenticated
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
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
    console.error('Error in getSmtpStatus controller:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch SMTP status',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}