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
  private webSocket: WebSocket | null = null;
  private userId: number | null = null;
  
  constructor() {
    this.db = this.initDatabase();
  }
  
  /**
   * Connect to the WebSocket server for real-time UID synchronization
   * 
   * @param userId The ID of the current user
   */
  public connectWebSocket(userId: number): void {
    if (!userId) {
      console.error('Cannot connect WebSocket: No user ID provided');
      return;
    }
    
    this.userId = userId;
    
    // Determine the WebSocket URL based on the current protocol and host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const primaryWsUrl = `${protocol}//${window.location.host}/api/ws?userId=${userId}`;
    const fallbackWsUrl = `${protocol}//${window.location.host}/ws?userId=${userId}`;
    
    try {
      // Close any existing connection
      if (this.webSocket) {
        this.webSocket.close();
      }
      
      // Create new WebSocket connection, trying primary endpoint first
      console.log(`Connecting UID persistence WebSocket to ${primaryWsUrl}`);
      
      // Try primary WebSocket endpoint
      this.connectToEndpoint(primaryWsUrl, () => {
        // If primary fails, try fallback endpoint
        console.log('Primary WebSocket endpoint failed, trying fallback...');
        this.connectToEndpoint(fallbackWsUrl, () => {
          console.error('All WebSocket connection attempts failed');
        });
      });
    } catch (error) {
      console.error('Error establishing UID persistence WebSocket connection:', error);
    }
  }
  
  /**
   * Connect to a specific WebSocket endpoint
   * 
   * @param url The WebSocket endpoint URL
   * @param onFailure Callback to execute if connection fails
   */
  private connectToEndpoint(url: string, onFailure: () => void): void {
    try {
      // Create new WebSocket connection
      this.webSocket = new WebSocket(url);
      
      // Set up event handlers
      this.webSocket.onopen = this.handleWebSocketOpen.bind(this);
      this.webSocket.onmessage = this.handleWebSocketMessage.bind(this);
      
      // Special handler for this connection attempt
      this.webSocket.onclose = (event: CloseEvent) => {
        // If the connection was never established (failed immediately)
        if (event.code !== 1000 && this.webSocket?.readyState !== WebSocket.OPEN) {
          onFailure();
        } else {
          // Normal close handling for established connections
          this.handleWebSocketClose(event);
        }
      };
      
      this.webSocket.onerror = (error: Event) => {
        this.handleWebSocketError(error);
        // Error doesn't always trigger close, so we ensure onFailure is called
        if (this.webSocket?.readyState !== WebSocket.OPEN) {
          onFailure();
        }
      };
    } catch (error) {
      console.error(`Error connecting to WebSocket endpoint ${url}:`, error);
      onFailure();
    }
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
        
        // Notify other clients about the updated UID
        this.sendUIDSyncMessage(eventId, uid, 'update');
      } else {
        // Create new mapping
        await dbInstance.add(UID_STORE, {
          eventId,
          uid,
          createdAt: now,
          updatedAt: now
        });
        console.log(`Stored new UID mapping for event ID ${eventId}: ${uid}`);
        
        // Notify other clients about the new UID
        this.sendUIDSyncMessage(eventId, uid, 'add');
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
      
      // Get the UID before deleting (for WebSocket notification)
      const mapping = await dbInstance.get(UID_STORE, eventId);
      const uid = mapping?.uid;
      
      // Delete the mapping
      await dbInstance.delete(UID_STORE, eventId);
      console.log(`Deleted UID mapping for event ID ${eventId}`);
      
      // Notify other clients about the deleted UID (if we have the UID)
      if (uid) {
        this.sendUIDSyncMessage(eventId, uid, 'delete');
      }
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
   * This matches the server-side centralUIDService.generateUID() format
   * to ensure consistent UID generation between client and server
   * 
   * @param prefix Optional prefix to use for special types of UIDs (e.g., "manual")
   * @returns A globally unique identifier that's compliant with RFC 5545
   */
  public generateUID(prefix: string = 'event'): string {
    // Use a more specific format that works well with CalDAV servers
    // This follows the format: prefix-timestamp-randomstring@domain
    // which is more readily recognizable and debuggable than a UUID
    const timestamp = Date.now();
    // Generate random part (since we don't have crypto.randomBytes on client)
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `${prefix}-${timestamp}-${randomPart}@caldavclient.local`;
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
  
  /**
   * Process a WebSocket message containing UID data
   * 
   * @param message The message containing UID sync data
   */
  private async processUIDSyncMessage(message: UIDSyncMessage): Promise<void> {
    try {
      switch (message.operation) {
        case 'add':
        case 'update':
          await this.storeUID(message.eventId, message.uid);
          console.log(`Received UID sync: ${message.operation} - Event ID ${message.eventId}, UID ${message.uid}`);
          break;
          
        case 'delete':
          await this.deleteUIDMapping(message.eventId);
          console.log(`Received UID sync: ${message.operation} - Event ID ${message.eventId}`);
          break;
          
        default:
          console.warn(`Unknown UID sync operation: ${(message as any).operation}`);
      }
    } catch (error) {
      console.error('Error processing UID sync message:', error);
    }
  }
  
  /**
   * Send a UID mapping update to other clients via WebSocket
   * 
   * @param eventId The event ID
   * @param uid The event UID
   * @param operation The operation being performed ('add', 'update', or 'delete')
   * @returns True if the message was sent successfully
   */
  private sendUIDSyncMessage(eventId: number, uid: string, operation: 'add' | 'update' | 'delete'): boolean {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send UID sync: WebSocket not connected');
      return false;
    }
    
    try {
      const message: WebSocketNotification = {
        type: 'event',
        action: 'uid-sync',
        timestamp: Date.now(),
        data: {
          eventId,
          uid,
          operation,
          timestamp: Date.now()
        },
        sourceUserId: this.userId
      };
      
      this.webSocket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending UID sync message:', error);
      return false;
    }
  }
  
  /**
   * Handle WebSocket open event
   */
  private handleWebSocketOpen(): void {
    console.log('UID persistence WebSocket connection established');
  }
  
  /**
   * Handle WebSocket message event
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      // Check if this is a UID sync message
      if (data.type === 'event' && data.action === 'uid-sync' && data.data) {
        const syncMessage = data.data as UIDSyncMessage;
        
        // Don't process our own messages
        if (data.sourceUserId !== this.userId) {
          this.processUIDSyncMessage(syncMessage);
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  }
  
  /**
   * Handle WebSocket close event
   */
  private handleWebSocketClose(event: CloseEvent): void {
    console.log('UID persistence WebSocket connection closed:', event.code, event.reason);
    
    // Attempt to reconnect after a delay if we have a user ID
    if (this.userId) {
      setTimeout(() => {
        if (this.userId) {
          console.log('Attempting to reconnect UID persistence WebSocket...');
          this.connectWebSocket(this.userId);
        }
      }, 5000);
    }
  }
  
  /**
   * Handle WebSocket error event
   */
  private handleWebSocketError(error: Event): void {
    console.error('UID persistence WebSocket error:', error);
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  public disconnectWebSocket(): void {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
      this.userId = null;
    }
  }
}

// Export singleton instance
export const uidPersistenceService = new UIDPersistenceService();