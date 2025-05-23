/**
 * Central UID Service
 * 
 * This is the server-side centralized UID management service that ensures
 * consistent UID persistence across the entire application.
 * 
 * It serves as the single source of truth for all UIDs and provides validation
 * and retrieval functions for the rest of the application.
 */

import { storage } from './storage';
import crypto from 'crypto';
import { broadcastUIDChange } from './websocket-notifications';

// Interface for UID mappings
interface UIDMapping {
  eventId: number;
  uid: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory cache for quick access to UIDs
const uidCache = new Map<number, string>();

// Constants for in-memory storage
const UID_TABLE = 'event_uids';

export class CentralUIDService {
  private initialized: boolean = false;
  
  constructor() {
    // Initialize the service
    this.init()
      .then(() => console.log('[CentralUIDService] Successfully initialized'))
      .catch(err => console.error('[CentralUIDService] Initialization failed:', err));
  }
  
  /**
   * Initialize the UID service
   */
  public async init(): Promise<void> {
    try {
      // Check if the table exists in our storage, if not create it
      if (!await this.tableExists()) {
        await this.createTable();
      }
      
      // Load existing UIDs into cache
      await this.loadUIDsIntoCache();
      
      this.initialized = true;
    } catch (error) {
      console.error('[CentralUIDService] Error initializing:', error);
    }
  }
  
  /**
   * Check if our UID table exists
   */
  private async tableExists(): Promise<boolean> {
    try {
      // Check if we can access any calendars to indirectly confirm storage is working
      const users = await storage.getAllUsers();
      return users.length > 0; // If we can get users, assume we can store UIDs
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Create the table for UID storage
   */
  private async createTable(): Promise<void> {
    console.log('[CentralUIDService] Creating UID storage table');
    // Using in-memory storage, no need to create actual table
  }
  
  /**
   * Load all UIDs from storage into cache
   */
  private async loadUIDsIntoCache(): Promise<void> {
    try {
      // Use storage to get all UIDs
      const mappings = await storage.getAllUIDs();
      
      // Clear existing cache
      uidCache.clear();
      
      // Load into cache
      if (mappings && Array.isArray(mappings)) {
        mappings.forEach((mapping: UIDMapping) => {
          if (mapping && mapping.eventId && mapping.uid) {
            uidCache.set(mapping.eventId, mapping.uid);
          }
        });
      }
      
      console.log(`[CentralUIDService] Loaded ${uidCache.size} UIDs into cache`);
    } catch (error) {
      console.error('[CentralUIDService] Error loading UIDs into cache:', error);
    }
  }
  
  /**
   * Generate a new RFC-compliant UID for an event
   * This is the ONLY method that should generate new UIDs in the entire application
   * 
   * @param eventId Optional event ID to automatically store the UID association
   * @returns A globally unique identifier that's compliant with RFC 5545
   */
  public generateUID(eventId?: number): string {
    // Use a more specific format that works well with CalDAV servers
    // This follows the format: event-timestamp-randomstring@domain
    // which is more readily recognizable and debuggable than a UUID
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(4).toString('hex');
    const uid = `event-${timestamp}-${randomPart}@caldavclient.local`;
    
    // If an eventId is provided, immediately store this association
    if (eventId) {
      this.storeUID(eventId, uid)
        .then(() => {
          console.log(`[CentralUIDService] Generated and stored UID ${uid} for event ${eventId}`);
        })
        .catch(err => {
          console.error(`[CentralUIDService] Failed to store generated UID for event ${eventId}:`, err);
        });
      
      // Update cache immediately for performance
      uidCache.set(eventId, uid);
    }
    
    return uid;
  }
  
  /**
   * Store a mapping between event ID and UID
   * This is the ONLY place where UID mappings should be created
   */
  public async storeUID(eventId: number, uid: string): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.init();
      }
      
      // Check if we already have a mapping
      const existingUid = await this.getUID(eventId);
      
      if (existingUid) {
        if (existingUid !== uid) {
          console.warn(`[CentralUIDService] Attempting to change UID for event ${eventId}.`);
          console.warn(`[CentralUIDService] Existing: ${existingUid}, New: ${uid}`);
          console.warn('[CentralUIDService] UIDs should never change after creation.');
          
          // We'll update it anyway but log the warning
          await storage.updateUID(eventId, uid);
          
          // Update the cache
          uidCache.set(eventId, uid);
          
          // Broadcast to all clients
          this.broadcastUIDChange(eventId, uid, 'update');
          return true;
        }
        
        // UID is the same, nothing to do
        return true;
      }
      
      // Create new mapping
      const now = new Date();
      await storage.storeUID({
        eventId, 
        uid,
        createdAt: now,
        updatedAt: now
      });
      
      // Update the cache
      uidCache.set(eventId, uid);
      
      // Broadcast to all clients
      this.broadcastUIDChange(eventId, uid, 'add');
      
      console.log(`[CentralUIDService] Stored new UID mapping: Event ${eventId} -> UID ${uid}`);
      return true;
    } catch (error) {
      console.error(`[CentralUIDService] Error storing UID for event ${eventId}:`, error);
      return false;
    }
  }
  
  /**
   * Get the UID for a specific event ID
   */
  public async getUID(eventId: number): Promise<string | null> {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // Try to get from cache first for performance
      if (uidCache.has(eventId)) {
        return uidCache.get(eventId) || null;
      }
      
      // Get from storage
      const mapping = await storage.getUIDByEventId(eventId);
      
      if (!mapping || !mapping.uid) {
        return null;
      }
      
      const uid = mapping.uid;
      
      // Update cache
      uidCache.set(eventId, uid);
      
      return uid;
    } catch (error) {
      console.error(`[CentralUIDService] Error getting UID for event ${eventId}:`, error);
      return null;
    }
  }
  
  /**
   * Get the event ID for a specific UID
   */
  public async getEventIdByUID(uid: string): Promise<number | null> {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // Check cache first by iterating entries
      const entries = Array.from(uidCache.entries());
      for (const [eventId, cachedUid] of entries) {
        if (cachedUid === uid) {
          return eventId;
        }
      }
      
      // Fallback to storage query
      const mapping = await storage.getEventIdByUID(uid);
      
      if (!mapping || typeof mapping.eventId !== 'number') {
        return null;
      }
      
      return mapping.eventId;
    } catch (error) {
      console.error(`[CentralUIDService] Error getting event ID for UID ${uid}:`, error);
      return null;
    }
  }
  
  /**
   * Delete a UID mapping
   */
  public async deleteUID(eventId: number): Promise<boolean> {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // Get the UID before deleting (for notification)
      const uid = await this.getUID(eventId);
      
      // Remove from storage
      await storage.deleteUID(eventId);
      
      // Remove from cache
      uidCache.delete(eventId);
      
      // Broadcast deletion if we had a UID
      if (uid) {
        this.broadcastUIDChange(eventId, uid, 'delete');
      }
      
      console.log(`[CentralUIDService] Deleted UID mapping for event ${eventId}`);
      return true;
    } catch (error) {
      console.error(`[CentralUIDService] Error deleting UID for event ${eventId}:`, error);
      return false;
    }
  }
  
  /**
   * Extract UID from raw ICS data
   * This is the standard way to extract UIDs across the application
   */
  public extractUIDFromICS(icsData: string): string | null {
    if (!icsData) return null;
    
    try {
      // Enhanced UID extraction with more robust pattern
      const uidPattern = /UID:([^\r\n]+)/i;
      const match = icsData.match(uidPattern);
      
      if (match && match[1]) {
        return match[1].trim();
      }
      
      return null;
    } catch (error) {
      console.error('[CentralUIDService] Error extracting UID from ICS data:', error);
      return null;
    }
  }
  
  /**
   * Validate that an event has the correct UID before any operation
   * 
   * This method is critical for maintaining UID consistency:
   * 1. If the event doesn't have a UID, check if we have one stored
   * 2. If we don't have one stored, generate a new one
   * 3. If we have one stored, use that instead of any provided UID
   * 
   * @returns The correct UID to use for this event
   */
  public async validateEventUID(eventId: number, providedUid?: string): Promise<string> {
    if (!this.initialized) {
      await this.init();
    }
    
    // Get the stored UID for this event
    const storedUid = await this.getUID(eventId);
    
    if (storedUid) {
      // We have a stored UID, use it regardless of provided UID
      if (providedUid && providedUid !== storedUid) {
        console.warn(`[CentralUIDService] Event ${eventId} has inconsistent UIDs.`);
        console.warn(`[CentralUIDService] Stored: ${storedUid}, Provided: ${providedUid}`);
        console.warn('[CentralUIDService] Using stored UID for consistency.');
      }
      
      return storedUid;
    }
    
    // We don't have a stored UID
    if (providedUid) {
      // Use the provided UID and store it
      await this.storeUID(eventId, providedUid);
      return providedUid;
    }
    
    // No stored UID and no provided UID, generate a new one
    const newUid = this.generateUID();
    await this.storeUID(eventId, newUid);
    
    console.log(`[CentralUIDService] Generated new UID ${newUid} for event ${eventId}`);
    return newUid;
  }
  
  // This duplicate function is removed - we already have extractUIDFromICS above

  /**
   * Synchronize UIDs from external sources (e.g., CalDAV server)
   */
  public async syncExternalUIDs(mappings: { eventId: number; uid: string }[]): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      console.log(`[CentralUIDService] Syncing ${mappings.length} external UIDs`);
      
      for (const { eventId, uid } of mappings) {
        await this.storeUID(eventId, uid);
      }
    } catch (error) {
      console.error('[CentralUIDService] Error syncing external UIDs:', error);
    }
  }
  
  /**
   * Broadcast a UID change to all connected clients
   */
  private broadcastUIDChange(eventId: number, uid: string, operation: 'add' | 'update' | 'delete'): void {
    try {
      console.log(`[CentralUIDService] Broadcasting UID ${operation} for event ${eventId}: ${uid}`);
      
      // Use the imported function from websocket-notifications.ts
      broadcastUIDChange(eventId, uid, operation);
    } catch (error) {
      console.error(`[CentralUIDService] Error broadcasting UID change: ${error}`);
    }
  }
}

// Export singleton instance
export const centralUIDService = new CentralUIDService();