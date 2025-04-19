// uid-utils.ts - RFC 5545 compliant UID generation for calendar events
import { createId } from '@paralleldrive/cuid2';

// IndexedDB for storing generated UIDs with fallback to localStorage
const DB_NAME = 'calendar_app';
const STORE_NAME = 'generated_uids';
const LS_UID_KEY = 'calendar_generated_uids';

// Opens the IndexedDB database for UID storage
async function openUIDDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        console.log('[UID Service] Created UID storage in IndexedDB');
      }
    };
    
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      console.log('[UID Service] Successfully opened IndexedDB');
      resolve(db);
    };
    
    request.onerror = (event) => {
      console.error('[UID Service] Error opening IndexedDB:', (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

// Get existing UIDs from storage
async function getExistingUIDs(): Promise<Set<string>> {
  try {
    // Try IndexedDB first
    const db = await openUIDDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = (event) => {
        const results = (event.target as IDBRequest).result;
        const uidSet = new Set<string>(results.map(item => item.uid));
        db.close();
        console.log(`[UID Service] Retrieved ${uidSet.size} UIDs from IndexedDB`);
        resolve(uidSet);
      };
      
      request.onerror = (event) => {
        console.error('[UID Service] Error retrieving UIDs from IndexedDB:', (event.target as IDBRequest).error);
        db.close();
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.warn('[UID Service] Falling back to localStorage for UIDs', error);
    // Fall back to localStorage
    try {
      const storedUIDs = localStorage.getItem(LS_UID_KEY);
      if (storedUIDs) {
        return new Set<string>(JSON.parse(storedUIDs));
      }
    } catch (lsError) {
      console.error('[UID Service] Error retrieving UIDs from localStorage:', lsError);
    }
    return new Set<string>();
  }
}

// Store a UID to prevent duplication
async function storeUID(uid: string): Promise<void> {
  try {
    // Try IndexedDB first
    const db = await openUIDDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add({ id: createId(), uid: uid });
      
      request.onsuccess = () => {
        console.log(`[UID Service] Stored UID in IndexedDB: ${uid.substring(0, 8)}...`);
        db.close();
        resolve();
      };
      
      request.onerror = (event) => {
        console.error('[UID Service] Error storing UID in IndexedDB:', (event.target as IDBRequest).error);
        db.close();
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.warn('[UID Service] Falling back to localStorage for storing UID', error);
    // Fall back to localStorage
    try {
      const existingUIDs = await getExistingUIDs();
      existingUIDs.add(uid);
      localStorage.setItem(LS_UID_KEY, JSON.stringify([...existingUIDs]));
      console.log(`[UID Service] Stored UID in localStorage: ${uid.substring(0, 8)}...`);
    } catch (lsError) {
      console.error('[UID Service] Failed to store UID in localStorage:', lsError);
    }
  }
}

/**
 * Generates a RFC 5545 compliant UID for calendar events
 * Format: [random-id]@[domain]
 * @returns A unique identifier string
 */
export function generateUID(): string {
  // Use CUID2 for better random id generation than Math.random
  const randomId = createId();
  
  // Get domain from window.location or use a fallback
  const domainPart = typeof window !== 'undefined' ? 
    window.location.hostname : 'calendar-app.example.com';
  
  // Construct the UID according to RFC 5545 format
  const uid = `${randomId}@${domainPart}`;
  
  // Store the generated UID asynchronously
  storeUID(uid).catch(error => {
    console.error('[UID Service] Failed to store generated UID:', error);
  });
  
  return uid;
}

/**
 * Gets a previous UID if one exists, or generates a new one
 * Useful for ensuring persistence across page reloads
 * @param key A key to identify this particular UID
 * @returns A RFC 5545 compliant UID
 */
export async function getOrGenerateUID(key: string): Promise<string> {
  const storageKey = `uid_${key}`;
  
  try {
    // First check local storage for this specific key
    const existingUID = localStorage.getItem(storageKey);
    if (existingUID) {
      console.log(`[UID Service] Using existing UID for ${key}: ${existingUID.substring(0, 8)}...`);
      return existingUID;
    }
  } catch (error) {
    console.warn(`[UID Service] Error retrieving UID for ${key} from localStorage:`, error);
  }
  
  // Generate a new UID
  const newUID = generateUID();
  
  // Store it for future use
  try {
    localStorage.setItem(storageKey, newUID);
  } catch (error) {
    console.warn(`[UID Service] Error storing UID for ${key} in localStorage:`, error);
  }
  
  console.log(`[UID Service] Generated new UID for ${key}: ${newUID.substring(0, 8)}...`);
  return newUID;
}

/**
 * Ensures the provided UID is RFC 5545 compliant
 * If not, it generates a compliant one
 * @param uid Possibly non-compliant UID
 * @returns RFC 5545 compliant UID
 */
export function ensureCompliantUID(uid: string | undefined | null): string {
  // If there's no UID, generate a new one
  if (!uid) {
    return generateUID();
  }
  
  // Check if the UID already has the required format (contains @)
  if (uid.includes('@')) {
    return uid;
  }
  
  // Get domain from window.location or use a fallback
  const domainPart = typeof window !== 'undefined' ? 
    window.location.hostname : 'calendar-app.example.com';
  
  // Add the domain part to make it compliant
  return `${uid}@${domainPart}`;
}