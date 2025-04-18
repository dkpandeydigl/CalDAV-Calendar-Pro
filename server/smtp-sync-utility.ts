/**
 * SMTP Synchronization Utility
 * 
 * This utility ensures that SMTP password is always synchronized with 
 * the CalDAV server password to ensure email invitations work properly.
 */

import { storage } from './storage';

/**
 * Synchronizes the user's SMTP password with their CalDAV password
 * 
 * @param userId The user ID whose SMTP password needs to be synchronized
 * @returns true if the password was updated, false if no update was necessary
 */
export async function syncSmtpPasswordWithCalDAV(userId: number): Promise<boolean> {
  try {
    // Get the server connection which has the CalDAV password
    const serverConnection = await storage.getServerConnection(userId);
    if (!serverConnection) {
      console.log(`No server connection found for user ${userId}, cannot sync SMTP password`);
      return false;
    }

    // Get the SMTP configuration
    const smtpConfig = await storage.getSmtpConfig(userId);
    if (!smtpConfig) {
      console.log(`No SMTP configuration found for user ${userId}, creating one based on CalDAV credentials`);
      
      // Get the user details to use for SMTP config
      const user = await storage.getUser(userId);
      if (!user || !user.email) {
        console.log(`User ${userId} doesn't have an email address, cannot create SMTP config`);
        return false;
      }
      
      // Create a new SMTP configuration based on server connection
      const newSmtpConfig = {
        userId,
        username: serverConnection.username,
        password: serverConnection.password,
        host: 'smtps.xgen.in', // Default SMTP server
        port: 465,
        secure: true,
        fromEmail: user.email,
        fromName: user.fullName || user.username,
        enabled: true
      };
      
      // Save the new configuration
      await storage.createSmtpConfig(newSmtpConfig);
      console.log(`Created new SMTP configuration for user ${userId} using CalDAV credentials`);
      return true;
    }
    
    // Check if passwords match
    if (smtpConfig.password !== serverConnection.password) {
      // Update the SMTP password to match the CalDAV password
      await storage.updateSmtpConfig(smtpConfig.id, {
        password: serverConnection.password
      });
      console.log(`Updated SMTP password for user ${userId} to match CalDAV password`);
      return true;
    }
    
    // Passwords already match, no update needed
    return false;
  } catch (error) {
    console.error(`Error synchronizing SMTP password for user ${userId}:`, error);
    throw error;
  }
}