/**
 * UID Persistence Service
 * 
 * This service manages the storage and retrieval of event UIDs using IndexedDB.
 * It ensures that event UIDs are consistently maintained across the application
 * lifecycle, including across browser sessions and syncs.
 */

import { openDB, IDBPDatabase } from 'idb';

interface UIDMapping {
  id: number; // Using eventId as the key
  uid: string;
  calendarId: number;
  created: Date;
  lastUpdated: Date;
}

// Database configuration
const DB_NAME = 'calDAV_client_db';
const STORE_NAME = 'event_uids';
const DB_VERSION = 1;

class UIDPersistenceService {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  /**
   * Initialize the database connection
   */
  async init(): Promise<void> {
    if (this.dbPromise) {
      return; // Database already initialized
    }

    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('uid', 'uid', { unique: true });
          store.createIndex('calendarId', 'calendarId', { unique: false });
          console.log('Created event_uids store in IndexedDB');
        }
      },
    });

    await this.dbPromise;
    console.log('UID persistence service initialized');
  }

  /**
   * Store a mapping between event ID and UID
   */
  async storeUID(eventId: number, uid: string, calendarId: number): Promise<void> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    const now = new Date();
    const mapping: UIDMapping = {
      id: eventId,
      uid,
      calendarId,
      created: now,
      lastUpdated: now,
    };

    await db.put(STORE_NAME, mapping);
    console.log(`Stored UID mapping: Event ID ${eventId} → UID ${uid}`);
  }

  /**
   * Retrieve UID for a given event ID
   */
  async getUID(eventId: number): Promise<string | null> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    try {
      const mapping = await db.get(STORE_NAME, eventId);
      return mapping ? mapping.uid : null;
    } catch (err) {
      console.error('Error retrieving UID:', err);
      return null;
    }
  }

  /**
   * Find event ID for a given UID
   * This is useful during syncs to match incoming UIDs to existing events
   */
  async findEventIdByUID(uid: string): Promise<number | null> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    try {
      const index = db.transaction(STORE_NAME).store.index('uid');
      const mapping = await index.get(uid);
      return mapping ? mapping.id : null;
    } catch (err) {
      console.error('Error finding event ID by UID:', err);
      return null;
    }
  }

  /**
   * Get all stored UID mappings
   * Useful for debugging and maintenance
   */
  async getAllMappings(): Promise<UIDMapping[]> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    return db.getAll(STORE_NAME);
  }

  /**
   * Delete a UID mapping
   */
  async deleteMapping(eventId: number): Promise<void> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    await db.delete(STORE_NAME, eventId);
    console.log(`Deleted UID mapping for event ID ${eventId}`);
  }

  /**
   * Generate a new UID
   * Following RFC 5545 guidelines for globally unique identifiers
   */
  generateUID(): string {
    // Format: uniqueIdentifier@domain
    const domain = 'caldavclient.local';
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    return `event-${timestamp}-${randomStr}@${domain}`;
  }

  /**
   * Check if a UID already exists
   */
  async uidExists(uid: string): Promise<boolean> {
    await this.init();
    const db = await this.dbPromise;
    if (!db) {
      throw new Error('Database not initialized');
    }

    const index = db.transaction(STORE_NAME).store.index('uid');
    const count = await index.count(uid);
    return count > 0;
  }
}

// Create and export singleton instance
export const uidPersistenceService = new UIDPersistenceService();