/**
 * SMTP Synchronization Utility
 * 
 * This utility ensures that SMTP password is always synchronized with 
 * the CalDAV server password to ensure email invitations work properly.
 */

import { storage } from './memory-storage';  // Use memory storage

export async function syncSmtpPasswordWithCalDAV(userId: number): Promise<boolean> {
  try {
    console.log(`Syncing SMTP password with CalDAV password for user ${userId}...`);
    
    // 1. Get the server connection to extract the CalDAV password
    const serverConnection = await storage.getServerConnection(userId);
    
    if (!serverConnection) {
      console.log(`No server connection found for user ${userId}, can't sync SMTP password`);
      return false;
    }
    
    if (!serverConnection.password) {
      console.log(`Server connection for user ${userId} doesn't have a password, can't sync SMTP password`);
      return false;
    }
    
    // 2. Get the user's profile to get email and name
    const user = await storage.getUser(userId);
    if (!user) {
      console.log(`User ${userId} not found, can't sync SMTP password`);
      return false;
    }
    
    // 3. Get or create SMTP configuration
    let smtpConfig = await storage.getSmtpConfig(userId);
    
    if (smtpConfig) {
      // Check if the password is different - if so, update it
      if (smtpConfig.password !== serverConnection.password) {
        console.log(`Updating SMTP password for user ${userId} to match CalDAV password`);
        
        // Update SMTP configuration with server connection password
        await storage.updateSmtpConfig(smtpConfig.id, {
          password: serverConnection.password,
          // Also ensure username matches the server connection username
          username: serverConnection.username,
          // Update other fields if needed
          fromEmail: user.email || serverConnection.username,
          fromName: user.fullName || (user.email ? user.email.split('@')[0] : serverConnection.username.split('@')[0])
        });
        
        console.log(`SMTP password updated successfully for user ${userId}`);
      } else {
        console.log(`SMTP password already matches CalDAV password for user ${userId}`);
      }
    } else {
      // Create new SMTP configuration with server connection password
      console.log(`Creating new SMTP configuration for user ${userId} with CalDAV password`);
      
      await storage.createSmtpConfig({
        userId,
        host: 'smtps.xgen.in',
        port: 465,
        secure: true,
        username: serverConnection.username,
        password: serverConnection.password,
        fromEmail: user.email || serverConnection.username,
        fromName: user.fullName || (user.email ? user.email.split('@')[0] : serverConnection.username.split('@')[0]),
        enabled: true
      });
      
      console.log(`New SMTP configuration created for user ${userId} with CalDAV password`);
    }
    
    return true;
  } catch (error) {
    console.error(`Error syncing SMTP password for user ${userId}:`, error);
    return false;
  }
}