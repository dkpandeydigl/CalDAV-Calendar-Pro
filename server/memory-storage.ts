import { 
  users, type User, type InsertUser,
  calendars, type Calendar, type InsertCalendar,
  events, type Event, type InsertEvent,
  serverConnections, type ServerConnection, type InsertServerConnection,
  calendarSharing, type CalendarSharing, type InsertCalendarSharing,
  smtpConfigurations, type SmtpConfig, type InsertSmtpConfig,
  deletedEvents, type DeletedEvent, type InsertDeletedEvent,
  notifications, type Notification, type InsertNotification
} from "@shared/schema";
import bcrypt from "bcryptjs";
import session from "express-session";
import createMemoryStore from "memorystore";
import { IStorage } from './storage';

// Implementation of storage interface using in-memory maps
export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private calendarsMap: Map<number, Calendar>;
  private eventsMap: Map<number, Event>;
  private serverConnectionsMap: Map<number, ServerConnection>;
  private calendarSharingMap: Map<number, CalendarSharing>;
  private smtpConfigMap: Map<number, SmtpConfig>;
  private notificationsMap: Map<number, Notification>;
  
  private userIdCounter: number;
  private calendarIdCounter: number;
  private eventIdCounter: number;
  private serverConnectionIdCounter: number;
  private calendarSharingIdCounter: number;
  private smtpConfigIdCounter: number;
  private notificationIdCounter: number;
  
  // Initialize memory store for sessions
  public sessionStore: session.Store;
  
  // Initialize database (for interface implementation)
  async initializeDatabase(): Promise<void> {
    await this.initializeSampleData();
    console.log("In-memory storage database initialized successfully");
  }

  constructor() {
    this.users = new Map();
    this.calendarsMap = new Map();
    this.eventsMap = new Map();
    this.serverConnectionsMap = new Map();
    this.calendarSharingMap = new Map();
    this.smtpConfigMap = new Map();
    this.notificationsMap = new Map();
    
    this.userIdCounter = 1;
    this.calendarIdCounter = 1;
    this.eventIdCounter = 1;
    this.serverConnectionIdCounter = 1;
    this.calendarSharingIdCounter = 1;
    this.smtpConfigIdCounter = 1;
    this.notificationIdCounter = 1;
    
    // Initialize the memory store for session management
    const MemoryStore = createMemoryStore(session);
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000, // 24 hours
    });
    
    // Create sample data - we'll call this asynchronously,
    // but for a simple demo app this won't cause issues
    this.initializeSampleData().catch(err => {
      console.error("Error initializing sample data:", err);
    });
  }
  
  // Initialize with a sample user and default calendars
  private async initializeSampleData(): Promise<void> {
    try {
      // Create a default user with hashed password
      const hashedPassword = await bcrypt.hash("password", 10);
      const defaultUser: InsertUser = {
        username: "demo",
        password: hashedPassword
      };
      const user = await this.createUser(defaultUser);
      
      // Create default calendars with proper types
      await this.createCalendar({
        name: "Work",
        color: "#0078d4",
        userId: user.id,
        url: null,
        enabled: true
      });
      
      await this.createCalendar({
        name: "Personal",
        color: "#107c10",
        userId: user.id,
        url: null,
        enabled: true
      });
      
      await this.createCalendar({
        name: "Holidays",
        color: "#ffaa44",
        userId: user.id,
        url: null,
        enabled: true
      });
      
      // Add sample events for testing
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      await this.createEvent({
        title: "Team Meeting",
        description: "Weekly team sync",
        location: "Conference Room A",
        startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0),
        endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0),
        allDay: false,
        calendarId: 1,
        uid: "event-123",
        url: null,
        recurrenceRule: null,
        timezone: "UTC"
      });
      
      await this.createEvent({
        title: "Product Launch",
        description: "New product release",
        location: "Main Hall",
        startDate: tomorrow,
        endDate: tomorrow,
        allDay: true,
        calendarId: 1,
        uid: "event-124",
        url: null,
        recurrenceRule: null,
        timezone: "UTC"
      });
      
      await this.createEvent({
        title: "Quarterly Review",
        description: "Financial review meeting",
        location: "Board Room",
        startDate: nextWeek,
        endDate: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000),
        allDay: false,
        calendarId: 2,
        uid: "event-125",
        url: null,
        recurrenceRule: null,
        timezone: "UTC"
      });
    } catch (error) {
      console.error("Error creating sample data:", error);
    }
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }
  
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    // Set default preferredTimezone if not provided
    const preferredTimezone = insertUser.preferredTimezone || "UTC";
    // Set email to null if not provided
    const email = insertUser.email || null;
    // Set fullName to null if not provided
    const fullName = insertUser.fullName || null;
    
    const user: User = { 
      ...insertUser, 
      id, 
      preferredTimezone, 
      email,
      fullName
    };
    
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...userData };
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  // Calendar methods
  async getCalendars(userId: number): Promise<Calendar[]> {
    return Array.from(this.calendarsMap.values()).filter(
      (calendar) => calendar.userId === userId
    );
  }
  
  async getCalendar(id: number): Promise<Calendar | undefined> {
    return this.calendarsMap.get(id);
  }
  
  async createCalendar(insertCalendar: InsertCalendar): Promise<Calendar> {
    const id = this.calendarIdCounter++;
    
    // Create the calendar with all required fields explicitly set
    const calendar: Calendar = { 
      id,
      name: insertCalendar.name,
      color: insertCalendar.color,
      userId: insertCalendar.userId,
      url: insertCalendar.url ?? null,
      syncToken: insertCalendar.syncToken ?? null,
      enabled: insertCalendar.enabled ?? true,
      isPrimary: insertCalendar.isPrimary ?? false,
      isLocal: insertCalendar.isLocal ?? true,
      description: insertCalendar.description ?? null
    };
    
    this.calendarsMap.set(id, calendar);
    return calendar;
  }
  
  async updateCalendar(id: number, calendarUpdate: Partial<Calendar>): Promise<Calendar | undefined> {
    const calendar = this.calendarsMap.get(id);
    if (!calendar) return undefined;
    
    const updatedCalendar = { ...calendar, ...calendarUpdate };
    this.calendarsMap.set(id, updatedCalendar);
    return updatedCalendar;
  }
  
  async deleteCalendar(id: number): Promise<{success: boolean, error?: string, details?: any}> {
    try {
      // Check if calendar exists
      if (!this.calendarsMap.has(id)) {
        return {success: false, error: `Calendar ID ${id} not found`};
      }
      
      // Delete all events in this calendar first
      const eventsDeleted = await this.deleteEventsByCalendarId(id);
      if (!eventsDeleted) {
        return {success: false, error: "Failed to delete calendar events"};
      }
      
      // Delete all sharing records for this calendar
      const sharingRecords = await this.getCalendarSharing(id);
      for (const record of sharingRecords) {
        await this.removeCalendarSharing(record.id);
      }
      
      // Finally delete the calendar
      const deleted = this.calendarsMap.delete(id);
      if (!deleted) {
        return {success: false, error: "Failed to delete calendar"};
      }
      
      return {success: true};
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false, 
        error: "Error during calendar deletion", 
        details: errorMessage
      };
    }
  }
  
  // Calendar sharing methods
  async getCalendarSharing(calendarId: number): Promise<CalendarSharing[]> {
    return Array.from(this.calendarSharingMap.values()).filter(
      (sharing) => sharing.calendarId === calendarId
    );
  }
  
  async getAllCalendarSharings(): Promise<CalendarSharing[]> {
    const allSharings = Array.from(this.calendarSharingMap.values());
    console.log(`Fetched ${allSharings.length} total calendar sharing records from memory storage`);
    return allSharings;
  }
  
  async getSharedCalendars(userId: number): Promise<Calendar[]> {
    // Get the username for this user to match against sharedWithEmail
    const user = await this.getUser(userId);
    if (!user) return [];
    
    console.log(`Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'not set'}`);
    
    // Find all sharing records that might match this user using flexible matching
    const userSharings = Array.from(this.calendarSharingMap.values()).filter(sharing => {
      // Priority 1: Exact user ID match (highest confidence)
      if (sharing.sharedWithUserId === userId) {
        console.log(`Found sharing record with exact user ID match: ${userId}`);
        return true;
      }
      
      // Priority 2: Exact email match (if user has email)
      if (user.email && sharing.sharedWithEmail === user.email) {
        console.log(`Found sharing record with exact email match: ${user.email}`);
        return true;
      }
      
      // Priority 3: Case-insensitive email match (if user has email)
      if (user.email && sharing.sharedWithEmail.toLowerCase() === user.email.toLowerCase()) {
        console.log(`Found sharing record with case-insensitive email match: ${sharing.sharedWithEmail} ≈ ${user.email}`);
        return true;
      }
      
      // Priority 4: Exact username match (treating username as email)
      if (sharing.sharedWithEmail === user.username) {
        console.log(`Found sharing record with exact username match: ${user.username}`);
        return true;
      }
      
      // Priority 5: Case-insensitive username match
      if (sharing.sharedWithEmail.toLowerCase() === user.username.toLowerCase()) {
        console.log(`Found sharing record with case-insensitive username match: ${sharing.sharedWithEmail} ≈ ${user.username}`);
        return true;
      }
      
      // Priority 6: Check if username is part of the email address
      if (sharing.sharedWithEmail.includes('@')) {
        const [emailUsername] = sharing.sharedWithEmail.split('@');
        if (user.username === emailUsername || 
            user.username.includes(emailUsername) || 
            emailUsername.includes(user.username)) {
          console.log(`Found sharing record with email username part match: ${emailUsername} ≈ ${user.username}`);
          return true;
        }
      }
      
      // Priority 7: Check for partial match with email (if user has email)
      if (user.email && (
        sharing.sharedWithEmail.includes(user.email) || 
        user.email.includes(sharing.sharedWithEmail)
      )) {
        console.log(`Found sharing record with partial email match: ${sharing.sharedWithEmail} ≈ ${user.email}`);
        return true;
      }
      
      // Priority 8: Check for partial match with username (lowest confidence)
      if (sharing.sharedWithEmail.includes(user.username) || 
          user.username.includes(sharing.sharedWithEmail)) {
        console.log(`Found sharing record with partial username match: ${sharing.sharedWithEmail} ≈ ${user.username}`);
        return true;
      }
      
      return false;
    });
    
    console.log(`Found ${userSharings.length} sharing records for user ${user.username}`);
    
    // Fetch all the calendars that are shared with this user
    const calendars: Calendar[] = [];
    for (const sharing of userSharings) {
      const calendar = await this.getCalendar(sharing.calendarId);
      if (calendar) {
        console.log(`Adding shared calendar "${calendar.name}" to user's shared calendars`);
        // Get the full owner information
        const owner = await this.getUser(calendar.userId);
        
        calendars.push({
          ...calendar,
          // Add complete owner information to shared calendars
          owner: {
            id: calendar.userId,
            username: owner?.username || 'unknown',
            email: owner?.email || owner?.username || 'unknown'
          },
          // Add owner email for backward compatibility
          ownerEmail: owner?.email || owner?.username || 'unknown',
          // Add both permission fields to ensure full compatibility
          permissionLevel: sharing.permissionLevel || 'view',
          permission: sharing.permissionLevel || 'view', // Add duplicate for compatibility
          // Add sharing ID for permission management
          sharingId: sharing.id,
          // Mark as shared for UI
          isShared: true,
          // Debug info for troubleshooting
          _sharingDebug: {
            userMatch: {
              userId,
              sharingId: sharing.id,
              permissionLevel: sharing.permissionLevel,
              sharedWithEmail: sharing.sharedWithEmail,
              sharedWithUserId: sharing.sharedWithUserId,
              sharedByUserId: sharing.sharedByUserId
            }
          }
        } as any);
      }
    }
    
    return calendars;
  }
  
  async shareCalendar(insertSharing: InsertCalendarSharing): Promise<CalendarSharing> {
    const id = this.calendarSharingIdCounter++;
    
    // Try to find a user ID for the email if available
    let sharedWithUserId = insertSharing.sharedWithUserId;
    if (!sharedWithUserId) {
      // First check: Exact email match
      const usersByEmail = Array.from(this.users.values()).find(
        u => u.email === insertSharing.sharedWithEmail
      );
      
      if (usersByEmail) {
        console.log(`Found user with matching email: ${insertSharing.sharedWithEmail}`);
        sharedWithUserId = usersByEmail.id;
      } else {
        // Second check: Username match
        const usersByUsername = Array.from(this.users.values()).find(
          u => u.username === insertSharing.sharedWithEmail
        );
        
        if (usersByUsername) {
          console.log(`Found user with matching username: ${insertSharing.sharedWithEmail}`);
          sharedWithUserId = usersByUsername.id;
        } else {
          // If we can't find a matching user, set to null
          sharedWithUserId = null;
        }
      }
    }
    
    // Create sharing record with proper fields
    const now = new Date();
    const sharing: CalendarSharing = {
      id,
      calendarId: insertSharing.calendarId,
      sharedWithEmail: insertSharing.sharedWithEmail,
      sharedWithUserId,
      sharedByUserId: insertSharing.sharedByUserId,
      permissionLevel: insertSharing.permissionLevel || "read",
      createdAt: now,
      lastModified: now
    };
    
    this.calendarSharingMap.set(id, sharing);
    return sharing;
  }
  
  async updateCalendarSharing(
    id: number, 
    sharingUpdate: Partial<CalendarSharing>
  ): Promise<CalendarSharing | undefined> {
    const sharing = this.calendarSharingMap.get(id);
    if (!sharing) return undefined;
    
    const now = new Date();
    const updatedSharing = { 
      ...sharing, 
      ...sharingUpdate,
      lastModified: now 
    };
    
    this.calendarSharingMap.set(id, updatedSharing);
    return updatedSharing;
  }
  
  async removeCalendarSharing(id: number): Promise<boolean> {
    return this.calendarSharingMap.delete(id);
  }
  
  // Event methods
  async getEvents(calendarId: number): Promise<Event[]> {
    return Array.from(this.eventsMap.values()).filter(
      (event) => event.calendarId === calendarId
    );
  }
  
  async getEvent(id: number): Promise<Event | undefined> {
    return this.eventsMap.get(id);
  }
  
  async getEventByUID(uid: string): Promise<Event | undefined> {
    return Array.from(this.eventsMap.values()).find(
      (event) => event.uid === uid
    );
  }
  
  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const id = this.eventIdCounter++;
    
    // Set up default values
    const now = new Date();
    
    // Create the event with all required fields
    const event: Event = {
      id,
      uid: insertEvent.uid,
      calendarId: insertEvent.calendarId,
      title: insertEvent.title,
      description: insertEvent.description || null,
      location: insertEvent.location || null,
      startDate: insertEvent.startDate,
      endDate: insertEvent.endDate,
      allDay: insertEvent.allDay || false,
      timezone: insertEvent.timezone || "UTC",
      url: insertEvent.url || null,
      etag: insertEvent.etag || null,
      rawData: insertEvent.rawData || null,
      recurringEventId: insertEvent.recurringEventId || null,
      recurrenceRule: insertEvent.recurrenceRule || null,
      isRecurring: insertEvent.isRecurring || false,
      isException: insertEvent.isException || false,
      lastSync: insertEvent.lastSync || now,
      createdAt: now,
      updatedAt: now,
      status: insertEvent.status || "confirmed",
      busyStatus: insertEvent.busyStatus || "busy",
      attendees: insertEvent.attendees || null,
      organizer: insertEvent.organizer || null,
      attachments: insertEvent.attachments || null,
      resources: insertEvent.resources || null,
      syncStatus: insertEvent.syncStatus || "local", // Set sync status with default "local"
      syncError: insertEvent.syncError || null,
      lastSyncAttempt: insertEvent.lastSyncAttempt || null,
      emailSent: false,
      emailError: null,
      lastModifiedBy: null,
      lastModifiedByName: null,
      lastModifiedAt: now
    };
    
    this.eventsMap.set(id, event);
    return event;
  }
  
  async updateEvent(id: number, eventUpdate: Partial<Event>): Promise<Event | undefined> {
    const event = this.eventsMap.get(id);
    if (!event) return undefined;
    
    const now = new Date();
    const updatedEvent = { 
      ...event, 
      ...eventUpdate,
      updatedAt: now
    };
    
    this.eventsMap.set(id, updatedEvent);
    return updatedEvent;
  }
  
  async deleteEvent(id: number): Promise<boolean> {
    return this.eventsMap.delete(id);
  }
  
  async deleteEventsByCalendarId(calendarId: number): Promise<boolean> {
    try {
      // Find all events for this calendar
      const calendarEvents = Array.from(this.eventsMap.values()).filter(
        (event) => event.calendarId === calendarId
      );
      
      // Delete each event
      for (const event of calendarEvents) {
        await this.deleteEvent(event.id);
      }
      
      return true;
    } catch (error) {
      console.error(`Error deleting events for calendar ${calendarId}:`, error);
      return false;
    }
  }
  
  // Server connection methods
  async getServerConnection(userId: number): Promise<ServerConnection | undefined> {
    return Array.from(this.serverConnectionsMap.values()).find(
      (conn) => conn.userId === userId
    );
  }
  
  async getServerConnectionByUsername(username: string): Promise<ServerConnection | undefined> {
    const user = await this.getUserByUsername(username);
    if (!user) return undefined;
    
    return await this.getServerConnection(user.id);
  }
  
  async createServerConnection(insertConnection: InsertServerConnection): Promise<ServerConnection> {
    const id = this.serverConnectionIdCounter++;
    
    const now = new Date();
    const connection: ServerConnection = {
      id,
      userId: insertConnection.userId,
      url: insertConnection.url,
      username: insertConnection.username,
      password: insertConnection.password,
      autoSync: insertConnection.autoSync ?? true,
      syncInterval: insertConnection.syncInterval ?? 15,
      lastSync: insertConnection.lastSync || null,
      status: insertConnection.status || "disconnected",
      createdAt: now,
      updatedAt: now
    };
    
    this.serverConnectionsMap.set(id, connection);
    return connection;
  }
  
  async updateServerConnection(
    id: number, 
    connectionUpdate: Partial<ServerConnection>
  ): Promise<ServerConnection | undefined> {
    const connection = this.serverConnectionsMap.get(id);
    if (!connection) return undefined;
    
    const now = new Date();
    const updatedConnection = { 
      ...connection, 
      ...connectionUpdate,
      updatedAt: now
    };
    
    this.serverConnectionsMap.set(id, updatedConnection);
    return updatedConnection;
  }
  
  async deleteServerConnection(id: number): Promise<boolean> {
    return this.serverConnectionsMap.delete(id);
  }
  
  // SMTP configuration methods
  async getSmtpConfig(userId: number): Promise<SmtpConfig | undefined> {
    return Array.from(this.smtpConfigMap.values()).find(
      (config) => config.userId === userId
    );
  }
  
  async createSmtpConfig(insertConfig: InsertSmtpConfig): Promise<SmtpConfig> {
    const id = this.smtpConfigIdCounter++;
    
    // Create SMTP config with all required fields explicitly set
    const now = new Date();
    const config: SmtpConfig = {
      id,
      userId: insertConfig.userId,
      host: insertConfig.host,
      port: insertConfig.port,
      secure: insertConfig.secure ?? true,
      username: insertConfig.username,
      password: insertConfig.password,
      fromEmail: insertConfig.fromEmail,
      fromName: insertConfig.fromName ?? null,
      enabled: insertConfig.enabled ?? true,
      createdAt: now,
      lastModified: now
    };
    
    this.smtpConfigMap.set(id, config);
    return config;
  }
  
  async updateSmtpConfig(id: number, configUpdate: Partial<SmtpConfig>): Promise<SmtpConfig | undefined> {
    const config = this.smtpConfigMap.get(id);
    if (!config) return undefined;
    
    const now = new Date();
    const updatedConfig = { 
      ...config, 
      ...configUpdate,
      lastModified: now
    };
    
    this.smtpConfigMap.set(id, updatedConfig);
    return updatedConfig;
  }
  
  async deleteSmtpConfig(id: number): Promise<boolean> {
    return this.smtpConfigMap.delete(id);
  }
  
  // Notification methods
  async createNotification(notification: InsertNotification): Promise<Notification> {
    const id = this.notificationIdCounter++;
    const now = new Date();
    
    const newNotification: Notification = {
      id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      relatedId: notification.relatedId || null,
      relatedType: notification.relatedType || null,
      isRead: false,
      createdAt: now,
      priority: notification.priority || "normal",
      actionLink: notification.actionLink || null,
      actionLabel: notification.actionLabel || null,
      data: notification.data || null
    };
    
    this.notificationsMap.set(id, newNotification);
    return newNotification;
  }
  
  async getNotifications(userId: number, limit: number = 50): Promise<Notification[]> {
    // Get all notifications for this user, sorted by creation time (newest first)
    const userNotifications = Array.from(this.notificationsMap.values())
      .filter(notification => notification.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    
    return userNotifications;
  }
  
  async getUnreadNotificationCount(userId: number): Promise<number> {
    // Count unread notifications for this user
    const count = Array.from(this.notificationsMap.values())
      .filter(notification => notification.userId === userId && !notification.isRead)
      .length;
    
    return count;
  }
  
  async getUnreadNotifications(userId: number): Promise<Notification[]> {
    // Get unread notifications for this user
    const unreadNotifications = Array.from(this.notificationsMap.values())
      .filter(notification => notification.userId === userId && !notification.isRead)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return unreadNotifications;
  }
  
  async markNotificationRead(id: number): Promise<boolean> {
    const notification = this.notificationsMap.get(id);
    if (!notification) return false;
    
    notification.isRead = true;
    this.notificationsMap.set(id, notification);
    return true;
  }
  
  async markAllNotificationsRead(userId: number): Promise<boolean> {
    let success = true;
    
    // Find all unread notifications for this user and mark them as read
    const userNotifications = Array.from(this.notificationsMap.values())
      .filter(notification => notification.userId === userId && !notification.isRead);
    
    for (const notification of userNotifications) {
      notification.isRead = true;
      this.notificationsMap.set(notification.id, notification);
    }
    
    return success;
  }
  
  async deleteNotification(id: number): Promise<boolean> {
    return this.notificationsMap.delete(id);
  }
  
  async getAllNotifications(): Promise<Notification[]> {
    // Return all notifications in the system, sorted by creation time (newest first)
    return Array.from(this.notificationsMap.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

// Create a single instance of memory storage
const memStorage = new MemStorage();

// Initialize it immediately
memStorage.initializeDatabase().catch(err => {
  console.error("Error initializing memory storage:", err);
});

// Export the memory storage as the main storage interface
export const storage: IStorage = memStorage;