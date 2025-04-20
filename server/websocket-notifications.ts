/**
 * WebSocket Notification Service
 * 
 * This service provides centralized WebSocket notification capabilities
 * for the application, managing connections and broadcasting messages.
 */

import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { logger } from './logger';

// Import any notification types from shared files or define them here
export interface WebSocketNotification {
  type: 'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email' | 'uid';
  action: 'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info' | 'add' | 'update' | 'delete';
  timestamp: number;
  data: any;
  sourceUserId?: number | null; // The user who triggered the notification
}

/**
 * Singleton service for managing WebSocket connections and notifications
 */
export class WebSocketNotificationService {
  private static instance: WebSocketNotificationService | null = null;
  private userConnections: Map<number, Set<WebSocket>> = new Map();
  private adminConnections: Set<WebSocket> = new Set();
  private wss: WebSocketServer | null = null;

  /**
   * Private constructor to enforce singleton pattern
   */
  constructor() {
    logger.info('WebSocket Notification Service initialized');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): WebSocketNotificationService {
    if (!WebSocketNotificationService.instance) {
      WebSocketNotificationService.instance = new WebSocketNotificationService();
    }
    return WebSocketNotificationService.instance;
  }

  /**
   * Initialize the service with a WebSocket server
   * 
   * @param wss The WebSocket server instance
   */
  public initialize(wss: WebSocketServer): void {
    this.wss = wss;
    logger.info('WebSocket Notification Service connected to WebSocket server');
  }

  /**
   * Add a user connection to the service
   * 
   * @param userId The user ID to associate with the connection
   * @param connection The WebSocket connection
   */
  public addUserConnection(userId: number, connection: WebSocket): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set<WebSocket>());
    }
    
    this.userConnections.get(userId)?.add(connection);
    logger.info(`Added connection for user ${userId}, total connections: ${this.userConnections.get(userId)?.size}`);
  }

  /**
   * Add an admin connection to the service
   * 
   * @param connection The WebSocket connection
   */
  public addAdminConnection(connection: WebSocket): void {
    this.adminConnections.add(connection);
    logger.info(`Added admin connection, total admin connections: ${this.adminConnections.size}`);
  }

  /**
   * Remove a connection from the service
   * 
   * @param userId The user ID associated with the connection, or null for admin connections
   * @param connection The WebSocket connection to remove
   */
  public removeConnection(userId: number | null, connection: WebSocket): void {
    if (userId !== null) {
      const connections = this.userConnections.get(userId);
      if (connections) {
        connections.delete(connection);
        logger.info(`Removed connection for user ${userId}, remaining connections: ${connections.size}`);
        
        // Clean up empty connection sets
        if (connections.size === 0) {
          this.userConnections.delete(userId);
          logger.info(`Removed empty connection set for user ${userId}`);
        }
      }
    } else {
      this.adminConnections.delete(connection);
      logger.info(`Removed admin connection, remaining admin connections: ${this.adminConnections.size}`);
    }
  }

  /**
   * Broadcast a notification to a specific user
   * 
   * @param userId The user ID to send the notification to
   * @param notification The notification to send
   * @returns True if the notification was sent to at least one connection
   */
  public broadcastToUser(userId: number, notification: WebSocketNotification): boolean {
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) {
      return false;
    }

    let sentCount = 0;
    for (const connection of connections) {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify(notification));
        sentCount++;
      }
    }

    logger.info(`Broadcast notification to user ${userId}, sent to ${sentCount}/${connections.size} connections`);
    return sentCount > 0;
  }

  /**
   * Broadcast a notification to all connected users
   * 
   * @param notification The notification to send
   * @returns True if the notification was sent to at least one connection
   */
  public broadcastToAll(notification: WebSocketNotification): boolean {
    let sentCount = 0;
    let totalConnections = 0;

    // Send to all user connections
    for (const [userId, connections] of this.userConnections) {
      totalConnections += connections.size;
      for (const connection of connections) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(JSON.stringify(notification));
          sentCount++;
        }
      }
    }

    // Send to all admin connections
    for (const connection of this.adminConnections) {
      totalConnections++;
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify(notification));
        sentCount++;
      }
    }

    logger.info(`Broadcast notification to all users, sent to ${sentCount}/${totalConnections} connections`);
    return sentCount > 0;
  }

  /**
   * Process and send a notification to the appropriate recipients
   * 
   * @param notification The notification to send
   * @returns True if the notification was sent to at least one connection
   */
  public sendNotification(notification: WebSocketNotification): boolean {
    // If the notification has a specific target user, send only to that user
    if (notification.data && notification.data.targetUserId) {
      return this.broadcastToUser(notification.data.targetUserId, notification);
    }
    
    // Otherwise broadcast to all connections
    return this.broadcastToAll(notification);
  }

  /**
   * Get statistics about the current connections
   * 
   * @returns An object containing statistics about the current connections
   */
  public getConnectionStats(): { totalUsers: number, totalConnections: number, adminConnections: number } {
    let totalConnections = 0;
    for (const connections of this.userConnections.values()) {
      totalConnections += connections.size;
    }
    
    return {
      totalUsers: this.userConnections.size,
      totalConnections: totalConnections + this.adminConnections.size,
      adminConnections: this.adminConnections.size
    };
  }
}

/**
 * Get the singleton instance of the WebSocket notification service
 * 
 * @returns The WebSocket notification service instance
 */
export function getWebSocketNotificationService(): WebSocketNotificationService {
  return WebSocketNotificationService.getInstance();
}

/**
 * Initialize the WebSocket notification service with a WebSocket server
 * 
 * @param wss The WebSocket server instance
 * @returns The initialized WebSocket notification service
 */
export function initializeWebSocketNotificationService(wss: WebSocketServer): WebSocketNotificationService {
  const service = WebSocketNotificationService.getInstance();
  service.initialize(wss);
  return service;
}

/**
 * Send an enhanced event change notification with attendee and resource metadata
 * 
 * @param userId The user ID
 * @param event The event object or event ID
 * @param action The action performed (created, updated, deleted)
 * @param metadata Additional metadata about the event change
 */
export function notifyEventChangeWithMetadata(
  userId: number, 
  event: any, 
  action: 'created' | 'updated' | 'deleted',
  metadata: {
    wasAttendeeUpdate?: boolean;
    wasResourceUpdate?: boolean;
    wasRecurrenceStateChange?: boolean;
    attendeeCount?: number;
    resourceCount?: number;
    [key: string]: any;
  } = {}
): void {
  try {
    const service = getWebSocketNotificationService();
    
    // Extract eventId and calendarId from the event
    const eventId = typeof event === 'object' ? event.id : event;
    const calendarId = typeof event === 'object' ? event.calendarId : 0;
    
    // Create a notification about the event change with metadata
    const notification: WebSocketNotification = {
      type: 'event',
      action: action,
      timestamp: Date.now(),
      data: {
        eventId,
        calendarId,
        message: `Event ${action}`,
        ...metadata // Include the metadata in the notification
      },
      sourceUserId: userId
    };
    
    // Send the notification to the user
    service.broadcastToUser(userId, notification);
    
    // Log the notification
    console.log(`[WebSocket] Sent enhanced event ${action} notification for event ${eventId} to user ${userId} with metadata: ${JSON.stringify(metadata)}`);
  } catch (error) {
    console.error(`[WebSocket] Error sending enhanced event notification:`, error);
  }
}

/**
 * Broadcast a UID change notification to all connected clients
 * This static method will be called from the centralUIDService
 * 
 * @param eventId The ID of the event
 * @param uid The UID associated with the event
 * @param operation The operation performed (add, update, delete)
 */
export function broadcastUIDChange(eventId: number, uid: string, operation: 'add' | 'update' | 'delete'): void {
  try {
    const service = getWebSocketNotificationService();
    
    // Create a notification about the UID change
    const notification: WebSocketNotification = {
      type: 'uid',
      action: operation,
      timestamp: Date.now(),
      data: {
        eventId,
        uid,
        message: `Event UID ${operation}d: ${uid}`
      }
    };
    
    // Broadcast to all users
    service.broadcastToAll(notification);
    
    logger.info(`[WebSocket] UID change notification broadcast: ${operation} for event ${eventId} with UID ${uid}`);
  } catch (error) {
    logger.error(`[WebSocket] Error broadcasting UID change: ${error}`);
  }
}