/**
 * Common SMTP Configuration Setup Script
 * 
 * This script ensures all users have a consistent SMTP configuration with a common sender.
 * It:
 * 1. Creates or updates SMTP configurations for all users
 * 2. Uses user's full name as the 'from name' when available
 * 3. Enables SMTP for all users to ensure consistent email sending capabilities
 */

import { storage } from '../server/database-storage';
import { InsertSmtpConfig } from '../shared/schema';

// Common SMTP server settings
const COMMON_SMTP_CONFIG = {
  host: 'smtps.xgen.in',
  port: 587,
  secure: true,
  username: 'common-notifications@xgenplus.com',
  password: 'PleaseUpdateWithRealPassword123!',  // This should be changed to the actual password
  enabled: true
};

async function setupCommonSmtp() {
  try {
    console.log('Setting up common SMTP configuration for all users...');
    
    // Get all users
    const users = await storage.getAllUsers();
    console.log(`Found ${users.length} users in the system.`);
    
    let created = 0;
    let updated = 0;
    let errors = 0;
    
    // Process each user
    for (const user of users) {
      try {
        // Get existing SMTP config if any
        const existingConfig = await storage.getSmtpConfig(user.id);
        
        // Determine from email (use user email if available, otherwise use username if it looks like an email)
        let fromEmail = user.email;
        if (!fromEmail && user.username.includes('@')) {
          fromEmail = user.username;
        } else if (!fromEmail) {
          // If no email is available, use the common notification email
          fromEmail = COMMON_SMTP_CONFIG.username;
        }
        
        // Determine from name (use user's full name if available, otherwise use username)
        const fromName = user.fullName || user.username;
        
        if (existingConfig) {
          // Update existing configuration
          await storage.updateSmtpConfig(existingConfig.id, {
            host: COMMON_SMTP_CONFIG.host,
            port: COMMON_SMTP_CONFIG.port,
            secure: COMMON_SMTP_CONFIG.secure,
            username: COMMON_SMTP_CONFIG.username,
            password: COMMON_SMTP_CONFIG.password,
            fromEmail,
            fromName,
            enabled: COMMON_SMTP_CONFIG.enabled
          });
          
          console.log(`Updated SMTP configuration for user ${user.username} (ID: ${user.id})`);
          updated++;
        } else {
          // Create new configuration
          const newConfig: InsertSmtpConfig = {
            userId: user.id,
            host: COMMON_SMTP_CONFIG.host,
            port: COMMON_SMTP_CONFIG.port,
            secure: COMMON_SMTP_CONFIG.secure,
            username: COMMON_SMTP_CONFIG.username,
            password: COMMON_SMTP_CONFIG.password,
            fromEmail,
            fromName,
            enabled: COMMON_SMTP_CONFIG.enabled
          };
          
          await storage.createSmtpConfig(newConfig);
          console.log(`Created SMTP configuration for user ${user.username} (ID: ${user.id})`);
          created++;
        }
      } catch (userError) {
        console.error(`Error processing SMTP config for user ${user.username} (ID: ${user.id}):`, userError);
        errors++;
      }
    }
    
    console.log('SMTP Configuration Summary:');
    console.log(`- Created: ${created}`);
    console.log(`- Updated: ${updated}`);
    console.log(`- Errors: ${errors}`);
    console.log('Common SMTP configuration setup completed.');
    
  } catch (error) {
    console.error('Error setting up common SMTP configuration:', error);
  }
}

// Execute the script
setupCommonSmtp().catch(console.error);