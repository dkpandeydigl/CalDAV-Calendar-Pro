/**
 * UID Persistence Service
 * 
 * Handles the storage and retrieval of event UIDs using IndexedDB.
 * This ensures UID consistency throughout an event's lifecycle.
 */

import { v4 as uuidv4 } from 'uuid';

// Constants
const DB_NAME = 'calendar_uids';
const STORE_NAME = 'event_uids';
const DB_VERSION = 1;

// Interface for event UID entry
interface EventUIDEntry {
  eventId: number;
  uid: string;
  created: Date;
  lastUsed: Date;
}

class UIDPersistenceService {
  private db: IDBDatabase | null = null;
  private dbInitPromise: Promise<IDBDatabase> | null = null;
  
  /**
   * Initialize the IndexedDB database
   * @returns Promise that resolves when the database is ready
   */
  private initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return Promise.resolve(this.db);
    }
    
    if (this.dbInitPromise) {
      return this.dbInitPromise;
    }
    
    this.dbInitPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (!window.indexedDB) {
        console.error('IndexedDB not supported in this browser');
        reject(new Error('IndexedDB not supported'));
        return;
      }
      
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = (event) => {
        console.error('Error opening IndexedDB:', event);
        reject(new Error('Failed to open IndexedDB'));
      };
      
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create the store for event UIDs if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
          store.createIndex('uid', 'uid', { unique: true });
          store.createIndex('created', 'created', { unique: false });
          store.createIndex('lastUsed', 'lastUsed', { unique: false });
        }
      };
    });
    
    return this.dbInitPromise;
  }
  
  /**
   * Generate a new event UID
   * @returns A RFC-compliant event UID
   */
  private generateUID(): string {
    // Format: event-[timestamp]-[uuid-segment]@caldavclient.local
    const timestamp = Date.now();
    const uuidSegment = uuidv4().split('-')[0];
    return `event-${timestamp}-${uuidSegment}@caldavclient.local`;
  }
  
  /**
   * Get the UID for an event
   * @param eventId The event ID
   * @returns Promise resolving to the event UID or null if not found
   */
  async getUID(eventId: number): Promise<string | null> {
    try {
      const db = await this.initDB();
      
      return new Promise<string | null>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(eventId);
        
        request.onsuccess = () => {
          const result = request.result as EventUIDEntry | undefined;
          if (result) {
            // Update last used timestamp
            this.updateLastUsed(eventId);
            resolve(result.uid);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = (event) => {
          console.error('Error getting UID:', event);
          reject(new Error('Failed to get UID'));
        };
      });
    } catch (error) {
      console.error('Error in getUID:', error);
      return null;
    }
  }
  
  /**
   * Store a UID for an event
   * @param eventId The event ID
   * @param uid Optional specific UID to use
   * @returns Promise resolving to the stored UID
   */
  async storeUID(eventId: number, uid?: string): Promise<string> {
    try {
      const db = await this.initDB();
      const finalUID = uid || this.generateUID();
      
      return new Promise<string>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const entry: EventUIDEntry = {
          eventId,
          uid: finalUID,
          created: new Date(),
          lastUsed: new Date()
        };
        
        const request = store.put(entry);
        
        request.onsuccess = () => {
          resolve(finalUID);
        };
        
        request.onerror = (event) => {
          console.error('Error storing UID:', event);
          reject(new Error('Failed to store UID'));
        };
      });
    } catch (error) {
      console.error('Error in storeUID:', error);
      // If we can't store in IndexedDB, return a generated UID anyway
      return uid || this.generateUID();
    }
  }
  
  /**
   * Delete a stored UID
   * @param eventId The event ID
   * @returns Promise resolving to a boolean indicating success
   */
  async deleteUID(eventId: number): Promise<boolean> {
    try {
      const db = await this.initDB();
      
      return new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(eventId);
        
        request.onsuccess = () => {
          resolve(true);
        };
        
        request.onerror = (event) => {
          console.error('Error deleting UID:', event);
          reject(new Error('Failed to delete UID'));
        };
      });
    } catch (error) {
      console.error('Error in deleteUID:', error);
      return false;
    }
  }
  
  /**
   * Find an event ID from a UID
   * @param uid The UID to look up
   * @returns Promise resolving to the event ID or null if not found
   */
  async findEventIdByUID(uid: string): Promise<number | null> {
    try {
      const db = await this.initDB();
      
      return new Promise<number | null>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const uidIndex = store.index('uid');
        const request = uidIndex.get(uid);
        
        request.onsuccess = () => {
          const result = request.result as EventUIDEntry | undefined;
          if (result) {
            // Update last used timestamp
            this.updateLastUsed(result.eventId);
            resolve(result.eventId);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = (event) => {
          console.error('Error finding event ID by UID:', event);
          reject(new Error('Failed to find event ID by UID'));
        };
      });
    } catch (error) {
      console.error('Error in findEventIdByUID:', error);
      return null;
    }
  }
  
  /**
   * Update the last used timestamp for an event UID
   * @param eventId The event ID
   */
  private async updateLastUsed(eventId: number): Promise<void> {
    try {
      const db = await this.initDB();
      
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(eventId);
      
      request.onsuccess = () => {
        const entry = request.result as EventUIDEntry;
        if (entry) {
          entry.lastUsed = new Date();
          store.put(entry);
        }
      };
    } catch (error) {
      console.error('Error updating last used timestamp:', error);
    }
  }
  
  /**
   * Get or create a UID for an event
   * @param eventId The event ID
   * @returns Promise resolving to a UID (either existing or newly created)
   */
  async getOrCreateUID(eventId: number): Promise<string> {
    try {
      const uid = await this.getUID(eventId);
      if (uid) {
        return uid;
      }
      return this.storeUID(eventId);
    } catch (error) {
      console.error('Error in getOrCreateUID:', error);
      // Generate a new UID as fallback
      return this.generateUID();
    }
  }
  
  /**
   * Clear all stored UIDs for debugging/testing
   * @returns Promise resolving to a boolean indicating success
   */
  async clearAllUIDs(): Promise<boolean> {
    try {
      const db = await this.initDB();
      
      return new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        
        request.onsuccess = () => {
          resolve(true);
        };
        
        request.onerror = (event) => {
          console.error('Error clearing UIDs:', event);
          reject(new Error('Failed to clear UIDs'));
        };
      });
    } catch (error) {
      console.error('Error in clearAllUIDs:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const uidPersistenceService = new UIDPersistenceService();