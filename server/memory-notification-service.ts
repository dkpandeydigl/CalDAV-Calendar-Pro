import { Notification, NotificationFilter, notificationTypeEnum } from '../shared/schema';
import { storage } from './storage';

/**
 * Memory Notification Service
 * 
 * Handles creating, retrieving, and managing notifications using in-memory storage
 */
export class MemoryNotificationService {
  /**
   * Create a new notification
   */
  async createNotification(notification: any): Promise<Notification> {
    return storage.createNotification(notification);
  }

  /**
   * Create event invitation notification
   */
  async createEventInvitationNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    fromUserId: number,
    fromUserName: string,
    fromUserEmail: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: 'event_invitation',
      title: 'New Event Invitation',
      message: `${fromUserName} invited you to "${eventTitle}"`,
      priority: 'medium',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      relatedUserId: fromUserId,
      relatedUserName: fromUserName,
      relatedUserEmail: fromUserEmail,
      requiresAction: true,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
      createdAt: new Date()
    });
  }

  /**
   * Create event update notification
   */
  async createEventUpdateNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    fromUserId: number,
    fromUserName: string,
    fromUserEmail: string,
    changesSummary: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: 'event_update',
      title: 'Event Updated',
      message: `${fromUserName} updated "${eventTitle}"`,
      priority: 'medium',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      relatedUserId: fromUserId,
      relatedUserName: fromUserName,
      relatedUserEmail: fromUserEmail,
      additionalData: JSON.stringify({ changesSummary }),
      requiresAction: false,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
      createdAt: new Date()
    });
  }

  /**
   * Create event cancellation notification
   */
  async createEventCancellationNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    fromUserId: number,
    fromUserName: string,
    fromUserEmail: string,
    reason?: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: 'event_cancellation',
      title: 'Event Cancelled',
      message: `${fromUserName} cancelled "${eventTitle}"`,
      priority: 'high',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      relatedUserId: fromUserId,
      relatedUserName: fromUserName,
      relatedUserEmail: fromUserEmail,
      additionalData: reason ? JSON.stringify({ reason }) : null,
      requiresAction: false,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
      createdAt: new Date()
    });
  }

  /**
   * Create attendee response notification
   */
  async createAttendeeResponseNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    attendeeId: number,
    attendeeName: string,
    attendeeEmail: string,
    response: 'accepted' | 'declined' | 'tentative'
  ): Promise<Notification> {
    const notificationType = response === 'accepted' 
      ? 'invitation_accepted' 
      : response === 'declined' 
        ? 'invitation_declined' 
        : 'invitation_tentative';
    
    const messagePrefix = response === 'accepted' 
      ? 'accepted' 
      : response === 'declined' 
        ? 'declined' 
        : 'tentatively accepted';

    return this.createNotification({
      userId,
      type: notificationType,
      title: 'Invitation Response',
      message: `${attendeeName} ${messagePrefix} your invitation to "${eventTitle}"`,
      priority: 'medium',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      relatedUserId: attendeeId,
      relatedUserName: attendeeName,
      relatedUserEmail: attendeeEmail,
      requiresAction: false,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
      createdAt: new Date()
    });
  }

  /**
   * Get notifications for a user with filtering
   */
  async getNotifications(filter: NotificationFilter): Promise<Notification[]> {
    const { userId, unreadOnly, requiresActionOnly, type, priority, relatedEventId, relatedEventUid, limit = 50, offset = 0 } = filter;
    
    // Get all notifications for this user
    let notifications = await storage.getNotifications(userId ?? -1);
    
    // Apply filters
    if (unreadOnly) {
      notifications = notifications.filter(notification => !notification.isRead);
    }
    
    if (requiresActionOnly) {
      notifications = notifications.filter(notification => notification.requiresAction);
    }
    
    if (type !== undefined) {
      if (Array.isArray(type)) {
        notifications = notifications.filter(notification => type.includes(notification.type));
      } else {
        notifications = notifications.filter(notification => notification.type === type);
      }
    }
    
    if (priority !== undefined) {
      notifications = notifications.filter(notification => notification.priority === priority);
    }
    
    if (relatedEventId !== undefined) {
      notifications = notifications.filter(notification => notification.relatedEventId === relatedEventId);
    }
    
    if (relatedEventUid !== undefined) {
      notifications = notifications.filter(notification => notification.relatedEventUid === relatedEventUid);
    }
    
    // Don't show dismissed notifications unless explicitly requested
    if (!filter.hasOwnProperty('isDismissed')) {
      notifications = notifications.filter(notification => !notification.isDismissed);
    }
    
    // Apply sorting (newest first)
    notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    // Apply pagination
    return notifications.slice(offset, offset + limit);
  }

  /**
   * Get a notification by ID
   */
  async getNotification(id: number): Promise<Notification | undefined> {
    const notifications = await storage.getAllNotifications();
    return notifications.find(notification => notification.id === id);
  }

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId: number): Promise<number> {
    return storage.getUnreadNotificationCount(userId);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: number): Promise<boolean> {
    return storage.markNotificationRead(id);
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(ids: number[]): Promise<boolean> {
    let success = true;
    for (const id of ids) {
      const result = await storage.markNotificationRead(id);
      if (!result) success = false;
    }
    return success;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: number): Promise<boolean> {
    return storage.markAllNotificationsRead(userId);
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(id: number): Promise<boolean> {
    const notification = (await storage.getNotifications(-1))
      .find(notification => notification.id === id);
    
    if (!notification) return false;
    
    notification.isDismissed = true;
    return true;
  }

  /**
   * Mark action taken on a notification
   */
  async markActionTaken(id: number): Promise<boolean> {
    const notification = (await storage.getNotifications(-1))
      .find(notification => notification.id === id);
    
    if (!notification) return false;
    
    notification.actionTaken = true;
    notification.requiresAction = false;
    return true;
  }

  /**
   * Delete old notifications
   * Removes notifications older than the specified number of days
   */
  async cleanupOldNotifications(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let deletedCount = 0;
    const notifications = await storage.getNotifications(-1);
    
    for (const notification of notifications) {
      if (notification.createdAt < cutoffDate) {
        const success = await storage.deleteNotification(notification.id);
        if (success) deletedCount++;
      }
    }
    
    return deletedCount;
  }

  /**
   * Delete notifications for an event
   */
  async deleteNotificationsForEvent(eventId: number): Promise<number> {
    let deletedCount = 0;
    const notifications = await storage.getNotifications(-1);
    
    for (const notification of notifications) {
      if (notification.relatedEventId === eventId) {
        const success = await storage.deleteNotification(notification.id);
        if (success) deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

// Export singleton instance
export const notificationService = new MemoryNotificationService();