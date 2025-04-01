import { pgTable, text, serial, integer, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema (keeping the existing one)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Calendar schema
export const calendars = pgTable("calendars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  userId: integer("user_id").notNull(),
  url: text("caldav_url"),
  syncToken: text("sync_token"),
  enabled: boolean("enabled").default(true),
});

export const insertCalendarSchema = createInsertSchema(calendars).pick({
  name: true,
  color: true,
  userId: true,
  url: true,
  enabled: true,
});

export type InsertCalendar = z.infer<typeof insertCalendarSchema>;
export type Calendar = typeof calendars.$inferSelect;

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
  etag: text("etag"), // CalDAV ETag for sync
  url: text("url"), // CalDAV event URL
  rawData: json("raw_data"), // Store the raw CalDAV data
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
  etag: true,
  url: true,
  rawData: true,
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
});

export type InsertServerConnection = z.infer<typeof insertServerConnectionSchema>;
export type ServerConnection = typeof serverConnections.$inferSelect;
