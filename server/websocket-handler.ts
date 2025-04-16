/**
 * WebSocket Handler
 * 
 * This module handles WebSocket connections and provides real-time
 * notification capabilities for the application.
 */

import { Server } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { getWebSocketNotificationService, initializeWebSocketNotificationService, WebSocketNotification } from './websocket-notifications';
import { logger } from './logger';
import url from 'url';

// Map to store user connections
const connections = new Map<number, Set<WebSocket>>();

// Store last ping times for each connection
const connectionLastPings = new WeakMap<WebSocket, number>();

/**
 * Get all active WebSocket connections
 * 
 * @returns A map of user IDs to their active WebSocket connections
 */
export function getActiveConnections(): Map<number, Set<WebSocket>> {
  return connections;
}

/**
 * Broadcast a message to all connected clients or specific users
 * 
 * @param message The message to broadcast
 * @param targetUserIds Optional array of user IDs to target (broadcasts to all if undefined)
 * @returns Number of clients the message was sent to
 */
export function broadcastMessage(message: any, targetUserIds?: number[]): number {
  // Use the WebSocketNotificationService if available
  const notificationService = getWebSocketNotificationService();
  
  if (notificationService) {
    const success = notificationService.sendNotification(message);
    // Just return 1 if success, since we don't have the actual count from the service
    return success ? 1 : 0;
  }
  
  // Fallback to manual broadcast if notification service is not available
  let sentCount = 0;
  
  // If targetUserIds is provided, only send to those users
  if (targetUserIds && targetUserIds.length > 0) {
    for (const userId of targetUserIds) {
      const userConnections = connections.get(userId);
      if (userConnections) {
        for (const conn of userConnections) {
          if (conn.readyState === WebSocket.OPEN) {
            conn.send(JSON.stringify(message));
            sentCount++;
          }
        }
      }
    }
  } else {
    // Otherwise broadcast to all connected clients
    for (const [userId, userConnections] of connections) {
      for (const conn of userConnections) {
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify(message));
          sentCount++;
        }
      }
    }
  }
  
  return sentCount;
}

/**
 * Initialize the WebSocket server and set up event handlers
 * 
 * @param httpServer The HTTP server to attach the WebSocket server to
 */
export function initializeWebSocketServer(httpServer: Server) {
  // Create primary WebSocket server on /api/ws path
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/ws'
  });
  
  // Initialize the notification service with the WebSocket server
  const notificationService = initializeWebSocketNotificationService(wss);
  
  logger.info('WebSocket server initialized on path /api/ws');
  
  // Set up event handlers for the WebSocket server
  wss.on('connection', (ws, req) => {
    handleNewConnection(ws, req, 'primary');
  });
  
  // Create fallback WebSocket server on /ws path (for compatibility)
  const wssFallback = new WebSocketServer({ 
    server: httpServer,
    path: '/ws'
  });
  
  logger.info('Fallback WebSocket server initialized on path /ws');
  
  // Set up event handlers for the fallback WebSocket server
  wssFallback.on('connection', (ws, req) => {
    handleNewConnection(ws, req, 'fallback');
  });
  
  // Set up ping interval to keep connections alive and detect stale connections
  setInterval(pingAllClients, 30000); // 30 seconds
  setInterval(checkStaleConnections, 60000); // 60 seconds
}

/**
 * Handle a new WebSocket connection
 * 
 * @param ws The WebSocket connection
 * @param req The HTTP request that initiated the connection
 * @param pathType Indicates if this is the primary or fallback WebSocket server
 */
function handleNewConnection(ws: WebSocket, req: any, pathType: 'primary' | 'fallback') {
  // Parse query parameters from the URL
  const queryParams = url.parse(req.url, true).query;
  const userId = queryParams.userId ? parseInt(queryParams.userId as string) : null;
  
  // Store the user ID on the WebSocket object for later reference
  (ws as any).userId = userId;
  (ws as any).connectionTime = Date.now();
  connectionLastPings.set(ws, Date.now());
  
  // Log the connection
  logger.info(`New WebSocket connection on ${pathType} server: User ID ${userId || 'unknown'}`);
  
  // Add the connection to the connections map
  if (userId) {
    if (!connections.has(userId)) {
      connections.set(userId, new Set());
    }
    connections.get(userId)!.add(ws);
    
    // Add to the notification service too
    const notificationService = getWebSocketNotificationService();
    if (notificationService) {
      notificationService.addUserConnection(userId, ws);
    }
    
    // Send confirmation message to client
    try {
      ws.send(JSON.stringify({
        type: 'connected',
        userId: userId,
        timestamp: Date.now(),
        message: `Connected to ${pathType} WebSocket server`
      }));
    } catch (error) {
      logger.error('Error sending connection confirmation:', error);
    }
  }
  
  // Set up event handlers for the WebSocket connection
  ws.on('message', (message) => {
    handleWebSocketMessage(ws, message);
  });
  
  ws.on('close', () => {
    handleWebSocketClose(ws);
  });
  
  ws.on('error', (error) => {
    logger.error(`WebSocket error for user ${userId || 'unknown'}:`, error);
    cleanupConnection(ws);
  });
}

/**
 * Handle a message received from a WebSocket client
 * 
 * @param ws The WebSocket connection that sent the message
 * @param message The message received
 */
function handleWebSocketMessage(ws: WebSocket, message: any) {
  // Update the last ping time for this connection
  connectionLastPings.set(ws, Date.now());
  
  try {
    // Parse the message as JSON
    const data = JSON.parse(message.toString());
    const userId = (ws as any).userId;
    
    logger.info(`Received WebSocket message from user ${userId || 'unknown'}: ${data.type}`);
    
    // Handle different message types
    switch (data.type) {
      case 'ping':
        handlePingMessage(ws, data);
        break;
        
      case 'chat':
        handleChatMessage(ws, data);
        break;
        
      case 'join':
        handleJoinMessage(ws, data);
        break;
        
      case 'leave':
        handleLeaveMessage(ws, data);
        break;
        
      default:
        // Forward the message to the notification service
        const notificationService = getWebSocketNotificationService();
        if (notificationService && userId) {
          const notification = {
            type: data.type || 'system',
            action: data.action || 'info',
            timestamp: Date.now(),
            data: data.data || { message: 'Unknown message format' },
            sourceUserId: userId
          };
          
          notificationService.sendNotification(notification);
        }
    }
  } catch (error) {
    logger.error('Error processing WebSocket message:', error);
  }
}

/**
 * Handle a ping message from a client
 * 
 * @param ws The WebSocket connection that sent the ping
 * @param message The ping message
 */
function handlePingMessage(ws: WebSocket, message: any) {
  try {
    // Send pong response
    ws.send(JSON.stringify({
      type: 'pong',
      timestamp: Date.now(),
      originalTimestamp: message.timestamp
    }));
  } catch (error) {
    logger.error('Error sending pong response:', error);
  }
}

/**
 * Handle a chat message from a client
 * 
 * @param ws The WebSocket connection that sent the chat message
 * @param message The chat message
 */
function handleChatMessage(ws: WebSocket, message: any) {
  try {
    const userId = (ws as any).userId;
    const username = message.username || `User-${userId || 'Anonymous'}`;
    
    logger.info(`Chat message from ${username}: ${message.message}`);
    
    // Construct a response message
    const responseMessage = {
      type: 'chat',
      username: username,
      message: message.message,
      timestamp: Date.now(),
      originalTimestamp: message.timestamp
    };
    
    // Broadcast to all connections
    broadcastMessage(responseMessage);
  } catch (error) {
    logger.error('Error handling chat message:', error);
  }
}

/**
 * Handle a join message from a client
 * 
 * @param ws The WebSocket connection that sent the join message
 * @param message The join message
 */
function handleJoinMessage(ws: WebSocket, message: any) {
  try {
    const userId = (ws as any).userId;
    const username = message.username || `User-${userId || 'Anonymous'}`;
    
    logger.info(`User joined: ${username}`);
    
    // Construct a join notification
    const joinMessage = {
      type: 'join',
      username: username,
      timestamp: Date.now()
    };
    
    // Broadcast to all connections
    broadcastMessage(joinMessage);
  } catch (error) {
    logger.error('Error handling join message:', error);
  }
}

/**
 * Handle a leave message from a client
 * 
 * @param ws The WebSocket connection that sent the leave message
 * @param message The leave message
 */
function handleLeaveMessage(ws: WebSocket, message: any) {
  try {
    const userId = (ws as any).userId;
    const username = message.username || `User-${userId || 'Anonymous'}`;
    
    logger.info(`User left: ${username}`);
    
    // Construct a leave notification
    const leaveMessage = {
      type: 'leave',
      username: username,
      timestamp: Date.now()
    };
    
    // Broadcast to all connections
    broadcastMessage(leaveMessage);
  } catch (error) {
    logger.error('Error handling leave message:', error);
  }
}

/**
 * Handle a WebSocket connection being closed
 * 
 * @param ws The WebSocket connection that was closed
 */
function handleWebSocketClose(ws: WebSocket) {
  const userId = (ws as any).userId;
  logger.info(`WebSocket connection closed for user ${userId || 'unknown'}`);
  
  cleanupConnection(ws);
}

/**
 * Clean up a WebSocket connection
 * 
 * @param ws The WebSocket connection to clean up
 */
function cleanupConnection(ws: WebSocket) {
  const userId = (ws as any).userId;
  
  // Remove from notification service
  const notificationService = getWebSocketNotificationService();
  if (notificationService && userId) {
    notificationService.removeConnection(userId, ws);
  }
  
  // Remove from connections map
  if (userId && connections.has(userId)) {
    const userConnections = connections.get(userId)!;
    userConnections.delete(ws);
    
    // If this was the last connection for this user, remove the user entry
    if (userConnections.size === 0) {
      connections.delete(userId);
      logger.info(`Removed last connection for user ${userId}`);
    }
  }
  
  // Remove from ping tracking
  connectionLastPings.delete(ws);
}

/**
 * Broadcast a message to a specific user
 * 
 * @param userId The user ID to send the message to
 * @param message The message to send
 * @returns True if the message was sent, false otherwise
 */
export function broadcastToUser(userId: number, message: any): boolean {
  return broadcastMessage(message, [userId]) > 0;
}

/**
 * Notify that a calendar has changed (for real-time updates)
 * 
 * @param calendarId The ID of the calendar that changed
 * @param userId The ID of the user who owns the calendar
 * @param action The action that was performed (created, updated, deleted)
 */
export function notifyCalendarChanged(
  calendarId: number, 
  userId: number, 
  action: 'created' | 'updated' | 'deleted'
): void {
  const notification: WebSocketNotification = {
    type: 'calendar',
    action: action,
    timestamp: Date.now(),
    data: {
      calendarId,
      message: `Calendar ${action}`,
    },
    sourceUserId: userId
  };
  
  broadcastToUser(userId, notification);
}

/**
 * Notify that an event has changed (for real-time updates)
 * 
 * @param eventId The ID of the event that changed
 * @param calendarId The ID of the calendar the event belongs to
 * @param userId The ID of the user who owns the calendar
 * @param action The action that was performed (created, updated, deleted)
 */
export function notifyEventChanged(
  eventId: number,
  calendarId: number,
  userId: number,
  action: 'created' | 'updated' | 'deleted'
): void {
  const notification: WebSocketNotification = {
    type: 'event',
    action: action,
    timestamp: Date.now(),
    data: {
      eventId,
      calendarId,
      message: `Event ${action}`,
    },
    sourceUserId: userId
  };
  
  broadcastToUser(userId, notification);
}

/**
 * Ping all connected clients to keep connections alive
 */
function pingAllClients() {
  const pingMessage = {
    type: 'ping',
    timestamp: Date.now()
  };
  
  broadcastMessage(pingMessage);
}

/**
 * Check for stale connections and clean them up
 */
function checkStaleConnections() {
  const now = Date.now();
  const staleThreshold = 2 * 60 * 1000; // 2 minutes
  
  for (const [userId, userConnections] of connections) {
    for (const conn of userConnections) {
      const lastPing = connectionLastPings.get(conn) || 0;
      
      if (now - lastPing > staleThreshold) {
        logger.info(`Closing stale connection for user ${userId}`);
        
        try {
          conn.close();
        } catch (error) {
          logger.error('Error closing stale connection:', error);
        }
        
        cleanupConnection(conn);
      }
    }
  }
}