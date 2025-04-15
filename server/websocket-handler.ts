/**
 * WebSocket Handler Module
 * 
 * This module manages real-time WebSocket connections for the application.
 * It provides functionality for:
 * - Establishing WebSocket connections with clients
 * - Maintaining a registry of active connections by user ID
 * - Broadcasting notifications and updates to clients
 * - Handling client disconnections and reconnections
 */

import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { storage } from './database-storage';
import { 
  type Notification, 
  NotificationType,
  notificationSchema 
} from '@shared/schema';
import { notificationService } from './notification-service';

// Map to track active WebSocket connections by user ID
const userSockets = new Map<number, Set<WebSocket>>();

// Map to track user IDs associated with each socket (for cleanup on disconnect)
const socketUsers = new Map<WebSocket, number>();

// WebSocket server instance
let wss: WebSocketServer;
let wssAlternate: WebSocketServer;  // Alternative path WebSocket server

// Initialize the WebSocket server
export function initializeWebSocketServer(server: Server) {
  console.log('Initializing WebSocket server with dual paths');
  
  // Create WebSocket server on the primary path /api/ws
  wss = new WebSocketServer({ 
    server, 
    path: '/api/ws',
    clientTracking: true 
  });
  
  // Create WebSocket server on the alternate path /ws for environments 
  // where the primary path might be blocked
  wssAlternate = new WebSocketServer({
    server,
    path: '/ws',
    clientTracking: true
  });

  // Set up connection handling for the primary WebSocket server
  wss.on('connection', handleConnection);
  
  // Set up connection handling for the alternate WebSocket server
  wssAlternate.on('connection', handleConnection);
  
  console.log('WebSocket server initialized on paths: /api/ws and /ws');
}

// Handle incoming WebSocket connections
function handleConnection(ws: WebSocket, req: any) {
  // Extract user ID from the request session or query parameters
  let userId: number | undefined;

  // Try to extract from URL parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userIdParam = url.searchParams.get('userId');
  if (userIdParam) {
    userId = parseInt(userIdParam, 10);
  } else {
    // Not authenticated yet - wait for auth message
    console.log('WebSocket connection established, waiting for authentication');
  }

  // Set up ping-pong to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const timestamp = Date.now();
      ws.ping(timestamp.toString());
    }
  }, 30000);

  ws.on('pong', (data) => {
    // Echo back the timestamp to measure latency
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const timestamp = data.toString();
        const now = Date.now();
        const latency = now - parseInt(timestamp);
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: parseInt(timestamp),
          receivedAt: now,
          latency
        }));
      } catch (err) {
        console.error('Error handling pong:', err);
      }
    }
  });

  // Handle messages from client
  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle authentication message
      if (data.type === 'auth' && data.userId) {
        userId = parseInt(data.userId, 10);
        if (isNaN(userId)) {
          console.error('Invalid user ID in WebSocket auth:', data.userId);
          return;
        }
        
        // Register this socket with the user
        registerUserSocket(userId, ws);
        
        // Acknowledge the authentication
        ws.send(JSON.stringify({ 
          type: 'auth_success', 
          message: 'WebSocket connection authenticated' 
        }));
        
        // Send initial unread notifications
        sendInitialNotifications(userId, ws);
        
        console.log(`WebSocket authenticated for user ${userId}`);
      }
      
      // Handle mark notification as read
      if (data.type === 'mark_read' && data.notificationId && userId) {
        try {
          await storage.markNotificationRead(data.notificationId);
          
          // Send updated notification status
          const updatedNotifications = await storage.getUnreadNotifications(userId);
          ws.send(JSON.stringify({
            type: 'notifications_update',
            notifications: updatedNotifications
          }));
        } catch (error) {
          console.error('Error marking notification as read:', error);
        }
      }
      
      // Handle mark all notifications as read
      if (data.type === 'mark_all_read' && userId) {
        try {
          await storage.markAllNotificationsRead(userId);
          
          // Send updated notification status (should be empty now)
          ws.send(JSON.stringify({
            type: 'notifications_update',
            notifications: []
          }));
        } catch (error) {
          console.error('Error marking all notifications as read:', error);
        }
      }
      
      // Handle ping message (manual ping for troubleshooting)
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ 
          type: 'pong', 
          timestamp: Date.now(),
          echo: data.timestamp 
        }));
      }
      
      // Handle test message
      if (data.type === 'test') {
        ws.send(JSON.stringify({ 
          type: 'test_response', 
          message: 'Test successful', 
          received: data 
        }));
      }
      
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    clearInterval(pingInterval);
    
    // Clean up the connection from our registry
    if (userId) {
      unregisterUserSocket(userId, ws);
    }
    
    console.log('WebSocket connection closed');
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(pingInterval);
    
    // Clean up on error
    if (userId) {
      unregisterUserSocket(userId, ws);
    }
  });
}

// Register a WebSocket connection for a user
function registerUserSocket(userId: number, ws: WebSocket) {
  // Add to user -> sockets map
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)?.add(ws);
  
  // Add to socket -> user map (for cleanup)
  socketUsers.set(ws, userId);
}

// Unregister a WebSocket connection for a user
function unregisterUserSocket(userId: number, ws: WebSocket) {
  // Remove from user -> sockets map
  const userSocketSet = userSockets.get(userId);
  if (userSocketSet) {
    userSocketSet.delete(ws);
    if (userSocketSet.size === 0) {
      userSockets.delete(userId);
    }
  }
  
  // Remove from socket -> user map
  socketUsers.delete(ws);
}

// Send notifications to a specific user
export function sendNotification(userId: number, notification: Notification) {
  // Validate notification schema
  try {
    notificationSchema.parse(notification);
  } catch (error) {
    console.error('Invalid notification schema:', error);
    return;
  }
  
  const userSocketSet = userSockets.get(userId);
  if (!userSocketSet || userSocketSet.size === 0) {
    // User doesn't have an active WebSocket connection
    // We'll just store it in the database for when they connect
    return;
  }
  
  // Send to all connections for this user
  for (const socket of userSocketSet) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'notification',
          notification
        }));
      } catch (error) {
        console.error(`Error sending notification to user ${userId}:`, error);
      }
    }
  }
}

// Create and send a notification in one step
export function createAndSendNotification(
  userId: number,
  type: NotificationType,
  title: string,
  message: string,
  data?: Record<string, any>,
  actionUrl?: string
) {
  const notification = notificationService.createNotification({
    userId,
    type,
    title,
    message,
    data,
    actionUrl
  });
  
  // Send the notification via WebSocket
  sendNotification(userId, notification);
  
  return notification;
}

// Send notifications to all users (system-wide)
export function broadcastNotification(notification: Notification) {
  // For non-targeted system messages
  if (!notification.userId) {
    console.error('Broadcast notification must have a userId set');
    return;
  }
  
  // For each user ID with active connections
  for (const [userId, sockets] of userSockets.entries()) {
    // Clone the notification for each user
    const userNotification = {
      ...notification,
      userId
    };
    
    // Send to all connections for this user
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({
            type: 'notification',
            notification: userNotification
          }));
        } catch (error) {
          console.error(`Error broadcasting notification to user ${userId}:`, error);
        }
      }
    }
  }
}

// Send existing unread notifications when a user connects
async function sendInitialNotifications(userId: number, ws: WebSocket) {
  try {
    // Get unread notifications from the database
    const notifications = await storage.getUnreadNotifications(userId);
    
    if (notifications.length > 0) {
      // Send them to the newly connected client
      ws.send(JSON.stringify({
        type: 'initial_notifications',
        notifications
      }));
    }
  } catch (error) {
    console.error(`Error sending initial notifications to user ${userId}:`, error);
  }
}

// Broadcast to a specific user on all their connections
export function broadcastToUser(userId: number, message: any) {
  const userSocketSet = userSockets.get(userId);
  if (!userSocketSet || userSocketSet.size === 0) {
    // User doesn't have an active WebSocket connection
    return;
  }
  
  // Send to all connections for this user
  for (const [socket, socketUserId] of socketUsers.entries()) {
    if (socketUserId === userId && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Error broadcasting to user ${userId}:`, error);
      }
    }
  }
}

// Notify all clients when a calendar is changed
export function notifyCalendarChanged(userId: number, calendarId: number, action: 'create' | 'update' | 'delete') {
  broadcastToUser(userId, {
    type: 'calendar_changed',
    calendarId,
    action
  });
}

// Notify all clients when an event is changed
export function notifyEventChanged(userId: number, eventId: number, action: 'create' | 'update' | 'delete') {
  broadcastToUser(userId, {
    type: 'event_changed',
    eventId,
    action
  });
}

// Get connection statistics
export function getConnectionStats() {
  return {
    totalConnections: socketUsers.size,
    uniqueUsers: userSockets.size,
    connectionsByUser: Array.from(userSockets.entries()).map(([userId, sockets]) => ({
      userId,
      connections: sockets.size
    }))
  };
}

// Get all connected users
export function getConnectedUsers() {
  return Array.from(userSockets.keys());
}