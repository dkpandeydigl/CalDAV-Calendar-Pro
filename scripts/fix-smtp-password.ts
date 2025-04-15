/**
 * SMTP Password Fix Script
 * 
 * This script sets up proper SMTP configuration for users by copying
 * their CalDAV server password to the SMTP configuration.
 * It ensures that when users authenticate with CalDAV, their email
 * functionality works correctly.
 */

import { storage } from '../server/memory-storage'; // Use memory storage instead of database-storage

async function fixSmtpPasswords() {
  console.log('Starting SMTP password fix process...');
  
  try {
    // Get all users
    const users = await storage.getAllUsers();
    console.log(`Found ${users.length} users to check for SMTP configurations`);
    
    for (const user of users) {
      console.log(`\nProcessing user: ${user.username} (ID: ${user.id})`);
      
      // 1. Get the server connection to get their CalDAV password
      const serverConnection = await storage.getServerConnection(user.id);
      
      if (!serverConnection) {
        console.log(`  - No server connection found for user ${user.username}, skipping`);
        continue;
      }
      
      if (!serverConnection.password) {
        console.log(`  - Server connection doesn't have a password saved for user ${user.username}, skipping`);
        continue;
      }
      
      console.log(`  - Found server connection with credentials for user ${user.username}`);
      
      // 2. Get or create SMTP configuration
      let smtpConfig = await storage.getSmtpConfig(user.id);
      
      if (smtpConfig) {
        // Update the existing config with the server password
        console.log(`  - Updating existing SMTP configuration for user ${user.username}`);
        
        smtpConfig = await storage.updateSmtpConfig(smtpConfig.id, {
          password: serverConnection.password,
          // Make sure username matches the server connection username
          username: serverConnection.username,
          // Ensure other fields are set
          fromEmail: user.email || serverConnection.username,
          fromName: user.fullName || (user.email ? user.email.split('@')[0] : serverConnection.username.split('@')[0]),
          enabled: true
        });
        
        console.log(`  - SMTP configuration updated successfully for user ${user.username}`);
      } else {
        // Create a new config
        console.log(`  - Creating new SMTP configuration for user ${user.username}`);
        
        smtpConfig = await storage.createSmtpConfig({
          userId: user.id,
          host: 'smtps.xgen.in',
          port: 465,
          secure: true,
          username: serverConnection.username,
          password: serverConnection.password,
          fromEmail: user.email || serverConnection.username,
          fromName: user.fullName || (user.email ? user.email.split('@')[0] : serverConnection.username.split('@')[0]),
          enabled: true
        });
        
        console.log(`  - New SMTP configuration created for user ${user.username}`);
      }
      
      // Print the updated configuration (without password)
      console.log(`  - SMTP Configuration details:`);
      console.log(`    - Host: ${smtpConfig.host}`);
      console.log(`    - Port: ${smtpConfig.port}`);
      console.log(`    - Secure: ${smtpConfig.secure}`);
      console.log(`    - Username: ${smtpConfig.username}`);
      console.log(`    - From Email: ${smtpConfig.fromEmail}`);
      console.log(`    - From Name: ${smtpConfig.fromName || 'Not set'}`);
      console.log(`    - Enabled: ${smtpConfig.enabled}`);
      console.log(`    - Password: ${smtpConfig.password ? '******' : 'Not set'}`);
    }
    
    console.log('\nSMTP password fix process completed successfully');
  } catch (error) {
    console.error('Error fixing SMTP passwords:', error);
  }
}

// Run the script
fixSmtpPasswords()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error running script:', error);
    process.exit(1);
  });