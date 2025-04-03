import session from "express-session";
import { 
  Calendar, Event, InsertCalendar, InsertEvent, InsertServerConnection, 
  InsertUser, ServerConnection, User, CalendarSharing, InsertCalendarSharing,
  users, calendars, events, serverConnections, calendarSharing
} from "@shared/schema";
import { createId } from '@paralleldrive/cuid2';
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, or, inArray } from 'drizzle-orm';
import connectPg from "connect-pg-simple";
import { IStorage } from './storage';

// Configure neon to use websockets 
neonConfig.fetchConnectionCache = true;

// Create a connection to the database
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

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
  
  async getSharedCalendars(userId: number): Promise<Calendar[]> {
    try {
      // Get the user
      const user = await this.getUser(userId);
      if (!user) return [];
      
      console.log(`Looking for calendars shared with user ID: ${userId}, username: ${user.username}`);
      
      // Use direct queries to simplify this function and avoid circular references
      let sharingRecords: {id: number, calendarId: number}[] = [];
      
      // 1. First try direct user ID match
      try {
        const result = await db.execute(
          "SELECT id, calendar_id FROM calendar_sharing WHERE shared_with_user_id = $1",
          [userId]
        );
        
        const directMatches = result.rows.map(row => ({
          id: Number(row.id),
          calendarId: Number(row.calendar_id)
        }));
        
        console.log(`Found ${directMatches.length} direct user ID matches`);
        sharingRecords = [...sharingRecords, ...directMatches];
      } catch (error) {
        console.error("Error in direct user ID match query:", error);
      }
      
      // 2. Try exact email/username matches
      try {
        // Build query parameters
        const params: any[] = [user.username];
        let emailPlaceholder = "";
        
        if (user.email) {
          params.push(user.email);
          emailPlaceholder = "OR shared_with_email = $2";
          console.log(`User has email: ${user.email}, including in exact match query`);
        }
        
        const exactQuery = `
          SELECT id, calendar_id FROM calendar_sharing 
          WHERE shared_with_email = $1 
          ${emailPlaceholder}
        `;
        
        const result = await db.execute(exactQuery, params);
        
        const exactMatches = result.rows.map(row => ({
          id: Number(row.id),
          calendarId: Number(row.calendar_id)
        }));
        
        console.log(`Found ${exactMatches.length} exact username/email matches`);
        sharingRecords = [...sharingRecords, ...exactMatches];
      } catch (error) {
        console.error("Error in exact match query:", error);
      }
      
      // 3. Try partial matches with ILIKE
      try {
        // Username partial match
        const usernameResult = await db.execute(
          "SELECT id, calendar_id FROM calendar_sharing WHERE shared_with_email ILIKE $1",
          [`%${user.username}%`]
        );
        
        const usernameMatches = usernameResult.rows.map(row => ({
          id: Number(row.id),
          calendarId: Number(row.calendar_id)
        }));
        
        console.log(`Found ${usernameMatches.length} partial username matches`);
        sharingRecords = [...sharingRecords, ...usernameMatches];
        
        // Email partial match if exists
        if (user.email) {
          const emailResult = await db.execute(
            "SELECT id, calendar_id FROM calendar_sharing WHERE shared_with_email ILIKE $1",
            [`%${user.email}%`]
          );
          
          const emailMatches = emailResult.rows.map(row => ({
            id: Number(row.id),
            calendarId: Number(row.calendar_id)
          }));
          
          console.log(`Found ${emailMatches.length} partial email matches`);
          sharingRecords = [...sharingRecords, ...emailMatches];
        }
      } catch (error) {
        console.error("Error in partial match query:", error);
      }
      
      // Deduplicate calendar IDs (sharing records may have duplicates)
      const calendarIdSet = new Set<number>();
      sharingRecords.forEach(record => calendarIdSet.add(record.calendarId));
      const calendarIds = Array.from(calendarIdSet);
      
      console.log(`Found ${calendarIds.length} unique calendar IDs to fetch`);
      
      if (calendarIds.length === 0) {
        return [];
      }
      
      // Get the actual calendars
      const sharedCalendars: Calendar[] = [];
      
      for (const calendarId of calendarIds) {
        try {
          const calendarResult = await db.execute(
            "SELECT * FROM calendars WHERE id = $1",
            [calendarId]
          );
          
          if (calendarResult.rows.length > 0) {
            const row = calendarResult.rows[0];
            
            // Convert to Calendar type with proper typing
            sharedCalendars.push({
              id: Number(row.id),
              name: String(row.name || ''),
              color: String(row.color || '#3788d8'),
              ownerId: Number(row.owner_id),
              serverCalendarId: row.server_calendar_id ? String(row.server_calendar_id) : null,
              serverUrl: row.server_url ? String(row.server_url) : null,
              description: row.description ? String(row.description) : null,
              isVisible: Boolean(row.is_visible),
              isReadOnly: Boolean(row.is_read_only),
              createdAt: row.created_at ? new Date(row.created_at) : null,
              lastModified: row.last_modified ? new Date(row.last_modified) : null
            });
          }
        } catch (error) {
          console.error(`Error fetching calendar with ID ${calendarId}:`, error);
        }
      }
      
      console.log(`Found ${sharedCalendars.length} shared calendars for user ${user.username}`);
      return sharedCalendars;
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