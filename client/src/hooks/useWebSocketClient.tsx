/**
 * WebSocket Client Hook
 * 
 * This hook manages a WebSocket connection to the server for real-time updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './use-auth';

interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export function useWebSocketClient() {
  const { user } = useAuth();
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const messageListenersRef = useRef<Map<string, ((data: any) => void)[]>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  // Connection attempt counter for alternating between paths
  const connectionAttemptsRef = useRef<number>(0);
  
  // Function to get the WebSocket URL per development guidelines
  const getWebSocketUrl = useCallback(() => {
    // Determine protocol (ws or wss) per development guidelines
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Determine which path to use based on connection attempts
    // Even attempts use primary path, odd attempts use fallback path
    const wsPath = connectionAttemptsRef.current % 2 === 0 ? '/api/ws' : '/ws';
    
    // Create relative URL per development guidelines
    let wsUrl = `${protocol}//${window.location.host}${wsPath}`;
    
    // Log which URL we're creating
    console.log(`Creating relative WebSocket URL for Replit: ${wsPath}`);
    
    // Add user ID as query parameter if available
    if (user?.id) {
      wsUrl += `?userId=${user.id}`;
    }
    
    return wsUrl;
  }, [user]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Don't connect if already connecting/connected or no user
    if (state.connecting || state.connected || !user?.id) return;
    
    // Set connecting state
    setState(prev => ({ ...prev, connecting: true, error: null }));
    
    // Clean up any existing connection
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    // Clear any reconnect timeout
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Increment connection attempt counter to alternate between paths
    connectionAttemptsRef.current += 1;
    
    // Get the connection path (will alternate between /api/ws and /ws)
    const wsUrl = getWebSocketUrl();
    const usingFallbackPath = connectionAttemptsRef.current % 2 !== 0;
    
    // Log connection attempt with user context
    console.log(`🔄 NotificationContext: Connection attempt ${connectionAttemptsRef.current}: Connecting to WebSocket server at ${wsUrl.split('?')[0]} ${usingFallbackPath ? '(fallback path)' : '(primary path)'}`);
    
    // Try to connect
    try {
      const socket = new WebSocket(wsUrl);
      
      // Define custom properties for type checking
      interface CustomWebSocket extends WebSocket {
        customUrl?: string;
        userId?: number;
        usingFallbackPath?: boolean;
        connectionTimestamp?: string;
      }
      
      // Add metadata to socket for logging/debugging (with proper typing)
      const customSocket = socket as CustomWebSocket;
      customSocket.customUrl = wsUrl;
      customSocket.userId = user.id;
      customSocket.usingFallbackPath = usingFallbackPath;
      customSocket.connectionTimestamp = new Date().toISOString();
      
      // Set up event handlers
      socket.onopen = () => {
        console.log(`WebSocket connected via ${usingFallbackPath ? 'fallback' : 'primary'} path`);
        setState({ connected: true, connecting: false, error: null });
        
        // Reset connection attempts on successful connection
        connectionAttemptsRef.current = 0;
        
        // Start heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now(),
              userId: user.id
            }));
          }
        }, 30000); // Send heartbeat every 30 seconds
        
        // Store heartbeat interval for cleanup
        socket.addEventListener('close', () => clearInterval(heartbeat));
      };
      
      socket.onclose = (event) => {
        console.log(`⚠️ WebSocket connection closed with code ${event.code}`);
        setState(prev => ({ ...prev, connected: false }));
        
        // Store connection details for debugging
        const customSocket = socket as CustomWebSocket;
        console.log('WebSocket error details:', {
          readyState: socket.readyState,
          url: socket.url,
          customUrl: customSocket.customUrl,
          userId: customSocket.userId,
          usingFallbackPath: customSocket.usingFallbackPath,
          timestamp: customSocket.connectionTimestamp
        });
        
        // If we've tried less than 5 times, try to reconnect
        if (connectionAttemptsRef.current < 5) {
          // Exponential backoff with jitter
          const baseDelay = 1000; // 1 second base
          const delay = baseDelay * Math.pow(1.5, connectionAttemptsRef.current) + Math.random() * 500;
          console.log(`Attempting to reconnect WebSocket in ${delay.toFixed(1)}ms (attempt ${connectionAttemptsRef.current}/5)`);
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, delay);
        } else {
          console.log("Maximum WebSocket reconnection attempts reached for notifications");
        }
      };
      
      socket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setState(prev => ({ 
          ...prev, 
          error: 'Connection error' 
        }));
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Call registered listeners for this message type
          const listeners = messageListenersRef.current.get(data.type) || [];
          for (const listener of listeners) {
            listener(data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      socketRef.current = socket;
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setState(prev => ({ 
        ...prev, 
        connecting: false, 
        error: error instanceof Error ? error.message : 'Connection error' 
      }));
      
      // Increment attempts and schedule a reconnect if we haven't tried too many times
      if (connectionAttemptsRef.current < 5) {
        scheduleReconnect();
      } else {
        console.log("Maximum WebSocket connection creation attempts reached");
      }
    }
  }, [state, user, getWebSocketUrl]);
  
  // Schedule a reconnection attempt
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }
    
    // Exponential backoff for reconnection (max 30 seconds)
    const reconnectDelay = Math.min(30000, 1000 * Math.pow(2, state.error ? 2 : 0));
    console.log(`Scheduling reconnect in ${reconnectDelay}ms`);
    
    reconnectTimeoutRef.current = window.setTimeout(() => {
      connect();
    }, reconnectDelay);
  }, [connect, state.error]);
  
  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('Manually disconnecting WebSocket');
      socketRef.current.close();
      socketRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    setState({ connected: false, connecting: false, error: null });
  }, []);
  
  // Send a message to the server
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message, WebSocket not connected');
      return false;
    }
    
    try {
      socketRef.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }, []);
  
  // Register a listener for a specific message type
  const addMessageListener = useCallback((
    type: string, 
    listener: (data: any) => void
  ) => {
    if (!messageListenersRef.current.has(type)) {
      messageListenersRef.current.set(type, []);
    }
    
    messageListenersRef.current.get(type)!.push(listener);
    
    // Return function to remove this listener
    return () => {
      const listeners = messageListenersRef.current.get(type);
      if (listeners) {
        messageListenersRef.current.set(
          type, 
          listeners.filter(l => l !== listener)
        );
      }
    };
  }, []);

  // Connect when user changes
  useEffect(() => {
    if (user?.id) {
      connect();
    } else {
      disconnect();
    }
    
    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [user, connect, disconnect]);
  
  // Register for window online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log('Browser went online, reconnecting WebSocket');
      connect();
    };
    
    const handleOffline = () => {
      console.log('Browser went offline, WebSocket will disconnect');
      // We don't need to explicitly disconnect as the browser will do that for us
      setState(prev => ({ ...prev, connected: false }));
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connect]);

  return {
    ...state,
    sendMessage,
    addMessageListener,
    connect,
    disconnect
  };
}