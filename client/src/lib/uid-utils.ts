/**
 * Generates a RFC 5545 compliant unique identifier (UID) for calendar events
 * Format: {timestamp}-{random}@{domain}
 * The domain part is required by the RFC to ensure uniqueness across different systems
 */
export function generateUID(domain = 'calendar.replit.app'): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000000).toString(16);
  return `${timestamp}-${random}@${domain}`;
}

/**
 * Stores a UID in localStorage for persistence 
 * This ensures UIDs can be tracked across browser sessions
 */
export function storeUID(uid: string, eventId?: number): void {
  try {
    // Get existing UIDs
    const storedUIDs = localStorage.getItem('calendar_event_uids');
    const uids = storedUIDs ? JSON.parse(storedUIDs) : {};
    
    // Add new UID with timestamp
    if (eventId) {
      uids[`event_${eventId}`] = uid;
    } else {
      // If no eventId, store by the UID itself (useful for template events)
      uids[uid] = uid;
    }
    
    // Save back to localStorage
    localStorage.setItem('calendar_event_uids', JSON.stringify(uids));
  } catch (error) {
    console.error('Error storing UID in localStorage:', error);
  }
}

/**
 * Gets a previously stored UID for an event ID, if available
 */
export function getStoredUID(eventId: number): string | null {
  try {
    const storedUIDs = localStorage.getItem('calendar_event_uids');
    if (!storedUIDs) return null;
    
    const uids = JSON.parse(storedUIDs);
    return uids[`event_${eventId}`] || null;
  } catch (error) {
    console.error('Error retrieving stored UID:', error);
    return null;
  }
}

/**
 * Generates or retrieves a UID for an event
 * Attempts to use a stored UID first, then generates a new one if needed
 */
export function getOrGenerateUID(eventId?: number): string {
  if (eventId) {
    const storedUID = getStoredUID(eventId);
    if (storedUID) return storedUID;
  }
  
  const uid = generateUID();
  
  // If we have an event ID, store for future use
  if (eventId) {
    storeUID(uid, eventId);
  }
  
  return uid;
}

/**
 * Ensures a UID is RFC 5545 compliant
 * If the provided UID doesn't have a domain part, one is added
 */
export function ensureCompliantUID(uid: string): string {
  // Check if UID already has a domain part
  if (uid.includes('@')) {
    return uid;
  }
  
  // Add domain part for compliance
  return `${uid}@calendar.replit.app`;
}

/**
 * Cleans a UID string by removing any invalid characters
 * RFC 5545 compliant UIDs should only contain alphanumeric characters, 
 * hyphens, periods, and @ symbols
 */
export function cleanUID(uid: string): string {
  // Remove any characters that aren't alphanumeric, hyphen, period, underscore or @
  return uid.replace(/[^a-zA-Z0-9\-\._@]/g, '');
}

/**
 * Retrieves a list of all event UIDs stored in the browser
 * Useful for debugging and maintaining UID consistency
 */
export function getAllStoredUIDs(): Record<string, string> {
  try {
    const storedUIDs = localStorage.getItem('calendar_event_uids');
    return storedUIDs ? JSON.parse(storedUIDs) : {};
  } catch (error) {
    console.error('Error retrieving stored UIDs:', error);
    return {};
  }
}

/**
 * Stores UIDs in IndexedDB for more robust persistence
 * This is a more advanced option than localStorage and better for large datasets
 */
export async function storeUIDInIndexedDB(uid: string, eventId?: number): Promise<void> {
  try {
    // Check if IndexedDB is supported
    if (!window.indexedDB) {
      console.warn('IndexedDB not supported, falling back to localStorage');
      storeUID(uid, eventId);
      return;
    }
    
    // Open (or create) the database
    const request = window.indexedDB.open('CalendarUIDStore', 1);
    
    // Handle database creation/upgrade
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create an object store for UIDs if it doesn't exist
      if (!db.objectStoreNames.contains('uids')) {
        const store = db.createObjectStore('uids', { keyPath: 'id' });
        store.createIndex('uid', 'uid', { unique: false });
        store.createIndex('eventId', 'eventId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    
    // Handle success
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(['uids'], 'readwrite');
      const store = transaction.objectStore('uids');
      
      // Store the UID with metadata
      const storeRequest = store.put({
        id: eventId ? `event_${eventId}` : uid,
        uid: uid,
        eventId: eventId,
        timestamp: Date.now()
      });
      
      storeRequest.onerror = (error) => {
        console.error('Error storing UID in IndexedDB:', error);
        // Fall back to localStorage
        storeUID(uid, eventId);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    };
    
    // Handle errors
    request.onerror = (event) => {
      console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
      // Fall back to localStorage
      storeUID(uid, eventId);
    };
  } catch (error) {
    console.error('Error in IndexedDB operation:', error);
    // Fall back to localStorage
    storeUID(uid, eventId);
  }
}

/**
 * Gets a UID from IndexedDB
 * Falls back to localStorage if IndexedDB is not supported or fails
 */
export async function getUIDFromIndexedDB(eventId: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      // Check if IndexedDB is supported
      if (!window.indexedDB) {
        console.warn('IndexedDB not supported, falling back to localStorage');
        resolve(getStoredUID(eventId));
        return;
      }
      
      // Open the database
      const request = window.indexedDB.open('CalendarUIDStore', 1);
      
      // Handle database opening
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Check if the UIDs store exists
        if (!db.objectStoreNames.contains('uids')) {
          db.close();
          resolve(getStoredUID(eventId));
          return;
        }
        
        const transaction = db.transaction(['uids'], 'readonly');
        const store = transaction.objectStore('uids');
        
        // Get the UID by event ID
        const getRequest = store.get(`event_${eventId}`);
        
        getRequest.onsuccess = () => {
          const data = getRequest.result;
          db.close();
          
          if (data && data.uid) {
            resolve(data.uid);
          } else {
            // Fall back to localStorage
            resolve(getStoredUID(eventId));
          }
        };
        
        getRequest.onerror = () => {
          db.close();
          resolve(getStoredUID(eventId));
        };
      };
      
      // Handle errors
      request.onerror = () => {
        resolve(getStoredUID(eventId));
      };
    } catch (error) {
      console.error('Error in IndexedDB operation:', error);
      resolve(getStoredUID(eventId));
    }
  });
}

/**
 * Gets or generates a UID, trying IndexedDB first, then localStorage, then generating
 * This is the most robust implementation that handles all fallback cases
 */
export async function getOrGenerateUIDAsync(eventId?: number): Promise<string> {
  if (eventId) {
    try {
      // Try IndexedDB first
      const indexedDBUID = await getUIDFromIndexedDB(eventId);
      if (indexedDBUID) return indexedDBUID;
      
      // If not in IndexedDB, check localStorage
      const localStorageUID = getStoredUID(eventId);
      if (localStorageUID) return localStorageUID;
    } catch (error) {
      console.error('Error retrieving UID:', error);
    }
  }
  
  // If we get here, we need to generate a new UID
  const uid = generateUID();
  
  // Store for future use if we have an eventId
  if (eventId) {
    try {
      await storeUIDInIndexedDB(uid, eventId);
    } catch (error) {
      console.error('Error storing generated UID:', error);
      storeUID(uid, eventId); // Fallback to localStorage
    }
  }
  
  return uid;
}