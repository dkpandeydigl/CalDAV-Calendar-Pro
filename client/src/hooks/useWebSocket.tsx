import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketNotification } from '@/services/websocketService';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketOptions {
  userId: number | null;
  autoConnect?: boolean;
  onMessage?: (notification: WebSocketNotification) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

interface UseWebSocketReturn {
  connectionStatus: ConnectionStatus;
  lastNotification: WebSocketNotification | null;
  connect: (id: number) => void;
  disconnect: () => void;
  sendMessage: (message: WebSocketNotification) => boolean;
}

const useWebSocket = ({
  userId,
  autoConnect = true,
  onMessage,
  onStatusChange
}: UseWebSocketOptions): UseWebSocketReturn => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastNotification, setLastNotification] = useState<WebSocketNotification | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectedUserIdRef = useRef<number | null>(null);
  
  // Helper to determine WebSocket URL based on current protocol and host
  const getWebSocketUrl = useCallback((id: number) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // First try the primary WebSocket endpoint
    try {
      // Try both potential paths, with priority to the /api/ws path
      return `${protocol}//${window.location.host}/api/ws?userId=${id}`;
    } catch (error) {
      console.error('Error constructing WebSocket URL:', error);
      // Fallback to a basic path if something went wrong
      return `${protocol}//${window.location.host}/ws?userId=${id}`;
    }
  }, []);

  // Function to establish WebSocket connection
  const connect = useCallback((id: number) => {
    if (!id) {
      console.error('Cannot connect WebSocket: No user ID provided');
      return;
    }

    try {
      // Close any existing connection
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      // Update status
      setConnectionStatus('connecting');
      
      // Save the connected user ID for reconnection attempts
      connectedUserIdRef.current = id;
      
      // Create new WebSocket connection
      const wsUrl = getWebSocketUrl(id);
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;
      
      // Set up event handlers
      socket.onopen = () => {
        console.log('WebSocket connection established');
        setConnectionStatus('connected');
        if (onStatusChange) onStatusChange('connected');
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message received:', data);
          
          // Handle different message types
          switch (data.type) {
            case 'connected':
              console.log(`Connected to WebSocket server as user ${data.userId}`);
              break;
              
            case 'pong':
              // Handle ping response (for latency calculation)
              const latency = Date.now() - data.originalTimestamp;
              console.log(`WebSocket latency: ${latency}ms`);
              break;
              
            case 'event':
            case 'calendar':
            case 'system':
            case 'resource':
            case 'attendee':
            case 'email':
            case 'uid':
              // These are notification types - process them
              if (data.action && data.timestamp && data.data) {
                const notification: WebSocketNotification = {
                  type: data.type,
                  action: data.action,
                  timestamp: data.timestamp,
                  data: data.data,
                  sourceUserId: data.sourceUserId
                };
                
                // Update last notification received
                setLastNotification(notification);
                
                // Call onMessage handler if provided
                if (onMessage) {
                  onMessage(notification);
                }
                
                // Log UID changes specifically
                if (data.type === 'uid') {
                  console.log(`UID ${data.action} notification received for event ${data.data.eventId}: ${data.data.uid}`);
                }
              }
              break;
              
            default:
              console.log('Unknown WebSocket message type:', data.type);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };
      
      socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        setConnectionStatus('disconnected');
        if (onStatusChange) onStatusChange('disconnected');
        
        // Attempt to reconnect after a delay
        if (connectedUserIdRef.current) {
          console.log('Scheduling WebSocket reconnection attempt...');
          setTimeout(() => {
            if (connectedUserIdRef.current && connectionStatus !== 'connected') {
              console.log('Attempting to reconnect WebSocket...');
              connect(connectedUserIdRef.current);
            }
          }, 5000);
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
        if (onStatusChange) onStatusChange('disconnected');
      };
      
    } catch (error) {
      console.error('Error establishing WebSocket connection:', error);
      setConnectionStatus('disconnected');
      if (onStatusChange) onStatusChange('disconnected');
    }
  }, [getWebSocketUrl, onMessage, onStatusChange, connectionStatus]);
  
  // Function to close WebSocket connection
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('Disconnecting WebSocket...');
      socketRef.current.close();
      socketRef.current = null;
      connectedUserIdRef.current = null;
    }
  }, []);
  
  // Function to send a message through the WebSocket
  const sendMessage = useCallback((message: WebSocketNotification): boolean => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    } else {
      console.error('Cannot send WebSocket message: Socket not connected');
      return false;
    }
  }, []);
  
  // Connect automatically if autoConnect is true and userId is provided
  useEffect(() => {
    if (autoConnect && userId && connectionStatus === 'disconnected') {
      connect(userId);
    }
    
    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [autoConnect, userId, connect, connectionStatus]);
  
  // Set up ping interval to keep connection alive
  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }
    
    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          // Send ping message to calculate roundtrip time
          socketRef.current.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now()
          }));
        } catch (error) {
          console.error('Error sending WebSocket ping:', error);
        }
      }
    }, 30000); // Send ping every 30 seconds
    
    return () => {
      clearInterval(pingInterval);
    };
  }, [connectionStatus]);
  
  return {
    connectionStatus,
    lastNotification,
    connect,
    disconnect,
    sendMessage
  };
};

export default useWebSocket;