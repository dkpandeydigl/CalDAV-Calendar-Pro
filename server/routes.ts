import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCalendarSchema, 
  insertEventSchema, 
  insertServerConnectionSchema,
  insertUserSchema,
  User
} from "@shared/schema";
import { parse, formatISO } from "date-fns";
import { ZodError } from "zod";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import MemoryStoreFactory from "memorystore";

// Define user type for Express
declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up session middleware
  const MemoryStore = MemoryStoreFactory(session);
  
  // Set up session
  app.use(session({
    secret: 'caldav-calendar-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    store: new MemoryStore({
      checkPeriod: 86400000 // Clear expired sessions every 24h
    })
  }));
  
  // Initialize Passport
  app.use(passport.initialize());
  app.use(passport.session());
  
  // Set up Passport authentication using CalDAV server
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      // First check if user exists in local storage
      let user = await storage.getUserByUsername(username);
      
      // Try to authenticate against CalDAV server
      const { DAVClient } = await import('tsdav');
      const davClient = new DAVClient({
        serverUrl: process.env.CALDAV_SERVER_URL || 'https://zpush.ajaydata.com/davical/', // Default server, can be changed
        credentials: {
          username,
          password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      try {
        // Try to connect to verify credentials
        await davClient.login();
        
        // If we reach here, credentials are valid
        if (!user) {
          // Create user if they don't exist in our local storage
          // Password is stored hashed even though we validate against CalDAV
          const hashedPassword = await bcrypt.hash(password, 10);
          user = await storage.createUser({
            username,
            password: hashedPassword
          });
        }
        
        // Store/update the server connection
        let serverConnection = await storage.getServerConnection(user.id);
        if (!serverConnection) {
          serverConnection = await storage.createServerConnection({
            userId: user.id,
            url: process.env.CALDAV_SERVER_URL || 'https://zpush.ajaydata.com/davical/', // Default server, can be changed
            username,
            password, // Note: In production, you might want to encrypt this
            autoSync: true,
            syncInterval: 15
          });
        }
        
        // Don't return the password
        const { password: _, ...userWithoutPassword } = user;
        return done(null, userWithoutPassword);
      } catch (error) {
        console.error("CalDAV authentication failed:", error);
        return done(null, false);
      }
    } catch (error) {
      console.error("Authentication error:", error);
      return done(error);
    }
  }));
  
  // Serialize user to session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });
  
  // Deserialize user from session
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      
      if (!user) {
        return done(null, false);
      }
      
      // Don't return the password
      const { password: _, ...userWithoutPassword } = user;
      done(null, userWithoutPassword);
    } catch (error) {
      done(error);
    }
  });
  
  // Authentication middleware
  const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
  };
  
  // All API routes are prefixed with /api
  
  // Error handling middleware for Zod validation errors
  const handleZodError = (err: unknown, res: any) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        message: "Validation error",
        errors: err.errors
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  };
  
  // Authentication routes
  app.post('/api/register', async (req, res) => {
    try {
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(req.body.username);
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Hash the password
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      
      // Validate with zod
      const validatedData = insertUserSchema.parse({
        ...req.body,
        password: hashedPassword
      });
      
      // Create the user
      const newUser = await storage.createUser(validatedData);
      
      // Don't return the password
      const { password: _, ...userWithoutPassword } = newUser;
      
      // Log the user in
      req.login(userWithoutPassword, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Error logging in' });
        }
        return res.status(201).json(userWithoutPassword);
      });
    } catch (err) {
      console.error('Error registering user:', err);
      return handleZodError(err, res);
    }
  });
  
  app.post('/api/login', passport.authenticate('local'), (req, res) => {
    // If this function executes, authentication was successful
    // req.user contains the authenticated user
    res.json(req.user);
  });
  
  app.post('/api/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: 'Error logging out' });
      }
      res.json({ message: 'Logged out successfully' });
    });
  });
  
  app.get('/api/user', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    res.json(req.user);
  });

  // Calendar routes
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      
      // First check if we have a server connection
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      // Create a CalDAV client with the stored connection data
      const { DAVClient } = await import('tsdav');
      const davClient = new DAVClient({
        serverUrl: connection.url,
        credentials: {
          username: connection.username,
          password: connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      try {
        // Attempt to login and discover calendars
        await davClient.login();
        const davCalendars = await davClient.fetchCalendars();
        
        // Convert CalDAV calendars to our format and save them
        const existingCalendars = await storage.getCalendars(userId);
        const existingCalendarUrls = new Set(existingCalendars.map(cal => cal.url));
        
        for (const davCal of davCalendars) {
          // Skip calendars we already have
          if (existingCalendarUrls.has(davCal.url)) {
            continue;
          }
          
          // Create new calendar
          await storage.createCalendar({
            userId,
            name: typeof davCal.displayName === 'string' ? davCal.displayName : 'Untitled Calendar',
            color: '#4285F4', // Default color if not provided
            url: davCal.url,
            syncToken: davCal.syncToken ? String(davCal.syncToken) : null
          });
        }
        
        // Update connection status
        await storage.updateServerConnection(connection.id, {
          lastSync: new Date(),
          status: "connected"
        });
        
        // Fetch updated calendars list
        const updatedCalendars = await storage.getCalendars(userId);
        res.json(updatedCalendars);
      } catch (error) {
        console.error("CalDAV calendar fetch failed:", error);
        
        // Update status to reflect failure
        await storage.updateServerConnection(connection.id, {
          status: "error"
        });
        
        // Still return local calendars if we have any
        const localCalendars = await storage.getCalendars(userId);
        res.json(localCalendars);
      }
    } catch (err) {
      console.error("Error fetching calendars:", err);
      res.status(500).json({ message: "Failed to fetch calendars" });
    }
  });

  app.get("/api/calendars/:id", async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      const calendar = await storage.getCalendar(calendarId);
      
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      res.json(calendar);
    } catch (err) {
      console.error("Error fetching calendar:", err);
      res.status(500).json({ message: "Failed to fetch calendar" });
    }
  });

  app.post("/api/calendars", async (req, res) => {
    try {
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
      
      // Add userId to request body
      const calendarData = { ...req.body, userId };
      
      // Validate with zod
      const validatedData = insertCalendarSchema.parse(calendarData);
      
      const newCalendar = await storage.createCalendar(validatedData);
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });

  app.put("/api/calendars/:id", async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      
      // Validate with zod (partial validation for update)
      const validatedData = insertCalendarSchema.partial().parse(req.body);
      
      const updatedCalendar = await storage.updateCalendar(calendarId, validatedData);
      
      if (!updatedCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      res.json(updatedCalendar);
    } catch (err) {
      console.error("Error updating calendar:", err);
      return handleZodError(err, res);
    }
  });

  app.delete("/api/calendars/:id", async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      const deleted = await storage.deleteCalendar(calendarId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting calendar:", err);
      res.status(500).json({ message: "Failed to delete calendar" });
    }
  });

  // Event routes
  app.get("/api/calendars/:calendarId/events", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.calendarId);
      const userId = req.user!.id;
      
      // Get the calendar to make sure it belongs to the user
      const calendar = await storage.getCalendar(calendarId);
      
      if (!calendar || calendar.userId !== userId) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // First get the server connection
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        // If no server connection, just return local events
        const events = await storage.getEvents(calendarId);
        return res.json(events);
      }
      
      // Get the CalDAV calendar URL from our calendar
      const calendarUrl = calendar.url;
      
      if (!calendarUrl) {
        // If no CalDAV URL, just return local events
        const events = await storage.getEvents(calendarId);
        return res.json(events);
      }
      
      try {
        // Create CalDAV client
        const { DAVClient } = await import('tsdav');
        const davClient = new DAVClient({
          serverUrl: connection.url,
          credentials: {
            username: connection.username,
            password: connection.password
          },
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        // Login and fetch events
        await davClient.login();
        
        // Fetch events from last month to next 6 months
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);
        
        const davEvents = await davClient.fetchCalendarObjects({
          calendar: { url: calendarUrl },
          timeRange: {
            start: startDate,
            end: endDate
          }
        });
        
        // Parse and store the events
        const existingEvents = await storage.getEvents(calendarId);
        const existingEventUrls = new Set(existingEvents.map(event => event.url));
        
        for (const davEvent of davEvents) {
          if (!davEvent.data || !davEvent.url) continue;
          
          // Skip events we already have
          if (existingEventUrls.has(davEvent.url)) continue;
          
          try {
            // Parse iCalendar data
            const { parseICS } = await import('tsdav');
            const parsed = parseICS(davEvent.data);
            
            if (!parsed.vevent || !parsed.vevent[0]) continue;
            
            const vevent = parsed.vevent[0];
            
            // Extract event details
            const uid = vevent.uid || `${Date.now()}-${Math.random()}`;
            const summary = vevent.summary || 'Untitled Event';
            const description = vevent.description || '';
            const location = vevent.location || '';
            
            // Handle date/time
            let startDate, endDate, allDay = false;
            
            if (vevent.dtstart && vevent.dtend) {
              // All-day event check
              if (typeof vevent.dtstart.value === 'string' && vevent.dtstart.value.length === 8) {
                allDay = true;
                // Parse YYYYMMDD format for all-day events
                const startYear = parseInt(vevent.dtstart.value.slice(0, 4));
                const startMonth = parseInt(vevent.dtstart.value.slice(4, 6)) - 1;
                const startDay = parseInt(vevent.dtstart.value.slice(6, 8));
                startDate = new Date(startYear, startMonth, startDay);
                
                const endYear = parseInt(vevent.dtend.value.slice(0, 4));
                const endMonth = parseInt(vevent.dtend.value.slice(4, 6)) - 1;
                const endDay = parseInt(vevent.dtend.value.slice(6, 8));
                endDate = new Date(endYear, endMonth, endDay);
              } else {
                // Regular event with time
                startDate = new Date(vevent.dtstart.value as string);
                endDate = new Date(vevent.dtend.value as string);
              }
            } else {
              // Fallback if no proper dates
              startDate = new Date();
              endDate = new Date();
              endDate.setHours(endDate.getHours() + 1);
            }
            
            // Get timezone
            let timezone = 'UTC';
            if (vevent.dtstart && vevent.dtstart.tzid) {
              timezone = vevent.dtstart.tzid;
            }
            
            // Check for recurrence
            const recurrenceRule = vevent.rrule ? vevent.rrule.toString() : null;
            
            // Create event in our database
            await storage.createEvent({
              uid,
              calendarId,
              title: summary,
              description,
              location,
              startDate,
              endDate,
              allDay,
              timezone,
              recurrenceRule,
              etag: davEvent.etag || null,
              url: davEvent.url,
              rawData: vevent
            });
          } catch (parseError) {
            console.error("Error parsing event:", parseError);
            // Skip this event if parsing fails
            continue;
          }
        }
        
        // Return the updated list of events
        const updatedEvents = await storage.getEvents(calendarId);
        res.json(updatedEvents);
      } catch (error) {
        console.error("Error fetching events from CalDAV:", error);
        // Fall back to local events
        const events = await storage.getEvents(calendarId);
        res.json(events);
      }
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const event = await storage.getEvent(eventId);
      
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      res.json(event);
    } catch (err) {
      console.error("Error fetching event:", err);
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });

  app.post("/api/events", async (req, res) => {
    try {
      // Generate a unique UID for the event
      const eventData = {
        ...req.body,
        uid: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`
      };
      
      // Validate with zod
      const validatedData = insertEventSchema.parse(eventData);
      
      const newEvent = await storage.createEvent(validatedData);
      res.status(201).json(newEvent);
    } catch (err) {
      console.error("Error creating event:", err);
      return handleZodError(err, res);
    }
  });

  app.put("/api/events/:id", async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      
      // Validate with zod (partial validation for update)
      const validatedData = insertEventSchema.partial().parse(req.body);
      
      const updatedEvent = await storage.updateEvent(eventId, validatedData);
      
      if (!updatedEvent) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      res.json(updatedEvent);
    } catch (err) {
      console.error("Error updating event:", err);
      return handleZodError(err, res);
    }
  });

  app.delete("/api/events/:id", async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const deleted = await storage.deleteEvent(eventId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting event:", err);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  // Server connection routes
  app.get("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      // Don't return the password in the response
      const { password, ...connectionWithoutPassword } = connection;
      res.json(connectionWithoutPassword);
    } catch (err) {
      console.error("Error fetching server connection:", err);
      res.status(500).json({ message: "Failed to fetch server connection" });
    }
  });

  app.post("/api/server-connection", async (req, res) => {
    try {
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
      
      // Add userId to request body
      const connectionData = { ...req.body, userId };
      
      // Validate with zod
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      
      const newConnection = await storage.createServerConnection(validatedData);
      
      // Don't return the password in the response
      const { password, ...connectionWithoutPassword } = newConnection;
      res.status(201).json(connectionWithoutPassword);
    } catch (err) {
      console.error("Error creating server connection:", err);
      return handleZodError(err, res);
    }
  });

  app.put("/api/server-connection/:id", async (req, res) => {
    try {
      const connectionId = parseInt(req.params.id);
      
      // Validate with zod (partial validation for update)
      const validatedData = insertServerConnectionSchema.partial().parse(req.body);
      
      const updatedConnection = await storage.updateServerConnection(connectionId, validatedData);
      
      if (!updatedConnection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      // Don't return the password in the response
      const { password, ...connectionWithoutPassword } = updatedConnection;
      res.json(connectionWithoutPassword);
    } catch (err) {
      console.error("Error updating server connection:", err);
      return handleZodError(err, res);
    }
  });

  app.delete("/api/server-connection/:id", async (req, res) => {
    try {
      const connectionId = parseInt(req.params.id);
      const deleted = await storage.deleteServerConnection(connectionId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting server connection:", err);
      res.status(500).json({ message: "Failed to delete server connection" });
    }
  });

  // CalDAV sync endpoint
  app.post("/api/sync", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      
      // Update the last sync time
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      // Create a CalDAV client with the stored connection data
      const { DAVClient } = await import('tsdav');
      const davClient = new DAVClient({
        serverUrl: connection.url,
        credentials: {
          username: connection.username,
          password: connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      try {
        // Attempt to login and discover calendars
        await davClient.login();
        const calendars = await davClient.fetchCalendars();
        
        // Update connection status
        const updatedConnection = await storage.updateServerConnection(connection.id, {
          lastSync: new Date(),
          status: "connected"
        });
        
        res.json({ 
          message: "Sync successful", 
          lastSync: updatedConnection?.lastSync,
          calendarsCount: calendars.length
        });
      } catch (error) {
        console.error("CalDAV sync failed:", error);
        
        // Update status to reflect failure
        await storage.updateServerConnection(connection.id, {
          lastSync: new Date(),
          status: "error"
        });
        
        res.status(500).json({ message: "Failed to sync with CalDAV server" });
      }
    } catch (err) {
      console.error("Error syncing with CalDAV server:", err);
      res.status(500).json({ message: "Failed to sync with CalDAV server" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
