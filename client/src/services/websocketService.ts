/**
 * WebSocket Service for Real-time Updates
 * 
 * Provides a central service for managing WebSocket connections and handling
 * real-time notifications from the server.
 */

export interface WebSocketNotification {
  type: 'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email';
  action: 'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info';
  timestamp: number;
  data: any;
  sourceUserId?: number;
  targetUserIds?: number[];
  uid?: string; // Event UID for event-related notifications
}

type MessageHandlerFunction = (notification: WebSocketNotification) => void;

class WebSocketService {
  private socket: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandlerFunction[]> = new Map();
  private connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private reconnectTimeout: number = 2000; // Start with 2 seconds
  private maxReconnectTimeout: number = 30000; // Max 30 seconds
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private userId: number | null = null;

  /**
   * Initialize the WebSocket connection
   * @param userId The user ID to associate with this connection
   */
  public initialize(userId: number): void {
    if (this.socket && this.connectionStatus === 'connected') {
      console.log('WebSocket connection already established');
      return;
    }

    this.userId = userId;
    this.connect();
  }

  /**
   * Connect to the WebSocket server
   */
  private connect(): void {
    try {
      // Close any existing connection
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }

      this.connectionStatus = 'connecting';
      console.log('Establishing WebSocket connection...');

      // Determine the correct protocol (wss for https, ws for http)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      // Create new WebSocket connection
      this.socket = new WebSocket(wsUrl);

      // Setup event handlers
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('Error initializing WebSocket connection:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket connection open
   */
  private handleOpen(event: Event): void {
    console.log('WebSocket connection established');
    this.connectionStatus = 'connected';
    this.reconnectAttempts = 0;
    this.reconnectTimeout = 2000; // Reset reconnect timeout

    // Send authentication message with user ID
    if (this.userId) {
      this.sendMessage({
        type: 'system',
        action: 'info',
        timestamp: Date.now(),
        data: { userId: this.userId, event: 'auth' }
      });
    }

    // Setup heartbeat to keep connection alive
    this.setupHeartbeat();

    // Notify interested components about connection status
    this.notifyHandlers('connection', {
      type: 'system',
      action: 'info',
      timestamp: Date.now(),
      data: { status: 'connected' }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const notification = JSON.parse(event.data) as WebSocketNotification;
      
      // Log all incoming notifications except heartbeats
      if (!(notification.type === 'system' && notification.data?.event === 'heartbeat')) {
        console.log('WebSocket notification received:', notification);
      }

      // Broadcast to all registered handlers
      this.notifyHandlers('all', notification);

      // Also notify type-specific handlers
      this.notifyHandlers(notification.type, notification);

      // If it's an event notification, also notify by UID
      if (notification.type === 'event' && notification.uid) {
        this.notifyHandlers(`event:${notification.uid}`, notification);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, event.data);
    }
  }

  /**
   * Handle WebSocket connection close
   */
  private handleClose(event: CloseEvent): void {
    console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
    this.connectionStatus = 'disconnected';
    this.cleanup();
    
    // Notify interested components about disconnection
    this.notifyHandlers('connection', {
      type: 'system',
      action: 'info',
      timestamp: Date.now(),
      data: { status: 'disconnected', code: event.code, reason: event.reason }
    });

    // Attempt to reconnect unless this was a clean close
    if (event.code !== 1000) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(event: Event): void {
    console.error('WebSocket error:', event);
    // Error handling is done in the onclose handler
  }

  /**
   * Send a message to the server
   */
  public sendMessage(message: WebSocketNotification): boolean {
    if (!this.socket || this.connectionStatus !== 'connected') {
      console.warn('Cannot send message, WebSocket not connected');
      return false;
    }

    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.log('Maximum reconnection attempts reached, giving up');
      
      // Notify interested components about failed reconnection
      this.notifyHandlers('connection', {
        type: 'system',
        action: 'error',
        timestamp: Date.now(),
        data: { status: 'failed', attempts: this.reconnectAttempts }
      });
      
      return;
    }

    console.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${this.reconnectTimeout}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connect();
    }, this.reconnectTimeout);

    // Increase the timeout for the next attempt (exponential backoff)
    this.reconnectTimeout = Math.min(this.reconnectTimeout * 1.5, this.maxReconnectTimeout);
  }

  /**
   * Set up heartbeat to keep connection alive
   */
  private setupHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.connectionStatus === 'connected') {
        this.sendMessage({
          type: 'system',
          action: 'info',
          timestamp: Date.now(),
          data: { event: 'heartbeat' }
        });
      }
    }, 30000);
  }

  /**
   * Clean up all timers and resources
   */
  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Terminate the WebSocket connection
   */
  public disconnect(): void {
    this.cleanup();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close(1000, 'User disconnected');
      this.socket = null;
    }
    
    this.connectionStatus = 'disconnected';
    console.log('WebSocket disconnected by user');
  }

  /**
   * Register a message handler for specific notification types
   * @param type The notification type to listen for ('all' for all notifications)
   * @param handler The function to call when a notification is received
   * @returns A function to unregister the handler
   */
  public registerHandler(type: string, handler: MessageHandlerFunction): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    
    const handlers = this.messageHandlers.get(type)!;
    handlers.push(handler);
    
    // Return unsubscribe function
    return () => {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    };
  }

  /**
   * Notify all registered handlers for a specific type
   */
  private notifyHandlers(type: string, notification: WebSocketNotification): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(notification);
        } catch (error) {
          console.error(`Error in WebSocket ${type} handler:`, error);
        }
      }
    }
  }

  /**
   * Get the current connection status
   */
  public getConnectionStatus(): 'connecting' | 'connected' | 'disconnected' {
    return this.connectionStatus;
  }
}

// Create a singleton instance
export const websocketService = new WebSocketService();

// Export the singleton instance as default
export default websocketService;