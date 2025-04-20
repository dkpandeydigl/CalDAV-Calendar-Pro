/**
 * WebSocket Service
 * 
 * This service wraps the WebSocket utility to provide higher-level
 * functionality specific to our application needs.
 */

import { sharedWebSocket, ConnectionState } from '../utils/websocket';

// WebSocket message types - used to identify different types of messages
export enum MessageType {
  // Calendar event notifications
  EVENT_CREATED = 'event_created',
  EVENT_UPDATED = 'event_updated',
  EVENT_DELETED = 'event_deleted',
  EVENT_CANCELLED = 'event_cancelled',
  
  // Calendar notifications
  CALENDAR_CREATED = 'calendar_created',
  CALENDAR_UPDATED = 'calendar_updated',
  CALENDAR_DELETED = 'calendar_deleted',
  CALENDAR_SHARED = 'calendar_shared',
  CALENDAR_UNSHARED = 'calendar_unshared',
  
  // User notifications
  USER_CONNECTED = 'user_connected',
  USER_DISCONNECTED = 'user_disconnected',
  
  // Synchronization notifications
  SYNC_STARTED = 'sync_started',
  SYNC_COMPLETED = 'sync_completed',
  SYNC_FAILED = 'sync_failed',
  
  // Server notifications
  SERVER_INFO = 'server_info',
  SERVER_ERROR = 'server_error',
  
  // Client commands
  PING = 'ping',
  PONG = 'pong',
  CLIENT_INFO = 'client_info'
}

// Standard message format for all WebSocket communications
export interface WebSocketMessage {
  type: MessageType;
  payload?: any;
  timestamp?: number;
  id?: string;
}

// Listener callback type
export type MessageListener = (message: WebSocketMessage) => void;

// WebSocket service for handling application-specific WebSocket communication
class WebSocketService {
  private listeners: Map<MessageType, Set<MessageListener>> = new Map();
  private globalListeners: Set<MessageListener> = new Set();
  private connected = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly PING_INTERVAL = 30000; // 30 seconds
  
  constructor() {
    // Listen for connection state changes
    sharedWebSocket.on('stateChange', this.handleConnectionStateChange.bind(this));
    
    // Listen for WebSocket messages
    sharedWebSocket.on('message', this.handleWebSocketMessage.bind(this));
    
    // Connect the WebSocket
    if (typeof window !== 'undefined') {
      this.connect();
    }
  }
  
  // Connect to the WebSocket server
  public connect(): void {
    sharedWebSocket.connect();
  }
  
  // Disconnect from the WebSocket server
  public disconnect(): void {
    this.stopPing();
    sharedWebSocket.disconnect();
  }
  
  // Get the current connection state
  public getConnectionState(): ConnectionState {
    return sharedWebSocket.getState();
  }
  
  // Check if the WebSocket is connected
  public isConnected(): boolean {
    return sharedWebSocket.isConnected();
  }
  
  // Send a message to the server
  public sendMessage(message: WebSocketMessage): boolean {
    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
    
    return sharedWebSocket.sendJson(message);
  }
  
  // Send a ping message to keep the connection alive
  private sendPing(): void {
    this.sendMessage({
      type: MessageType.PING,
      timestamp: Date.now()
    });
  }
  
  // Start sending regular pings to keep the connection alive
  private startPing(): void {
    this.stopPing(); // Clear any existing interval
    
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.PING_INTERVAL);
  }
  
  // Stop sending pings
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  // Handle connection state changes
  private handleConnectionStateChange(state: ConnectionState): void {
    console.log(`[WebSocketService] Connection state changed: ${state}`);
    
    if (state === ConnectionState.OPEN) {
      this.connected = true;
      this.startPing();
      
      // Send client info when connected
      this.sendMessage({
        type: MessageType.CLIENT_INFO,
        payload: {
          userAgent: navigator.userAgent,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          timestamp: Date.now()
        }
      });
    } else if (state === ConnectionState.CLOSED || state === ConnectionState.CLOSING) {
      this.connected = false;
      this.stopPing();
    }
  }
  
  // Parse and handle incoming WebSocket messages
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      // Parse the message
      const message = JSON.parse(event.data) as WebSocketMessage;
      
      // Call global listeners
      this.globalListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('[WebSocketService] Error in global message listener:', error);
        }
      });
      
      // Call specific listeners for this message type
      const typeListeners = this.listeners.get(message.type);
      if (typeListeners) {
        typeListeners.forEach(listener => {
          try {
            listener(message);
          } catch (error) {
            console.error(`[WebSocketService] Error in message listener for type ${message.type}:`, error);
          }
        });
      }
      
      // Special handling for ping/pong
      if (message.type === MessageType.PING) {
        this.sendMessage({
          type: MessageType.PONG,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[WebSocketService] Error parsing WebSocket message:', error, event.data);
    }
  }
  
  // Add a listener for a specific message type
  public addListener(type: MessageType, listener: MessageListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    
    const typeListeners = this.listeners.get(type)!;
    typeListeners.add(listener);
    
    // Return a function to remove this listener
    return () => {
      if (this.listeners.has(type)) {
        const listeners = this.listeners.get(type)!;
        listeners.delete(listener);
        
        if (listeners.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }
  
  // Add a listener for all message types
  public addGlobalListener(listener: MessageListener): () => void {
    this.globalListeners.add(listener);
    
    // Return a function to remove this listener
    return () => {
      this.globalListeners.delete(listener);
    };
  }
  
  // Remove a listener for a specific message type
  public removeListener(type: MessageType, listener: MessageListener): void {
    if (this.listeners.has(type)) {
      const typeListeners = this.listeners.get(type)!;
      typeListeners.delete(listener);
      
      if (typeListeners.size === 0) {
        this.listeners.delete(type);
      }
    }
  }
  
  // Remove a global listener
  public removeGlobalListener(listener: MessageListener): void {
    this.globalListeners.delete(listener);
  }
}

// Create a singleton instance of the WebSocket service
export const websocketService = new WebSocketService();

export default websocketService;