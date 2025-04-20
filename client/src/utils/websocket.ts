/**
 * WebSocket utility for establishing and maintaining connections to the server
 * Provides resilient behavior with automatic reconnection
 */

// WebSocket connection states
export enum ConnectionState {
  CONNECTING = 'connecting',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
  RECONNECTING = 'reconnecting'
}

// Configuration options for the WebSocket connection
interface WebSocketOptions {
  reconnectInterval?: number; // Time in ms to wait before reconnecting
  maxReconnectAttempts?: number; // Maximum number of reconnect attempts
  debug?: boolean; // Enable debug logging
  useFallbackPath?: boolean; // Whether to use the fallback WebSocket path
}

// Default options
const DEFAULT_OPTIONS: WebSocketOptions = {
  reconnectInterval: 2000,
  maxReconnectAttempts: 10,
  debug: false,
  useFallbackPath: false
};

/**
 * Creates a resilient WebSocket connection to the server
 * Handles automatic reconnection if the connection is lost
 */
export function createWebSocketConnection(options: WebSocketOptions = DEFAULT_OPTIONS) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  // Internal state
  let socket: WebSocket | null = null;
  let connectionState: ConnectionState = ConnectionState.CLOSED;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Event callbacks
  const eventListeners: Record<string, Function[]> = {
    'open': [],
    'close': [],
    'message': [],
    'error': [],
    'reconnect': [],
    'stateChange': []
  };
  
  // Helper to determine the correct WebSocket URL
  const getWebSocketUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    // Use the correct path based on configuration
    // Some environments require specific WebSocket paths
    const path = config.useFallbackPath ? '/ws' : '/api/ws';
    
    return `${protocol}//${host}${path}`;
  };
  
  // Update connection state and notify listeners
  const updateState = (newState: ConnectionState) => {
    if (connectionState !== newState) {
      if (config.debug) {
        console.log(`[WebSocket] State changed: ${connectionState} -> ${newState}`);
      }
      
      connectionState = newState;
      triggerEvent('stateChange', connectionState);
    }
  };
  
  // Trigger event callbacks
  const triggerEvent = (eventName: string, ...args: any[]) => {
    if (eventListeners[eventName]) {
      eventListeners[eventName].forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[WebSocket] Error in ${eventName} handler:`, error);
        }
      });
    }
  };
  
  // Attempt to reconnect to the server
  const reconnect = () => {
    if (reconnectAttempts >= (config.maxReconnectAttempts || 0)) {
      if (config.debug) {
        console.log(`[WebSocket] Max reconnect attempts reached (${reconnectAttempts})`);
      }
      return;
    }
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    reconnectTimer = setTimeout(() => {
      if (config.debug) {
        console.log(`[WebSocket] Reconnecting... Attempt ${reconnectAttempts + 1}`);
      }
      
      updateState(ConnectionState.RECONNECTING);
      reconnectAttempts++;
      connect();
      
      triggerEvent('reconnect', reconnectAttempts);
    }, config.reconnectInterval);
  };
  
  // Handle WebSocket events
  const setupEventHandlers = () => {
    if (!socket) return;
    
    socket.onopen = (event) => {
      updateState(ConnectionState.OPEN);
      reconnectAttempts = 0;
      triggerEvent('open', event);
    };
    
    socket.onclose = (event) => {
      updateState(ConnectionState.CLOSED);
      triggerEvent('close', event);
      
      // Attempt to reconnect if the close wasn't initiated by the user
      if (!event.wasClean) {
        reconnect();
      }
    };
    
    socket.onmessage = (event) => {
      triggerEvent('message', event);
    };
    
    socket.onerror = (event) => {
      triggerEvent('error', event);
      
      if (config.debug) {
        console.error('[WebSocket] Connection error:', event);
      }
    };
  };
  
  // Connect to the WebSocket server
  const connect = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return; // Already connected
    }
    
    // If there's an existing connection, clean it up first
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      
      try {
        socket.close();
      } catch (e) {
        // Ignore any errors when closing
      }
    }
    
    try {
      updateState(ConnectionState.CONNECTING);
      socket = new WebSocket(getWebSocketUrl());
      setupEventHandlers();
    } catch (error) {
      updateState(ConnectionState.CLOSED);
      console.error('[WebSocket] Failed to create connection:', error);
      
      // Try to reconnect
      reconnect();
    }
  };
  
  // Disconnect from the WebSocket server
  const disconnect = () => {
    if (!socket) return;
    
    updateState(ConnectionState.CLOSING);
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    try {
      socket.close();
    } catch (error) {
      console.error('[WebSocket] Error closing connection:', error);
    }
    
    updateState(ConnectionState.CLOSED);
    reconnectAttempts = 0;
  };
  
  // Send data to the server
  const send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (config.debug) {
        console.warn('[WebSocket] Cannot send message - connection not open');
      }
      return false;
    }
    
    try {
      socket.send(data);
      return true;
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
      return false;
    }
  };
  
  // Send a JSON object to the server
  const sendJson = (data: any) => {
    try {
      return send(JSON.stringify(data));
    } catch (error) {
      console.error('[WebSocket] Error stringifying JSON data:', error);
      return false;
    }
  };
  
  // Add an event listener
  const on = (eventName: string, callback: Function) => {
    if (!eventListeners[eventName]) {
      eventListeners[eventName] = [];
    }
    
    eventListeners[eventName].push(callback);
    
    // If the event is 'stateChange' and we have a current state, trigger immediately
    if (eventName === 'stateChange') {
      try {
        callback(connectionState);
      } catch (error) {
        console.error('[WebSocket] Error in initial stateChange callback:', error);
      }
    }
    
    return () => off(eventName, callback); // Return a function to remove the listener
  };
  
  // Remove an event listener
  const off = (eventName: string, callback: Function) => {
    if (eventListeners[eventName]) {
      const index = eventListeners[eventName].indexOf(callback);
      
      if (index !== -1) {
        eventListeners[eventName].splice(index, 1);
      }
    }
  };
  
  // Get current connection state
  const getState = () => connectionState;
  
  // Check if the connection is currently open
  const isConnected = () => socket?.readyState === WebSocket.OPEN;
  
  // Public API
  return {
    connect,
    disconnect,
    reconnect,
    send,
    sendJson,
    on,
    off,
    getState,
    isConnected
  };
}

// Create a shared WebSocket instance for the entire app
export const sharedWebSocket = createWebSocketConnection({
  debug: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 20
});