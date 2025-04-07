import { pool } from '../server/db';

async function addEmailColumnsToEvents() {
  console.log('Adding email tracking columns to the events table...');
  
  try {
    // Check if the columns already exist
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'events' 
      AND column_name IN ('email_sent', 'email_error');
    `);
    
    const existingColumns = checkResult.rows.map(row => row.column_name);
    
    // Add email_sent column if it doesn't exist
    if (!existingColumns.includes('email_sent')) {
      console.log('Adding email_sent column...');
      await pool.query(`
        ALTER TABLE events 
        ADD COLUMN email_sent TIMESTAMP;
      `);
      console.log('email_sent column added successfully.');
    } else {
      console.log('email_sent column already exists.');
    }
    
    // Add email_error column if it doesn't exist
    if (!existingColumns.includes('email_error')) {
      console.log('Adding email_error column...');
      await pool.query(`
        ALTER TABLE events 
        ADD COLUMN email_error TEXT;
      `);
      console.log('email_error column added successfully.');
    } else {
      console.log('email_error column already exists.');
    }
    
    console.log('Email tracking columns migration completed successfully.');
  } catch (error) {
    console.error('Error adding email tracking columns:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the migration
addEmailColumnsToEvents()
  .then(() => {
    console.log('Migration completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });