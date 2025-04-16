/**
 * WebSocket Handler
 * 
 * This module handles WebSocket connections and provides real-time
 * notification capabilities for the application.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { storage } from './memory-storage'; // Using in-memory storage instead of database storage
import { notificationService } from './memory-notification-service'; // Using in-memory notification service
import { Notification } from '@shared/schema';

// Track active WebSocket connections by user ID
const userConnections: Map<number, Set<WebSocket>> = new Map();

// User IDs by WebSocket instance for quick lookup
const socketUsers: Map<WebSocket, number> = new Map();

// Track ping/pong status for each connection
const socketLastPing: Map<WebSocket, number> = new Map();
const socketLastPong: Map<WebSocket, number> = new Map();

// Track if the WebSocket server has been initialized
let websocketInitialized = false;

/**
 * Get all active WebSocket connections
 * 
 * @returns A map of user IDs to their active WebSocket connections
 */
export function getActiveConnections(): Map<number, Set<WebSocket>> {
  return userConnections;
}

/**
 * Broadcast a message to all connected clients or specific users
 * 
 * @param message The message to broadcast
 * @param targetUserIds Optional array of user IDs to target (broadcasts to all if undefined)
 * @returns Number of clients the message was sent to
 */
export function broadcastMessage(message: any, targetUserIds?: number[]): number {
  let clientCount = 0;
  
  // If we have specific target users
  if (targetUserIds?.length) {
    for (const userId of targetUserIds) {
      const userSockets = userConnections.get(userId);
      if (userSockets) {
        for (const socket of userSockets) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
            clientCount++;
          }
        }
      }
    }
  } 
  // Otherwise broadcast to all connected clients
  else {
    for (const [userId, sockets] of userConnections.entries()) {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
          clientCount++;
        }
      }
    }
  }
  
  return clientCount;
}

// Initialize the WebSocket server with two paths for redundancy
// - Main path at '/api/ws' for normal operations
// - Fallback path at '/ws' for environments where the main path might be blocked
export function initializeWebSocketServer(httpServer: Server) {
  // Prevent double initialization
  if (websocketInitialized) {
    console.log("WebSocket server already initialized, skipping");
    return;
  }
  
  console.log("Initializing WebSocket server with dual paths");
  websocketInitialized = true;
  
  // Primary WebSocket server on /api/ws path
  const wssApiPath = new WebSocketServer({ 
    server: httpServer, 
    path: '/api/ws'
  });
  
  // Fallback WebSocket server on /ws path
  const wssFallback = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  });
  
  // Set up handlers for primary path
  wssApiPath.on('connection', (ws, req) => {
    handleNewConnection(ws, req, 'primary');
  });
  
  // Set up handlers for fallback path
  wssFallback.on('connection', (ws, req) => {
    handleNewConnection(ws, req, 'fallback');
  });
  
  // Regularly check connection health
  setInterval(() => {
    pingAllClients();
    checkStaleConnections();
  }, 30000);
  
  console.log("WebSocket server initialized on paths: /api/ws and /ws");
  
  return { wssApiPath, wssFallback };
}

// Handle new WebSocket connections
function handleNewConnection(ws: WebSocket, req: any, pathType: 'primary' | 'fallback') {
  try {
    // Extract user ID from request query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = parseInt(url.searchParams.get('userId') || '0');
    
    console.log(`New WebSocket connection (${pathType}) from user ID: ${userId}`);
    
    if (isNaN(userId) || userId <= 0) {
      console.log('WebSocket connection rejected: Invalid user ID');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Authentication required',
        timestamp: Date.now()
      }));
      ws.close();
      return;
    }
    
    // Add to user connections map
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId)?.add(ws);
    
    // Track which user this socket belongs to
    socketUsers.set(ws, userId);
    
    // Initialize ping tracking
    const now = Date.now();
    socketLastPing.set(ws, now);
    socketLastPong.set(ws, now);
    
    // Set up message handler
    ws.on('message', (message) => handleWebSocketMessage(ws, message));
    
    // Set up close handler
    ws.on('close', () => handleWebSocketClose(ws));
    
    // Set up error handler
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      cleanupConnection(ws);
    });
    
    // Set up pong handler
    ws.on('pong', () => {
      socketLastPong.set(ws, Date.now());
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: `Connected to ${pathType} WebSocket server`,
      timestamp: Date.now(),
      userId
    }));
    
    // Fetch and send pending notifications
    sendPendingNotifications(userId, ws);
  } catch (error) {
    console.error('Error handling WebSocket connection:', error);
    try {
      ws.close();
    } catch (closeError) {
      console.error('Error closing WebSocket:', closeError);
    }
  }
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(ws: WebSocket, message: any) {
  try {
    const userId = socketUsers.get(ws);
    
    if (!userId) {
      console.log('Message from unauthenticated WebSocket, closing');
      ws.close();
      return;
    }
    
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message.toString());
      console.log(`Received WebSocket message from user ${userId}:`, parsedMessage.type);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', message.toString());
      return;
    }
    
    // Handle different message types
    switch (parsedMessage.type) {
      case 'ping':
        handlePingMessage(ws, parsedMessage);
        break;
        
      case 'notification_read':
        handleNotificationRead(userId, parsedMessage);
        break;
        
      case 'notification_read_all':
        handleNotificationReadAll(userId);
        break;
        
      case 'sync_request':
        handleSyncRequest(userId, parsedMessage);
        break;
        
      default:
        console.log(`Unknown WebSocket message type: ${parsedMessage.type}`);
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
  }
}

// Handle ping messages from clients (not the built-in WebSocket ping)
function handlePingMessage(ws: WebSocket, message: any) {
  try {
    // Echo back the ping message with the server's timestamp
    ws.send(JSON.stringify({
      type: 'pong',
      originalTimestamp: message.timestamp,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error handling ping message:', error);
  }
}

// Handle notification read message
async function handleNotificationRead(userId: number, message: any) {
  try {
    const notificationId = message.notificationId;
    
    if (!notificationId) {
      console.error('Missing notification ID in read request');
      return;
    }
    
    // Mark notification as read in the database
    await storage.markNotificationRead(notificationId);
    
    // Send confirmation to user
    broadcastToUser(userId, {
      type: 'notification_marked_read',
      notificationId,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
  }
}

// Handle mark all notifications read
async function handleNotificationReadAll(userId: number) {
  try {
    // Mark all notifications as read in the database
    await storage.markAllNotificationsRead(userId);
    
    // Send confirmation to user
    broadcastToUser(userId, {
      type: 'all_notifications_marked_read',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
  }
}

// Handle sync request message
async function handleSyncRequest(userId: number, message: any) {
  try {
    // Fetch the sync service dynamically
    const { syncService } = await import('./sync-service');
    
    // Request a sync with provided options
    const result = await syncService.requestSync(userId, message.options || {});
    
    // Send confirmation to user
    broadcastToUser(userId, {
      type: 'sync_requested',
      success: result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error handling sync request:', error);
    
    // Send error notification to user
    broadcastToUser(userId, {
      type: 'sync_request_error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    });
  }
}

// Handle WebSocket close event
function handleWebSocketClose(ws: WebSocket) {
  console.log('WebSocket connection closed');
  cleanupConnection(ws);
}

// Clean up WebSocket connection when it closes
function cleanupConnection(ws: WebSocket) {
  try {
    const userId = socketUsers.get(ws);
    
    if (userId) {
      const userSockets = userConnections.get(userId);
      if (userSockets) {
        userSockets.delete(ws);
        
        // If this was the last connection for this user, clean up the map entry
        if (userSockets.size === 0) {
          userConnections.delete(userId);
        }
      }
    }
    
    // Clean up socket tracking maps
    socketUsers.delete(ws);
    socketLastPing.delete(ws);
    socketLastPong.delete(ws);
  } catch (error) {
    console.error('Error cleaning up WebSocket connection:', error);
  }
}

// Send a message to all connected WebSockets for a specific user
export function broadcastToUser(userId: number, message: any) {
  try {
    const userSockets = userConnections.get(userId);
    
    if (!userSockets || userSockets.size === 0) {
      return;
    }
    
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    
    // Use forEach instead of for...of to avoid TypeScript downlevelIteration issue
    userSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(messageString);
      }
    });
  } catch (error) {
    console.error(`Error broadcasting to user ${userId}:`, error);
  }
}

// Send a notification to a specific user
export function sendNotification(userId: number, notification: Notification) {
  try {
    broadcastToUser(userId, {
      type: 'notification',
      notification,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Error sending notification to user ${userId}:`, error);
  }
}

// Create a notification in the database and send it to the user
export async function createAndSendNotification(
  userId: number,
  title: string,
  message: string,
  notificationType: string,
  entityType?: string,
  entityId?: number,
  createdBy?: number
) {
  try {
    // Create the notification in the database
    const notification = await notificationService.createNotification({
      userId,
      title,
      message,
      type: notificationType,
      entityType,
      entityId,
      createdBy,
      isRead: false,
      createdAt: new Date()
    });
    
    // Send the notification to the user
    if (notification) {
      sendNotification(userId, notification);
    }
    
    return notification;
  } catch (error) {
    console.error(`Error creating and sending notification to user ${userId}:`, error);
    return null;
  }
}

// Notify about calendar changes
export function notifyCalendarChanged(
  userId: number,
  calendarId: number,
  changeType: 'created' | 'updated' | 'deleted',
  details?: any
) {
  try {
    broadcastToUser(userId, {
      type: 'calendar_changed',
      calendarId,
      changeType,
      details,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Error sending calendar change notification to user ${userId}:`, error);
  }
}

// Notify about event changes
export function notifyEventChanged(
  userId: number,
  eventId: number | { id: number; calendarId: number; uid?: string; title?: string },
  changeType: 'created' | 'updated' | 'deleted',
  details?: any
) {
  try {
    // Backward compatibility with existing code
    if (typeof eventId === 'number' && typeof changeType === 'string') {
      // Try to extract UID from details for legacy format
      const uid = details?.uid || null;
      const calendarId = details?.calendarId || null;
      
      console.log(`[WS] Legacy notification for user ${userId}: event ${eventId} ${changeType} with uid: ${uid || 'not specified'}`);
      
      broadcastToUser(userId, {
        type: 'event_changed',
        eventId,
        changeType,
        // CRITICAL: Include these fields in every notification for consistent identity tracking
        uid: uid,  // UID is critical for event identity across updates
        calendarId: calendarId,
        details,
        timestamp: Date.now()
      });
    } 
    // Support for enhanced sync service format
    else if (eventId && typeof eventId === 'object') {
      const event = eventId as { id: number; calendarId: number; uid?: string; title?: string };
      const action = changeType as 'created' | 'updated' | 'deleted';
      
      console.log(`[WS] Enhanced notification for user ${userId}: event ${event.id} ${action} with uid: ${event.uid || 'not specified'}`);
      
      broadcastToUser(userId, {
        type: 'event_changed',
        eventId: event.id,
        calendarId: event.calendarId,
        uid: event.uid, // This is critical for event identity
        title: event.title,
        changeType: action,
        details,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error(`Error sending event change notification to user ${userId}:`, error);
  }
}

// Notify about event cancellations
export function notifyEventCancelled(
  userId: number,
  eventId: number,
  calendarId: number,
  eventTitle: string,
  preservedUid: string,
  resourcesPreserved: boolean,
  resourceCount: number,
  details?: any
) {
  try {
    broadcastToUser(userId, {
      type: 'event_cancelled',
      eventId,
      calendarId,
      eventTitle,
      preservedUid,
      resourcesPreserved,
      resourceCount,
      details,
      timestamp: Date.now()
    });
    
    // Create a permanent notification for this important event
    createAndSendNotification(
      userId,
      'Event Cancelled',
      `Event "${eventTitle}" has been cancelled. ${resourceCount > 0 ? `${resourceCount} resources were ${resourcesPreserved ? 'preserved' : 'not preserved'}.` : ''}`,
      'event_cancellation',
      'event',
      eventId
    );
    
    console.log(`Sent cancellation notification for event ${eventId} (${eventTitle}) to user ${userId}`);
    
  } catch (error) {
    console.error(`Error sending event cancellation notification to user ${userId}:`, error);
  }
}

// Send any pending notifications for a user
async function sendPendingNotifications(userId: number, ws: WebSocket) {
  try {
    // Get unread notifications for this user
    const notifications = await storage.getUnreadNotifications(userId);
    
    if (notifications.length > 0) {
      console.log(`Sending ${notifications.length} pending notifications to user ${userId}`);
      
      // Send each notification
      for (const notification of notifications) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'notification',
            notification,
            timestamp: Date.now()
          }));
        }
      }
    }
  } catch (error) {
    console.error(`Error sending pending notifications to user ${userId}:`, error);
  }
}

// Ping all connected clients to check for stale connections
function pingAllClients() {
  try {
    // Use forEach instead of for...of to avoid TypeScript downlevelIteration issue
    socketUsers.forEach((userId, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Update last ping time
        socketLastPing.set(ws, Date.now());
        
        // Send ping
        try {
          ws.ping();
        } catch (pingError) {
          console.error(`Error pinging client for user ${userId}:`, pingError);
          cleanupConnection(ws);
        }
      }
    });
  } catch (error) {
    console.error('Error pinging WebSocket clients:', error);
  }
}

// Check for stale connections that haven't responded to pings
function checkStaleConnections() {
  try {
    const now = Date.now();
    const timeout = 60000; // 60 seconds
    
    // Use forEach instead of for...of to avoid TypeScript downlevelIteration issue
    socketLastPong.forEach((lastPong, ws) => {
      // If we haven't received a pong in the timeout period, close the connection
      if (now - lastPong > timeout) {
        console.log(`Closing stale WebSocket connection (no pong for ${Math.floor((now - lastPong) / 1000)}s)`);
        
        try {
          ws.close();
          cleanupConnection(ws);
        } catch (closeError) {
          console.error('Error closing stale WebSocket connection:', closeError);
        }
      }
    });
  } catch (error) {
    console.error('Error checking for stale WebSocket connections:', error);
  }
}