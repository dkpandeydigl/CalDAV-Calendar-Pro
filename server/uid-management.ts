/**
 * UID Management Service
 * 
 * This service ensures consistent UID handling across event lifecycles (create/update/cancel)
 * - UIDs are generated only during event creation
 * - The same UID is preserved for updates and cancellations
 * - Follows RFC 5545/5546 requirements for iCalendar identifiers
 */

// Mapping for external -> internal UIDs
const uidMappings: Record<string, string> = {};

/**
 * Generate a new unique identifier for a calendar event
 * Following RFC 5545/5546 specifications for globally unique identifiers
 * 
 * @returns A compliant UID string
 */
export function generateEventUID(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const hostname = 'caldavclient.local';
  
  return `event-${timestamp}-${random}@${hostname}`;
}

/**
 * Extract the UID from an event's raw data if available
 * This ensures we maintain the exact same UID for updates and cancellations
 * 
 * @param rawData The raw ICS data or object representation
 * @returns The extracted UID or null if not found
 */
export function extractUIDFromRawData(rawData: string | object | null): string | null {
  if (!rawData) {
    return null;
  }
  
  try {
    // If rawData is an object, stringify it
    const rawString = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    
    // Extract UID using regex
    const uidMatch = rawString.match(/UID:([^\r\n]+)/i);
    if (uidMatch && uidMatch[1]) {
      return uidMatch[1].trim();
    }
    
    // Try alternate pattern for JSON-encoded data
    const jsonUidMatch = rawString.match(/"UID"\s*:\s*"([^"]+)"/i);
    if (jsonUidMatch && jsonUidMatch[1]) {
      return jsonUidMatch[1].trim();
    }
  } catch (error) {
    console.error('Error extracting UID from raw data:', error);
  }
  
  return null;
}

/**
 * Preserve the original UID when updating or cancelling an event
 * 
 * Priority order:
 * 1. Original event's UID from raw data
 * 2. Original event's UID property
 * 3. Generate a new UID (only for new events)
 * 
 * @param event The original event or null if creating a new event
 * @param rawData Optional raw data to extract UID from
 * @returns The UID to use
 */
export function preserveOrGenerateUID(
  event: { uid?: string; rawData?: string | object | null } | null,
  rawData?: string | object | null
): string {
  // Case 1: Check raw data from parameters first (has highest priority)
  const rawDataUID = extractUIDFromRawData(rawData);
  if (rawDataUID) {
    console.log(`[UID Management] Using UID from provided raw data: ${rawDataUID}`);
    return rawDataUID;
  }
  
  // Case 2: Check if we have an existing event
  if (event) {
    // Case 2a: Check raw data in existing event
    const existingRawDataUID = extractUIDFromRawData(event.rawData);
    if (existingRawDataUID) {
      console.log(`[UID Management] Using UID from existing event's raw data: ${existingRawDataUID}`);
      return existingRawDataUID;
    }
    
    // Case 2b: Use existing event's UID property
    if (event.uid) {
      console.log(`[UID Management] Using existing event's UID property: ${event.uid}`);
      return event.uid;
    }
  }
  
  // Case 3: Generate a new UID (only when creating a new event)
  const newUID = generateEventUID();
  console.log(`[UID Management] Generated new UID: ${newUID}`);
  return newUID;
}

/**
 * Record the mapping between server-generated UIDs and our internal UIDs
 * This helps maintain consistent identifiers across different calendar clients
 */

/**
 * Register a mapping between an external UID and our internal UID
 * 
 * @param externalUID The UID from an external CalDAV server
 * @param internalUID Our internal UID
 */
export function registerUIDMapping(externalUID: string, internalUID: string): void {
  if (externalUID && internalUID && externalUID !== internalUID) {
    console.log(`[UID Management] Mapping external UID "${externalUID}" to internal UID "${internalUID}"`);
    uidMappings[externalUID] = internalUID;
  }
}

/**
 * Get our internal UID for a given external UID
 * 
 * @param externalUID The UID from an external CalDAV server
 * @returns Our internal UID or the external UID if no mapping exists
 */
export function getInternalUID(externalUID: string): string {
  return uidMappings[externalUID] || externalUID;
}