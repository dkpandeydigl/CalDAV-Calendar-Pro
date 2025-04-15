/**
 * List Users Script
 * 
 * This script lists all users in the memory storage.
 */

import { storage } from '../server/memory-storage';

async function listUsers() {
  console.log('Listing all users in memory storage...');
  
  try {
    const users = await storage.getAllUsers();
    console.log(`Found ${users.length} users`);
    
    users.forEach((user, index) => {
      console.log(`\nUser ${index + 1}:`);
      console.log(`- ID: ${user.id}`);
      console.log(`- Username: ${user.username}`);
      console.log(`- Email: ${user.email || 'Not set'}`);
      console.log(`- Full Name: ${user.fullName || 'Not set'}`);
      console.log(`- Preferred Timezone: ${user.preferredTimezone || 'Not set'}`);
    });
  } catch (error) {
    console.error('Error listing users:', error);
  }
}

// Run the script
listUsers()
  .then(() => {
    console.log('\nDone');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error running script:', error);
    process.exit(1);
  });