import { Notification, NotificationFilter, notificationTypeEnum } from '../shared/schema';
import { storage } from './memory-storage';

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
      additionalData: reason ? JSON.stringify({ reason }) : undefined,
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
   * Get notifications for a user
   */
  async getNotifications(filter: NotificationFilter): Promise<Notification[]> {
    const { userId, limit = 50, offset = 0 } = filter;
    
    if (userId === undefined) {
      return [];
    }
    
    return storage.getNotifications(userId, limit);
  }

  /**
   * Get a notification by ID
   */
  async getNotification(id: number): Promise<Notification | undefined> {
    const allNotifications = await storage.getAllNotifications();
    return allNotifications.find(n => n.id === id);
  }

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId: number): Promise<number> {
    const count = await storage.getUnreadNotificationCount(userId);
    return count;
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
    const notification = await this.getNotification(id);
    
    if (!notification) return false;
    
    // We don't have a direct "dismiss" method in our storage interface,
    // so we'll update the notification with isDismissed = true
    notification.isDismissed = true;
    
    // Since memory-storage doesn't have an update method for notifications,
    // we'll delete and recreate
    await storage.deleteNotification(id);
    await storage.createNotification(notification);
    
    return true;
  }

  /**
   * Mark action taken on a notification
   */
  async markActionTaken(id: number): Promise<boolean> {
    const notification = await this.getNotification(id);
    
    if (!notification) return false;
    
    // Update the notification
    notification.actionTaken = true;
    notification.requiresAction = false;
    
    // Since memory-storage doesn't have an update method for notifications,
    // we'll delete and recreate
    await storage.deleteNotification(id);
    await storage.createNotification(notification);
    
    return true;
  }
}

// Export singleton instance
export const notificationService = new MemoryNotificationService();