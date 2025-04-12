/**
 * Script to add last modified tracking columns to events table
 * 
 * This script adds:
 * - last_modified_by: User ID who last modified the event
 * - last_modified_by_name: Username or email of user who last modified
 * - last_modified_at: Timestamp of last modification
 */
import { db } from '../server/db';
import { pool } from '../server/db';

async function addEventHistoryColumns() {
  console.log('Starting migration: Adding event history tracking columns');
  
  try {
    // First check if the columns already exist
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'events' 
      AND column_name IN ('last_modified_by', 'last_modified_by_name', 'last_modified_at');
    `;
    
    const result = await pool.query(checkQuery);
    const existingColumns = result.rows.map(row => row.column_name);
    
    console.log('Existing history columns:', existingColumns);
    
    const columnsToAdd = [];
    
    if (!existingColumns.includes('last_modified_by')) {
      columnsToAdd.push(`
        ALTER TABLE events 
        ADD COLUMN last_modified_by INTEGER NULL;
      `);
    }
    
    if (!existingColumns.includes('last_modified_by_name')) {
      columnsToAdd.push(`
        ALTER TABLE events 
        ADD COLUMN last_modified_by_name TEXT NULL;
      `);
    }
    
    if (!existingColumns.includes('last_modified_at')) {
      columnsToAdd.push(`
        ALTER TABLE events 
        ADD COLUMN last_modified_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP;
      `);
    }
    
    if (columnsToAdd.length === 0) {
      console.log('All required columns already exist. No migration needed.');
      return;
    }
    
    // Execute each alteration in sequence
    for (const query of columnsToAdd) {
      console.log('Executing:', query.trim());
      await pool.query(query);
    }
    
    console.log('Migration completed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Run the migration
addEventHistoryColumns()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });