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
      const calendars = await storage.getCalendars(userId);
      res.json(calendars);
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
  app.get("/api/calendars/:calendarId/events", async (req, res) => {
    try {
      const calendarId = parseInt(req.params.calendarId);
      const events = await storage.getEvents(calendarId);
      res.json(events);
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
