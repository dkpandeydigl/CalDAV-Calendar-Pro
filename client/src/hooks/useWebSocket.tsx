import { useState, useEffect, useCallback, useRef } from 'react';
import websocketService, { WebSocketNotification } from '../services/websocketService';

interface UseWebSocketOptions {
  notificationTypes?: string[];
  eventUid?: string;
  onMessage?: (notification: WebSocketNotification) => void;
  autoConnect?: boolean;
  userId?: number | null;
}

/**
 * React hook for using WebSocket notifications
 * 
 * This hook provides an easy way to:
 * 1. Connect to the WebSocket server
 * 2. Receive notifications of specific types
 * 3. Send messages to the server
 * 4. Monitor connection status
 * 
 * @param options Configuration options
 * @returns WebSocket hook utilities
 */
function useWebSocket({
  notificationTypes = ['all'],
  eventUid,
  onMessage,
  autoConnect = true,
  userId = null
}: UseWebSocketOptions = {}) {
  // Track connection status
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  // Track notification messages
  const [lastNotification, setLastNotification] = useState<WebSocketNotification | null>(null);
  // Reference to unsubscribe functions
  const unsubscribeRefs = useRef<(() => void)[]>([]);

  // Handle incoming notifications
  const handleNotification = useCallback((notification: WebSocketNotification) => {
    setLastNotification(notification);
    // If a custom handler was provided, call it
    if (onMessage) {
      onMessage(notification);
    }
  }, [onMessage]);

  // Initialize WebSocket connection
  const connect = useCallback((id: number) => {
    // Only initialize if we have a user ID
    if (id) {
      websocketService.initialize(id);
    }
  }, []);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    websocketService.disconnect();
  }, []);

  // Send a WebSocket message
  const sendMessage = useCallback((message: WebSocketNotification): boolean => {
    return websocketService.sendMessage(message);
  }, []);

  // Register connection status handler
  useEffect(() => {
    const unsubscribe = websocketService.registerHandler('connection', (notification) => {
      const status = notification.data?.status as 'connecting' | 'connected' | 'disconnected';
      if (status) {
        setConnectionStatus(status);
      }
    });

    // Store current connection status
    setConnectionStatus(websocketService.getConnectionStatus());

    return () => {
      unsubscribe();
    };
  }, []);

  // Register notification handlers for each type
  useEffect(() => {
    // Clean up previous subscriptions
    unsubscribeRefs.current.forEach(unsubscribe => unsubscribe());
    unsubscribeRefs.current = [];

    // Register new handlers for each notification type
    const newUnsubscribes: (() => void)[] = [];
    notificationTypes.forEach(type => {
      const unsubscribe = websocketService.registerHandler(type, handleNotification);
      newUnsubscribes.push(unsubscribe);
    });

    // If an event UID was provided, register for specific event notifications
    if (eventUid) {
      const unsubscribe = websocketService.registerHandler(`event:${eventUid}`, handleNotification);
      newUnsubscribes.push(unsubscribe);
    }

    // Store the unsubscribe functions
    unsubscribeRefs.current = newUnsubscribes;

    // Clean up on unmount
    return () => {
      newUnsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, [notificationTypes, eventUid, handleNotification]);

  // Auto-connect if enabled
  useEffect(() => {
    if (autoConnect && userId) {
      connect(userId);
    }
    // We don't include connect in dependencies as it would cause an infinite loop
  }, [autoConnect, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connectionStatus,
    lastNotification,
    connect,
    disconnect,
    sendMessage
  };
}

export default useWebSocket;