import { WebSocket } from 'ws';
import { WebSocketHandler } from './websocket-handler';

// Types for notification messages
export interface WebSocketNotification {
  type: 'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email';
  action: 'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info';
  timestamp: number;
  data: any;
  sourceUserId?: number;
  targetUserIds?: number[];
  uid?: string; // Event UID for event-related notifications
}

/**
 * Websocket notification service for real-time updates
 * Extends the base WebSocketHandler with specific notification functionality
 */
export class WebSocketNotificationService {
  private static instance: WebSocketNotificationService;
  private wsHandler: WebSocketHandler;

  private constructor(wsHandler: WebSocketHandler) {
    this.wsHandler = wsHandler;
    console.log('WebSocket notification service initialized');
  }

  /**
   * Get the singleton instance of the notification service
   */
  public static getInstance(wsHandler: WebSocketHandler): WebSocketNotificationService {
    if (!WebSocketNotificationService.instance) {
      WebSocketNotificationService.instance = new WebSocketNotificationService(wsHandler);
    }
    return WebSocketNotificationService.instance;
  }

  /**
   * Send a notification to specific users
   * @param notification The notification to send
   */
  public sendNotification(notification: WebSocketNotification): void {
    try {
      // If targetUserIds is specified, send only to those users
      if (notification.targetUserIds && notification.targetUserIds.length > 0) {
        // Add UID to data for event-related notifications if not already there
        if (notification.type === 'event' && notification.uid && !notification.data.uid) {
          notification.data.uid = notification.uid;
        }
        
        // Convert to JSON once to avoid multiple serialization operations
        const notificationJson = JSON.stringify(notification);
        
        for (const userId of notification.targetUserIds) {
          this.wsHandler.sendToUser(userId, notificationJson);
        }
        
        console.log(`Notification sent to ${notification.targetUserIds.length} specific users`);
        return;
      }
      
      // Otherwise broadcast to all connected clients
      // Add UID to data for event-related notifications if not already there
      if (notification.type === 'event' && notification.uid && !notification.data.uid) {
        notification.data.uid = notification.uid;
      }
      
      this.wsHandler.broadcast(JSON.stringify(notification));
      console.log('Notification broadcast to all connected users');
    } catch (error) {
      console.error('Error sending WebSocket notification:', error);
    }
  }

  /**
   * Send an event notification
   */
  public sendEventNotification(action: 'created' | 'updated' | 'deleted', data: any, targetUserIds?: number[], sourceUserId?: number): void {
    // Extract UID from data if available
    const uid = data.uid || '';
    
    this.sendNotification({
      type: 'event',
      action,
      timestamp: Date.now(),
      data,
      sourceUserId,
      targetUserIds,
      uid
    });
  }

  /**
   * Send a calendar notification
   */
  public sendCalendarNotification(action: 'created' | 'updated' | 'deleted', data: any, targetUserIds?: number[], sourceUserId?: number): void {
    this.sendNotification({
      type: 'calendar',
      action,
      timestamp: Date.now(),
      data,
      sourceUserId,
      targetUserIds
    });
  }

  /**
   * Send an attendee status change notification
   */
  public sendAttendeeStatusNotification(eventData: any, attendee: { email: string, status: string, name?: string }, targetUserIds?: number[]): void {
    // Extract UID from data if available
    const uid = eventData.uid || '';
    
    this.sendNotification({
      type: 'attendee',
      action: 'status-change',
      timestamp: Date.now(),
      data: {
        event: eventData,
        attendee
      },
      targetUserIds,
      uid
    });
  }

  /**
   * Send an email status notification
   */
  public sendEmailNotification(action: 'created' | 'error', eventData: any, emailStatus: any, targetUserIds?: number[]): void {
    // Extract UID from data if available
    const uid = eventData.uid || '';
    
    this.sendNotification({
      type: 'email',
      action,
      timestamp: Date.now(),
      data: {
        event: eventData,
        emailStatus
      },
      targetUserIds,
      uid
    });
  }

  /**
   * Send a system notification
   */
  public sendSystemNotification(action: 'info' | 'error', message: string, targetUserIds?: number[]): void {
    this.sendNotification({
      type: 'system',
      action,
      timestamp: Date.now(),
      data: { message },
      targetUserIds
    });
  }
}

// Create and export a convenience function to get the notification service
export function getWebSocketNotificationService(wsHandler: WebSocketHandler): WebSocketNotificationService {
  return WebSocketNotificationService.getInstance(wsHandler);
}