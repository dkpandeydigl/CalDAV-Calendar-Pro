// Import shared WebSocket utilities
import { ConnectionState, createWebSocketConnection } from '@/utils/websocket';

// Define the SharedWebSocketConnection interface here to avoid circular imports
interface SharedWebSocketConnection {
  connect: () => void;
  disconnect: () => void;
  send: (data: string) => void;
  getState: () => ConnectionState;
  on: (event: string, callback: any) => () => void;
}

/**
 * Message types for WebSocket communication
 */
export enum MessageType {
  PING = 'ping',
  PONG = 'pong',
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  EVENT_CREATED = 'event_created',
  EVENT_UPDATED = 'event_updated',
  EVENT_DELETED = 'event_deleted',
  CALENDAR_UPDATED = 'calendar_updated',
  SERVER_INFO = 'server_info',
  SERVER_ERROR = 'server_error',
  CLIENT_INFO = 'client_info',
  CLIENT_ERROR = 'client_error',
  DEBUG = 'debug'
}

/**
 * WebSocket message interface
 */
export interface WebSocketMessage {
  type: MessageType;
  payload?: any;
  timestamp?: number;
  direction?: 'incoming' | 'outgoing';
}

/**
 * Callback type for message listeners
 */
type MessageListener = (message: WebSocketMessage) => void;

/**
 * WebSocket service that handles connection management and message passing
 */
export class WebSocketService {
  private connection: SharedWebSocketConnection;
  private messageListeners: Map<string, MessageListener[]> = new Map();
  private globalListeners: MessageListener[] = [];
  private listenerIdCounter: number = 0;
  
  constructor() {
    // Create or reuse the shared WebSocket connection
    this.connection = createWebSocketConnection({
      onMessage: this.handleMessage.bind(this),
      onStateChange: this.handleStateChange.bind(this),
      autoReconnect: true,
      debug: true
    });
  }
  
  /**
   * Connect to the WebSocket server
   */
  connect() {
    this.connection.connect();
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  disconnect() {
    this.connection.disconnect();
  }
  
  /**
   * Get the current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connection.getState();
  }
  
  /**
   * Handle incoming messages
   * @param event WebSocket message event
   */
  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      
      // Attach timestamp if not present
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }
      
      // Mark as incoming message
      const incomingMessage = { ...message, direction: 'incoming' as const };
      
      // Dispatch message to topic-specific listeners
      if (this.messageListeners.has(message.type)) {
        const listeners = this.messageListeners.get(message.type) || [];
        listeners.forEach(listener => {
          try {
            listener(incomingMessage);
          } catch (error) {
            console.error(`Error in message listener for type ${message.type}:`, error);
          }
        });
      }
      
      // Dispatch to global listeners
      this.globalListeners.forEach(listener => {
        try {
          listener(incomingMessage);
        } catch (error) {
          console.error('Error in global message listener:', error);
        }
      });
      
      // Special handling for ping/pong for connection testing
      if (message.type === MessageType.PING) {
        this.sendMessage({
          type: MessageType.PONG,
          payload: { 
            receivedAt: Date.now(),
            originalTimestamp: message.timestamp 
          }
        });
      }
      
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  }
  
  /**
   * Handle connection state changes
   */
  private handleStateChange(state: ConnectionState) {
    // Notify global listeners about state change
    this.globalListeners.forEach(listener => {
      try {
        listener({
          type: MessageType.CLIENT_INFO,
          payload: { connectionState: state },
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('Error in state change listener:', error);
      }
    });
  }
  
  /**
   * Send a message to the server
   * @param message Message to send
   * @returns boolean indicating if message was sent
   */
  sendMessage(message: WebSocketMessage): boolean {
    if (this.connection.getState() !== ConnectionState.OPEN) {
      console.warn('Cannot send message: WebSocket is not open');
      return false;
    }
    
    try {
      // Ensure timestamp is present
      const messageToSend: WebSocketMessage = {
        ...message,
        timestamp: message.timestamp || Date.now()
      };
      
      // Send as JSON string
      this.connection.send(JSON.stringify(messageToSend));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }
  
  /**
   * Add a listener for a specific message type
   * @param type Message type to listen for
   * @param callback Callback function
   * @returns Function to remove the listener
   */
  addListener(type: MessageType, callback: MessageListener): () => void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, []);
    }
    
    const listeners = this.messageListeners.get(type)!;
    const id = this.listenerIdCounter++;
    
    listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const updatedListeners = this.messageListeners.get(type) || [];
      this.messageListeners.set(
        type,
        updatedListeners.filter((_, i) => i !== id)
      );
    };
  }
  
  /**
   * Add a global listener for all message types
   * @param callback Callback function
   * @returns Function to remove the listener
   */
  addGlobalListener(callback: MessageListener): () => void {
    const id = this.globalListeners.length;
    this.globalListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.globalListeners = this.globalListeners.filter((_, i) => i !== id);
    };
  }
}

// Create a singleton instance of the WebSocket service
export const websocketService = new WebSocketService();

export default websocketService;