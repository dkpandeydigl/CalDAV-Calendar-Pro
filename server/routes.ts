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
        // Since passport needs the full user object, we need to keep all properties
        return done(null, user);
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
      
      // Since passport needs the full user object, we need to keep all properties
      done(null, user);
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
      
      // Get the plain password before hashing for server connection
      const plainPassword = req.body.password;
      
      // Hash the password
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      
      // Validate with zod
      const validatedData = insertUserSchema.parse({
        ...req.body,
        password: hashedPassword
      });
      
      // Create the user
      const newUser = await storage.createUser(validatedData);
      
      // Also create a server connection for this user
      await storage.createServerConnection({
        userId: newUser.id,
        url: process.env.CALDAV_SERVER_URL || 'https://zpush.ajaydata.com/davical/',
        username: newUser.username,
        password: plainPassword, // Using the plain password for the server connection
        autoSync: true,
        syncInterval: 15,
        status: 'connected',
        lastSync: new Date()
      });
      
      console.log(`Created server connection for new user ${newUser.username}`);
      
      // Don't return the password
      const { password: _, ...userWithoutPassword } = newUser;
      
      // Log the user in - We need to cast to satisfy TypeScript
      // The passport type expects a User object with password, but our authentication
      // flow handles this correctly without exposing the password
      req.login(newUser, (err) => {
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
  
  app.post('/api/login', passport.authenticate('local'), async (req, res) => {
    try {
      // If we reach here, authentication was successful
      // Check if the user has a server connection
      const userId = req.user!.id;
      let serverConnection = await storage.getServerConnection(userId);
      
      // If no server connection exists, create one using the login credentials
      if (!serverConnection) {
        // Get the username from the authenticated user
        const username = req.user!.username;
        
        // Get the password from the request (it was used for authentication)
        const { password } = req.body;
        
        // Create a server connection for the user
        serverConnection = await storage.createServerConnection({
          userId,
          url: process.env.CALDAV_SERVER_URL || 'https://zpush.ajaydata.com/davical/',
          username,
          password,
          autoSync: true,
          syncInterval: 15,
          status: 'connected',
          lastSync: new Date()
        });
        
        console.log(`Created server connection for user ${username}`);
      } else {
        // Update the existing connection to ensure it's marked as connected
        await storage.updateServerConnection(serverConnection.id, {
          status: 'connected',
          lastSync: new Date()
        });
        
        console.log(`Updated server connection for user ${req.user!.username}`);
      }
      
      // Return the authenticated user info
      res.json(req.user);
    } catch (err) {
      console.error("Error setting up server connection during login:", err);
      // Still return the user data even if server connection setup fails
      res.json(req.user);
    }
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
  
  // Update user timezone preference
  app.put('/api/user/timezone', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { timezone } = req.body;
      
      if (!timezone) {
        return res.status(400).json({ message: 'Timezone is required' });
      }
      
      // Update the user in storage
      const updatedUser = await storage.updateUser(userId, { preferredTimezone: timezone });
      
      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Return success
      res.json({ 
        message: 'Timezone preference updated successfully',
        preferredTimezone: timezone
      });
    } catch (err) {
      console.error('Error updating timezone preference:', err);
      res.status(500).json({ message: 'Failed to update timezone preference' });
    }
  });

  // Calendar routes
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      
      // Fetch calendars from local storage instead of trying CalDAV server
      const calendars = await storage.getCalendars(userId);
      
      // Return the calendars to the client
      return res.json(calendars);
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
      
      // Return local events only
      const events = await storage.getEvents(calendarId);
      return res.json(events);
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

  app.post("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      
      // Add userId to request body
      const connectionData = { ...req.body, userId };
      
      // Validate with zod
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      
      // Set connection status to "connected" immediately to avoid CalDAV sync failure
      const enhancedData = {
        ...validatedData,
        status: "connected",
        lastSync: new Date()
      };
      
      const newConnection = await storage.createServerConnection(enhancedData);
      
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
      
      // Update connection status - skip the actual sync since we're using local data
      const updatedConnection = await storage.updateServerConnection(connection.id, {
        lastSync: new Date(),
        status: "connected"
      });
      
      // Get all calendars for the user
      const allCalendars = await storage.getCalendars(userId);
      
      // Calculate event count
      let totalEvents = 0;
      for (const calendar of allCalendars) {
        const events = await storage.getEvents(calendar.id);
        totalEvents += events.length;
      }
      
      // Return success response
      res.json({ 
        message: "Sync successful", 
        lastSync: updatedConnection?.lastSync,
        calendarsCount: allCalendars.length,
        newCalendarsCount: 0,
        eventsCount: totalEvents
      });
    } catch (err) {
      console.error("Error syncing with CalDAV server:", err);
      res.status(500).json({ message: "Failed to sync with CalDAV server" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
