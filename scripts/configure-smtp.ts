/**
 * SMTP Configuration Script
 * 
 * This script configures the SMTP server settings for all users in the system.
 * It uses the default SMTP server details (smtps.xgen.in) and the user's email address as the FROM.
 * The script uses the user's login password as the SMTP password.
 */

import { db } from '../server/db';
import { users, smtpConfigurations } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function configureSmtp() {
  try {
    console.log('Starting SMTP configuration setup...');
    
    // Get all users with their passwords
    const allUsers = await db.select().from(users);
    console.log(`Found ${allUsers.length} users to configure SMTP for.`);
    
    // For each user, check if they have an SMTP config and create one if not
    for (const user of allUsers) {
      // Check if user already has SMTP config
      const existingConfig = await db.select()
        .from(smtpConfigurations)
        .where(eq(smtpConfigurations.userId, user.id));
      
      if (existingConfig.length > 0) {
        console.log(`User ${user.username} (ID: ${user.id}) already has SMTP configuration.`);
        // Update existing config with the user's password if password is empty
        if (!existingConfig[0].password) {
          await db.update(smtpConfigurations)
            .set({ password: user.password }) // Use the user's login password for SMTP
            .where(eq(smtpConfigurations.id, existingConfig[0].id));
          console.log(`Updated SMTP password for user ${user.username} (ID: ${user.id})`);
        }
        continue;
      }
      
      // Check if user has an email
      if (!user.email) {
        console.log(`User ${user.username} (ID: ${user.id}) doesn't have an email, skipping SMTP configuration.`);
        continue;
      }
      
      // Create new SMTP configuration with default settings
      // Using the user's login password as the SMTP password
      const newConfig = {
        userId: user.id,
        host: 'smtps.xgen.in',
        port: 465,
        secure: true, // SSL/TLS
        username: user.email,
        password: user.password, // Using user login password
        fromEmail: user.email,
        fromName: user.username || '',
        enabled: true
      };
      
      // Insert the new configuration
      const result = await db.insert(smtpConfigurations)
        .values(newConfig)
        .returning();
      
      console.log(`Created SMTP configuration for user ${user.username} (ID: ${user.id})`);
    }
    
    console.log('SMTP configuration setup completed successfully.');
  } catch (error) {
    console.error('Error configuring SMTP:', error);
  } finally {
    process.exit(0);
  }
}

configureSmtp();