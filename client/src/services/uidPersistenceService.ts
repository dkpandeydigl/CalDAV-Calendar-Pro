/**
 * UID Persistence Service
 * 
 * This service provides functionality to store and retrieve event UIDs 
 * using IndexedDB to ensure consistency throughout an event's lifecycle.
 * 
 * When a new event is created:
 * 1. Generate a new UID
 * 2. Store it in IndexedDB with the event ID once received from server
 * 
 * When an event is updated or canceled:
 * 1. Retrieve the stored UID using the event ID
 * 2. Use the same UID for the update/cancellation operation
 */

interface EventUIDMapping {
  eventId: number;
  uid: string;
  createdAt: number;
}

// Use a specific DB name and version
const DB_NAME = 'caldav-client-uids';
const DB_VERSION = 1;
const STORE_NAME = 'event-uids';

class UIDPersistenceService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    this.initializeDB();
  }

  /**
   * Initialize the IndexedDB database
   */
  private initializeDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      try {
        console.log('Initializing UID persistence database...');
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
          console.error('IndexedDB error:', event);
          reject(new Error('Failed to open UID database'));
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          console.log('UID persistence database initialized successfully');
          resolve(db);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          // Create the object store with eventId as key path
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
            store.createIndex('uid', 'uid', { unique: false }); // UIDs might be reused in recurring events
            store.createIndex('createdAt', 'createdAt', { unique: false });
            console.log('Created event-uids object store');
          }
        };
      } catch (error) {
        console.error('Error initializing UID persistence database:', error);
        reject(error);
      }
    });

    return this.dbPromise;
  }

  /**
   * Store a UID for an event
   * @param eventId The event ID
   * @param uid The UID to store
   */
  public async storeUID(eventId: number, uid: string): Promise<void> {
    try {
      const db = await this.initializeDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          const item: EventUIDMapping = {
            eventId,
            uid,
            createdAt: Date.now()
          };

          const request = store.put(item);

          request.onsuccess = () => {
            console.log(`Stored UID ${uid} for event ID ${eventId}`);
            resolve();
          };

          request.onerror = (event) => {
            console.error('Error storing UID:', event);
            reject(new Error('Failed to store UID'));
          };
        } catch (error) {
          console.error('Transaction error storing UID:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Failed to access UID database:', error);
      throw error;
    }
  }

  /**
   * Retrieve a UID for an event
   * @param eventId The event ID
   * @returns The stored UID or null if not found
   */
  public async getUID(eventId: number): Promise<string | null> {
    try {
      const db = await this.initializeDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readonly');
          const store = transaction.objectStore(STORE_NAME);

          const request = store.get(eventId);

          request.onsuccess = (event) => {
            const result = (event.target as IDBRequest).result as EventUIDMapping | undefined;
            if (result) {
              console.log(`Retrieved UID ${result.uid} for event ID ${eventId}`);
              resolve(result.uid);
            } else {
              console.log(`No UID found for event ID ${eventId}`);
              resolve(null);
            }
          };

          request.onerror = (event) => {
            console.error('Error retrieving UID:', event);
            reject(new Error('Failed to retrieve UID'));
          };
        } catch (error) {
          console.error('Transaction error retrieving UID:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Failed to access UID database:', error);
      throw error;
    }
  }

  /**
   * Generate a new unique UID for an event
   * Format: event-{timestamp}-{random}@caldavclient.local
   * 
   * @returns A new unique UID
   */
  public generateUID(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `event-${timestamp}-${random}@caldavclient.local`;
  }

  /**
   * Delete a UID mapping for an event
   * @param eventId The event ID
   */
  public async deleteUID(eventId: number): Promise<void> {
    try {
      const db = await this.initializeDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          const request = store.delete(eventId);

          request.onsuccess = () => {
            console.log(`Deleted UID mapping for event ID ${eventId}`);
            resolve();
          };

          request.onerror = (event) => {
            console.error('Error deleting UID mapping:', event);
            reject(new Error('Failed to delete UID mapping'));
          };
        } catch (error) {
          console.error('Transaction error deleting UID:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Failed to access UID database:', error);
      throw error;
    }
  }

  /**
   * Get all stored UID mappings
   * Useful for debugging
   */
  public async getAllUIDMappings(): Promise<EventUIDMapping[]> {
    try {
      const db = await this.initializeDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.getAll();

          request.onsuccess = (event) => {
            const result = (event.target as IDBRequest).result as EventUIDMapping[];
            resolve(result);
          };

          request.onerror = (event) => {
            console.error('Error retrieving all UID mappings:', event);
            reject(new Error('Failed to retrieve all UID mappings'));
          };
        } catch (error) {
          console.error('Transaction error retrieving all UIDs:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Failed to access UID database:', error);
      throw error;
    }
  }

  /**
   * Clear all stored UID mappings
   * Use with caution - primarily for testing
   */
  public async clearAllUIDMappings(): Promise<void> {
    try {
      const db = await this.initializeDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.clear();

          request.onsuccess = () => {
            console.log('Cleared all UID mappings');
            resolve();
          };

          request.onerror = (event) => {
            console.error('Error clearing UID mappings:', event);
            reject(new Error('Failed to clear UID mappings'));
          };
        } catch (error) {
          console.error('Transaction error clearing UIDs:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Failed to access UID database:', error);
      throw error;
    }
  }
}

// Export a singleton instance of the service
export const uidPersistenceService = new UIDPersistenceService();