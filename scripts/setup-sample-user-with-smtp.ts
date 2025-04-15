/**
 * Setup Sample User with SMTP Script
 * 
 * This script creates a sample user with proper SMTP configuration
 * in the in-memory storage.
 */

import { storage } from '../server/memory-storage';
import { syncSmtpPasswordWithCalDAV } from '../server/smtp-sync-utility';
import { hashPassword } from '../server/auth';

async function setupSampleUserWithSmtp() {
  try {
    console.log('Starting sample user SMTP setup...');
    
    // Check if we already have users in the system
    const users = await storage.getAllUsers();
    
    if (users.length === 0) {
      console.log('No users found in storage, creating sample user...');
      
      // Create a sample user
      const hashedPassword = await hashPassword('testpassword');
      const user = await storage.createUser({
        username: 'testuser',
        password: hashedPassword,
        email: 'test@example.com',
        fullName: 'Test User',
        preferredTimezone: 'Asia/Kolkata'
      });
      
      console.log(`Created sample user with ID ${user.id}`);
      
      // Create a server connection for the user
      const serverConnection = await storage.createServerConnection({
        userId: user.id,
        url: 'https://zpush.ajaydata.com/davical/',
        username: 'testuser',
        password: 'testpassword',
        autoSync: true,
        syncInterval: 300,
        status: 'connected'
      });
      
      console.log(`Created server connection for user: ${serverConnection.id}`);
      
      // Use the SMTP sync utility to create a proper SMTP config based on CalDAV credentials
      const result = await syncSmtpPasswordWithCalDAV(user.id);
      
      if (result) {
        console.log('Successfully created SMTP configuration from CalDAV credentials');
      } else {
        console.log('Failed to create SMTP configuration');
      }
      
      console.log('Sample user setup complete!');
    } else {
      console.log(`Found ${users.length} existing users, setting up SMTP configs for each...`);
      
      // If users exist, ensure they all have SMTP configs
      for (const user of users) {
        const result = await syncSmtpPasswordWithCalDAV(user.id);
        if (result) {
          console.log(`Successfully set up SMTP for user ${user.id} (${user.username})`);
        } else {
          console.log(`No SMTP setup needed for user ${user.id} (${user.username})`);
        }
      }
    }
  } catch (error) {
    console.error('Error setting up sample user with SMTP:', error);
  }
}

// Call the function directly when this script is run
if (require.main === module) {
  setupSampleUserWithSmtp()
    .then(() => console.log('Script execution complete'))
    .catch(err => console.error('Script execution failed:', err));
}

export { setupSampleUserWithSmtp };