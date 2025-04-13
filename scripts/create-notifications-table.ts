/**
 * Notifications Table Migration Script
 * 
 * This script creates the necessary notifications table and enum types
 * for the notification system.
 */

import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function createNotificationsTable() {
  const client = await pool.connect();
  
  try {
    console.log('Starting migration: Creating notifications table...');
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Check if notification_type enum exists
    const typeEnumResult = await client.query(`
      SELECT 1 FROM pg_type JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
      WHERE typname = 'notification_type' AND nspname = 'public'
    `);
    
    if (typeEnumResult.rowCount === 0) {
      console.log('Creating notification_type enum...');
      await client.query(`
        CREATE TYPE notification_type AS ENUM (
          'event_invitation',
          'event_update',
          'event_cancellation',
          'attendee_response',
          'event_reminder',
          'invitation_accepted',
          'invitation_declined',
          'invitation_tentative',
          'comment_added',
          'resource_confirmed',
          'resource_denied',
          'system_message'
        )
      `);
    } else {
      console.log('notification_type enum already exists, skipping creation');
    }
    
    // Check if notification_priority enum exists
    const priorityEnumResult = await client.query(`
      SELECT 1 FROM pg_type JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
      WHERE typname = 'notification_priority' AND nspname = 'public'
    `);
    
    if (priorityEnumResult.rowCount === 0) {
      console.log('Creating notification_priority enum...');
      await client.query(`
        CREATE TYPE notification_priority AS ENUM (
          'low',
          'medium',
          'high'
        )
      `);
    } else {
      console.log('notification_priority enum already exists, skipping creation');
    }
    
    // Check if notifications table exists
    const tableResult = await client.query(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'notifications'
    `);
    
    if (tableResult.rowCount === 0) {
      console.log('Creating notifications table...');
      await client.query(`
        CREATE TABLE notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          type notification_type NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          priority notification_priority NOT NULL DEFAULT 'medium',
          related_event_id INTEGER,
          related_event_uid TEXT,
          related_user_id INTEGER,
          related_user_name TEXT,
          related_user_email TEXT,
          additional_data TEXT,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
          requires_action BOOLEAN NOT NULL DEFAULT FALSE,
          action_taken BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP
        )
      `);
      
      // Add index on user_id for faster queries
      await client.query(`
        CREATE INDEX idx_notifications_user_id ON notifications(user_id)
      `);
      
      // Add index on is_read for unread notification queries
      await client.query(`
        CREATE INDEX idx_notifications_is_read ON notifications(is_read) 
        WHERE is_read = FALSE
      `);
      
      // Add index on related_event_id for event-related notifications
      await client.query(`
        CREATE INDEX idx_notifications_event ON notifications(related_event_id)
        WHERE related_event_id IS NOT NULL
      `);
      
      console.log('Notifications table created successfully with indexes');
    } else {
      console.log('Notifications table already exists, skipping creation');
    }
    
    // Commit transaction
    await client.query('COMMIT');
    console.log('Migration completed successfully!');
    
  } catch (error) {
    // Rollback transaction on error
    await client.query('ROLLBACK');
    console.error('Error creating notifications table:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the migration
createNotificationsTable()
  .then(() => {
    console.log('Notifications table migration completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });