/**
 * Setup Sample User with SMTP Script
 * 
 * This script creates a sample user with proper SMTP configuration
 * in the in-memory storage.
 */

import { storage } from '../server/memory-storage';
import bcrypt from 'bcryptjs';

async function setupSampleUserWithSmtp() {
  console.log('Setting up sample user with SMTP configuration...');
  
  try {
    // Check if user already exists
    const existingUsers = await storage.getAllUsers();
    console.log(`Found ${existingUsers.length} existing users`);
    
    // Hash password
    const hashedPassword = await bcrypt.hash('password', 10);
    
    // Create user
    const user = await storage.createUser({
      username: 'dk.pandey@xgenplus.com',
      password: hashedPassword,
      email: 'dk.pandey@xgenplus.com',
      fullName: 'Dharmendra Pandey',
      preferredTimezone: 'Asia/Kolkata'
    });
    
    console.log(`Created user: ${user.username} (ID: ${user.id})`);
    
    // Create server connection with the same password for CalDAV
    const serverConnection = await storage.createServerConnection({
      userId: user.id,
      url: 'https://zpush.ajaydata.com/davical/',
      username: 'dk.pandey@xgenplus.com',
      password: 'dkp_3010024', // Set the actual password
      autoSync: true,
      syncInterval: 15,
      status: 'connected'
    });
    
    console.log(`Created server connection for user ${user.username}`);
    
    // Create SMTP configuration with the same password
    const smtpConfig = await storage.createSmtpConfig({
      userId: user.id,
      host: 'smtps.xgen.in',
      port: 465,
      secure: true,
      username: 'dk.pandey@xgenplus.com',
      password: 'dkp_3010024', // Set the same password
      fromEmail: 'dk.pandey@xgenplus.com',
      fromName: 'Dharmendra Pandey',
      enabled: true
    });
    
    console.log(`Created SMTP configuration for user ${user.username}`);
    console.log(`SMTP Configuration details:`);
    console.log(`- Host: ${smtpConfig.host}`);
    console.log(`- Port: ${smtpConfig.port}`);
    console.log(`- Secure: ${smtpConfig.secure}`);
    console.log(`- Username: ${smtpConfig.username}`);
    console.log(`- From Email: ${smtpConfig.fromEmail}`);
    console.log(`- From Name: ${smtpConfig.fromName || 'Not set'}`);
    console.log(`- Enabled: ${smtpConfig.enabled}`);
    
    console.log('\nSetup completed successfully');
  } catch (error) {
    console.error('Error setting up sample user:', error);
  }
}

// Run the script
setupSampleUserWithSmtp()
  .then(() => {
    console.log('\nDone');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error running script:', error);
    process.exit(1);
  });