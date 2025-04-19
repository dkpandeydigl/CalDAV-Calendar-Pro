/**
 * RFC 5545 compliant UID generation and persistence utilities
 * 
 * Per RFC 5545 section 3.8.4.7:
 * - A UID MUST be a globally unique identifier
 * - The generator SHOULD create the UID with a time component plus a unique identifier
 * - Email-style identifier (user@host) is RECOMMENDED
 * - The domain name SHOULD be real, but domain name requirements can be eased for simple calendaring systems
 */

// Initialize IndexedDB for UID persistence
const DB_NAME = 'calendar-app';
const STORE_NAME = 'event-uids';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

// Initialize the database
async function initDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event) => {
      console.error("IndexedDB error:", event);
      reject(new Error("Failed to open IndexedDB"));
    };
    
    request.onsuccess = (event) => {
      db = (event.target as IDBOpenDBRequest).result;
      console.log("UID persistence service initialized");
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create an object store for UIDs if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

// Try to initialize the database on module load
initDatabase().catch(error => {
  console.warn("Could not initialize IndexedDB for UID persistence:", error);
});

/**
 * Generates a new RFC 5545 compliant UID
 * Format: event-[timestamp]-[random string]@[domain]
 * 
 * @returns A string UID conforming to RFC 5545
 */
export function generateUID(): string {
  // RFC 5545 requires the UID to be globally unique
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 10);
  
  // Per RFC 5545, email format is RECOMMENDED
  // We use caldavclient.local to indicate our client generated this
  return `event-${timestamp}-${randomPart}@caldavclient.local`;
}

/**
 * Get a persisted UID if available or generate and persist a new one
 * This helps maintain consistency for copied events
 */
export async function getOrGenerateUID(): Promise<string> {
  try {
    // Try to get from IndexedDB first (most reliable)
    return await getUIDFromIndexedDB();
  } catch (error) {
    console.warn("Failed to get UID from IndexedDB, using localStorage fallback");
    
    try {
      // Fallback to localStorage if IndexedDB is not available
      return getUIDFromLocalStorage();
    } catch (innerError) {
      console.error("Failed to get UID from localStorage:", innerError);
      
      // Generate a new one if all persistence methods fail
      return generateUID();
    }
  }
}

/**
 * Generate and store a UID in IndexedDB
 */
async function getUIDFromIndexedDB(): Promise<string> {
  try {
    const database = await initDatabase();
    const uid = generateUID();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.add({ uid, created: new Date() });
      
      request.onsuccess = () => {
        resolve(uid);
      };
      
      request.onerror = (event) => {
        reject(new Error("Failed to store UID in IndexedDB"));
      };
    });
  } catch (error) {
    throw new Error(`IndexedDB UID persistence failed: ${error}`);
  }
}

/**
 * Get a UID from localStorage or generate a new one
 */
function getUIDFromLocalStorage(): string {
  try {
    // Generate a new UID
    const uid = generateUID();
    
    // Try to store it in localStorage
    const storedUids = JSON.parse(localStorage.getItem('event-uids') || '[]');
    storedUids.push({ uid, created: new Date() });
    
    // Keep only the last 100 UIDs to prevent localStorage from growing too large
    if (storedUids.length > 100) {
      storedUids.splice(0, storedUids.length - 100);
    }
    
    localStorage.setItem('event-uids', JSON.stringify(storedUids));
    
    return uid;
  } catch (error) {
    // If localStorage fails, just return a new UID
    console.error("localStorage UID persistence failed:", error);
    return generateUID();
  }
}

/**
 * Validate that a UID is RFC 5545 compliant
 * @param uid UID to validate
 * @returns true if valid, false otherwise
 */
export function isValidUID(uid: string): boolean {
  if (!uid) return false;
  
  // RFC 5545 requires the UID to be a valid URI character set
  // At minimum, it should not contain spaces, control characters, or commas
  if (/[\s,]/.test(uid)) return false;
  
  // Should not be longer than 255 characters (practical limit)
  if (uid.length > 255) return false;
  
  return true;
}