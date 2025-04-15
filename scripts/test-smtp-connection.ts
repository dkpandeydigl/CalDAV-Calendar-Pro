/**
 * SMTP Connection Test Script
 * 
 * This script tests the SMTP connection for a specified user
 * to verify that email sending will work correctly.
 */

import { storage } from '../server/memory-storage';
import nodemailer from 'nodemailer';

async function testSmtpConnection(userId: number) {
  try {
    console.log(`Testing SMTP connection for user ${userId}...`);
    
    // Get the user's SMTP configuration
    const smtpConfig = await storage.getSmtpConfig(userId);
    
    if (!smtpConfig) {
      console.error(`No SMTP configuration found for user ${userId}`);
      return false;
    }
    
    // Get the user details
    const user = await storage.getUser(userId);
    if (!user) {
      console.error(`User ${userId} not found`);
      return false;
    }
    
    console.log(`Found SMTP config for ${user.username} (${smtpConfig.host}:${smtpConfig.port})`);
    console.log(`From: ${smtpConfig.fromName} <${smtpConfig.fromEmail}>`);
    
    // Create a transporter using the user's SMTP settings
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: smtpConfig.password
      }
    });
    
    // Verify the connection
    try {
      console.log('Verifying connection...');
      const verified = await transporter.verify();
      console.log('Connection verified:', verified);
      return true;
    } catch (verifyError) {
      console.error('SMTP connection verification failed:', verifyError);
      
      // Print detailed error information
      if (verifyError instanceof Error) {
        console.error('Error message:', verifyError.message);
        console.error('Error name:', verifyError.name);
        console.error('Error stack:', verifyError.stack);
      }
      
      return false;
    }
  } catch (error) {
    console.error('Error testing SMTP connection:', error);
    return false;
  }
}

// Call the function directly when this script is run
if (require.main === module) {
  const userId = process.argv[2] ? parseInt(process.argv[2]) : 1;
  
  testSmtpConnection(userId)
    .then(success => {
      console.log('Test completed. Success:', success);
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Test failed with error:', err);
      process.exit(1);
    });
}

export { testSmtpConnection };