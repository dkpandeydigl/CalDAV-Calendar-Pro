import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { notificationService } from './notification-service';
import { storage } from './database-storage';

// Map to store WebSocket connections by user ID
const userSockets = new Map<number, Set<WebSocket>>();

/**
 * Initialize WebSocket server
 */
export function initializeWebSocketServer(httpServer: Server) {
  // Create WebSocket server with more flexible configuration
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/ws', // Main path for WebSocket connections
    // Increase client timeout settings
    clientTracking: true,
    // Add extra WebSocket options to handle various client scenarios
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      // Don't use shared compression state for improved reliability
      serverNoContextTakeover: true, 
      clientNoContextTakeover: true,
      // Threshold below which messages should not be compressed
      threshold: 1024
    }
  });
  
  // Create a secondary WebSocket server on the root path for clients that can't use the full path
  // This helps with certain environments where path-based routing fails
  const fallbackWss = new WebSocketServer({
    server: httpServer,
    path: '/ws', // Fallback path for WebSocket connections
    clientTracking: true
  });

  console.log('🌐 WebSocket servers initialized on paths: /api/ws (primary) and /ws (fallback)');

  // Handle connections on the fallback server the same way as the main server
  fallbackWss.on('connection', (ws, req) => {
    console.log('📡 WebSocket connection on fallback path /ws');
    // Forward to the same handler used by the main WebSocket server
    handleWebSocketConnection(ws, req);
  });

  // Use the same handler for the main WebSocket server
  wss.on('connection', (ws, req) => {
    console.log('📡 WebSocket connection on primary path /api/ws');
    handleWebSocketConnection(ws, req);
  });
  
  return wss;
}

/**
 * Reusable WebSocket connection handler for both primary and fallback sockets
 */
async function handleWebSocketConnection(ws: WebSocket, req: any) {
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
    
    // Send a welcome message immediately after connection
    sendToSocket(ws, {
      type: 'connection_established',
      userId: userId,
      timestamp: new Date().toISOString(),
      message: 'Successfully connected to calendar notification service'
    });
    
    // Handle incoming messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`📥 Received WebSocket message from user ${userId}:`, data);
        
        // Special handling for authentication messages
        if (data.type === 'auth') {
          console.log(`🔑 Received authentication message from client for user ${data.userId}`);
          
          // Verify if the userId matches what we already have
          if (data.userId === userId) {
            console.log(`✅ Authentication confirmed for user ${userId}`);
            sendToSocket(ws, {
              type: 'auth_success',
              userId: userId,
              timestamp: new Date().toISOString()
            });
          } else {
            console.log(`❌ Authentication mismatch: expected ${userId}, got ${data.userId}`);
            sendToSocket(ws, {
              type: 'auth_error',
              message: 'User ID mismatch in authentication'
            });
          }
        } else {
          // Regular message handling
          await handleWebSocketMessage(userId, data, ws);
        }
      } catch (error) {
        console.error('❌ Error handling WebSocket message:', error);
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
        console.log(`No more active WebSocket connections for user ${userId}`);
        userSockets.delete(userId);
        
        // Note: We don't stop the sync service here because
        // the global sync timer will continue checking for external changes
        // even when no user is actively connected. This ensures that when the user
        // reconnects, they will still see the latest data, including
        // changes made from external clients like Thunderbird.
      }
    });
    
  } catch (error) {
    console.error('Error handling WebSocket connection:', error);
    ws.close(1011, 'Server error');
  }
}

/**
 * Extract user ID from request
 */
async function getUserIdFromRequest(req: any): Promise<number | null> {
  try {
    // First, try to get userId directly from query parameters - this is the most reliable method
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryUserId = url.searchParams.get('userId');
    
    if (queryUserId) {
      try {
        const parsedUserId = parseInt(queryUserId, 10);
        
        // Log attempt to connect with this userId
        console.log(`👤 WebSocket connection attempt with userId: ${parsedUserId}`);
        
        // Verify the user exists
        const user = await storage.getUser(parsedUserId);
        if (user) {
          console.log(`✅ Successfully validated user ID ${parsedUserId} for WebSocket connection`);
          return parsedUserId;
        } else {
          console.log(`❌ User ID ${parsedUserId} not found in database`);
        }
      } catch (error) {
        console.error(`❌ Error parsing user ID from query parameter: ${queryUserId}`, error);
      }
    } else {
      console.log('❓ No userId query parameter found in WebSocket connection URL');
    }
    
    // If we get here, try to extract from cookie session
    if (req.headers.cookie && req.headers.cookie.includes('connect.sid')) {
      // Attempt to parse session ID from cookie
      try {
        const cookies = req.headers.cookie.split(';')
          .map((cookie: string) => cookie.trim())
          .reduce((acc: any, cookie: string) => {
            const [key, value] = cookie.split('=');
            acc[key] = value;
            return acc;
          }, {});
          
        const sessionId = cookies['connect.sid'];
        if (sessionId) {
          console.log('Found session ID in cookies:', sessionId);
          // This is where you would typically lookup the session in your session store
          // For now, we'll just log it and continue with other authentication methods
        }
      } catch (err) {
        console.error('Error parsing cookies:', err);
      }
    }
    
    // If no session or query parameter, check authorization header as last resort
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('Attempting to authenticate WebSocket with Bearer token');
      const token = authHeader.substring(7);
      const [userId, timestamp] = token.split('.');
      
      if (userId && timestamp) {
        const parsedUserId = parseInt(userId, 10);
        
        // Verify the user exists
        const user = await storage.getUser(parsedUserId);
        if (user) {
          console.log(`✅ Successfully validated user ID ${parsedUserId} from Bearer token`);
          return parsedUserId;
        }
      }
    }
    
    console.log('❌ All authentication methods failed for WebSocket connection');
    return null;
  } catch (error) {
    console.error('❌ Error extracting user ID from request:', error);
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
      // Handle keep-alive ping messages from client
      // Simply respond with a pong to maintain the connection
      console.log(`Received ping from user ${userId}, sending pong`);
      sendToSocket(ws, { type: 'pong' });
      break;
      
    case 'event_deleted':
      // Handle event deletion notifications from client
      // This enables real-time syncing of deleted events across multiple tabs/devices
      try {
        console.log(`📢 Received event deletion notification from user ${userId}:`, data);
        
        if (data.eventId) {
          // Broadcast deletion to all other clients of this user
          broadcastToUser(userId, {
            type: 'event_changed', 
            changeType: 'deleted',
            eventId: data.eventId,
            uid: data.uid || null,
            timestamp: new Date().toISOString(),
            data: {
              calendarId: data.calendarId,
              title: data.title || 'Untitled event',
              uid: data.uid || null
            }
          }, ws); // Exclude the sender from receiving their own broadcast
          
          console.log(`🗑️ Event deletion broadcasted to all connected clients for user ${userId}`);
        } else {
          console.warn('Event deletion notification missing event ID');
        }
      } catch (error) {
        console.error('Error handling event deletion notification:', error);
      }
      break;
      
    case 'sync_request':
      // Client is requesting an immediate sync
      // This can happen after a tab becomes visible again
      try {
        console.log(`Received sync request from user ${userId}`);
        
        // Get the user's server connection
        const connection = await storage.getServerConnection(userId);
        if (connection) {
          // Forward to sync service
          const { syncService } = await import('./sync-service');
          await syncService.syncNow(userId, { 
            forceRefresh: data.forceRefresh || false,
            calendarId: data.calendarId || null,
            preserveLocalEvents: data.preserveLocalEvents || false // Pass through preserveLocalEvents parameter
          });
          
          sendToSocket(ws, { 
            type: 'sync_complete',
            success: true,
            message: 'Sync completed successfully'
          });
        } else {
          sendToSocket(ws, { 
            type: 'sync_complete',
            success: false,
            message: 'No server connection found for user'
          });
        }
      } catch (error) {
        console.error('Error handling sync request:', error);
        sendToSocket(ws, {
          type: 'sync_complete',
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error during sync'
        });
      }
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
 * 
 * @param userId User ID to broadcast to
 * @param data Data to broadcast
 * @param excludeSocket Optional socket to exclude from broadcast (useful for not echoing back to sender)
 */
export function broadcastToUser(userId: number, data: any, excludeSocket?: WebSocket): void {
  const sockets = userSockets.get(userId);
  if (sockets) {
    // Convert Set to Array for compatibility with all TS versions
    Array.from(sockets).forEach(socket => {
      // Skip the excluded socket if specified
      if (excludeSocket && socket === excludeSocket) {
        return;
      }
      sendToSocket(socket, data);
    });
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