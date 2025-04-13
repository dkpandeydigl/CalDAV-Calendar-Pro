import session from "express-session";
import { 
  Calendar, Event, InsertCalendar, InsertEvent, InsertServerConnection, 
  InsertUser, ServerConnection, User, CalendarSharing, InsertCalendarSharing,
  SmtpConfig, InsertSmtpConfig,
  users, calendars, events, serverConnections, calendarSharing, smtpConfigurations
} from "@shared/schema";
import { createId } from '@paralleldrive/cuid2';
import { neon, neonConfig, NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, or, inArray, ne, sql, count } from 'drizzle-orm';
import connectPg from "connect-pg-simple";
import { IStorage } from './storage';

// Configure neon to use websockets 
neonConfig.fetchConnectionCache = true;

// Create a connection to the database
const neonDb: NeonQueryFunction<any, any> = neon(process.env.DATABASE_URL!);
const db = drizzle(neonDb);

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
  
  /**
   * Get the user IDs of users with active sessions
   * This is used by the sync service to determine which users need background sync
   */
  async getActiveUserIds(): Promise<number[]> {
    try {
      // Use the db object from drizzle-orm to query the session table
      // This avoids using the deprecated neonDb.query method
      const { rows } = await db.execute(/* sql */`
        SELECT sess->'passport'->'user' as user_id 
        FROM "session" 
        WHERE sess->'passport'->'user' IS NOT NULL 
        AND expire > NOW()
      `);
      
      if (!rows || rows.length === 0) {
        return [];
      }
      
      // Extract user IDs from session data and convert to numbers
      const userIds = rows
        .map((row: { user_id: string | number }) => {
          // Extract the numeric user ID from the session data
          const userId = parseInt(row.user_id?.toString(), 10);
          return isNaN(userId) ? null : userId;
        })
        .filter((id): id is number => id !== null); // Type guard to filter out null values
      
      // Return unique user IDs
      return [...new Set(userIds)];
    } catch (error) {
      console.error('Error retrieving active user IDs from sessions:', error);
      return [];
    }
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
        rawData: null,
        emailSent: 'not_sent',
        emailError: null
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
        rawData: null,
        emailSent: 'not_sent',
        emailError: null
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
  
  async deleteCalendar(id: number): Promise<{success: boolean, error?: string, details?: any}> {
    try {
      // Get calendar before deletion to verify it exists
      const calendar = await this.getCalendar(id);
      if (!calendar) {
        const errorMsg = `Calendar ID ${id} not found, cannot delete`;
        console.error(errorMsg);
        return {success: false, error: errorMsg};
      }
      
      try {
        // First, forcefully check for any remaining event references
        const eventCheck = await db.select({count: count()})
          .from(events)
          .where(eq(events.calendarId, id));
        
        const eventCount = eventCheck[0]?.count || 0;
        console.log(`Found ${eventCount} events still linked to calendar ID ${id}`);
        
        if (eventCount > 0) {
          console.log(`Attempting forceful deletion of ${eventCount} events for calendar ID ${id}`);
          
          // Use raw SQL with CASCADE if normal delete doesn't work
          try {
            // First try the regular way
            const eventsDeleted = await this.deleteEventsByCalendarId(id);
            if (!eventsDeleted) {
              console.error(`Standard event deletion failed, will try direct SQL for calendar ID ${id}`);
              
              // Use direct SQL as a fallback
              const deleteResult = await db.execute(
                sql`DELETE FROM ${events} WHERE ${events.calendarId} = ${id}`
              );
              console.log(`Direct SQL event deletion result:`, deleteResult);
            }
          } catch (eventDeleteError) {
            console.error(`Event deletion error for calendar ${id}:`, eventDeleteError);
            return {
              success: false, 
              error: "Failed to delete calendar events", 
              details: eventDeleteError instanceof Error ? eventDeleteError.message : String(eventDeleteError)
            };
          }
        }
        
        // Check again to verify events are gone
        const eventRecheckCount = (await db.select({count: count()})
          .from(events)
          .where(eq(events.calendarId, id)))[0]?.count || 0;
        
        if (eventRecheckCount > 0) {
          console.error(`Still have ${eventRecheckCount} events after deletion attempt`);
          return {
            success: false, 
            error: `Failed to delete ${eventRecheckCount} events from calendar`, 
            details: {eventCount: eventRecheckCount}
          };
        }
        
        // Check for sharing records
        const sharingCheck = await db.select({count: count()})
          .from(calendarSharing)
          .where(eq(calendarSharing.calendarId, id));
        
        const sharingCount = sharingCheck[0]?.count || 0;
        console.log(`Found ${sharingCount} sharing records for calendar ID ${id}`);
        
        if (sharingCount > 0) {
          console.log(`Deleting ${sharingCount} sharing records for calendar ID ${id}`);
          
          try {
            // First try the regular way - get and delete each record
            const sharingRecords = await this.getCalendarSharing(id);
            let allDeleted = true;
            
            for (const record of sharingRecords) {
              const deleteSuccess = await this.removeCalendarSharing(record.id);
              if (!deleteSuccess) {
                console.warn(`Failed to delete sharing record ${record.id} through normal method`);
                allDeleted = false;
              }
            }
            
            // If some sharing records failed to delete, try direct SQL
            if (!allDeleted) {
              console.log(`Some sharing records failed to delete, trying direct SQL`);
              
              const directResult = await db.execute(
                sql`DELETE FROM ${calendarSharing} WHERE ${calendarSharing.calendarId} = ${id}`
              );
              console.log(`Direct SQL sharing deletion result:`, directResult);
            }
          } catch (sharingDeleteError) {
            console.error(`Error deleting sharing records:`, sharingDeleteError);
            // Continue anyway - we still want to try deleting the calendar
          }
        }
        
        // Verify sharing records are gone
        const sharingRecheckCount = (await db.select({count: count()})
          .from(calendarSharing)
          .where(eq(calendarSharing.calendarId, id)))[0]?.count || 0;
        
        if (sharingRecheckCount > 0) {
          console.warn(`Still have ${sharingRecheckCount} sharing records after deletion attempt`);
          // Continue anyway - these shouldn't block calendar deletion
        }
        
        // Finally, delete the calendar using a transaction for safety
        console.log(`Attempting final calendar deletion for ID ${id}`);
        
        try {
          // Try standard delete first
          const result = await db.delete(calendars)
            .where(eq(calendars.id, id))
            .returning();
          
          const deleted = result.length > 0;
          if (deleted) {
            console.log(`Successfully deleted calendar ID ${id} with standard method`);
            return {success: true};
          } else {
            console.error(`Standard deletion returned no results for calendar ID ${id}`);
            
            // Try direct SQL as fallback
            const directResult = await db.execute(
              sql`DELETE FROM ${calendars} WHERE ${calendars.id} = ${id}`
            );
            console.log(`Direct SQL calendar deletion result:`, directResult);
            
            // Check if calendar is actually gone
            const calendarStillExists = await this.getCalendar(id);
            if (!calendarStillExists) {
              console.log(`Calendar ${id} successfully deleted with direct SQL`);
              return {success: true};
            } else {
              console.error(`Calendar ${id} still exists after direct SQL deletion`);
              return {
                success: false, 
                error: "Calendar could not be deleted using any method", 
                details: {directSqlResult: directResult}
              };
            }
          }
        } catch (calendarDeleteError) {
          console.error(`Final calendar deletion error:`, calendarDeleteError);
          
          // Check specifically for foreign key constraint errors
          const errorMsg = calendarDeleteError instanceof Error ? calendarDeleteError.message : String(calendarDeleteError);
          if (errorMsg.includes('constraint') || errorMsg.includes('foreign key')) {
            // This might be a constraint error with references to events or sharing records
            console.error(`Detected potential constraint error during calendar deletion`);
            
            // Let's try to find what's still referencing the calendar
            try {
              // Check events again
              const remainingEvents = await db.select({ id: events.id })
                .from(events)
                .where(eq(events.calendarId, id))
                .limit(5);
                
              // Check sharing records again
              const remainingSharing = await db.select({ id: calendarSharing.id })
                .from(calendarSharing)
                .where(eq(calendarSharing.calendarId, id))
                .limit(5);
              
              return {
                success: false, 
                error: "Failed to delete calendar record due to database constraints", 
                details: {
                  message: errorMsg,
                  remainingEvents: remainingEvents.map(e => e.id),
                  remainingSharing: remainingSharing.map(s => s.id)
                }
              };
            } catch (innerError) {
              console.error("Error while checking for remaining references:", innerError);
            }
          }
          
          return {
            success: false, 
            error: "Failed to delete calendar record", 
            details: errorMsg
          };
        }
      } catch (cascadeError) {
        console.error(`Error during CASCADE operations:`, cascadeError);
        return {
          success: false, 
          error: "Failed during related record deletion", 
          details: cascadeError instanceof Error ? cascadeError.message : String(cascadeError)
        };
      }
    } catch (error) {
      console.error(`Error during calendar deletion process for ID ${id}:`, error);
      
      // Log more detailed error information
      let errorDetails: any = {};
      if (error instanceof Error) {
        console.error(`Error name: ${error.name}, Message: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);
        errorDetails = {
          name: error.name,
          message: error.message,
          stack: error.stack
        };
      }
      
      return {
        success: false, 
        error: "Calendar deletion operation failed", 
        details: errorDetails
      };
    }
  }
  
  // Calendar sharing methods
  async getCalendarSharing(calendarId: number | null): Promise<CalendarSharing[]> {
    try {
      // If calendarId is null, return all sharing records
      if (calendarId === null) {
        return await this.getAllCalendarSharings();
      }
      
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
      
      console.log(`SHARING: Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'none'}`);
      
      try {
        // Try a direct SQL query that avoids the sharedByUserId column
        const rawSql = `
          SELECT * FROM calendar_sharing 
          WHERE shared_with_user_id = $1 
          OR shared_with_email = $2
          ${user.username && user.username.includes('@') ? 'OR shared_with_email = $3' : ''}
        `;
        
        const params = user.username && user.username.includes('@') 
          ? [userId, user.email || '', user.username] 
          : [userId, user.email || ''];
        
        // Execute query directly
        const result = await neonDb(rawSql, params);
        let records: any[] = [];
        
        // Handle different response formats that neonDb might return
        if (Array.isArray(result)) {
          if (result.length === 0) {
            console.log('No shared calendars found (array format)');
            return [];
          }
          records = result;
        } else if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
          if (result.rows.length === 0) {
            console.log('No shared calendars found (rows format)');
            return [];
          }
          records = result.rows;
        } else {
          console.log('No shared calendars found (unknown format)');
          return [];
        }
        
        console.log(`Found ${records.length} sharing records`);
        
        // Extract calendar IDs from sharing records
        const calendarIds = Array.from(new Set(
          records.map((record: any) => record.calendar_id)
        ));
        
        if (!calendarIds.length) {
          return [];
        }
        
        // Fetch the actual calendar objects
        const sharedCalendars = await db.select()
          .from(calendars)
          .where(
            and(
              inArray(calendars.id, calendarIds as number[]),
              ne(calendars.userId, userId)
            )
          );
          
        console.log(`Found ${sharedCalendars.length} calendars`);
        
        // Create a permission map
        const permissionMap = new Map(
          records.map((record: any) => [record.calendar_id, record.permission_level])
        );
        
        // Enhance the calendars with additional info
        const enhancedCalendarsPromises = sharedCalendars.map(async (calendar) => {
          const owner = await this.getUser(calendar.userId);
          
          return {
            ...calendar,
            owner: owner ? {
              id: owner.id,
              username: owner.username,
              email: owner.email
            } : undefined,
            permissionLevel: permissionMap.get(calendar.id) || 'view',
            isShared: true
          };
        });
        
        // Wait for all owner info to be fetched
        const enhancedCalendars = await Promise.all(enhancedCalendarsPromises);
        
        return enhancedCalendars;
      } catch (dbError) {
        console.error('Database error in getSharedCalendars:', dbError);
        return [];
      }
    } catch (error) {
      console.error('Error fetching shared calendars:', error);
      return [];
    }
  }
  
  async shareCalendar(sharing: InsertCalendarSharing): Promise<CalendarSharing> {
    try {
      // SECURITY IMPROVEMENT: Try to map an email to a user ID when possible
      if (sharing.sharedWithEmail && !sharing.sharedWithUserId && sharing.sharedWithEmail.includes('@')) {
        // Find users with this email address
        const userResults = await db.select()
          .from(users)
          .where(
            or(
              eq(users.email, sharing.sharedWithEmail),
              eq(users.username, sharing.sharedWithEmail)
            )
          );
        
        // Update sharing with user ID if found
        if (userResults.length > 0) {
          console.log(`Enhancing security: Found user ID ${userResults[0].id} for email ${sharing.sharedWithEmail}`);
          sharing.sharedWithUserId = userResults[0].id;
        }
      }
      
      // Check if sharing already exists
      let existingSharing: CalendarSharing[] = [];
      
      if (sharing.sharedWithUserId) {
        // Check by user ID (preferred)
        existingSharing = await db.select()
          .from(calendarSharing)
          .where(
            and(
              eq(calendarSharing.calendarId, sharing.calendarId),
              eq(calendarSharing.sharedWithUserId, sharing.sharedWithUserId)
            )
          );
      } 
      
      if (existingSharing.length === 0 && sharing.sharedWithEmail) {
        // Check by email if no match by user ID
        existingSharing = await db.select()
          .from(calendarSharing)
          .where(
            and(
              eq(calendarSharing.calendarId, sharing.calendarId),
              eq(calendarSharing.sharedWithEmail, sharing.sharedWithEmail)
            )
          );
      }
      
      // Update existing sharing or create new
      if (existingSharing.length > 0) {
        const sharingId = existingSharing[0].id;
        const updateData: Partial<CalendarSharing> = { 
          permissionLevel: sharing.permissionLevel,
          lastModified: new Date()
        };
        
        // Also update user ID if we found one
        if (sharing.sharedWithUserId && !existingSharing[0].sharedWithUserId) {
          updateData.sharedWithUserId = sharing.sharedWithUserId;
        }
        
        const updated = await this.updateCalendarSharing(sharingId, updateData);
        return updated || existingSharing[0];
      } else {
        // Create new sharing - ensure sharedByUserId is included
        const insertData = {
          ...sharing,
          // Make sure sharedByUserId is never missing
          sharedByUserId: sharing.sharedByUserId, 
          createdAt: new Date(),
          lastModified: new Date()
        };
        
        // Verify all required fields are present
        if (!insertData.sharedByUserId) {
          throw new Error("Calendar sharing requires sharedByUserId to be set");
        }
        
        const result = await db.insert(calendarSharing)
          .values(insertData)
          .returning();
        
        return result[0];
      }
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
  
  async getServerConnectionByUsername(username: string): Promise<ServerConnection | undefined> {
    try {
      const result = await db.select()
        .from(serverConnections)
        .where(eq(serverConnections.username, username));
      
      return result.length > 0 ? result[0] : undefined;
    } catch (error) {
      console.error('Error getting server connection by username:', error);
      return undefined;
    }
  }
  
  /**
   * Get all active server connections
   * This is used for global background sync to check for external changes
   */
  async getAllServerConnections(): Promise<ServerConnection[]> {
    try {
      // Get all server connections
      const result = await db.select()
        .from(serverConnections);
      
      console.log(`Found ${result.length} server connections for background sync`);
      return result;
    } catch (error) {
      console.error('Error getting all server connections:', error);
      return [];
    }
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
  
  // SMTP configuration methods
  async getSmtpConfig(userId: number): Promise<SmtpConfig | undefined> {
    const [config] = await db.select()
      .from(smtpConfigurations)
      .where(eq(smtpConfigurations.userId, userId));
    
    return config;
  }
  
  async createSmtpConfig(insertConfig: InsertSmtpConfig): Promise<SmtpConfig> {
    const now = new Date();
    const configWithDates = {
      ...insertConfig,
      createdAt: now,
      lastModified: now
    };
    
    const [config] = await db.insert(smtpConfigurations)
      .values(configWithDates)
      .returning();
    
    return config;
  }
  
  async updateSmtpConfig(id: number, configUpdate: Partial<SmtpConfig>): Promise<SmtpConfig | undefined> {
    const now = new Date();
    const updateData = {
      ...configUpdate,
      lastModified: now
    };
    
    const [config] = await db.update(smtpConfigurations)
      .set(updateData)
      .where(eq(smtpConfigurations.id, id))
      .returning();
    
    return config;
  }
  
  async deleteSmtpConfig(id: number): Promise<boolean> {
    const result = await db.delete(smtpConfigurations)
      .where(eq(smtpConfigurations.id, id))
      .returning();
    
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();