/**
 * SMTP Connection Test Script
 * 
 * This script tests the SMTP connection for a specified user
 * to verify that email sending will work correctly.
 */

import { storage } from '../server/memory-storage'; // Use memory storage instead of database-storage
import { EmailService } from '../server/email-service';

// Create a new email service instance
const emailService = new EmailService();

async function testSmtpConnection(userId: number) {
  console.log(`Testing SMTP connection for user ID ${userId}...`);
  
  try {
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return;
    }
    
    console.log(`Found user: ${user.username} (${user.fullName || 'No name'})`);
    
    // Initialize the email service
    const initialized = await emailService.initialize(userId);
    if (!initialized) {
      console.error('Failed to initialize email service');
      
      // Check if SMTP config exists
      const smtpConfig = await storage.getSmtpConfig(userId);
      if (!smtpConfig) {
        console.error('No SMTP configuration found for this user');
      } else {
        console.log('SMTP configuration exists but initialization failed:');
        console.log(`- Host: ${smtpConfig.host}`);
        console.log(`- Port: ${smtpConfig.port}`);
        console.log(`- Secure: ${smtpConfig.secure}`);
        console.log(`- Username: ${smtpConfig.username}`);
        console.log(`- From Email: ${smtpConfig.fromEmail}`);
        console.log(`- From Name: ${smtpConfig.fromName || 'Not set'}`);
        console.log(`- Password: ${smtpConfig.password ? '******' : 'Not set'}`);
        
        if (!smtpConfig.password) {
          console.error('SMTP password is not set. This is likely the cause of the failure.');
        }
      }
      return;
    }
    
    // Verify the connection
    const verificationResult = await emailService.verifyConnection();
    console.log(`Verification result: ${verificationResult.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Message: ${verificationResult.message}`);
    
    if (!verificationResult.success) {
      console.log('\nTrying to get more information...');
      
      // Get the server connection to check if CalDAV password is available
      const serverConnection = await storage.getServerConnection(userId);
      if (!serverConnection) {
        console.log('No server connection found for this user');
      } else {
        console.log('Server connection details:');
        console.log(`- URL: ${serverConnection.url}`);
        console.log(`- Username: ${serverConnection.username}`);
        console.log(`- Password: ${serverConnection.password ? '******' : 'Not set'}`);
        
        if (serverConnection.password) {
          console.log('\nA password is available in the server connection. You can run the fix-smtp-password.ts script to copy this password to the SMTP configuration.');
        }
      }
    }
  } catch (error) {
    console.error('Error testing SMTP connection:', error);
  }
}

// Get the user ID from command line arguments or use a default
const userId = process.argv[2] ? parseInt(process.argv[2], 10) : 4; // Default to user ID 4

// Run the test
testSmtpConnection(userId)
  .then(() => {
    console.log('SMTP connection test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error running test:', error);
    process.exit(1);
  });