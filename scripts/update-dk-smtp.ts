/**
 * Update DK SMTP Configuration Script
 * 
 * This script specifically updates the SMTP configuration for dk.pandey@xgenplus.com
 * with the correct password while maintaining existing settings for the server.
 */

import { db } from '../server/db';
import { smtpConfigurations } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function updateDkSmtpConfig() {
  console.log('Updating SMTP configuration for dk.pandey@xgenplus.com...');
  
  try {
    // Find the SMTP config for dk.pandey@xgenplus.com user
    const [config] = await db.select()
      .from(smtpConfigurations)
      .where(eq(smtpConfigurations.userId, 4)); // User ID for dk.pandey@xgenplus.com
    
    if (!config) {
      console.error('No SMTP configuration found for dk.pandey@xgenplus.com');
      return;
    }
    
    // Update only the password field
    await db.update(smtpConfigurations)
      .set({
        password: 'dkp_3010024'
      })
      .where(eq(smtpConfigurations.id, config.id));
    
    console.log('SMTP configuration updated successfully for dk.pandey@xgenplus.com');
    
    // Verify the update
    const [updatedConfig] = await db.select()
      .from(smtpConfigurations)
      .where(eq(smtpConfigurations.id, config.id));
      
    console.log('Updated configuration:');
    console.log(`- Host: ${updatedConfig.host}`);
    console.log(`- Port: ${updatedConfig.port}`);
    console.log(`- Secure: ${updatedConfig.secure}`);
    console.log(`- Username: ${updatedConfig.username}`);
    console.log(`- From Email: ${updatedConfig.fromEmail}`);
    console.log(`- From Name: ${updatedConfig.fromName}`);
    console.log(`- Enabled: ${updatedConfig.enabled}`);
  } catch (error) {
    console.error('Error updating SMTP configuration:', error);
  }
}

// Run the script
updateDkSmtpConfig()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error running script:', error);
    process.exit(1);
  });