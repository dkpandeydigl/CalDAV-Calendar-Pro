/**
 * UID Management Service
 * 
 * This service ensures consistent UID handling across event lifecycles (create/update/cancel)
 * - UIDs are generated only during event creation
 * - The same UID is preserved for updates and cancellations
 * - Follows RFC 5545/5546 requirements for iCalendar identifiers
 */

import { Event } from '../shared/schema';

/**
 * Generate a new unique identifier for a calendar event
 * Following RFC 5545/5546 specifications for globally unique identifiers
 * 
 * @returns A compliant UID string
 */
export function generateEventUID(): string {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 10);
  // Format: event-{timestamp}-{random string}@{hostname/domain}
  return `event-${timestamp}-${randomPart}@caldavclient.local`;
}

/**
 * Extract the UID from an event's raw data if available
 * This ensures we maintain the exact same UID for updates and cancellations
 * 
 * @param rawData The raw ICS data or object representation
 * @returns The extracted UID or null if not found
 */
export function extractUIDFromRawData(rawData: string | object | null): string | null {
  if (!rawData) return null;
  
  let rawDataString: string;
  
  if (typeof rawData === 'string') {
    rawDataString = rawData;
  } else {
    try {
      rawDataString = JSON.stringify(rawData);
    } catch (err) {
      console.error('Error converting raw data to string:', err);
      return null;
    }
  }
  
  // Use multiple patterns to extract UID
  const uidPatterns = [
    /UID:([^\r\n]+)/i,     // Standard UID line
    /"UID":"([^"]+)"/i,    // JSON format
    /UID=([^&]+)/i,        // URL parameter format
    /"uid":"([^"]+)"/i     // Lowercase JSON format
  ];
  
  for (const pattern of uidPatterns) {
    const match = rawDataString.match(pattern);
    if (match && match[1]) {
      const extractedUid = match[1].trim();
      console.log(`[UID Manager] Successfully extracted UID from raw data: ${extractedUid}`);
      return extractedUid;
    }
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
  event: Event | null | undefined,
  rawData?: string | object | null
): string {
  // Case 1: Extract from provided raw data first (highest priority)
  if (rawData) {
    const extractedUID = extractUIDFromRawData(rawData);
    if (extractedUID) {
      console.log(`[UID Manager] Using UID from provided raw data: ${extractedUID}`);
      return extractedUID;
    }
  }
  
  // Case 2: Extract from event's raw data
  if (event?.rawData) {
    const extractedUID = extractUIDFromRawData(event.rawData);
    if (extractedUID) {
      console.log(`[UID Manager] Using UID from event's raw data: ${extractedUID}`);
      return extractedUID;
    }
  }
  
  // Case 3: Use event's UID property
  if (event?.uid) {
    console.log(`[UID Manager] Using UID from event object: ${event.uid}`);
    return event.uid;
  }
  
  // Case 4: Generate a new UID (only for creation)
  const newUID = generateEventUID();
  console.log(`[UID Manager] Generated new UID for event creation: ${newUID}`);
  return newUID;
}

/**
 * Record the mapping between server-generated UIDs and our internal UIDs
 * This helps maintain consistent identifiers across different calendar clients
 */
const uidMappings = new Map<string, string>();

/**
 * Register a mapping between an external UID and our internal UID
 * 
 * @param externalUID The UID from an external CalDAV server
 * @param internalUID Our internal UID
 */
export function registerUIDMapping(externalUID: string, internalUID: string): void {
  if (externalUID && internalUID && externalUID !== internalUID) {
    console.log(`[UID Manager] Registering UID mapping: ${externalUID} → ${internalUID}`);
    uidMappings.set(externalUID, internalUID);
  }
}

/**
 * Get our internal UID for a given external UID
 * 
 * @param externalUID The UID from an external CalDAV server
 * @returns Our internal UID or the external UID if no mapping exists
 */
export function getInternalUID(externalUID: string): string {
  const internalUID = uidMappings.get(externalUID);
  if (internalUID) {
    console.log(`[UID Manager] Resolved external UID ${externalUID} to internal UID ${internalUID}`);
    return internalUID;
  }
  return externalUID;
}