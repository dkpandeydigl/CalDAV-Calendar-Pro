import WebSocket from 'ws';
import { storage } from './storage';
import { WebSocketServer } from 'ws';

export interface WebSocketNotification {
  type: 'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email';
  action: 'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info';
  timestamp: number;
  data: any;
  sourceUserId?: number | null; // The user who triggered the notification
}

export class WebSocketNotificationService {
  private static instance: WebSocketNotificationService | null = null;
  private userConnections: Map<number, Set<WebSocket>> = new Map();
  private adminConnections: Set<WebSocket> = new Set();
  private wss: WebSocketServer | null = null;

  constructor() {
    console.log('WebSocket notification service initialized');
  }

  public static getInstance(): WebSocketNotificationService {
    if (!WebSocketNotificationService.instance) {
      WebSocketNotificationService.instance = new WebSocketNotificationService();
    }
    return WebSocketNotificationService.instance;
  }

  public initialize(wss: WebSocketServer): void {
    this.wss = wss;
  }

  public addUserConnection(userId: number, connection: WebSocket): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)?.add(connection);
    console.log(`Added WebSocket connection for user ${userId}, total connections: ${this.userConnections.get(userId)?.size}`);
  }

  public addAdminConnection(connection: WebSocket): void {
    this.adminConnections.add(connection);
    console.log(`Added admin WebSocket connection, total admin connections: ${this.adminConnections.size}`);
  }

  public removeConnection(userId: number | null, connection: WebSocket): void {
    if (userId !== null) {
      const userConnections = this.userConnections.get(userId);
      if (userConnections) {
        userConnections.delete(connection);
        if (userConnections.size === 0) {
          this.userConnections.delete(userId);
        }
        console.log(`Removed WebSocket connection for user ${userId}, remaining connections: ${userConnections.size}`);
      }
    } else {
      this.adminConnections.delete(connection);
      console.log(`Removed admin WebSocket connection, remaining admin connections: ${this.adminConnections.size}`);
    }
  }

  public broadcastToUser(userId: number, notification: WebSocketNotification): boolean {
    const userConnections = this.userConnections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      return false;
    }

    let success = false;
    try {
      const message = JSON.stringify(notification);
      
      for (const connection of userConnections) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(message);
          success = true;
        }
      }
    } catch (error) {
      console.error(`Error broadcasting to user ${userId}:`, error);
      return false;
    }

    return success;
  }

  public broadcastToAll(notification: WebSocketNotification): boolean {
    let success = false;
    
    try {
      const message = JSON.stringify(notification);
      
      // Broadcast to all user connections
      for (const [userId, connections] of this.userConnections.entries()) {
        for (const connection of connections) {
          if (connection.readyState === WebSocket.OPEN) {
            connection.send(message);
            success = true;
          }
        }
      }
      
      // Broadcast to admin connections
      for (const connection of this.adminConnections) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(message);
          success = true;
        }
      }
    } catch (error) {
      console.error('Error broadcasting to all:', error);
      return false;
    }

    return success;
  }

  public sendNotification(notification: WebSocketNotification): boolean {
    // If notification has a source user ID, don't send it back to that user
    const sourceUserId = notification.sourceUserId;
    
    let success = false;
    
    try {
      const message = JSON.stringify(notification);
      
      // Send to all connections except the source user
      for (const [userId, connections] of this.userConnections.entries()) {
        // Skip the source user
        if (sourceUserId !== undefined && sourceUserId === userId) {
          continue;
        }
        
        for (const connection of connections) {
          if (connection.readyState === WebSocket.OPEN) {
            connection.send(message);
            success = true;
          }
        }
      }
      
      // Send to admin connections
      for (const connection of this.adminConnections) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(message);
          success = true;
        }
      }
    } catch (error) {
      console.error('Error sending notification:', error);
      return false;
    }

    return success;
  }

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

// Create a singleton instance
const notificationService = WebSocketNotificationService.getInstance();

export function getWebSocketNotificationService(): WebSocketNotificationService {
  return notificationService;
}

export function initializeWebSocketNotificationService(): WebSocketNotificationService {
  return notificationService;
}