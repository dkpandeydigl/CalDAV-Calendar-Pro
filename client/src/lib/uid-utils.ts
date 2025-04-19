/**
 * Generates a RFC 5545 compliant unique identifier (UID) for calendar events
 * Format: {timestamp}-{random}@{domain}
 * The domain part is required by the RFC to ensure uniqueness across different systems
 */
export function generateUID(domain = 'calendar.replit.app'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}@${domain}`;
}

/**
 * Stores a UID in localStorage for persistence 
 * This ensures UIDs can be tracked across browser sessions
 */
export function storeUID(uid: string, eventId?: number): void {
  try {
    // Get existing UIDs from localStorage
    const existingUIDs = JSON.parse(localStorage.getItem('event_uids') || '{}');
    
    // Add the new UID, potentially mapping to an event ID
    if (eventId) {
      existingUIDs[eventId.toString()] = uid;
    } else {
      // Store in a timestamp-indexed array for unmapped UIDs
      const unmappedUIDs = existingUIDs['unmapped'] || [];
      unmappedUIDs.push({
        uid,
        created: new Date().toISOString()
      });
      existingUIDs['unmapped'] = unmappedUIDs;
    }
    
    // Save back to localStorage
    localStorage.setItem('event_uids', JSON.stringify(existingUIDs));
  } catch (error) {
    console.error('Error storing UID in localStorage:', error);
  }
}

/**
 * Gets a previously stored UID for an event ID, if available
 */
export function getStoredUID(eventId: number): string | null {
  try {
    const existingUIDs = JSON.parse(localStorage.getItem('event_uids') || '{}');
    return existingUIDs[eventId.toString()] || null;
  } catch (error) {
    console.error('Error retrieving UID from localStorage:', error);
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
    if (storedUID) {
      return storedUID;
    }
  }
  
  const newUID = generateUID();
  if (eventId) {
    storeUID(newUID, eventId);
  } else {
    storeUID(newUID);
  }
  
  return newUID;
}

/**
 * Ensures a UID is RFC 5545 compliant
 * If the provided UID doesn't have a domain part, one is added
 */
export function ensureCompliantUID(uid: string): string {
  // Check if UID has an @ symbol indicating it has a domain
  if (!uid.includes('@')) {
    return `${uid}@calendar.replit.app`;
  }
  return uid;
}

/**
 * Cleans a UID string by removing any invalid characters
 * RFC 5545 compliant UIDs should only contain alphanumeric characters, 
 * hyphens, periods, and @ symbols
 */
export function cleanUID(uid: string): string {
  // First ensure any newlines, tabs, etc. are removed
  uid = uid.replace(/[\r\n\t]/g, '');
  
  // If UID contains invalid chars, regenerate a compliant one
  if (!/^[a-zA-Z0-9\-\.@]+$/.test(uid)) {
    console.warn('Cleaning invalid UID:', uid);
    
    // Extract valid parts if possible
    const validParts = uid.match(/([a-zA-Z0-9\-\.@]+)/g);
    if (validParts && validParts.length > 0) {
      return validParts.join('-');
    }
    
    // If no valid parts found, generate a new UID
    return generateUID();
  }
  
  return uid;
}

/**
 * Retrieves a list of all event UIDs stored in the browser
 * Useful for debugging and maintaining UID consistency
 */
export function getAllStoredUIDs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('event_uids') || '{}');
  } catch (error) {
    console.error('Error retrieving all UIDs:', error);
    return {};
  }
}