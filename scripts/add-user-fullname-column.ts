/**
 * Script to add full_name column to users table
 * 
 * This script adds:
 * - full_name: Full name of the user to be displayed in emails
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function addUserFullNameColumn() {
  try {
    console.log('Checking if full_name column exists in users table...');
    
    // Check if the column already exists
    const checkColumnResult = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'full_name'
    `);
    
    if (checkColumnResult.length > 0) {
      console.log('Column full_name already exists in users table. Skipping...');
      return;
    }
    
    // Add full_name column to users table
    console.log('Adding full_name column to users table...');
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN full_name text
    `);
    
    console.log('Successfully added full_name column to users table.');
    
    // Initially, set full name to be the same as username
    console.log('Initializing full_name with username values...');
    await db.execute(sql`
      UPDATE users
      SET full_name = username
      WHERE full_name IS NULL
    `);
    
    console.log('Done.');
  } catch (error) {
    console.error('Error adding full_name column to users table:', error);
    process.exit(1);
  }
}

// Run the migration
addUserFullNameColumn()
  .then(() => {
    console.log('Migration completed successfully.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });