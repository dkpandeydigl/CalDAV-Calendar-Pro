/**
 * WebSocket Service
 * Provides a centralized way to interact with WebSockets in the application
 */
import { createWebSocketConnection, checkWebSocketConnectivity } from '../utils/websocket';

// Types for WebSocket messages
export interface WebSocketMessage {
  type: string;
  timestamp: number;
  data?: any;
}

// Callback types
type MessageCallback = (data: any) => void;
type ConnectionCallback = () => void;

class WebSocketService {
  private static instance: WebSocketService;
  private socket: WebSocket | null = null;
  private messageListeners: Map<string, Set<MessageCallback>> = new Map();
  private connectListeners: Set<ConnectionCallback> = new Set();
  private disconnectListeners: Set<ConnectionCallback> = new Set();
  private isConnected: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000; // in ms

  private constructor() {
    // Initialize the service
    console.log('WebSocket service initialized');
  }

  /**
   * Get the singleton instance of the WebSocket service
   */
  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  /**
   * Connect to the WebSocket server
   */
  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket already connected or connecting');
      return;
    }

    this.socket = createWebSocketConnection(
      this.handleMessage.bind(this),
      this.handleOpen.bind(this),
      this.handleClose.bind(this)
    );
  }

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.close(1000, 'Disconnected by client');
      this.socket = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnected = false;
  }

  /**
   * Send a message to the WebSocket server
   */
  public send(type: string, data?: any): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message - WebSocket not connected');
      return false;
    }

    try {
      const message: WebSocketMessage = {
        type,
        timestamp: Date.now(),
        data
      };

      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  /**
   * Subscribe to WebSocket messages of a specific type
   */
  public subscribe(type: string, callback: MessageCallback): () => void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Set());
    }

    this.messageListeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.messageListeners.get(type);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.messageListeners.delete(type);
        }
      }
    };
  }

  /**
   * Subscribe to connection events
   */
  public onConnect(callback: ConnectionCallback): () => void {
    this.connectListeners.add(callback);

    // If already connected, call the callback immediately
    if (this.isConnected) {
      callback();
    }

    // Return unsubscribe function
    return () => {
      this.connectListeners.delete(callback);
    };
  }

  /**
   * Subscribe to disconnection events
   */
  public onDisconnect(callback: ConnectionCallback): () => void {
    this.disconnectListeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.disconnectListeners.delete(callback);
    };
  }

  /**
   * Check if WebSocket is currently connected
   */
  public isWebSocketConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Test WebSocket connectivity
   */
  public testConnectivity(callback: (isWorking: boolean) => void): void {
    checkWebSocketConnectivity(callback);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    if (!data || !data.type) {
      console.warn('Received WebSocket message with invalid format:', data);
      return;
    }

    // Notify all listeners for this message type
    const listeners = this.messageListeners.get(data.type);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in WebSocket message handler for type ${data.type}:`, error);
        }
      });
    }

    // Also notify global listeners (if any)
    const globalListeners = this.messageListeners.get('*');
    if (globalListeners) {
      globalListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in global WebSocket message handler:', error);
        }
      });
    }
  }

  /**
   * Handle WebSocket connection open event
   */
  private handleOpen(): void {
    console.log('WebSocket connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;

    // Notify all connection listeners
    this.connectListeners.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in WebSocket connection handler:', error);
      }
    });
  }

  /**
   * Handle WebSocket connection close event
   */
  private handleClose(): void {
    console.log('WebSocket disconnected');
    this.isConnected = false;

    // Notify all disconnection listeners
    this.disconnectListeners.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in WebSocket disconnection handler:', error);
      }
    });

    // Try to reconnect if not manually disconnected
    this.attemptReconnect();
  }

  /**
   * Attempt to reconnect to the WebSocket server
   */
  private attemptReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
      
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      this.reconnectTimer = setTimeout(() => {
        console.log(`Reconnecting to WebSocket (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect();
      }, delay);
    } else {
      console.warn(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
    }
  }
}

// Export singleton instance
export const websocketService = WebSocketService.getInstance();
export default websocketService;