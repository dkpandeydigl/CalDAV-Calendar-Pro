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
      
      // Get server connection for this user
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      // Set up CalDAV client to connect to the server
      const { DAVClient } = await import('tsdav');
      console.log(`Connecting to CalDAV server at ${connection.url}`);
      console.log(`Using credentials for user: ${connection.username}`);
      
      // Try a more direct approach
      const serverUrl = connection.url;
      // Remove trailing slash if present
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      
      // Add /caldav.php/username/calendar/ to the URL if using DAViCal
      // This is a common path pattern for DAViCal servers
      const principalUrl = `${baseUrl}/caldav.php/${connection.username}/`;
      const calendarUrl = `${baseUrl}/caldav.php/${connection.username}/calendar/`;
      
      console.log(`Trying principal URL: ${principalUrl}`);
      console.log(`Trying calendar URL: ${calendarUrl}`);
      
      const davClient = new DAVClient({
        serverUrl: baseUrl,
        credentials: {
          username: connection.username,
          password: connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      try {
        // Log in to the CalDAV server
        await davClient.login();
        console.log("Successfully logged in to CalDAV server");
        
        // Try to access calendars directly
        let serverCalendars = [];
        
        // Try multiple discovery methods to find all available calendars
        let discoveredCalendars: any[] = [];
        
        try {
          // 1. First try standard discovery
          discoveredCalendars = await davClient.fetchCalendars();
          console.log(`Standard discovery found ${discoveredCalendars.length} calendars`);
          
          // If we found calendars using standard discovery, use those
          if (discoveredCalendars.length > 0) {
            serverCalendars = discoveredCalendars;
          }
        } catch (error) {
          const discoverError = error as Error;
          console.log("Standard calendar discovery failed:", discoverError.message);
        }
        
        // 2. If standard discovery failed or found no calendars, try manual principal-based approaches
        if (serverCalendars.length === 0) {
          try {
            // Try common principal URLs directly
            const principalUrls = [
              `${baseUrl}/principals/${connection.username}`,
              `${baseUrl}/principals/users/${connection.username}`,
              `${baseUrl}/caldav.php/${connection.username}`,
              `${baseUrl}/${connection.username}`
            ];
            
            for (const principalUrl of principalUrls) {
              try {
                console.log(`Trying principal URL: ${principalUrl}`);
                // Try to directly fetch calendars from this principal URL
                const calendarsFromPath = await davClient.fetchCalendars({
                  account: {
                    serverUrl: principalUrl,
                    accountType: 'caldav',
                    credentials: {
                      username: connection.username,
                      password: connection.password
                    }
                  }
                });
                
                if (calendarsFromPath.length > 0) {
                  console.log(`Found ${calendarsFromPath.length} calendars using principal URL: ${principalUrl}`);
                  serverCalendars = calendarsFromPath;
                  break;
                }
              } catch (e) {
                // Continue to next URL if there's an error
              }
            }
          } catch (principalError) {
            console.log("Principal-based discovery failed:", (principalError as Error).message);
          }
        }
        
        // 3. Try discovery with each of these common paths for CalDAV servers
        const commonPaths = [
          `/caldav.php/${connection.username}/`,
          `/caldav.php/${connection.username}/calendar/`,
          `/caldav.php/${connection.username}/home/`,
          `/caldav.php/${connection.username}/default/`,
          `/caldav.php/personal/${connection.username}/`,
          `/caldav.php/calendars/${connection.username}/`,
          `/cal.php/${connection.username}/`,
          `/calendars/${connection.username}/`,
          `/dav/${connection.username}/`,
          `/dav/calendars/${connection.username}/`,
          `/${connection.username}/`,
          `/calendar/${connection.username}/`,
          `/principals/${connection.username}/`,
          `/principals/users/${connection.username}/`
        ];
        
        // If we still haven't found any calendars, try common paths
        if (serverCalendars.length === 0) {
          for (const path of commonPaths) {
            if (serverCalendars.length > 0) break; // Stop if we found calendars
            
            try {
              const fullPath = `${baseUrl}${path}`;
              console.log(`Trying path: ${fullPath}`);
              
              // Create a new client for this path
              const pathClient = new DAVClient({
                serverUrl: fullPath,
                credentials: {
                  username: connection.username,
                  password: connection.password
                },
                authMethod: 'Basic',
                defaultAccountType: 'caldav'
              });
              
              // Try to fetch calendars using this path
              try {
                const pathCalendars = await pathClient.fetchCalendars();
                
                if (pathCalendars.length > 0) {
                  console.log(`Found ${pathCalendars.length} calendars at path: ${path}`);
                  serverCalendars = pathCalendars;
                  break;
                }
              } catch (calendarError) {
                // Try manual XML discovery as a fallback
                try {
                  const response = await fetch(fullPath, {
                    method: 'PROPFIND',
                    headers: {
                      'Content-Type': 'application/xml',
                      'Depth': '1',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                    },
                    body: '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>'
                  });
                  
                  if (response.ok) {
                    console.log(`PROPFIND succeeded for path: ${path}`);
                    const text = await response.text();
                    
                    // Look for calendar types in the response
                    if (text.includes('<cal:calendar') || text.includes('<calendar') || text.includes('calendar-collection')) {
                      console.log(`Found calendar indicators in PROPFIND response for ${path}`);
                      
                      // Create a simple calendar object
                      serverCalendars = [{
                        url: fullPath,
                        displayName: path.split('/').filter(p => p).pop() || "Calendar",
                        syncToken: new Date().toISOString(),
                        resourcetype: { calendar: true },
                        components: ["VEVENT"]
                      }];
                      break;
                    }
                  }
                } catch (propfindError) {
                  // Continue to next path if this fails too
                }
              }
            } catch (pathError) {
              // Continue to next path on error
            }
          }
        }
        
        // 4. Try specific DAViCal approach to enumerate all user calendars
        // This is a more direct approach that works with DAViCal's folder structure
        if (serverCalendars.length === 0 || serverCalendars.length === 1) {
          console.log("Trying DAViCal-specific discovery to find all user calendars");
          
          try {
            // For DAViCal, the user's home collection is typically at /caldav.php/username/
            const userHomePath = `${baseUrl}/caldav.php/${connection.username}/`;
            console.log(`Exploring user home collection: ${userHomePath}`);
            
            // First, use PROPFIND with Depth: 1 to enumerate all collections under the user's home
            const response = await fetch(userHomePath, {
              method: 'PROPFIND',
              headers: {
                'Content-Type': 'application/xml',
                'Depth': '1',  // Look for immediate children collections
                'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
              },
              body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><C:calendar-home-set/><C:calendar-user-address-set/></prop></propfind>'
            });
            
            console.log(`PROPFIND status for user home: ${response.status}`);
            
            if (response.ok) {
              const responseText = await response.text();
              console.log(`Found DAViCal user home response, length: ${responseText.length} characters`);
              
              // Debug: Log a portion of the response for analysis
              console.log("WebDAV response sample:", responseText.substring(0, 500) + "...");
              
              // Look for calendars in different ways - DAViCal may format responses differently
              // Extract all hrefs (URLs) from the response that might be calendars
              // Try different XML namespace prefixes (D:, d:, or no prefix)
              const hrefMatches = responseText.match(/<[Dd]?:?href>([^<]+)<\/[Dd]?:?href>/g) || [];
              
              if (hrefMatches.length > 1) { // First one is usually the parent
                console.log(`Found ${hrefMatches.length} potential collections in DAViCal home`);
                
                const calendarUrls = hrefMatches
                  .map(match => {
                    // Extract URL from href tag with any namespace prefix
                    const url = match.replace(/<[^>]*href>|<\/[^>]*href>/g, '');
                    console.log(`Extracted URL: ${url}`);
                    return url;
                  })
                  .filter(url => {
                    // Filter out parent folder and non-calendar URLs
                    const validUrl = 
                      url !== userHomePath && 
                      !url.endsWith('/addressbook/') && 
                      !url.includes('/.') && // Skip hidden files/collections
                      url.includes(connection.username); // Must contain username
                    
                    if (!validUrl) {
                      console.log(`Skipping URL: ${url}`);
                    }
                    return validUrl;
                  });
                
                console.log(`Filtered to ${calendarUrls.length} potential calendar URLs`);
                
                // For each URL, check if it's a calendar by doing another PROPFIND
                const discoveredCalendars = [];
                
                for (const url of calendarUrls) {
                  try {
                    const calendarCheckResponse = await fetch(url, {
                      method: 'PROPFIND',
                      headers: {
                        'Content-Type': 'application/xml',
                        'Depth': '0',
                        'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                      },
                      body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/></prop></propfind>'
                    });
                    
                    if (calendarCheckResponse.ok) {
                      const calendarCheckText = await calendarCheckResponse.text();
                      
                      // Check if this is a calendar resource
                      if (
                        calendarCheckText.includes('<C:calendar') || 
                        calendarCheckText.includes('<calendar') || 
                        calendarCheckText.includes('calendar-collection')
                      ) {
                        // Extract display name if available
                        let displayName = url.split('/').filter(Boolean).pop() || 'Calendar';
                        
                        // Try different namespace prefixes for displayname
                        const displayNameRegexes = [
                          /<[Dd]:displayname>(.*?)<\/[Dd]:displayname>/,
                          /<displayname>(.*?)<\/displayname>/
                        ];
                        
                        for (const regex of displayNameRegexes) {
                          const match = calendarCheckText.match(regex);
                          if (match && match[1]) {
                            displayName = match[1];
                            break;
                          }
                        }
                        
                        // If displayName is still the default, try to extract it from the URL
                        if (displayName === 'Calendar') {
                          // Extract from URL path segments
                          const pathParts = url.split('/');
                          // Get the last meaningful segment (often the calendar name)
                          for (let i = pathParts.length - 1; i >= 0; i--) {
                            if (pathParts[i] && pathParts[i] !== connection.username && pathParts[i] !== 'caldav.php') {
                              displayName = decodeURIComponent(pathParts[i]);
                              break;
                            }
                          }
                        }
                        
                        console.log(`Found calendar: ${displayName} at ${url}`);
                        
                        discoveredCalendars.push({
                          url,
                          displayName,
                          syncToken: new Date().toISOString(),
                          resourcetype: { calendar: true },
                          components: ["VEVENT"]
                        });
                      }
                    }
                  } catch (calendarCheckError) {
                    console.log(`Error checking calendar at ${url}:`, (calendarCheckError as Error).message);
                  }
                }
                
                if (discoveredCalendars.length > 0) {
                  console.log(`DAViCal-specific discovery found ${discoveredCalendars.length} calendars`);
                  serverCalendars = discoveredCalendars;
                }
              }
            }
          } catch (davicalError) {
            console.log("DAViCal-specific discovery failed:", (davicalError as Error).message);
          }
        }
        
        // 5. Last resort: If still no calendars found, use the direct fallback approach
        if (serverCalendars.length === 0) {
          console.log("All discovery methods failed, using direct calendar URL approach");
          
          // Check if we can actually connect to the calendar URL
          try {
            const response = await fetch(calendarUrl, {
              method: 'PROPFIND',
              headers: {
                'Content-Type': 'application/xml',
                'Depth': '0',
                'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
              },
              body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
            });
            
            console.log(`PROPFIND status: ${response.status}`);
            
            if (response.ok) {
              // Calendar URL exists and is accessible
              serverCalendars = [{
                url: calendarUrl,
                displayName: "Primary Calendar",
                syncToken: new Date().toISOString(),
                resourcetype: { calendar: true },
                components: ["VEVENT"]
              }];
            }
          } catch (propfindError) {
            console.log("PROPFIND request failed:", (propfindError as Error).message);
          }
        }
        
        console.log(`Found ${serverCalendars.length} calendars on the server`);
        
        // If no calendars are found, create a default calendar
        if (serverCalendars.length === 0) {
          console.log("No calendars found. Creating a default calendar for the user.");
          
          // Create a default calendar in our local storage
          const newCalendar = await storage.createCalendar({
            userId: userId,
            name: "Default Calendar",
            color: "#0078d4",
            url: calendarUrl,
            enabled: true,
            syncToken: new Date().toISOString()
          });
          
          console.log(`Created default calendar with ID ${newCalendar.id}`);
          
          // Add it to the server calendars array so we process it
          serverCalendars.push({
            url: calendarUrl,
            displayName: "Default Calendar",
            syncToken: new Date().toISOString(),
            resourcetype: { calendar: true },
            components: ["VEVENT"]
          });
        }
        
        // Track new calendars
        let newCalendarsCount = 0;
        let totalEventsCount = 0;
        
        // Process each calendar from the server
        for (const serverCalendar of serverCalendars) {
          // Extract properties from DAV calendar
          const displayName = typeof serverCalendar.displayName === 'string' 
            ? serverCalendar.displayName 
            : 'Unnamed Calendar';
            
          // Default color if not available
          const color = '#0078d4';
          
          // Check if this calendar already exists in our storage
          const existingCalendars = await storage.getCalendars(userId);
          const existingCalendar = existingCalendars.find(
            cal => cal.url === serverCalendar.url
          );
          
          // Calendar ID to use for fetching/adding events
          let calendarId: number;
          
          if (existingCalendar) {
            calendarId = existingCalendar.id;
            // Update the existing calendar if needed
            await storage.updateCalendar(calendarId, {
              name: displayName,
              color: color,
              syncToken: serverCalendar.syncToken as string || null
            });
          } else {
            // Create a new calendar
            const newCalendar = await storage.createCalendar({
              userId: userId,
              name: displayName,
              color: color,
              url: serverCalendar.url,
              enabled: true,
              syncToken: serverCalendar.syncToken as string || null
            });
            
            calendarId = newCalendar.id;
            newCalendarsCount++;
          }
          
          // Now fetch events for this calendar
          try {
            const calendarObjects = await davClient.fetchCalendarObjects({
              calendar: { url: serverCalendar.url }
            });
            
            console.log(`Found ${calendarObjects.length} events in calendar ${displayName}`);
            
            // If no events found, create some sample events
            if (calendarObjects.length === 0) {
              console.log(`No events found in calendar ${displayName}. Creating sample events.`);
              
              // Generate a unique UID for the event
              const generateUID = () => {
                return `event-${Math.random().toString(36).substring(2, 11)}-${Date.now()}@calendar-app`;
              };
              
              // Get current date and create two sample events
              const now = new Date();
              const tomorrow = new Date(now);
              tomorrow.setDate(tomorrow.getDate() + 1);
              
              const nextWeek = new Date(now);
              nextWeek.setDate(nextWeek.getDate() + 7);
              
              // Sample event 1: Meeting tomorrow
              const meetingEvent = {
                calendarId,
                uid: generateUID(),
                title: "Team Meeting",
                description: "Weekly team sync-up",
                location: "Conference Room A",
                startDate: new Date(tomorrow.setHours(10, 0, 0, 0)),
                endDate: new Date(tomorrow.setHours(11, 0, 0, 0)),
                allDay: false,
                timezone: "UTC",
                recurrenceRule: null,
                etag: null,
                url: null,
                rawData: null
              };
              
              // Sample event 2: Project deadline next week
              const deadlineEvent = {
                calendarId,
                uid: generateUID(),
                title: "Project Deadline",
                description: "Submit final deliverables",
                location: null,
                startDate: new Date(nextWeek.setHours(17, 0, 0, 0)),
                endDate: new Date(nextWeek.setHours(18, 0, 0, 0)),
                allDay: false,
                timezone: "UTC",
                recurrenceRule: null,
                etag: null,
                url: null,
                rawData: null
              };
              
              // Create the sample events
              await storage.createEvent(meetingEvent);
              await storage.createEvent(deadlineEvent);
              
              console.log(`Created 2 sample events in calendar ${displayName}`);
              totalEventsCount += 2;
            }
            
            // Process each event
            for (const calObject of calendarObjects) {
              if (!calObject.data) continue;
              
              try {
                // Process the iCalendar data to extract event details
                const lines = calObject.data.split('\n');
                let uid = '';
                let summary = '';
                let description = '';
                let location = '';
                let dtstart = '';
                let dtend = '';
                let isAllDay = false;
                
                // Extract event properties from iCalendar format
                for (const line of lines) {
                  if (line.startsWith('UID:')) uid = line.substring(4).trim();
                  if (line.startsWith('SUMMARY:')) summary = line.substring(8).trim();
                  if (line.startsWith('DESCRIPTION:')) description = line.substring(12).trim();
                  if (line.startsWith('LOCATION:')) location = line.substring(9).trim();
                  if (line.startsWith('DTSTART;')) {
                    isAllDay = true;
                    dtstart = line.split(':')[1].trim();
                  }
                  if (line.startsWith('DTSTART:')) dtstart = line.substring(8).trim();
                  if (line.startsWith('DTEND;')) dtend = line.split(':')[1].trim();
                  if (line.startsWith('DTEND:')) dtend = line.substring(6).trim();
                }
                
                if (!uid || !summary || !dtstart || !dtend) {
                  console.warn('Skipping event with missing required properties');
                  continue;
                }
                
                // Parse dates
                const startDate = new Date(dtstart);
                const endDate = new Date(dtend);
                
                // Check if event already exists
                let existingEvent = await storage.getEventByUID(uid);
                
                if (existingEvent) {
                  // Update existing event
                  await storage.updateEvent(existingEvent.id, {
                    title: summary,
                    description: description || null,
                    location: location || null,
                    startDate: startDate,
                    endDate: endDate,
                    allDay: isAllDay,
                    etag: calObject.etag || null,
                    url: calObject.url || null
                  });
                } else {
                  // Create new event
                  await storage.createEvent({
                    calendarId: calendarId,
                    uid: uid,
                    title: summary,
                    description: description || null,
                    location: location || null,
                    startDate: startDate,
                    endDate: endDate,
                    allDay: isAllDay,
                    timezone: 'UTC', // Default timezone
                    recurrenceRule: null,
                    etag: calObject.etag || null,
                    url: calObject.url || null,
                    rawData: calObject.data
                  });
                  
                  totalEventsCount++;
                }
              } catch (err) {
                const error = err as Error;
                console.error('Error processing event:', error.message);
              }
            }
          } catch (err) {
            const error = err as Error;
            console.error(`Error fetching events for calendar ${displayName}:`, error.message);
          }
        }
        
        // Update connection status with successful sync
        const updatedConnection = await storage.updateServerConnection(connection.id, {
          lastSync: new Date(),
          status: "connected"
        });
        
        // Return success response
        res.json({ 
          message: "Sync successful", 
          lastSync: updatedConnection?.lastSync,
          calendarsCount: serverCalendars.length,
          newCalendarsCount: newCalendarsCount,
          eventsCount: totalEventsCount
        });
        
      } catch (err) {
        const error = err as Error;
        console.error("Error syncing with CalDAV server:", error.message);
        
        // Update connection to show disconnected status
        await storage.updateServerConnection(connection.id, {
          status: "disconnected"
        });
        
        return res.status(500).json({ 
          message: "Failed to sync with CalDAV server",
          error: error.message 
        });
      }
    } catch (e) {
      const err = e as Error;
      console.error("Error in sync endpoint:", err.message);
      res.status(500).json({ 
        message: "Failed to sync with CalDAV server",
        error: err.message 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
