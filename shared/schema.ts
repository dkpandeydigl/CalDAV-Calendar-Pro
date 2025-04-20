import { pgTable, text, serial, integer, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import notification schema
import { 
  notifications, 
  insertNotificationSchema, 
  notificationTypeEnum, 
  notificationPriorityEnum, 
  notificationFilterSchema
} from './notification-schema';

// User schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  preferredTimezone: text("preferred_timezone").default("UTC"),
  email: text("email"),
  fullName: text("full_name"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  preferredTimezone: true,
  email: true,
  fullName: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Calendar schema
export const calendars = pgTable("calendars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  userId: integer("user_id").notNull(), // Owner of the calendar
  url: text("caldav_url"),
  syncToken: text("sync_token"),
  enabled: boolean("enabled").default(true),
  isPrimary: boolean("is_primary").default(false), // Is this a primary calendar (can't be deleted)
  isLocal: boolean("is_local").default(false), // Calendar created locally (not from CalDAV)
  description: text("description"),
});

export const insertCalendarSchema = createInsertSchema(calendars).pick({
  name: true,
  color: true,
  userId: true,
  url: true,
  syncToken: true,
  enabled: true,
  isPrimary: true,
  isLocal: true,
  description: true,
});

// Create a validation schema for calendar names
export const calendarNameSchema = z.string()
  .min(1, "Calendar name is required")
  .max(50, "Calendar name is too long")
  .regex(/^[A-Za-z0-9_\-\.]+$/, "Only letters, digits, underscores, hyphens, and periods are allowed");

export type InsertCalendar = z.infer<typeof insertCalendarSchema>;
export type Calendar = typeof calendars.$inferSelect;

// Calendar sharing permissions
export const calendarSharing = pgTable("calendar_sharing", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull(),
  sharedWithEmail: text("shared_with_email").notNull(), // Email of the user the calendar is shared with
  sharedWithUserId: integer("shared_with_user_id"), // User ID if the email corresponds to a registered user
  sharedByUserId: integer("shared_by_user_id").notNull(), // User ID of the calendar owner who shared it
  permissionLevel: text("permission_level").notNull(), // 'view' or 'edit'
  createdAt: timestamp("created_at").defaultNow(),
  lastModified: timestamp("last_modified").defaultNow(),
});

export const insertCalendarSharingSchema = createInsertSchema(calendarSharing).pick({
  calendarId: true,
  sharedWithEmail: true,
  sharedWithUserId: true,
  sharedByUserId: true,
  permissionLevel: true,
});

export type InsertCalendarSharing = z.infer<typeof insertCalendarSharingSchema>;
export type CalendarSharing = typeof calendarSharing.$inferSelect;

// Event schema
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(), // CalDAV UID
  calendarId: integer("calendar_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  allDay: boolean("all_day").default(false),
  timezone: text("timezone").default("UTC"),
  recurrenceRule: text("recurrence_rule"),
  isRecurring: boolean("is_recurring").default(false), // Flag to quickly identify recurring events
  attendees: json("attendees"), // JSON array of attendees with email, name, role, status
  resources: json("resources"), // JSON array of resource names/emails
  busyStatus: text("busy_status").default("busy"), // busy, free, tentative, or cancelled
  etag: text("etag"), // CalDAV ETag for sync
  url: text("url"), // CalDAV event URL
  rawData: json("raw_data"), // Store the raw CalDAV data
  syncStatus: text("sync_status").default("local").notNull(), // Values: 'local', 'synced', 'sync_failed', 'syncing', 'pending', 'needs_sync', 'error'
  syncError: text("sync_error"), // Error message if sync failed
  lastSyncAttempt: timestamp("last_sync_attempt"), // When we last tried to sync
  emailSent: text("email_sent"), // Values: 'sent', 'failed', 'not_sent', null (if no attendees)
  emailError: text("email_error"), // Error message if email sending failed
  lastModifiedBy: integer("last_modified_by"), // User ID who last modified the event
  lastModifiedByName: text("last_modified_by_name"), // Username or email of user who last modified (for display)
  lastModifiedAt: timestamp("last_modified_at").defaultNow(), // Timestamp of last modification
});

export const insertEventSchema = createInsertSchema(events).pick({
  uid: true,
  calendarId: true, 
  title: true,
  description: true,
  location: true,
  startDate: true,
  endDate: true,
  allDay: true,
  timezone: true,
  recurrenceRule: true,
  isRecurring: true,
  attendees: true,
  resources: true,
  busyStatus: true,
  etag: true,
  url: true,
  rawData: true,
  syncStatus: true,
  syncError: true,
  lastSyncAttempt: true,
  emailSent: true,
  emailError: true,
  lastModifiedBy: true,
  lastModifiedByName: true,
  lastModifiedAt: true,
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;
export type CalendarEvent = typeof events.$inferSelect;

/**
 * RFC 5545 compliant interface for a calendar event
 * Used for better type safety when handling events in the application
 */
export interface ICalendarEvent {
  id?: number;
  uid: string;
  calendarId: number;
  title: string;
  description?: string | null;
  location?: string | null;
  startDate: Date;
  endDate: Date;
  allDay?: boolean | null;
  timezone?: string | null;
  recurrenceRule?: string | null;
  isRecurring?: boolean | null;
  attendees?: any[] | null;
  resources?: any[] | null;
  busyStatus?: string | null;
  etag?: string | null;
  url?: string | null;
  rawData?: any | null;
  syncStatus?: string;
  syncError?: string | null;
  lastSyncAttempt?: Date | null;
  emailSent?: string | null;
  emailError?: string | null;
  lastModifiedBy?: number | null;
  lastModifiedByName?: string | null;
  lastModifiedAt?: Date | null;
  /**
   * Runtime flag to indicate if this event is a copy of another event.
   * This is not stored in the database, only used during event creation.
   */
  isCopy?: boolean;
}

/**
 * For creating new RFC 5545 compliant events
 */
export interface ICalendarEventCreate {
  calendarId: number;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
  timezone?: string;
  uid?: string;
  attendees?: any[];
  resources?: any[];
  syncStatus?: string;
  status?: string;
}

// CalDAV server connection settings
export const serverConnections = pgTable("server_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  url: text("url").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  autoSync: boolean("auto_sync").default(true),
  syncInterval: integer("sync_interval").default(15), // in minutes
  lastSync: timestamp("last_sync"),
  status: text("status").default("disconnected"),
});

export const insertServerConnectionSchema = createInsertSchema(serverConnections).pick({
  userId: true,
  url: true,
  username: true,
  password: true,
  autoSync: true,
  syncInterval: true,
  lastSync: true,
  status: true,
});

export type InsertServerConnection = z.infer<typeof insertServerConnectionSchema>;
export type ServerConnection = typeof serverConnections.$inferSelect;

// SMTP configuration for sending event invitations
export const smtpConfigurations = pgTable("smtp_configurations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  secure: boolean("secure").default(true),
  username: text("username").notNull(),
  password: text("password").notNull(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  lastModified: timestamp("last_modified").defaultNow(),
});

export const insertSmtpConfigSchema = createInsertSchema(smtpConfigurations).pick({
  userId: true,
  host: true,
  port: true,
  secure: true,
  username: true,
  password: true,
  fromEmail: true,
  fromName: true,
  enabled: true,
});

export type InsertSmtpConfig = z.infer<typeof insertSmtpConfigSchema>;
export type SmtpConfig = typeof smtpConfigurations.$inferSelect;

// Deleted Events schema - for permanent tracking of deleted events
export const deletedEvents = pgTable("deleted_events", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id"),  // Original event ID if available
  uid: text("uid").notNull(),    // Event UID - primary identifier for syncing
  url: text("url"),              // CalDAV URL if available
  etag: text("etag"),            // Last known ETag
  calendarId: integer("calendar_id").notNull(),
  userId: integer("user_id").notNull(),
  deletedAt: timestamp("deleted_at").notNull().defaultNow(),
  data: json("data"),            // Additional info about the deleted event
});

export const insertDeletedEventSchema = createInsertSchema(deletedEvents).pick({
  eventId: true,
  uid: true,
  url: true,
  etag: true,
  calendarId: true,
  userId: true,
  data: true
});

export type InsertDeletedEvent = z.infer<typeof insertDeletedEventSchema>;
export type DeletedEvent = typeof deletedEvents.$inferSelect;

// Re-export notification schema
export {
  notifications,
  insertNotificationSchema,
  notificationTypeEnum,
  notificationPriorityEnum,
  notificationFilterSchema
} from './notification-schema';
export type { InsertNotification, Notification, NotificationFilter } from './notification-schema';
