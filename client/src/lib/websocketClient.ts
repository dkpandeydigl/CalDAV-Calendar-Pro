/**
 * WebSocket Client
 * 
 * Provides a client-side interface for connecting to the WebSocket server
 * and handling real-time notifications and events.
 */

// Define the message interface (matching server-side)
export interface WSMessage {
  type: string;
  action: string;
  data: any;
  timestamp: number;
}

// Define event handler type
type MessageHandler = (message: WSMessage) => void;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private userId: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Initial delay of 2 seconds
  
  /**
   * Connect to the WebSocket server
   * @param userId Optional user ID to register with the server
   */
  connect(userId?: number): void {
    // Close existing connection if any
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    // Store user ID if provided
    if (userId !== undefined) {
      this.userId = userId;
    }
    
    // Determine the WebSocket URL using the current protocol and host
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      // Create a new WebSocket connection
      this.socket = new WebSocket(wsUrl);
      
      // Set up event handlers
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
      
      console.log('WebSocket: Connecting to', wsUrl);
    } catch (error) {
      console.error('WebSocket: Connection error', error);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reset reconnect attempts
    this.reconnectAttempts = 0;
  }
  
  /**
   * Send a message to the WebSocket server
   * @param message The message to send
   */
  send(message: WSMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket: Cannot send message, socket not open');
      return;
    }
    
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('WebSocket: Send error', error);
    }
  }
  
  /**
   * Add a message handler for a specific message type
   * @param type The message type to listen for
   * @param handler The handler function to call
   */
  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    
    this.handlers.get(type)?.add(handler);
  }
  
  /**
   * Remove a message handler
   * @param type The message type
   * @param handler The handler function to remove
   */
  off(type: string, handler: MessageHandler): void {
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      typeHandlers.delete(handler);
      if (typeHandlers.size === 0) {
        this.handlers.delete(type);
      }
    }
  }
  
  /**
   * Handle WebSocket open event
   */
  private handleOpen(event: Event): void {
    console.log('WebSocket: Connected');
    
    // Reset reconnect attempts on successful connection
    this.reconnectAttempts = 0;
    
    // Send authentication message if user ID is set
    if (this.userId !== null) {
      this.send({
        type: 'auth',
        action: 'register',
        timestamp: Date.now(),
        data: { userId: this.userId }
      });
    }
    
    // Notify any registered handlers
    this.notifyHandlers({
      type: 'system',
      action: 'connected',
      timestamp: Date.now(),
      data: { event }
    });
  }
  
  /**
   * Handle WebSocket message event
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WSMessage;
      this.notifyHandlers(message);
    } catch (error) {
      console.error('WebSocket: Error parsing message', error);
    }
  }
  
  /**
   * Handle WebSocket close event
   */
  private handleClose(event: CloseEvent): void {
    console.log('WebSocket: Disconnected', event.code, event.reason);
    
    // Notify any registered handlers
    this.notifyHandlers({
      type: 'system',
      action: 'disconnected',
      timestamp: Date.now(),
      data: { code: event.code, reason: event.reason }
    });
    
    // Schedule reconnect if needed
    this.scheduleReconnect();
  }
  
  /**
   * Handle WebSocket error event
   */
  private handleError(event: Event): void {
    console.error('WebSocket: Error', event);
    
    // Notify any registered handlers
    this.notifyHandlers({
      type: 'system',
      action: 'error',
      timestamp: Date.now(),
      data: { event }
    });
  }
  
  /**
   * Notify all registered handlers for a message
   */
  private notifyHandlers(message: WSMessage): void {
    // Notify handlers for this specific message type
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      typeHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('WebSocket: Handler error', error);
        }
      });
    }
    
    // Notify 'all' handlers that receive every message
    const allHandlers = this.handlers.get('all');
    if (allHandlers) {
      allHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('WebSocket: All handler error', error);
        }
      });
    }
  }
  
  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Check if we've reached the maximum reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('WebSocket: Maximum reconnect attempts reached');
      return;
    }
    
    // Calculate exponential backoff delay (with some randomness)
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts) * (0.9 + Math.random() * 0.2);
    
    // Schedule reconnect
    this.reconnectTimer = setTimeout(() => {
      console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
}

// Export a singleton instance
export const wsClient = new WebSocketClient();

// For convenience, export a connection function that can be called from components
export function connectToWebSocket(userId?: number): void {
  wsClient.connect(userId);
}