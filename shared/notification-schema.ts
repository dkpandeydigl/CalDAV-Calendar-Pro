import { pgEnum, pgTable, serial, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

/**
 * Notification Types Enum
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'event_invitation',       // New event invitation
  'event_update',           // Event details were updated
  'event_cancellation',     // Event was cancelled
  'attendee_response',      // Attendee responded to an event
  'event_reminder',         // Upcoming event reminder
  'invitation_accepted',    // Event invitation was accepted
  'invitation_declined',    // Event invitation was declined
  'invitation_tentative',   // Event invitation response is tentative
  'comment_added',          // Someone commented on an event
  'resource_confirmed',     // Resource was confirmed
  'resource_denied',        // Resource request was denied
  'system_message'          // System notification
]);

/**
 * Notification Priority Enum
 */
export const notificationPriorityEnum = pgEnum('notification_priority', [
  'low',
  'medium',
  'high'
]);

/**
 * Notifications Table Schema
 */
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  priority: notificationPriorityEnum('priority').default('medium').notNull(),
  relatedEventId: integer('related_event_id'),
  relatedEventUid: text('related_event_uid'),
  relatedUserId: integer('related_user_id'),
  relatedUserName: text('related_user_name'),
  relatedUserEmail: text('related_user_email'),
  additionalData: text('additional_data'), // JSON string for any extra data
  isRead: boolean('is_read').default(false).notNull(),
  isDismissed: boolean('is_dismissed').default(false).notNull(),
  requiresAction: boolean('requires_action').default(false).notNull(),
  actionTaken: boolean('action_taken').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at')
});

/**
 * Notification Insert Schema
 */
export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true });

/**
 * Notification Insert Type
 */
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

/**
 * Notification Select Type
 */
export type Notification = typeof notifications.$inferSelect;

/**
 * Filter schema for notifications
 */
export const notificationFilterSchema = z.object({
  userId: z.number().optional(),
  unreadOnly: z.boolean().optional(),
  requiresActionOnly: z.boolean().optional(),
  type: z.union([
    z.nativeEnum(notificationTypeEnum),
    z.array(z.nativeEnum(notificationTypeEnum))
  ]).optional(),
  priority: z.nativeEnum(notificationPriorityEnum).optional(),
  relatedEventId: z.number().optional(),
  relatedEventUid: z.string().optional(),
  limit: z.number().min(1).max(100).default(50).optional(),
  offset: z.number().min(0).default(0).optional(),
});

export type NotificationFilter = z.infer<typeof notificationFilterSchema>;