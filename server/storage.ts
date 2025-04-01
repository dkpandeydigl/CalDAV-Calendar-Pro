import { 
  users, type User, type InsertUser,
  calendars, type Calendar, type InsertCalendar,
  events, type Event, type InsertEvent,
  serverConnections, type ServerConnection, type InsertServerConnection
} from "@shared/schema";
import bcrypt from "bcryptjs";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Calendar methods
  getCalendars(userId: number): Promise<Calendar[]>;
  getCalendar(id: number): Promise<Calendar | undefined>;
  createCalendar(calendar: InsertCalendar): Promise<Calendar>;
  updateCalendar(id: number, calendar: Partial<Calendar>): Promise<Calendar | undefined>;
  deleteCalendar(id: number): Promise<boolean>;
  
  // Event methods
  getEvents(calendarId: number): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  getEventByUID(uid: string): Promise<Event | undefined>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<Event>): Promise<Event | undefined>;
  deleteEvent(id: number): Promise<boolean>;
  
  // Server connection methods
  getServerConnection(userId: number): Promise<ServerConnection | undefined>;
  createServerConnection(connection: InsertServerConnection): Promise<ServerConnection>;
  updateServerConnection(
    id: number, 
    connection: Partial<ServerConnection>
  ): Promise<ServerConnection | undefined>;
  deleteServerConnection(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private calendarsMap: Map<number, Calendar>;
  private eventsMap: Map<number, Event>;
  private serverConnectionsMap: Map<number, ServerConnection>;
  
  private userIdCounter: number;
  private calendarIdCounter: number;
  private eventIdCounter: number;
  private serverConnectionIdCounter: number;

  constructor() {
    this.users = new Map();
    this.calendarsMap = new Map();
    this.eventsMap = new Map();
    this.serverConnectionsMap = new Map();
    
    this.userIdCounter = 1;
    this.calendarIdCounter = 1;
    this.eventIdCounter = 1;
    this.serverConnectionIdCounter = 1;
    
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
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
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
      syncToken: null,
      enabled: insertCalendar.enabled ?? true
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
  
  async deleteCalendar(id: number): Promise<boolean> {
    return this.calendarsMap.delete(id);
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
    
    // Create event with all required fields explicitly set
    const event: Event = {
      id,
      uid: insertEvent.uid,
      calendarId: insertEvent.calendarId,
      title: insertEvent.title,
      description: insertEvent.description ?? null,
      location: insertEvent.location ?? null,
      startDate: insertEvent.startDate,
      endDate: insertEvent.endDate,
      allDay: insertEvent.allDay ?? false,
      timezone: insertEvent.timezone ?? "UTC",
      recurrenceRule: insertEvent.recurrenceRule ?? null,
      etag: insertEvent.etag ?? null,
      url: insertEvent.url ?? null,
      rawData: insertEvent.rawData ?? null
    };
    
    this.eventsMap.set(id, event);
    return event;
  }
  
  async updateEvent(id: number, eventUpdate: Partial<Event>): Promise<Event | undefined> {
    const event = this.eventsMap.get(id);
    if (!event) return undefined;
    
    const updatedEvent = { ...event, ...eventUpdate };
    this.eventsMap.set(id, updatedEvent);
    return updatedEvent;
  }
  
  async deleteEvent(id: number): Promise<boolean> {
    return this.eventsMap.delete(id);
  }
  
  // Server connection methods
  async getServerConnection(userId: number): Promise<ServerConnection | undefined> {
    return Array.from(this.serverConnectionsMap.values()).find(
      (connection) => connection.userId === userId
    );
  }
  
  async createServerConnection(insertConnection: InsertServerConnection): Promise<ServerConnection> {
    const id = this.serverConnectionIdCounter++;
    
    // Create server connection with all required fields explicitly set
    const connection: ServerConnection = {
      id,
      userId: insertConnection.userId,
      url: insertConnection.url,
      username: insertConnection.username,
      password: insertConnection.password,
      autoSync: insertConnection.autoSync ?? true,
      syncInterval: insertConnection.syncInterval ?? 15,
      lastSync: null,
      status: "disconnected"
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
    
    const updatedConnection = { ...connection, ...connectionUpdate };
    this.serverConnectionsMap.set(id, updatedConnection);
    return updatedConnection;
  }
  
  async deleteServerConnection(id: number): Promise<boolean> {
    return this.serverConnectionsMap.delete(id);
  }
}

export const storage = new MemStorage();
