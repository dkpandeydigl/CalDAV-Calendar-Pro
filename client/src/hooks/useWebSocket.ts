/**
 * WebSocket Hook
 * 
 * React hook for interacting with the WebSocket client in React components.
 * Provides connection management and message handling capabilities.
 */

import { useEffect, useCallback, useState } from 'react';
import { wsClient, WSMessage, connectToWebSocket } from '../lib/websocketClient';

type MessageHandler = (message: WSMessage) => void;

interface UseWebSocketOptions {
  autoConnect?: boolean;
  userId?: number;
  onOpen?: () => void;
  onClose?: (event: { code: number, reason: string }) => void;
  onError?: (event: any) => void;
}

/**
 * Hook for using WebSocket in React components
 */
export default function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true, userId, onOpen, onClose, onError } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  
  // Handle system messages related to connection status
  const handleSystemMessage = useCallback((message: WSMessage) => {
    if (message.type === 'system') {
      if (message.action === 'connected') {
        setIsConnected(true);
        onOpen?.();
      } else if (message.action === 'disconnected') {
        setIsConnected(false);
        onClose?.(message.data);
      } else if (message.action === 'error') {
        onError?.(message.data);
      }
    }
    
    // Update last message state
    setLastMessage(message);
  }, [onOpen, onClose, onError]);
  
  // Connect to WebSocket server
  const connect = useCallback(() => {
    connectToWebSocket(userId);
  }, [userId]);
  
  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    wsClient.disconnect();
  }, []);
  
  // Send a message to the server
  const sendMessage = useCallback((message: WSMessage) => {
    wsClient.send(message);
  }, []);
  
  // Subscribe to a specific message type
  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    wsClient.on(type, handler);
    
    // Return unsubscribe function for cleanup
    return () => {
      wsClient.off(type, handler);
    };
  }, []);
  
  // Effect for connection management
  useEffect(() => {
    // Register system message handler
    wsClient.on('system', handleSystemMessage);
    
    // Connect if autoConnect is enabled
    if (autoConnect) {
      connect();
    }
    
    // Cleanup on unmount
    return () => {
      wsClient.off('system', handleSystemMessage);
    };
  }, [autoConnect, connect, handleSystemMessage]);
  
  return {
    isConnected,
    lastMessage,
    connect,
    disconnect,
    sendMessage,
    subscribe
  };
}

/**
 * Simplified hook for subscribing to specific WebSocket message types
 */
export function useWebSocketSubscription(type: string, handler: MessageHandler) {
  useEffect(() => {
    // Register handler
    wsClient.on(type, handler);
    
    // Cleanup on unmount
    return () => {
      wsClient.off(type, handler);
    };
  }, [type, handler]);
}