/**
 * WebSocket connection state enum
 */
export enum ConnectionState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
  RECONNECTING = 4
}

/**
 * WebSocket connection options
 */
export interface WebSocketConnectionOptions {
  url?: string;
  fallbackUrl?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (event: MessageEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  debug?: boolean;
}

/**
 * Interface for the shared WebSocket connection
 */
export interface SharedWebSocketConnection {
  connect: () => void;
  disconnect: () => void;
  send: (data: string) => void;
  getState: () => ConnectionState;
  on: (event: string, callback: any) => () => void;
}

// Singleton instance of the shared WebSocket connection
let sharedInstance: SharedWebSocketConnection | null = null;

/**
 * Create a shared WebSocket connection that can be used across components
 * 
 * @param options Configuration options for the WebSocket connection
 * @returns Shared WebSocket connection interface
 */
export function createWebSocketConnection(options: WebSocketConnectionOptions = {}): SharedWebSocketConnection {
  // If a shared instance already exists, return it
  if (sharedInstance) {
    if (options.debug) {
      console.log('[WebSocket] Returning existing shared WebSocket instance');
    }
    return sharedInstance;
  }
  
  // Default options
  const {
    url = determineWebSocketUrl('/api/ws'),
    fallbackUrl = determineWebSocketUrl('/ws'),
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    onMessage,
    onStateChange,
    debug = false
  } = options;
  
  // WebSocket instance
  let socket: WebSocket | null = null;
  
  // Connection state
  let state: ConnectionState = ConnectionState.CLOSED;
  
  // Reconnection tracking
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isFallbackActive = false;
  
  // Event listeners
  const eventListeners: Record<string, Array<(...args: any[]) => void>> = {
    message: [],
    open: [],
    close: [],
    error: [],
    stateChange: []
  };
  
  /**
   * Update the connection state and notify listeners
   */
  const updateState = (newState: ConnectionState) => {
    if (state !== newState) {
      state = newState;
      
      if (debug) {
        console.log(`[WebSocket] State changed to: ${ConnectionState[newState]}`);
      }
      
      // Notify state change listeners
      eventListeners.stateChange.forEach(listener => {
        try {
          listener(newState);
        } catch (error) {
          console.error('[WebSocket] Error in state change listener:', error);
        }
      });
      
      // Notify external state change handler if provided
      if (onStateChange) {
        try {
          onStateChange(newState);
        } catch (error) {
          console.error('[WebSocket] Error in external state change handler:', error);
        }
      }
    }
  };
  
  /**
   * Attempt to connect to the WebSocket server
   */
  const connect = () => {
    // Prevent connection attempts if already connecting or connected
    if (state === ConnectionState.CONNECTING || state === ConnectionState.OPEN) {
      if (debug) {
        console.log(`[WebSocket] Already ${ConnectionState[state]}, ignoring connect() call`);
      }
      return;
    }
    
    // Clean up any existing socket
    if (socket !== null) {
      try {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      } catch (error) {
        console.error('[WebSocket] Error closing existing socket:', error);
      }
      socket = null;
    }
    
    updateState(ConnectionState.CONNECTING);
    
    try {
      // Choose URL based on fallback state
      const currentUrl = isFallbackActive ? fallbackUrl : url;
      
      if (debug) {
        console.log(`[WebSocket] Connecting to ${currentUrl} (fallback: ${isFallbackActive})`);
      }
      
      // Create new WebSocket
      socket = new WebSocket(currentUrl);
      
      // Configure handlers
      socket.onopen = (event) => {
        reconnectAttempts = 0;
        updateState(ConnectionState.OPEN);
        
        if (debug) {
          console.log('[WebSocket] Connection established');
        }
        
        // Trigger event listeners
        eventListeners.open.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            console.error('[WebSocket] Error in open listener:', error);
          }
        });
      };
      
      socket.onclose = (event) => {
        const wasConnected = state === ConnectionState.OPEN;
        updateState(ConnectionState.CLOSED);
        
        if (debug) {
          console.log(`[WebSocket] Connection closed with code ${event.code}, reason: ${event.reason || 'Unknown'}`);
        }
        
        // Trigger event listeners
        eventListeners.close.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            console.error('[WebSocket] Error in close listener:', error);
          }
        });
        
        // Handle reconnection if auto-reconnect is enabled
        if (autoReconnect && wasConnected) {
          handleReconnect();
        }
      };
      
      socket.onerror = (event) => {
        // Don't change state on error, wait for close
        if (debug) {
          console.error('[WebSocket] Connection error:', event);
        }
        
        // Trigger event listeners
        eventListeners.error.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            console.error('[WebSocket] Error in error listener:', error);
          }
        });
        
        // If we're in connecting state and an error occurs,
        // probably means the connection failed - try fallback URL
        if (state === ConnectionState.CONNECTING && !isFallbackActive) {
          if (debug) {
            console.log('[WebSocket] Primary connection failed, trying fallback URL');
          }
          
          // Use fallback URL next time
          isFallbackActive = true;
          
          // Reconnect immediately with fallback
          if (autoReconnect) {
            // Reset the socket first
            socket = null;
            handleReconnect(0);
          }
        }
      };
      
      socket.onmessage = (event) => {
        if (debug) {
          console.log('[WebSocket] Message received:', event.data);
        }
        
        // Trigger event listeners
        eventListeners.message.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            console.error('[WebSocket] Error in message listener:', error);
          }
        });
        
        // Call external message handler if provided
        if (onMessage) {
          try {
            onMessage(event);
          } catch (error) {
            console.error('[WebSocket] Error in external message handler:', error);
          }
        }
      };
    } catch (error) {
      console.error('[WebSocket] Error creating connection:', error);
      updateState(ConnectionState.CLOSED);
      
      // If auto-reconnect is enabled, try reconnecting
      if (autoReconnect) {
        handleReconnect();
      }
    }
  };
  
  /**
   * Handle reconnection logic
   */
  const handleReconnect = (delay = reconnectInterval) => {
    // Clear any existing reconnect timer
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    // Check if we've exceeded the maximum reconnect attempts
    if (reconnectAttempts >= maxReconnectAttempts) {
      if (debug) {
        console.log(`[WebSocket] Maximum reconnect attempts (${maxReconnectAttempts}) reached`);
      }
      return;
    }
    
    reconnectAttempts++;
    updateState(ConnectionState.RECONNECTING);
    
    if (debug) {
      console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
    }
    
    // Schedule reconnection
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  
  /**
   * Disconnect from the WebSocket server
   */
  const disconnect = () => {
    // Clear any reconnect timer
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    if (socket !== null) {
      if (state === ConnectionState.OPEN || state === ConnectionState.CONNECTING) {
        updateState(ConnectionState.CLOSING);
        
        try {
          // Remove handlers to prevent reconnection
          socket.onclose = () => {
            updateState(ConnectionState.CLOSED);
            
            if (debug) {
              console.log('[WebSocket] Connection closed');
            }
          };
          
          // Close the connection
          socket.close(1000, 'Normal closure');
        } catch (error) {
          console.error('[WebSocket] Error closing connection:', error);
          updateState(ConnectionState.CLOSED);
        }
      }
    } else {
      updateState(ConnectionState.CLOSED);
    }
  };
  
  /**
   * Send data through the WebSocket connection
   */
  const send = (data: string) => {
    if (socket !== null && state === ConnectionState.OPEN) {
      try {
        socket.send(data);
        return true;
      } catch (error) {
        console.error('[WebSocket] Error sending data:', error);
        return false;
      }
    } else {
      if (debug) {
        console.warn(`[WebSocket] Cannot send data, socket is ${socket ? ConnectionState[state] : 'null'}`);
      }
      return false;
    }
  };
  
  /**
   * Add an event listener
   */
  const on = (event: string, callback: (...args: any[]) => void): (() => void) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    
    eventListeners[event].push(callback);
    
    // Return a function to remove this listener
    return () => {
      eventListeners[event] = eventListeners[event].filter(listener => listener !== callback);
    };
  };
  
  /**
   * Get the current connection state
   */
  const getState = () => state;
  
  // Create a shared instance interface
  const sharedConnectionInterface: SharedWebSocketConnection = {
    connect,
    disconnect,
    send,
    getState,
    on
  };
  
  // Store the singleton instance
  sharedInstance = sharedConnectionInterface;
  
  // Return the shared interface
  return sharedConnectionInterface;
}

/**
 * Shared WebSocket connection instance
 */
export const sharedWebSocket = createWebSocketConnection({
  autoReconnect: true,
  debug: true
});

/**
 * Determine the WebSocket URL based on the current environment and endpoint
 */
function determineWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export default sharedWebSocket;