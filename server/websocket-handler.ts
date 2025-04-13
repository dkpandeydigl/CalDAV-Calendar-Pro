import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { notificationService } from './notification-service';
import { storage } from './database-storage';

// Map to store WebSocket connections by user ID
const userSockets = new Map<number, Set<WebSocket>>();

// Initialize WebSocket server
export function initializeWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  console.log('WebSocket server initialized');

  wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection');
    
    // Try to get user ID from session cookie in request
    // We'll extract from cookie or request parameter
    try {
      const userId = await getUserIdFromRequest(req);
      
      if (!userId) {
        console.log('WebSocket connection rejected: No user ID found');
        ws.close(1008, 'User not authenticated');
        return;
      }
      
      console.log(`WebSocket connected for user ${userId}`);
      
      // Store the connection in the map
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId)?.add(ws);
      
      // Send initial unread notification count
      const unreadCount = await notificationService.getUnreadCount(userId);
      sendToSocket(ws, {
        type: 'notification_count',
        count: unreadCount
      });
      
      // Handle incoming messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log(`Received WebSocket message from user ${userId}:`, data);
          
          await handleWebSocketMessage(userId, data, ws);
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          sendToSocket(ws, {
            type: 'error',
            message: 'Invalid message format'
          });
        }
      });
      
      // Handle disconnect
      ws.on('close', () => {
        console.log(`WebSocket disconnected for user ${userId}`);
        userSockets.get(userId)?.delete(ws);
        
        // Clean up empty sets
        if (userSockets.get(userId)?.size === 0) {
          userSockets.delete(userId);
        }
      });
      
    } catch (error) {
      console.error('Error handling WebSocket connection:', error);
      ws.close(1011, 'Server error');
    }
  });
  
  return wss;
}

/**
 * Extract user ID from request
 */
async function getUserIdFromRequest(req: any): Promise<number | null> {
  try {
    // Extract from cookie session if available
    if (req.headers.cookie && req.headers.cookie.includes('connect.sid')) {
      // We'll need to parse the session from the cookie and validate it
      // This logic would depend on your session implementation
      
      // For now, we'll extract a token from the query parameter as a fallback
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (token) {
        // Validate token and get user ID
        // For demonstration, we'll use a simple parsing, in production use proper JWT validation
        const [userId, timestamp] = token.split('.');
        
        if (userId && timestamp) {
          const parsedUserId = parseInt(userId, 10);
          
          // Verify the user exists
          const user = await storage.getUser(parsedUserId);
          if (user) {
            return parsedUserId;
          }
        }
      }
    }
    
    // If no session or query parameter, check authorization header
    // This is for demonstration
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const [userId, timestamp] = token.split('.');
      
      if (userId && timestamp) {
        const parsedUserId = parseInt(userId, 10);
        
        // Verify the user exists
        const user = await storage.getUser(parsedUserId);
        if (user) {
          return parsedUserId;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting user ID from request:', error);
    return null;
  }
}

/**
 * Handle WebSocket message
 */
async function handleWebSocketMessage(userId: number, data: any, ws: WebSocket): Promise<void> {
  if (!data || !data.type) {
    sendToSocket(ws, {
      type: 'error',
      message: 'Invalid message format'
    });
    return;
  }
  
  switch (data.type) {
    case 'get_notifications':
      const limit = data.limit || 50;
      const offset = data.offset || 0;
      const unreadOnly = data.unreadOnly || false;
      const requiresActionOnly = data.requiresActionOnly || false;
      
      try {
        const notifications = await notificationService.getNotifications({
          userId,
          limit,
          offset,
          unreadOnly,
          requiresActionOnly
        });
        
        sendToSocket(ws, {
          type: 'notifications',
          notifications
        });
      } catch (error) {
        console.error('Error getting notifications:', error);
        sendToSocket(ws, {
          type: 'error',
          message: 'Failed to get notifications'
        });
      }
      break;
      
    case 'mark_read':
      if (data.notificationId) {
        try {
          const success = await notificationService.markAsRead(data.notificationId);
          if (success) {
            const unreadCount = await notificationService.getUnreadCount(userId);
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'marked_read',
              success: true,
              unreadCount
            });
            
            // Send updated count to all user's connections
            broadcastToUser(userId, {
              type: 'notification_count',
              count: unreadCount
            });
          } else {
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'marked_read',
              success: false,
              error: 'Notification not found'
            });
          }
        } catch (error) {
          console.error('Error marking notification as read:', error);
          sendToSocket(ws, {
            type: 'error',
            message: 'Failed to mark notification as read'
          });
        }
      }
      break;
      
    case 'mark_all_read':
      try {
        const success = await notificationService.markAllAsRead(userId);
        sendToSocket(ws, {
          type: 'all_marked_read',
          success
        });
        
        // Send updated count to all user's connections
        broadcastToUser(userId, {
          type: 'notification_count',
          count: 0
        });
      } catch (error) {
        console.error('Error marking all notifications as read:', error);
        sendToSocket(ws, {
          type: 'error',
          message: 'Failed to mark all notifications as read'
        });
      }
      break;
      
    case 'dismiss':
      if (data.notificationId) {
        try {
          const success = await notificationService.dismissNotification(data.notificationId);
          if (success) {
            const unreadCount = await notificationService.getUnreadCount(userId);
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'dismissed',
              success: true,
              unreadCount
            });
            
            // Send updated count to all user's connections
            broadcastToUser(userId, {
              type: 'notification_count',
              count: unreadCount
            });
          } else {
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'dismissed',
              success: false,
              error: 'Notification not found'
            });
          }
        } catch (error) {
          console.error('Error dismissing notification:', error);
          sendToSocket(ws, {
            type: 'error',
            message: 'Failed to dismiss notification'
          });
        }
      }
      break;
      
    case 'action_taken':
      if (data.notificationId) {
        try {
          const success = await notificationService.markActionTaken(data.notificationId);
          if (success) {
            const unreadCount = await notificationService.getUnreadCount(userId);
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'action_taken',
              success: true,
              unreadCount
            });
            
            // Send updated count to all user's connections
            broadcastToUser(userId, {
              type: 'notification_count',
              count: unreadCount
            });
          } else {
            sendToSocket(ws, {
              type: 'notification_updated',
              notificationId: data.notificationId,
              change: 'action_taken',
              success: false,
              error: 'Notification not found'
            });
          }
        } catch (error) {
          console.error('Error marking action taken:', error);
          sendToSocket(ws, {
            type: 'error',
            message: 'Failed to mark action taken'
          });
        }
      }
      break;
      
    case 'ping':
      sendToSocket(ws, { type: 'pong' });
      break;
      
    default:
      sendToSocket(ws, {
        type: 'error',
        message: `Unknown message type: ${data.type}`
      });
  }
}

/**
 * Send message to a WebSocket
 */
function sendToSocket(ws: WebSocket, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Broadcast message to all sockets for a user
 */
export function broadcastToUser(userId: number, data: any): void {
  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const socket of sockets) {
      sendToSocket(socket, data);
    }
  }
}

/**
 * Broadcast notification to a user
 */
export async function sendNotification(userId: number, notification: any): Promise<void> {
  try {
    const unreadCount = await notificationService.getUnreadCount(userId);
    
    // Send the notification to the user
    broadcastToUser(userId, {
      type: 'new_notification',
      notification,
      unreadCount
    });
    
    // Also update the unread count
    broadcastToUser(userId, {
      type: 'notification_count',
      count: unreadCount
    });
  } catch (error) {
    console.error('Error sending notification via WebSocket:', error);
  }
}

/**
 * Create and send a notification
 */
export async function createAndSendNotification(notificationData: any): Promise<void> {
  try {
    const notification = await notificationService.createNotification(notificationData);
    await sendNotification(notificationData.userId, notification);
  } catch (error) {
    console.error('Error creating and sending notification:', error);
  }
}

/**
 * Notify a user about calendar changes
 * 
 * @param userId - User ID to notify
 * @param calendarId - Calendar ID that changed
 * @param changeType - Type of change ('created', 'updated', 'deleted')
 * @param data - Any relevant data about the change
 */
export function notifyCalendarChanged(
  userId: number, 
  calendarId: number, 
  changeType: string, 
  data: any = null
): void {
  try {
    // Send the notification to the user
    broadcastToUser(userId, {
      type: 'calendar_changed',
      calendarId,
      changeType,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending calendar change notification:', error);
  }
}

/**
 * Notify a user about changes to an event
 * 
 * @param userId - User ID to notify
 * @param eventId - Event ID that changed
 * @param changeType - Type of change ('created', 'updated', 'deleted')
 * @param data - Any relevant data about the change
 */
export function notifyEventChanged(
  userId: number, 
  eventId: number, 
  changeType: string, 
  data: any = null
): void {
  try {
    // Send the notification to the user
    broadcastToUser(userId, {
      type: 'event_changed',
      eventId,
      changeType,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending event change notification:', error);
  }
}