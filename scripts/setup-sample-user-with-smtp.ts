/**
 * Sample User Setup Script with SMTP Configuration
 * 
 * This script sets up a sample user with proper SMTP configuration
 * for testing email functionality.
 */

import { storage } from '../server/memory-storage';
import { emailService } from '../server/email-service';
import { hashPassword } from '../server/auth';

async function setupSampleUserWithSmtp() {
  try {
    console.log('Setting up sample user with SMTP configuration...');
    
    // Check if user already exists
    const username = 'test@example.com';
    let user = await storage.getUserByUsername(username);
    
    if (!user) {
      // Create user if doesn't exist
      const hashedPassword = await hashPassword('password123');
      user = await storage.createUser({
        username,
        password: hashedPassword,
        email: username,
        fullName: 'Test User'
      });
      
      console.log(`Created user ${username} with ID ${user.id}`);
    } else {
      console.log(`User ${username} already exists with ID ${user.id}`);
    }
    
    // Create or update server connection
    let serverConnection = await storage.getServerConnection(user.id);
    if (!serverConnection) {
      serverConnection = await storage.createServerConnection({
        userId: user.id,
        url: 'https://zpush.ajaydata.com/davical/',
        username,
        password: 'password123', // Plain password for CalDAV access
        autoSync: true,
        syncInterval: 15,
        status: "connected"
      });
      console.log(`Created server connection for user ${username}`);
    } else {
      await storage.updateServerConnection(serverConnection.id, {
        password: 'password123' // Update password
      });
      console.log(`Updated server connection for user ${username}`);
    }
    
    // Create or update SMTP config using same credentials
    let smtpConfig = await storage.getSmtpConfig(user.id);
    if (!smtpConfig) {
      smtpConfig = await storage.createSmtpConfig({
        userId: user.id,
        host: 'smtps.xgen.in',
        port: 465,
        secure: true,
        username,
        password: 'password123', // Use the same password as CalDAV
        fromEmail: username,
        fromName: 'Test User',
        enabled: true
      });
      console.log(`Created SMTP configuration for user ${username}`);
    } else {
      await storage.updateSmtpConfig(smtpConfig.id, {
        password: 'password123'
      });
      console.log(`Updated SMTP configuration for user ${username}`);
    }
    
    // Test the SMTP connection
    try {
      console.log('Initializing email service to test connection...');
      const initSuccess = await emailService.initialize(user.id);
      
      if (initSuccess) {
        console.log('Email service initialized successfully');
        const verifyResult = await emailService.verifyConnection();
        
        console.log('SMTP connection test result:', verifyResult);
        
        if (verifyResult.success) {
          console.log('SUCCESS: SMTP connection verified successfully');
        } else {
          console.log('WARNING: SMTP connection verification failed:', verifyResult.message);
        }
      } else {
        console.log('FAILED: Unable to initialize email service');
      }
    } catch (emailError) {
      console.error('Error testing email service:', emailError);
    }
    
    console.log('\nSample user setup complete. You can use these credentials for testing:');
    console.log('Username:', username);
    console.log('Password: password123');
    console.log('User ID:', user.id);
    
    return user.id;
  } catch (error) {
    console.error('Error setting up sample user:', error);
    throw error;
  }
}

// Call the function directly when this script is run
if (require.main === module) {
  setupSampleUserWithSmtp()
    .then(userId => {
      console.log('Setup completed for user ID:', userId);
      process.exit(0);
    })
    .catch(err => {
      console.error('Setup failed:', err);
      process.exit(1);
    });
}

export { setupSampleUserWithSmtp };