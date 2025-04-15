/**
 * IndexedDB Service
 * 
 * This module provides a wrapper around IndexedDB for the application.
 * It handles database initialization, schema upgrades, and provides
 * CRUD operations for all entity types.
 */

import { openDB, IDBPDatabase, DBSchema } from 'idb';
import { 
  Calendar, Event, User, ServerConnection, 
  CalendarSharing, SmtpConfig, Notification
} from '@shared/schema';

// Database schema definition for IndexedDB
interface CalendarAppDB extends DBSchema {
  users: {
    key: number;
    value: User;
    indexes: {
      'by-username': string;
      'by-email': string;
    };
  };
  calendars: {
    key: number;
    value: Calendar;
    indexes: {
      'by-userId': number;
    };
  };
  events: {
    key: number;
    value: Event;
    indexes: {
      'by-calendarId': number;
      'by-uid': string;
    };
  };
  serverConnections: {
    key: number;
    value: ServerConnection;
    indexes: {
      'by-userId': number;
    };
  };
  calendarSharings: {
    key: number;
    value: CalendarSharing;
    indexes: {
      'by-calendarId': number;
      'by-sharedWithEmail': string;
      'by-sharedWithUserId': number;
    };
  };
  smtpConfigs: {
    key: number;
    value: SmtpConfig;
    indexes: {
      'by-userId': number;
    };
  };
  notifications: {
    key: number;
    value: Notification;
    indexes: {
      'by-userId': number;
      'by-read': boolean;
    };
  };
  syncState: {
    key: string;
    value: {
      lastSync: Date;
      syncToken: string | null;
    };
  };
}

// Database version
const DB_VERSION = 1;
const DB_NAME = 'calendar-app-db';

// Class to manage database operations
class IndexedDBService {
  private db: Promise<IDBPDatabase<CalendarAppDB>>;
  private static instance: IndexedDBService;

  private constructor() {
    this.db = this.initDatabase();
  }

  // Get singleton instance
  public static getInstance(): IndexedDBService {
    if (!IndexedDBService.instance) {
      IndexedDBService.instance = new IndexedDBService();
    }
    return IndexedDBService.instance;
  }

  // Initialize the database
  private async initDatabase(): Promise<IDBPDatabase<CalendarAppDB>> {
    console.log('Initializing IndexedDB database...');
    return openDB<CalendarAppDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        console.log(`Upgrading IndexedDB to version ${DB_VERSION}`);
        
        // Create users store
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('by-username', 'username', { unique: true });
          userStore.createIndex('by-email', 'email', { unique: false });
        }
        
        // Create calendars store
        if (!db.objectStoreNames.contains('calendars')) {
          const calendarStore = db.createObjectStore('calendars', { keyPath: 'id' });
          calendarStore.createIndex('by-userId', 'userId', { unique: false });
        }
        
        // Create events store
        if (!db.objectStoreNames.contains('events')) {
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('by-calendarId', 'calendarId', { unique: false });
          eventStore.createIndex('by-uid', 'uid', { unique: true });
        }
        
        // Create server connections store
        if (!db.objectStoreNames.contains('serverConnections')) {
          const connStore = db.createObjectStore('serverConnections', { keyPath: 'id' });
          connStore.createIndex('by-userId', 'userId', { unique: false });
        }
        
        // Create calendar sharing store
        if (!db.objectStoreNames.contains('calendarSharings')) {
          const sharingStore = db.createObjectStore('calendarSharings', { keyPath: 'id' });
          sharingStore.createIndex('by-calendarId', 'calendarId', { unique: false });
          sharingStore.createIndex('by-sharedWithEmail', 'sharedWithEmail', { unique: false });
          sharingStore.createIndex('by-sharedWithUserId', 'sharedWithUserId', { unique: false });
        }
        
        // Create SMTP config store
        if (!db.objectStoreNames.contains('smtpConfigs')) {
          const smtpStore = db.createObjectStore('smtpConfigs', { keyPath: 'id' });
          smtpStore.createIndex('by-userId', 'userId', { unique: false });
        }
        
        // Create notifications store
        if (!db.objectStoreNames.contains('notifications')) {
          const notifStore = db.createObjectStore('notifications', { keyPath: 'id' });
          notifStore.createIndex('by-userId', 'userId', { unique: false });
          notifStore.createIndex('by-read', 'read', { unique: false });
        }
        
        // Create sync state store
        if (!db.objectStoreNames.contains('syncState')) {
          db.createObjectStore('syncState', { keyPath: 'key' });
        }
        
        console.log('IndexedDB upgrade complete');
      },
      blocked() {
        console.warn('IndexedDB upgrade blocked - older version is open in another tab');
      },
      blocking() {
        console.warn('IndexedDB upgrade is blocking a newer version');
      },
      terminated() {
        console.error('IndexedDB connection terminated unexpectedly');
      },
    });
  }

  // Get all users
  async getAllUsers(): Promise<User[]> {
    return (await this.db).getAll('users');
  }

  // Get user by ID
  async getUser(id: number): Promise<User | undefined> {
    return (await this.db).get('users', id);
  }

  // Get user by username
  async getUserByUsername(username: string): Promise<User | undefined> {
    return (await this.db).getFromIndex('users', 'by-username', username);
  }

  // Create user
  async createUser(user: User): Promise<User> {
    // Generate ID if not present
    if (!user.id) {
      user.id = Date.now();
    }
    await (await this.db).put('users', user);
    return user;
  }

  // Update user
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    const db = await this.db;
    const user = await db.get('users', id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...userData };
    await db.put('users', updatedUser);
    return updatedUser;
  }

  // Delete user
  async deleteUser(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('users', id);
      return true;
    } catch (error) {
      console.error('Error deleting user:', error);
      return false;
    }
  }

  // Get calendars by user ID
  async getCalendars(userId: number): Promise<Calendar[]> {
    return (await this.db).getAllFromIndex('calendars', 'by-userId', userId);
  }

  // Get calendar by ID
  async getCalendar(id: number): Promise<Calendar | undefined> {
    return (await this.db).get('calendars', id);
  }

  // Create calendar
  async createCalendar(calendar: Calendar): Promise<Calendar> {
    // Generate ID if not present
    if (!calendar.id) {
      calendar.id = Date.now();
    }
    await (await this.db).put('calendars', calendar);
    return calendar;
  }

  // Update calendar
  async updateCalendar(id: number, calendarData: Partial<Calendar>): Promise<Calendar | undefined> {
    const db = await this.db;
    const calendar = await db.get('calendars', id);
    if (!calendar) return undefined;
    
    const updatedCalendar = { ...calendar, ...calendarData };
    await db.put('calendars', updatedCalendar);
    return updatedCalendar;
  }

  // Delete calendar
  async deleteCalendar(id: number): Promise<{success: boolean, error?: string, details?: any}> {
    try {
      const db = await this.db;
      
      // Get events for this calendar
      const events = await db.getAllFromIndex('events', 'by-calendarId', id);
      
      // Delete all events
      for (const event of events) {
        await db.delete('events', event.id);
      }
      
      // Get sharing records for this calendar
      const sharings = await db.getAllFromIndex('calendarSharings', 'by-calendarId', id);
      
      // Delete all sharing records
      for (const sharing of sharings) {
        await db.delete('calendarSharings', sharing.id);
      }
      
      // Delete the calendar
      await db.delete('calendars', id);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting calendar:', error);
      return { 
        success: false, 
        error: 'Error deleting calendar', 
        details: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  // Get events by calendar ID
  async getEvents(calendarId: number): Promise<Event[]> {
    return (await this.db).getAllFromIndex('events', 'by-calendarId', calendarId);
  }

  // Get event by ID
  async getEvent(id: number): Promise<Event | undefined> {
    return (await this.db).get('events', id);
  }

  // Get event by UID
  async getEventByUID(uid: string): Promise<Event | undefined> {
    return (await this.db).getFromIndex('events', 'by-uid', uid);
  }

  // Create event
  async createEvent(event: Event): Promise<Event> {
    // Generate ID if not present
    if (!event.id) {
      event.id = Date.now();
    }
    await (await this.db).put('events', event);
    return event;
  }

  // Update event
  async updateEvent(id: number, eventData: Partial<Event>): Promise<Event | undefined> {
    const db = await this.db;
    const event = await db.get('events', id);
    if (!event) return undefined;
    
    const updatedEvent = { ...event, ...eventData };
    await db.put('events', updatedEvent);
    return updatedEvent;
  }

  // Delete event
  async deleteEvent(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('events', id);
      return true;
    } catch (error) {
      console.error('Error deleting event:', error);
      return false;
    }
  }

  // Delete events by calendar ID
  async deleteEventsByCalendarId(calendarId: number): Promise<boolean> {
    try {
      const db = await this.db;
      const events = await db.getAllFromIndex('events', 'by-calendarId', calendarId);
      
      for (const event of events) {
        await db.delete('events', event.id);
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting events by calendar ID:', error);
      return false;
    }
  }

  // Get server connection by user ID
  async getServerConnection(userId: number): Promise<ServerConnection | undefined> {
    const connections = await (await this.db).getAllFromIndex('serverConnections', 'by-userId', userId);
    return connections.length > 0 ? connections[0] : undefined;
  }

  // Get server connection by username (requires fetching user first)
  async getServerConnectionByUsername(username: string): Promise<ServerConnection | undefined> {
    const user = await this.getUserByUsername(username);
    if (!user) return undefined;
    
    return this.getServerConnection(user.id);
  }

  // Create server connection
  async createServerConnection(connection: ServerConnection): Promise<ServerConnection> {
    // Generate ID if not present
    if (!connection.id) {
      connection.id = Date.now();
    }
    await (await this.db).put('serverConnections', connection);
    return connection;
  }

  // Update server connection
  async updateServerConnection(id: number, connectionData: Partial<ServerConnection>): Promise<ServerConnection | undefined> {
    const db = await this.db;
    const connection = await db.get('serverConnections', id);
    if (!connection) return undefined;
    
    const updatedConnection = { ...connection, ...connectionData };
    await db.put('serverConnections', updatedConnection);
    return updatedConnection;
  }

  // Delete server connection
  async deleteServerConnection(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('serverConnections', id);
      return true;
    } catch (error) {
      console.error('Error deleting server connection:', error);
      return false;
    }
  }

  // Get calendar sharing by calendar ID
  async getCalendarSharing(calendarId: number): Promise<CalendarSharing[]> {
    return (await this.db).getAllFromIndex('calendarSharings', 'by-calendarId', calendarId);
  }

  // Get all calendar sharings
  async getAllCalendarSharings(): Promise<CalendarSharing[]> {
    return (await this.db).getAll('calendarSharings');
  }

  // Get shared calendars for a user
  async getSharedCalendars(userId: number): Promise<Calendar[]> {
    const db = await this.db;
    
    // Get user
    const user = await db.get('users', userId);
    if (!user) return [];
    
    // Try to find sharings by user ID first
    let sharings = await db.getAllFromIndex('calendarSharings', 'by-sharedWithUserId', userId);
    
    // If email is available, also check sharings by email
    if (user.email) {
      const emailSharings = await db.getAllFromIndex('calendarSharings', 'by-sharedWithEmail', user.email);
      sharings = [...sharings, ...emailSharings];
    }
    
    // Also check sharings by username (if username looks like an email)
    const usernameSharings = await db.getAllFromIndex('calendarSharings', 'by-sharedWithEmail', user.username);
    sharings = [...sharings, ...usernameSharings];
    
    // Remove duplicates (by ID)
    const uniqueSharings = Array.from(new Map(sharings.map(s => [s.id, s])).values());
    
    // Get the actual calendars
    const calendars: Calendar[] = [];
    for (const sharing of uniqueSharings) {
      const calendar = await db.get('calendars', sharing.calendarId);
      if (calendar) {
        // Add sharing metadata to calendar
        const calendarWithSharing = {
          ...calendar,
          permissionLevel: sharing.permissionLevel,
          owner: { userId: calendar.userId }
        };
        calendars.push(calendarWithSharing as Calendar);
      }
    }
    
    return calendars;
  }

  // Create calendar sharing
  async shareCalendar(sharing: CalendarSharing): Promise<CalendarSharing> {
    // Generate ID if not present
    if (!sharing.id) {
      sharing.id = Date.now();
    }
    
    // Try to find the user by email if sharedWithUserId is not set
    if (!sharing.sharedWithUserId && sharing.sharedWithEmail) {
      const user = await (await this.db).getFromIndex('users', 'by-email', sharing.sharedWithEmail);
      if (user) {
        sharing.sharedWithUserId = user.id;
      }
    }
    
    await (await this.db).put('calendarSharings', sharing);
    return sharing;
  }

  // Update calendar sharing
  async updateCalendarSharing(id: number, sharingData: Partial<CalendarSharing>): Promise<CalendarSharing | undefined> {
    const db = await this.db;
    const sharing = await db.get('calendarSharings', id);
    if (!sharing) return undefined;
    
    const updatedSharing = { ...sharing, ...sharingData };
    await db.put('calendarSharings', updatedSharing);
    return updatedSharing;
  }

  // Remove calendar sharing
  async removeCalendarSharing(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('calendarSharings', id);
      return true;
    } catch (error) {
      console.error('Error removing calendar sharing:', error);
      return false;
    }
  }

  // Get SMTP config by user ID
  async getSmtpConfig(userId: number): Promise<SmtpConfig | undefined> {
    const configs = await (await this.db).getAllFromIndex('smtpConfigs', 'by-userId', userId);
    return configs.length > 0 ? configs[0] : undefined;
  }

  // Create SMTP config
  async createSmtpConfig(config: SmtpConfig): Promise<SmtpConfig> {
    // Generate ID if not present
    if (!config.id) {
      config.id = Date.now();
    }
    await (await this.db).put('smtpConfigs', config);
    return config;
  }

  // Update SMTP config
  async updateSmtpConfig(id: number, configData: Partial<SmtpConfig>): Promise<SmtpConfig | undefined> {
    const db = await this.db;
    const config = await db.get('smtpConfigs', id);
    if (!config) return undefined;
    
    const updatedConfig = { ...config, ...configData };
    await db.put('smtpConfigs', updatedConfig);
    return updatedConfig;
  }

  // Delete SMTP config
  async deleteSmtpConfig(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('smtpConfigs', id);
      return true;
    } catch (error) {
      console.error('Error deleting SMTP config:', error);
      return false;
    }
  }

  // Create notification
  async createNotification(notification: Notification): Promise<Notification> {
    // Generate ID if not present
    if (!notification.id) {
      notification.id = Date.now();
    }
    await (await this.db).put('notifications', notification);
    return notification;
  }

  // Get notifications for a user
  async getNotifications(userId: number, limit: number = 50): Promise<Notification[]> {
    const db = await this.db;
    const tx = db.transaction('notifications', 'readonly');
    const index = tx.store.index('by-userId');
    
    const notifications: Notification[] = [];
    let cursor = await index.openCursor(userId);
    
    // Collect notifications
    while (cursor && notifications.length < limit) {
      notifications.push(cursor.value);
      cursor = await cursor.continue();
    }
    
    // Sort by creation time (newest first)
    return notifications.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Get unread notification count for a user
  async getUnreadNotificationCount(userId: number): Promise<number> {
    const db = await this.db;
    const tx = db.transaction('notifications', 'readonly');
    const userIndex = tx.store.index('by-userId');
    
    // Get all notifications for this user
    const userNotifications = await userIndex.getAll(userId);
    
    // Count unread notifications
    return userNotifications.filter(n => !n.read).length;
  }

  // Get unread notifications for a user
  async getUnreadNotifications(userId: number): Promise<Notification[]> {
    const db = await this.db;
    const tx = db.transaction('notifications', 'readonly');
    const userIndex = tx.store.index('by-userId');
    
    // Get all notifications for this user
    const userNotifications = await userIndex.getAll(userId);
    
    // Filter unread notifications and sort by creation time (newest first)
    return userNotifications
      .filter(n => !n.read)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Mark notification as read
  async markNotificationRead(id: number): Promise<boolean> {
    try {
      const db = await this.db;
      const notification = await db.get('notifications', id);
      if (!notification) return false;
      
      notification.read = true;
      await db.put('notifications', notification);
      return true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
  }

  // Mark all notifications as read for a user
  async markAllNotificationsRead(userId: number): Promise<boolean> {
    try {
      const db = await this.db;
      const notifications = await db.getAllFromIndex('notifications', 'by-userId', userId);
      
      for (const notification of notifications) {
        if (!notification.read) {
          notification.read = true;
          await db.put('notifications', notification);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return false;
    }
  }

  // Delete notification
  async deleteNotification(id: number): Promise<boolean> {
    try {
      await (await this.db).delete('notifications', id);
      return true;
    } catch (error) {
      console.error('Error deleting notification:', error);
      return false;
    }
  }

  // Get sync state
  async getSyncState(key: string): Promise<{ lastSync: Date; syncToken: string | null; } | undefined> {
    return (await this.db).get('syncState', key);
  }

  // Update sync state
  async updateSyncState(key: string, data: { lastSync: Date; syncToken: string | null; }): Promise<void> {
    await (await this.db).put('syncState', data, key);
  }

  // Clear all data (useful for testing or logout)
  async clearAllData(): Promise<void> {
    const db = await this.db;
    const stores = ['users', 'calendars', 'events', 'serverConnections', 
                    'calendarSharings', 'smtpConfigs', 'notifications', 'syncState'];
    
    const tx = db.transaction(stores, 'readwrite');
    
    await Promise.all(stores.map(store => tx.objectStore(store).clear()));
    await tx.done;
    
    console.log('All IndexedDB data cleared');
  }
}

// Export singleton instance
export const indexedDBService = IndexedDBService.getInstance();

// Export type for use in components
export type { CalendarAppDB };