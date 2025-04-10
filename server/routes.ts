import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncService } from './sync-service';
import { emailService } from './email-service';
import { 
  insertCalendarSchema, 
  insertEventSchema, 
  insertServerConnectionSchema,
  insertUserSchema,
  insertSmtpConfigSchema,
  User,
  serverConnections,
  CalendarSharing,
  calendars,
  smtpConfigurations
} from "@shared/schema";
import { db } from "./db";
import { registerExportRoutes } from "./export-routes";
import { registerImportRoutes } from "./import-routes";
import { eq, inArray, sql } from "drizzle-orm";
import { parse, formatISO } from "date-fns";
import { ZodError } from "zod";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { WebSocketServer, WebSocket } from 'ws';

// Extend the session interface to include our custom properties
declare module "express-session" {
  interface SessionData {
    recentlyDeletedEvents?: number[];
  }
}

// Define user type for Express
declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
    }
    
    interface Request {
      session: session.Session & {
        recentlyDeletedEvents?: number[];
      };
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication
  setupAuth(app);
  
  // Register export/import routes
  registerExportRoutes(app);
  registerImportRoutes(app);
  
  // Setup auth with passport
  function setupAuth(app: Express) {
    const MemoryStore = session.MemoryStore;
    
    const sessionSettings: session.SessionOptions = {
      secret: process.env.SESSION_SECRET || 'your-session-secret',
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore(),
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    };
    
    app.use(session(sessionSettings));
    app.use(passport.initialize());
    app.use(passport.session());
    
    // Configure Passport to use local strategy
    passport.use(new LocalStrategy(async (username, password, done) => {
      try {
        // First check if the user exists in the users table
        const user = await storage.getUserByUsername(username);
        
        if (user) {
          // Check if the password is stored in bcrypt format
          if (user.password && user.password.startsWith('$2')) {
            // Compare with bcrypt
            const match = await bcrypt.compare(password, user.password);
            if (match) {
              return done(null, user);
            }
          }
        }
        
        // If user not found or bcrypt password doesn't match, try server_connections
        const serverConnection = await storage.getServerConnectionByUsername(username);
        if (serverConnection && serverConnection.password === password) {
          // If connection credentials match, get the associated user
          const connectionUser = await storage.getUser(serverConnection.userId);
          if (connectionUser) {
            return done(null, connectionUser);
          }
        }
        
        // If we get here, authentication failed
        return done(null, false);
      } catch (error) {
        return done(error);
      }
    }));
    
    // Serialize user to the session
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });
    
    // Deserialize user from the session
    passport.deserializeUser(async (id: number, done) => {
      try {
        const user = await storage.getUser(id);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });
    
    // Authentication routes
    app.post('/api/login', passport.authenticate('local'), (req, res) => {
      res.json(req.user);
    });
    
    app.post('/api/logout', (req, res, next) => {
      req.logout((err) => {
        if (err) return next(err);
        res.sendStatus(200);
      });
    });
  }
  
  // Middleware to check if user is authenticated
  function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.isAuthenticated()) {
      return next();
    }
    return res.status(401).json({ message: "Not authenticated" });
  }
  
  // Handler for Zod validation errors
  function handleZodError(err: unknown, res: Response) {
    if (err instanceof ZodError) {
      return res.status(400).json({ 
        message: "Validation failed", 
        errors: err.errors 
      });
    }
    return res.status(500).json({ message: "An error occurred" });
  }
  
  // AUTHENTICATION ENDPOINTS
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    return res.json(req.user);
  });
  
  // CALENDARS API
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const userCalendars = await storage.getCalendars(userId);
      res.json(userCalendars);
    } catch (err) {
      console.error("Error fetching calendars:", err);
      res.status(500).json({ message: "Failed to fetch calendars" });
    }
  });
  
  app.post("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Validate the request body
      const validatedData = insertCalendarSchema.parse({
        ...req.body,
        userId
      });
      
      const newCalendar = await storage.createCalendar(validatedData);
      
      // Attempt to create the calendar on the CalDAV server if the user has a server connection
      try {
        const connection = await storage.getServerConnection(userId);
        if (connection && connection.status === 'connected') {
          // Import dynamically to prevent issues with server-side rendering
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
          
          // Login to the server
          await davClient.login();
          
          // Get all calendars to find the principal URL
          const calendars = await davClient.fetchCalendars();
          if (calendars.length > 0) {
            // Extract principal URL from the first calendar, assuming all share the same principal
            const principalUrl = calendars[0].principalUrl || '';
            
            // Check if we found a valid principal URL
            if (principalUrl) {
              // Create a new calendar
              // Note: DaviCal has specific URL requirements, we need to ensure the URL is properly constructed
              // The URL must include the username from the connection
              // Example: https://example.com/caldav.php/username/calendar-name/
              
              // Find the caldav.php part in the principal URL
              const urlParts = principalUrl.split('/');
              const caldavIndex = urlParts.findIndex(p => p === 'caldav.php');
              if (caldavIndex >= 0 && caldavIndex + 1 < urlParts.length) {
                // Get the username from the URL
                const username = urlParts[caldavIndex + 1];
                // Create a calendar with a proper DaviCal URL
                
                // DaviCal requires calendar names to be lowercase and without spaces
                const sanitizedCalendarName = newCalendar.name.toLowerCase().replace(/\s+/g, '-');
                
                // Create the calendar URL
                const calendarUrl = `${connection.url}/caldav.php/${username}/${sanitizedCalendarName}/`;
                
                // Try to create the calendar on the server
                console.log(`Creating calendar on server at ${calendarUrl}`);
                try {
                  await davClient.createCalendarCollection({
                    url: calendarUrl,
                    props: {
                      'displayname': newCalendar.name,
                      'calendar-color': newCalendar.color,
                    }
                  });
                  
                  // Update the calendar with the server URL
                  await storage.updateCalendar(newCalendar.id, { url: calendarUrl });
                  
                  // Return the updated calendar
                  const updatedCalendar = await storage.getCalendar(newCalendar.id);
                  console.log(`Successfully created calendar on CalDAV server and updated local database with URL: ${calendarUrl}`);
                  
                  // Return the calendar
                  return res.status(201).json(updatedCalendar);
                } catch (createError) {
                  console.error("Error creating calendar on CalDAV server:", createError);
                  // Continue and return the local calendar even if server creation fails
                }
              }
            }
          }
        }
      } catch (serverError) {
        console.error("Error connecting to CalDAV server:", serverError);
        // Continue and return the local calendar even if server creation fails
      }
      
      // If we couldn't create the calendar on the server or there was an error,
      // just return the locally created calendar
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  app.put("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarId = parseInt(req.params.id);
      
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      // Get the existing calendar to verify ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check that the user owns the calendar
      if (existingCalendar.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to update this calendar" });
      }
      
      // Parse the request body to ensure valid data
      const validatedData = insertCalendarSchema.parse({
        ...req.body,
        userId // Ensure the userId isn't changed
      });
      
      // Only update allowed fields
      const updatedCalendar = await storage.updateCalendar(calendarId, {
        name: validatedData.name,
        color: validatedData.color,
        description: validatedData.description,
        isDefault: validatedData.isDefault,
        timezone: validatedData.timezone
      });
      
      if (!updatedCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // If the calendar exists on the server, update it there too
      if (updatedCalendar.url) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client
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
            
            // Login to the server
            await davClient.login();
            
            // Use PROPPATCH to update the calendar properties on the server
            await davClient.davRequest({
              url: updatedCalendar.url,
              init: {
                method: 'PROPPATCH',
                headers: {
                  'Content-Type': 'application/xml; charset=utf-8',
                },
                body: `<?xml version="1.0" encoding="utf-8" ?>
                  <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                    <D:set>
                      <D:prop>
                        <D:displayname>${updatedCalendar.name}</D:displayname>
                        <C:calendar-color>${updatedCalendar.color}</C:calendar-color>
                      </D:prop>
                    </D:set>
                  </D:propertyupdate>`
              }
            });
            
            console.log(`Successfully updated calendar on CalDAV server: ${updatedCalendar.url}`);
          } else {
            console.log(`User ${userId} does not have an active server connection, can't update calendar on server`);
          }
        } catch (error) {
          console.error(`Error updating calendar on CalDAV server:`, error);
          // Continue with return even if server update fails
        }
      }
      
      res.json(updatedCalendar);
    } catch (err) {
      console.error("Error updating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // Delete a calendar
  app.delete("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarId = parseInt(req.params.id);
      
      if (isNaN(calendarId)) {
        return res.status(400).json({ message: "Invalid calendar ID" });
      }
      
      // Get the existing calendar to verify ownership
      const existingCalendar = await storage.getCalendar(calendarId);
      if (!existingCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check that the user owns the calendar
      if (existingCalendar.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to delete this calendar" });
      }
      
      // If the calendar exists on the DAViCal server, delete it there first
      if (existingCalendar.url && existingCalendar.url.includes('/caldav.php/')) {
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Parse the calendar URL to get components
            const urlObj = new URL(existingCalendar.url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            
            // Find the caldav.php part in the URL
            const caldavIndex = pathParts.findIndex(p => p === 'caldav.php');
            
            // Extract user and calendar name from URL
            let username = '';
            let calendarName = '';
            
            if (caldavIndex >= 0 && caldavIndex + 2 < pathParts.length) {
              username = decodeURIComponent(pathParts[caldavIndex + 1]);
              calendarName = pathParts[caldavIndex + 2];
            }
            
            if (!username || !calendarName) {
              throw new Error(`Cannot parse calendar username or name from URL: ${existingCalendar.url}`);
            }
            
            console.log(`Attempting to delete calendar: ${calendarName} for user: ${username}`);
            
            // First try standard DELETE
            try {
              console.log(`Using standard DELETE for URL: ${existingCalendar.url}`);
              const response = await fetch(existingCalendar.url, {
                method: 'DELETE',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                  'Depth': 'infinity'
                }
              });
              
              if (response.ok) {
                console.log(`Successfully deleted calendar with standard DELETE (Status: ${response.status})`);
              } else {
                // If standard delete fails, try DaviCal-specific method
                console.log(`Standard DELETE failed with status: ${response.status}`);
                
                // Try DAViCal-specific deletion via web API
                try {
                  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                  
                  console.log(`Trying DAViCal-specific deletion API for ${username}/${calendarName}`);
                  
                  const davicalResponse = await fetch(`${baseUrl}/caldav.php/`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'Accept': 'text/html,application/xhtml+xml',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                    },
                    body: new URLSearchParams({
                      'delete_calendar': '1',
                      'calendar_path': `/${username}/${calendarName}/`,
                    }).toString()
                  });
                  
                  console.log(`DAViCal deletion API response: ${davicalResponse.status}`);
                  
                  if (davicalResponse.ok || davicalResponse.status === 302) {
                    console.log(`Successfully deleted calendar using DAViCal API`);
                  } else {
                    // If that also fails, try the admin interface
                    console.log(`DAViCal API deletion failed with status: ${davicalResponse.status}`);
                    
                    // Try DAViCal admin interface method
                    try {
                      console.log(`Trying DAViCal admin deletion for ${username}/${calendarName}`);
                      
                      const adminResponse = await fetch(`${baseUrl}/admin.php`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/x-www-form-urlencoded',
                          'Accept': 'text/html,application/xhtml+xml',
                          'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                        },
                        body: new URLSearchParams({
                          'action': 'delete',
                          'delete_type': 'calendar',
                          'user': username,
                          'calendar': calendarName,
                        }).toString()
                      });
                      
                      console.log(`DAViCal admin deletion response: ${adminResponse.status}`);
                      
                      if (adminResponse.ok || adminResponse.status === 302) {
                        console.log(`Successfully deleted calendar via admin interface`);
                      } else {
                        console.log(`Admin deletion failed with status: ${adminResponse.status}`);
                      }
                    } catch (adminError) {
                      console.error(`Admin deletion error:`, adminError);
                    }
                  }
                } catch (davicalError) {
                  console.error(`DAViCal API error:`, davicalError);
                }
              }
              
              // Verify if calendar was actually deleted
              try {
                console.log(`Verifying if calendar still exists at ${existingCalendar.url}`);
                const check = await fetch(existingCalendar.url, {
                  method: 'PROPFIND',
                  headers: {
                    'Depth': '0',
                    'Content-Type': 'application/xml',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                  },
                  body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
                });
                
                if (check.status === 404) {
                  console.log(`Calendar no longer exists - verification confirms deletion was successful`);
                } else {
                  console.log(`Calendar might still exist, status code: ${check.status}`);
                }
              } catch (checkError) {
                console.log(`Verification check error, calendar might be deleted:`, checkError);
              }
            } catch (deleteError) {
              console.error(`DELETE request error:`, deleteError);
            }
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
        }
      } else if (existingCalendar.url) {
        // For non-DaviCal servers, use the DAV client
        try {
          // Get the user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            // Create a DAV client
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
            
            // Login to the server
            await davClient.login();
            
            // Delete the calendar on the server
            await davClient.davRequest({
              url: existingCalendar.url,
              init: {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/xml; charset=utf-8',
                },
                body: '' // Empty body but required by type
              }
            });
            
            console.log(`Successfully deleted calendar from CalDAV server using DAV client`);
          } else {
            console.log(`User ${userId} does not have an active server connection, can't delete calendar on server`);
          }
        } catch (error) {
          console.error(`Error connecting to CalDAV server:`, error);
        }
      }
      
      // Delete the calendar and all its events locally
      const result = await storage.deleteCalendar(calendarId);
      
      if (result.success) {
        res.json({ message: "Calendar deleted successfully" });
      } else {
        res.status(500).json({ 
          message: "Failed to delete calendar", 
          error: result.error,
          details: result.details
        });
      }
    } catch (err) {
      console.error("Error deleting calendar:", err);
      res.status(500).json({ message: "Failed to delete calendar" });
    }
  });
  
  // EVENTS API
  app.get("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      let allEvents: any[] = [];
      
      // Check if calendarIds is provided as an array in the query parameter
      if (req.query.calendarIds) {
        // Convert array-like string to actual array of numbers
        let calendarIds: number[] = [];
        
        if (Array.isArray(req.query.calendarIds)) {
          // Handle case when it's already an array in req.query
          calendarIds = req.query.calendarIds.map(id => parseInt(id as string)).filter(id => !isNaN(id));
        } else if (typeof req.query.calendarIds === 'string') {
          // Handle case when it's a JSON string array
          try {
            const parsed = JSON.parse(req.query.calendarIds);
            if (Array.isArray(parsed)) {
              calendarIds = parsed.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
            }
          } catch (e) {
            // If not a valid JSON, try comma-separated values
            calendarIds = req.query.calendarIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
          }
        }
        
        // Get events for each calendar ID
        if (calendarIds.length > 0) {
          for (const calendarId of calendarIds) {
            const calendarEvents = await storage.getEvents(calendarId);
            allEvents = [...allEvents, ...calendarEvents];
          }
          return res.json(allEvents);
        }
      }
      
      // If no calendarIds array, check for single calendarId
      if (req.query.calendarId) {
        const calendarId = parseInt(req.query.calendarId as string);
        
        if (isNaN(calendarId)) {
          return res.status(400).json({ message: "Invalid calendar ID" });
        }
        
        const events = await storage.getEvents(calendarId);
        return res.json(events);
      }
      
      // If no specific calendar ID is provided, return all events from user's calendars
      const userCalendars = await storage.getCalendars(userId);
      const sharedCalendars = await storage.getSharedCalendars(userId);
      const allCalendars = [...userCalendars, ...sharedCalendars];
      
      for (const calendar of allCalendars) {
        const calendarEvents = await storage.getEvents(calendar.id);
        allEvents = [...allEvents, ...calendarEvents];
      }
      
      res.json(allEvents);
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });
  
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Create WebSocket server on a distinct path (not '/' to avoid conflicts with Vite HMR)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received message:', data);
        
        // Handle different message types
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    // Send initial message
    ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to CalDAV Calendar Server' }));
  });
  
  // Broadcast to all connected clients
  function broadcastMessage(message: any) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
  
  return httpServer;
}