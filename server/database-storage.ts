import session from "express-session";
import { 
  Calendar, Event, InsertCalendar, InsertEvent, InsertServerConnection, 
  InsertUser, ServerConnection, User, CalendarSharing, InsertCalendarSharing,
  users, calendars, events, serverConnections, calendarSharing
} from "@shared/schema";
import { createId } from '@paralleldrive/cuid2';
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, or, inArray, ne, sql } from 'drizzle-orm';
import connectPg from "connect-pg-simple";
import { IStorage } from './storage';

// Configure neon to use websockets 
neonConfig.fetchConnectionCache = true;

// Create a connection to the database
const neonClient = neon(process.env.DATABASE_URL!);
const db = drizzle(neonClient);

const PostgresSessionStore = connectPg(session);

// PostgreSQL database storage implementation
export class DatabaseStorage implements IStorage {
  public sessionStore: session.Store;
  
  constructor() {
    // Initialize session store with PostgreSQL
    this.sessionStore = new PostgresSessionStore({
      conObject: {
        connectionString: process.env.DATABASE_URL,
      },
      createTableIfMissing: true,
    });
  }
  
  async initializeDatabase(): Promise<void> {
    try {
      console.log("Checking if tables exist and creating if necessary...");
      
      // Sample data is now created only if the users table is empty
      const userCount = await db.select().from(users);
      
      if (userCount.length === 0) {
        console.log("No users found, initializing sample data...");
        await this.initializeSampleData();
      } else {
        console.log(`Found ${userCount.length} existing users, skipping sample data initialization.`);
      }
    } catch (error) {
      console.error("Error during database initialization:", error);
    }
  }
  
  private async initializeSampleData(): Promise<void> {
    try {
      // Create a default user for demo purposes
      const defaultUser: InsertUser = {
        username: "demo",
        password: "$2a$10$JNtOWyzifkSQPN9x.kFI0et9rEHP0XvKkQHZZS5sKdCXJ7.BViAf.", // "password"
        preferredTimezone: "UTC"
      };
      
      const user = await this.createUser(defaultUser);
      
      // Create a CalDAV server connection for the user
      const serverConnection: InsertServerConnection = {
        userId: user.id,
        url: "https://zpush.ajaydata.com/davical/",
        username: "lalchand",
        password: "lalchand",
        autoSync: true,
        syncInterval: 15,
        status: "connected",
        lastSync: new Date()
      };
      
      await this.createServerConnection(serverConnection);
      
      // Create a default calendar for the user
      const calendar: InsertCalendar = {
        userId: user.id,
        name: "Personal",
        color: "#3498db",
        url: null,
        enabled: true
      };
      
      const newCalendar = await this.createCalendar(calendar);
      
      // Create some sample events for the calendar
      const now = new Date();
      const startDate = new Date(now);
      startDate.setHours(10, 0, 0, 0); // 10:00 AM
      
      const endDate = new Date(now);
      endDate.setHours(11, 0, 0, 0); // 11:00 AM
      
      // Sample event 1 - Today
      const event1: InsertEvent = {
        calendarId: newCalendar.id,
        title: "Team Meeting",
        description: "Weekly team sync",
        location: "Conference Room A",
        startDate,
        endDate,
        timezone: defaultUser.preferredTimezone,
        allDay: false,
        recurrenceRule: null,
        uid: `${Date.now()}-${createId()}@caldavclient`,
        url: null,
        etag: null,
        rawData: null
      };
      
      await this.createEvent(event1);
      
      // Sample event 2 - Next week
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(17, 0, 0, 0); // 5:00 PM
      
      const nextWeekEnd = new Date(nextWeek);
      nextWeekEnd.setHours(18, 0, 0, 0); // 6:00 PM
      
      const event2: InsertEvent = {
        calendarId: newCalendar.id,
        title: "Project Deadline",
        description: "Submit final deliverables",
        location: null,
        startDate: nextWeek,
        endDate: nextWeekEnd,
        timezone: defaultUser.preferredTimezone,
        allDay: false,
        recurrenceRule: null,
        uid: `${Date.now() + 1}-${createId()}@caldavclient`,
        url: null,
        etag: null,
        rawData: null
      };
      
      await this.createEvent(event2);
      
      console.log("Sample data initialized successfully");
    } catch (error) {
      console.error("Error initializing sample data:", error);
    }
  }
  
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result.length > 0 ? result[0] : undefined;
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result.length > 0 ? result[0] : undefined;
  }
  
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const preferredTimezone = insertUser.preferredTimezone || "UTC";
    const result = await db.insert(users).values({
      ...insertUser,
      preferredTimezone
    }).returning();
    
    return result[0];
  }
  
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    const result = await db.update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  // Calendar methods
  async getCalendars(userId: number): Promise<Calendar[]> {
    return await db.select()
      .from(calendars)
      .where(eq(calendars.userId, userId));
  }
  
  async getCalendar(id: number): Promise<Calendar | undefined> {
    const result = await db.select()
      .from(calendars)
      .where(eq(calendars.id, id));
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async createCalendar(insertCalendar: InsertCalendar): Promise<Calendar> {
    const result = await db.insert(calendars)
      .values(insertCalendar)
      .returning();
    
    return result[0];
  }
  
  async updateCalendar(id: number, calendarUpdate: Partial<Calendar>): Promise<Calendar | undefined> {
    const result = await db.update(calendars)
      .set(calendarUpdate)
      .where(eq(calendars.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async deleteCalendar(id: number): Promise<boolean> {
    const result = await db.delete(calendars)
      .where(eq(calendars.id, id))
      .returning();
    
    return result.length > 0;
  }
  
  // Calendar sharing methods
  async getCalendarSharing(calendarId: number): Promise<CalendarSharing[]> {
    try {
      const sharingRecords = await db.select()
        .from(calendarSharing)
        .where(eq(calendarSharing.calendarId, calendarId));
      
      return sharingRecords;
    } catch (error) {
      console.error("Error fetching calendar sharing records:", error);
      return [];
    }
  }
  
  async getAllCalendarSharings(): Promise<CalendarSharing[]> {
    try {
      const allSharingRecords = await db.select().from(calendarSharing);
      console.log(`Fetched ${allSharingRecords.length} total calendar sharing records from database`);
      return allSharingRecords;
    } catch (error) {
      console.error("Error fetching all calendar sharing records:", error);
      return [];
    }
  }
  
  async getSharedCalendars(userId: number): Promise<Calendar[]> {
    try {
      // Get the user
      const user = await this.getUser(userId);
      if (!user) {
        console.log(`User with ID ${userId} not found when looking for shared calendars`);
        return [];
      }
      
      console.log(`Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'none'}`);
      
      // Important: We only want to show calendars that were explicitly shared with this user
      // We need to enforce strict matching to avoid showing calendars to unintended users
      
      // First approach: Direct queries for exact matches with user ID or email
      // This prevents showing calendars to users they weren't shared with
      const sharingRecords = await db.select()
        .from(calendarSharing)
        .where(
          or(
            // Match by user ID (strongest match)
            eq(calendarSharing.sharedWithUserId, userId),
            // Match by exact email (next strongest match)
            user.email ? eq(calendarSharing.sharedWithEmail, user.email) : sql`FALSE`,
            // Match by username as email (fallback match)
            eq(calendarSharing.sharedWithEmail, user.username)
          )
        );
      
      console.log(`Found ${sharingRecords.length} direct sharing records for user ${user.username}`);
      
      // Debug info for direct matches
      if (sharingRecords.length > 0) {
        console.log('Direct sharing matches:', JSON.stringify(sharingRecords.map(r => ({
          id: r.id,
          calendarId: r.calendarId,
          sharedWithEmail: r.sharedWithEmail,
          sharedWithUserId: r.sharedWithUserId,
          permissionLevel: r.permissionLevel
        })), null, 2));
      }
      
      // Important: Never include calendars that the user owns
      // (Prevents the "shared calendar with myself" issue)
      if (sharingRecords.length === 0) {
        return [];
      }
      
      // Get unique calendar IDs from direct matches
      const calendarIds = Array.from(new Set(sharingRecords.map(record => record.calendarId)));
      
      // Fetch the shared calendars
      const sharedCalendars = await db.select()
        .from(calendars)
        .where(
          and(
            // Must be in our list of shared calendar IDs
            inArray(calendars.id, calendarIds),
            // Must NOT be owned by the current user
            ne(calendars.userId, userId)
          )
        );
      
      console.log(`Found ${sharedCalendars.length} shared calendars for user ${user.username} (excluding owned calendars)`);
      
      // Map sharing records to their respective calendars for permission info
      const calendarPermissionMap = new Map(
        sharingRecords.map(record => [record.calendarId, record.permissionLevel])
      );
      
      // Detailed logging of calendar properties 
      for (const calendar of sharedCalendars) {
        console.log(`Calendar ${calendar.id} (${calendar.name}) owned by user ${calendar.userId}, shared with user ${userId}, permission: ${calendarPermissionMap.get(calendar.id) || 'unknown'}`);
      }
      
      // Ensure we only return calendars that match our strict criteria
      return sharedCalendars.filter(calendar => {
        // Double check that this calendar is actually shared with the user
        const isSharedWithUser = calendarPermissionMap.has(calendar.id);
        
        // Never show user their own calendars in shared section
        const isNotOwnedByUser = calendar.userId !== userId;
        
        return isSharedWithUser && isNotOwnedByUser;
      });
    } catch (error) {
      console.error("Error fetching shared calendars:", error);
      return [];
    }
  }
  
  async shareCalendar(sharing: InsertCalendarSharing): Promise<CalendarSharing> {
    try {
      // First, check if a sharing already exists for this calendar and email/user
      let existingSharing;
      
      if (sharing.sharedWithUserId) {
        existingSharing = await db.select()
          .from(calendarSharing)
          .where(
            and(
              eq(calendarSharing.calendarId, sharing.calendarId),
              eq(calendarSharing.sharedWithUserId, sharing.sharedWithUserId)
            )
          );
      } else if (sharing.sharedWithEmail) {
        existingSharing = await db.select()
          .from(calendarSharing)
          .where(
            and(
              eq(calendarSharing.calendarId, sharing.calendarId),
              eq(calendarSharing.sharedWithEmail, sharing.sharedWithEmail)
            )
          );
      }
      
      // If sharing already exists, update the permissions
      if (existingSharing && existingSharing.length > 0) {
        const sharingId = existingSharing[0].id;
        return await this.updateCalendarSharing(sharingId, { permissionLevel: sharing.permissionLevel }) 
          || existingSharing[0];
      }
      
      // Otherwise, create a new sharing record
      const result = await db.insert(calendarSharing)
        .values({
          ...sharing,
          createdAt: new Date(),
          lastModified: new Date()
        })
        .returning();
      
      return result[0];
    } catch (error: any) {
      console.error("Error sharing calendar:", error);
      throw new Error(`Failed to share calendar: ${error?.message || 'Unknown error'}`);
    }
  }
  
  async updateCalendarSharing(id: number, sharing: Partial<CalendarSharing>): Promise<CalendarSharing | undefined> {
    try {
      const result = await db.update(calendarSharing)
        .set(sharing)
        .where(eq(calendarSharing.id, id))
        .returning();
      
      return result.length > 0 ? result[0] : undefined;
    } catch (error: any) {
      console.error(`Error updating calendar sharing with ID ${id}:`, error);
      return undefined;
    }
  }
  
  async removeCalendarSharing(id: number): Promise<boolean> {
    try {
      const result = await db.delete(calendarSharing)
        .where(eq(calendarSharing.id, id))
        .returning();
      
      return result.length > 0;
    } catch (error: any) {
      console.error(`Error removing calendar sharing with ID ${id}:`, error);
      return false;
    }
  }
  
  // Event methods
  async getEvents(calendarId: number): Promise<Event[]> {
    return await db.select()
      .from(events)
      .where(eq(events.calendarId, calendarId));
  }
  
  async getEvent(id: number): Promise<Event | undefined> {
    const result = await db.select()
      .from(events)
      .where(eq(events.id, id));
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async getEventByUID(uid: string): Promise<Event | undefined> {
    const result = await db.select()
      .from(events)
      .where(eq(events.uid, uid));
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const result = await db.insert(events)
      .values(insertEvent)
      .returning();
    
    return result[0];
  }
  
  async updateEvent(id: number, eventUpdate: Partial<Event>): Promise<Event | undefined> {
    const result = await db.update(events)
      .set(eventUpdate)
      .where(eq(events.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async deleteEvent(id: number): Promise<boolean> {
    try {
      console.log(`Attempting to delete event with ID ${id} from database`);
      const result = await db.delete(events)
        .where(eq(events.id, id))
        .returning({ id: events.id });
      
      console.log(`Delete result:`, result);
      return result.length > 0;
    } catch (error: any) {
      console.error(`Error deleting event with ID ${id}:`, error);
      return false;
    }
  }
  
  async deleteEventsByCalendarId(calendarId: number): Promise<boolean> {
    try {
      console.log(`Attempting to delete all events for calendar ID ${calendarId} from database`);
      const result = await db.delete(events)
        .where(eq(events.calendarId, calendarId))
        .returning({ id: events.id });
      
      console.log(`Deleted ${result.length} events for calendar ID ${calendarId}`);
      return true;
    } catch (error: any) {
      console.error(`Error deleting events for calendar ID ${calendarId}:`, error);
      return false;
    }
  }
  
  // Server connection methods
  async getServerConnection(userId: number): Promise<ServerConnection | undefined> {
    const result = await db.select()
      .from(serverConnections)
      .where(eq(serverConnections.userId, userId));
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async createServerConnection(insertConnection: InsertServerConnection): Promise<ServerConnection> {
    const result = await db.insert(serverConnections)
      .values({
        ...insertConnection,
        lastSync: insertConnection.lastSync || new Date(),
        status: insertConnection.status || "disconnected"
      })
      .returning();
    
    return result[0];
  }
  
  async updateServerConnection(
    id: number, 
    connectionUpdate: Partial<ServerConnection>
  ): Promise<ServerConnection | undefined> {
    const result = await db.update(serverConnections)
      .set(connectionUpdate)
      .where(eq(serverConnections.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async deleteServerConnection(id: number): Promise<boolean> {
    const result = await db.delete(serverConnections)
      .where(eq(serverConnections.id, id))
      .returning();
    
    return result.length > 0;
  }
}