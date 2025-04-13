import { db } from './db';
import { InsertNotification, Notification, NotificationFilter, notifications, notificationTypeEnum } from '../shared/schema';
import { and, desc, eq, isNull, lt, gte, ne, or, sql } from 'drizzle-orm';

/**
 * Notification Service
 * 
 * Handles creating, retrieving, and managing notifications
 */
export class NotificationService {
  /**
   * Create a new notification
   */
  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [result] = await db.insert(notifications).values(notification).returning();
    return result;
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
    });
  }

  /**
   * Create event reminder notification
   */
  async createEventReminderNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    minutesUntilStart: number
  ): Promise<Notification> {
    const timeText = minutesUntilStart <= 60 
      ? `${minutesUntilStart} minutes` 
      : `${Math.floor(minutesUntilStart / 60)} hours`;

    return this.createNotification({
      userId,
      type: 'event_reminder',
      title: 'Upcoming Event',
      message: `Your event "${eventTitle}" starts in ${timeText}`,
      priority: 'high',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      requiresAction: false,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
    });
  }

  /**
   * Create resource confirmation notification
   */
  async createResourceConfirmationNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    resourceName: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: 'resource_confirmed',
      title: 'Resource Confirmed',
      message: `Resource "${resourceName}" confirmed for "${eventTitle}"`,
      priority: 'low',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      requiresAction: false,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
    });
  }

  /**
   * Create resource denial notification
   */
  async createResourceDenialNotification(
    userId: number,
    eventId: number,
    eventUid: string,
    eventTitle: string,
    resourceName: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: 'resource_denied',
      title: 'Resource Unavailable',
      message: `Resource "${resourceName}" is unavailable for "${eventTitle}"`,
      priority: 'medium',
      relatedEventId: eventId,
      relatedEventUid: eventUid,
      requiresAction: true,
      isRead: false,
      isDismissed: false,
      actionTaken: false,
    });
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(filter: NotificationFilter): Promise<Notification[]> {
    const { userId, unreadOnly, requiresActionOnly, type, priority, relatedEventId, relatedEventUid, limit = 50, offset = 0 } = filter;
    
    const conditions = [];
    
    if (userId !== undefined) {
      conditions.push(eq(notifications.userId, userId));
    }
    
    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }
    
    if (requiresActionOnly) {
      conditions.push(eq(notifications.requiresAction, true));
    }
    
    if (type !== undefined) {
      if (Array.isArray(type)) {
        conditions.push(sql`${notifications.type} IN (${sql.join(type, sql`, `)})`);
      } else {
        conditions.push(eq(notifications.type, type));
      }
    }
    
    if (priority !== undefined) {
      conditions.push(eq(notifications.priority, priority));
    }
    
    if (relatedEventId !== undefined) {
      conditions.push(eq(notifications.relatedEventId, relatedEventId));
    }
    
    if (relatedEventUid !== undefined) {
      conditions.push(eq(notifications.relatedEventUid, relatedEventUid));
    }
    
    // Add condition to exclude dismissed notifications unless explicitly requested
    if (!filter.hasOwnProperty('isDismissed')) {
      conditions.push(eq(notifications.isDismissed, false));
    }

    const query = conditions.length > 0
      ? db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset)
      : db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset);

    return await query;
  }

  /**
   * Get a notification by ID
   */
  async getNotification(id: number): Promise<Notification | undefined> {
    const results = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    return results.length > 0 ? results[0] : undefined;
  }

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isDismissed, false)
        )
      );
    
    return result[0]?.count || 0;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: number): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    
    return result.length > 0;
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(ids: number[]): Promise<boolean> {
    if (ids.length === 0) return false;
    
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(sql`${notifications.id} IN (${sql.join(ids, sql`, `)})`)
      .returning({ id: notifications.id });
    
    return result.length > 0;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: number): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false)
        )
      )
      .returning({ id: notifications.id });
    
    return result.length > 0;
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(id: number): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ isDismissed: true })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    
    return result.length > 0;
  }

  /**
   * Mark action taken on a notification
   */
  async markActionTaken(id: number): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ actionTaken: true, requiresAction: false })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    
    return result.length > 0;
  }

  /**
   * Delete old notifications
   * Removes notifications older than the specified number of days
   */
  async cleanupOldNotifications(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoffDate))
      .returning({ id: notifications.id });
    
    return result.length;
  }

  /**
   * Delete notifications for an event
   */
  async deleteNotificationsForEvent(eventId: number): Promise<number> {
    const result = await db
      .delete(notifications)
      .where(eq(notifications.relatedEventId, eventId))
      .returning({ id: notifications.id });
    
    return result.length;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();