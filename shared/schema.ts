import { pgTable, text, serial, integer, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // Keep username for CalDAV server compatibility
  email: text("email").notNull().unique(), // Add email for app login
  password: text("password").notNull(),
  preferredTimezone: text("preferred_timezone").default("UTC"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
  preferredTimezone: true,
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
  permissionLevel: text("permission_level").notNull(), // 'view' or 'edit'
  createdAt: timestamp("created_at").defaultNow(),
  lastModified: timestamp("last_modified").defaultNow(),
});

export const insertCalendarSharingSchema = createInsertSchema(calendarSharing).pick({
  calendarId: true,
  sharedWithEmail: true,
  sharedWithUserId: true,
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
  attendees: json("attendees"), // JSON array of attendees with email, name, role, status
  resources: json("resources"), // JSON array of resource names/emails
  busyStatus: text("busy_status").default("busy"), // busy, free, tentative, or cancelled
  etag: text("etag"), // CalDAV ETag for sync
  url: text("url"), // CalDAV event URL
  rawData: json("raw_data"), // Store the raw CalDAV data
  syncStatus: text("sync_status").default("local").notNull(), // Values: 'local', 'synced', 'sync_failed', 'syncing'
  syncError: text("sync_error"), // Error message if sync failed
  lastSyncAttempt: timestamp("last_sync_attempt"), // When we last tried to sync
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
  attendees: true,
  resources: true,
  busyStatus: true,
  etag: true,
  url: true,
  rawData: true,
  syncStatus: true,
  syncError: true,
  lastSyncAttempt: true,
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

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
