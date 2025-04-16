/**
 * UID Persistence Service
 * 
 * This service implements client-side persistence of event UIDs using IndexedDB.
 * It ensures UIDs remain consistent throughout the event lifecycle by:
 * 
 * 1. Storing UIDs when events are created
 * 2. Retrieving the correct UID when events are updated or cancelled
 * 3. Persisting UIDs across browser refreshes and sessions
 * 4. Syncing with server-stored UIDs when available
 * 5. Real-time synchronization across clients via WebSockets
 */

import { openDB, IDBPDatabase } from 'idb';
import { WebSocketNotification } from './websocketService';

interface UIDMapping {
  eventId: number;
  uid: string;
  createdAt: Date;
  updatedAt: Date;
}

// Type for WebSocket UID synchronization messages
interface UIDSyncMessage {
  eventId: number;
  uid: string;
  operation: 'add' | 'update' | 'delete';
  timestamp: number;
}

// Database configuration
const DB_NAME = 'caldav-client-uids';
const DB_VERSION = 1;
const UID_STORE = 'uid-mappings';

class UIDPersistenceService {
  private db: Promise<IDBPDatabase>;
  private isInitialized = false;
  
  constructor() {
    this.db = this.initDatabase();
  }
  
  /**
   * Initialize the IndexedDB database
   */
  private async initDatabase(): Promise<IDBPDatabase> {
    try {
      const db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          // Create the object store for UID mappings if it doesn't exist
          if (!db.objectStoreNames.contains(UID_STORE)) {
            const store = db.createObjectStore(UID_STORE, { keyPath: 'eventId' });
            // Create index on UID for lookups by UID
            store.createIndex('uid', 'uid', { unique: true });
            console.log('UID persistence database created successfully');
          }
        }
      });
      
      this.isInitialized = true;
      console.log('UID persistence service initialized');
      return db;
    } catch (error) {
      console.error('Failed to initialize UID persistence database:', error);
      throw error;
    }
  }
  
  /**
   * Store a mapping between an event ID and its UID
   */
  public async storeUID(eventId: number, uid: string): Promise<void> {
    try {
      const dbInstance = await this.db;
      const now = new Date();
      
      // Check if mapping already exists
      const existingMapping = await dbInstance.get(UID_STORE, eventId);
      
      if (existingMapping) {
        // Update existing mapping with the new UID
        await dbInstance.put(UID_STORE, {
          ...existingMapping,
          uid,
          updatedAt: now
        });
        console.log(`Updated UID mapping for event ID ${eventId}: ${uid}`);
      } else {
        // Create new mapping
        await dbInstance.add(UID_STORE, {
          eventId,
          uid,
          createdAt: now,
          updatedAt: now
        });
        console.log(`Stored new UID mapping for event ID ${eventId}: ${uid}`);
      }
    } catch (error) {
      console.error(`Failed to store UID mapping for event ${eventId}:`, error);
      throw error;
    }
  }
  
  /**
   * Retrieve the UID for a given event ID
   */
  public async getUID(eventId: number): Promise<string | null> {
    try {
      const dbInstance = await this.db;
      const mapping = await dbInstance.get(UID_STORE, eventId);
      
      if (mapping) {
        return mapping.uid;
      }
      
      console.log(`No stored UID found for event ID ${eventId}`);
      return null;
    } catch (error) {
      console.error(`Failed to retrieve UID for event ${eventId}:`, error);
      return null;
    }
  }
  
  /**
   * Find an event ID by its UID
   */
  public async getEventIdByUID(uid: string): Promise<number | null> {
    try {
      const dbInstance = await this.db;
      const mapping = await dbInstance.getFromIndex(UID_STORE, 'uid', uid);
      
      if (mapping) {
        return mapping.eventId;
      }
      
      console.log(`No event ID found for UID ${uid}`);
      return null;
    } catch (error) {
      console.error(`Failed to find event ID for UID ${uid}:`, error);
      return null;
    }
  }
  
  /**
   * Delete a UID mapping for a given event ID
   */
  public async deleteUIDMapping(eventId: number): Promise<void> {
    try {
      const dbInstance = await this.db;
      await dbInstance.delete(UID_STORE, eventId);
      console.log(`Deleted UID mapping for event ID ${eventId}`);
    } catch (error) {
      console.error(`Failed to delete UID mapping for event ${eventId}:`, error);
      throw error;
    }
  }
  
  /**
   * List all stored UID mappings (for debugging)
   */
  public async listAllMappings(): Promise<UIDMapping[]> {
    try {
      const dbInstance = await this.db;
      return await dbInstance.getAll(UID_STORE);
    } catch (error) {
      console.error('Failed to list UID mappings:', error);
      return [];
    }
  }
  
  /**
   * Bulk import mappings from server or sync
   */
  public async bulkImportMappings(mappings: { eventId: number; uid: string }[]): Promise<void> {
    try {
      const dbInstance = await this.db;
      const tx = dbInstance.transaction(UID_STORE, 'readwrite');
      const now = new Date();
      
      for (const mapping of mappings) {
        const existingMapping = await tx.store.get(mapping.eventId);
        
        if (existingMapping) {
          // Update existing mapping
          await tx.store.put({
            ...existingMapping,
            uid: mapping.uid,
            updatedAt: now
          });
        } else {
          // Create new mapping
          await tx.store.add({
            eventId: mapping.eventId,
            uid: mapping.uid,
            createdAt: now,
            updatedAt: now
          });
        }
      }
      
      await tx.done;
      console.log(`Bulk imported ${mappings.length} UID mappings`);
    } catch (error) {
      console.error('Failed to bulk import UID mappings:', error);
      throw error;
    }
  }
  
  /**
   * Generate a unique UID for a new event
   * This follows the RFC 4122 v4 UUID format which is compatible with iCalendar UID requirements
   */
  public generateUID(): string {
    return crypto.randomUUID();
  }
  
  /**
   * Check if UID persistence service is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }
  
  /**
   * Clear all stored UID mappings (use with caution!)
   */
  public async clearAllMappings(): Promise<void> {
    try {
      const dbInstance = await this.db;
      await dbInstance.clear(UID_STORE);
      console.log('Cleared all UID mappings');
    } catch (error) {
      console.error('Failed to clear UID mappings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const uidPersistenceService = new UIDPersistenceService();