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
  
  // Function to get the WebSocket URL
  const getWebSocketUrl = useCallback(() => {
    // Determine protocol (ws or wss)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Try the primary WebSocket path first
    let wsUrl = `${protocol}//${window.location.host}/api/ws`;
    
    // Add user ID as query parameter if available
    if (user?.id) {
      wsUrl += `?userId=${user.id}`;
    }
    
    return wsUrl;
  }, [user]);
  
  // Function to get the fallback WebSocket URL (if primary fails)
  const getFallbackWebSocketUrl = useCallback(() => {
    // Determine protocol (ws or wss)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Use the fallback path
    let wsUrl = `${protocol}//${window.location.host}/ws`;
    
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
    
    // Try to connect using primary URL
    try {
      console.log('Connecting to WebSocket server at', getWebSocketUrl());
      const socket = new WebSocket(getWebSocketUrl());
      
      // Set up event handlers
      socket.onopen = () => {
        console.log('WebSocket connected');
        setState({ connected: true, connecting: false, error: null });
        
        // Start heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now() 
            }));
          }
        }, 30000); // Send heartbeat every 30 seconds
        
        // Store heartbeat interval for cleanup
        socket.addEventListener('close', () => clearInterval(heartbeat));
      };
      
      socket.onclose = (event) => {
        console.log('WebSocket disconnected, attempting fallback or reconnect', event);
        setState(prev => ({ ...prev, connected: false }));
        
        // If this was the primary URL that failed, try the fallback
        if (socket.url === getWebSocketUrl()) {
          tryFallbackConnection();
        } else {
          // This was already the fallback, so schedule a reconnect
          scheduleReconnect();
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setState(prev => ({ 
          ...prev, 
          error: 'Connection error' 
        }));
        
        // If this was the primary URL that failed, try the fallback
        if (socket.url === getWebSocketUrl()) {
          tryFallbackConnection();
        }
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message received:', data.type);
          
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
      
      // Try fallback connection
      tryFallbackConnection();
    }
  }, [state, user, getWebSocketUrl, getFallbackWebSocketUrl]);
  
  // Try fallback WebSocket URL
  const tryFallbackConnection = useCallback(() => {
    try {
      console.log('Trying fallback WebSocket connection at', getFallbackWebSocketUrl());
      const socket = new WebSocket(getFallbackWebSocketUrl());
      
      // Set up event handlers (same as primary)
      socket.onopen = () => {
        console.log('WebSocket connected (fallback)');
        setState({ connected: true, connecting: false, error: null });
        
        // Start heartbeat
        const heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now() 
            }));
          }
        }, 30000);
        
        socket.addEventListener('close', () => clearInterval(heartbeat));
      };
      
      socket.onclose = () => {
        console.log('Fallback WebSocket disconnected');
        setState(prev => ({ ...prev, connected: false }));
        scheduleReconnect();
      };
      
      socket.onerror = (error) => {
        console.error('Fallback WebSocket error:', error);
        setState(prev => ({ 
          ...prev, 
          error: 'Connection error (fallback)' 
        }));
        scheduleReconnect();
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message received (fallback):', data.type);
          
          // Call registered listeners for this message type
          const listeners = messageListenersRef.current.get(data.type) || [];
          for (const listener of listeners) {
            listener(data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message (fallback):', error);
        }
      };
      
      socketRef.current = socket;
    } catch (error) {
      console.error('Error creating fallback WebSocket connection:', error);
      setState(prev => ({ 
        ...prev, 
        connecting: false, 
        error: error instanceof Error ? error.message : 'Connection error (fallback)' 
      }));
      
      // Schedule reconnect
      scheduleReconnect();
    }
  }, [getFallbackWebSocketUrl]);
  
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