import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncService } from './sync-service';
import { 
  insertCalendarSchema, 
  insertEventSchema, 
  insertServerConnectionSchema,
  insertUserSchema,
  User,
  serverConnections,
  CalendarSharing
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
    
    interface Session {
      recentlyDeletedEvents?: number[];
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  /**
   * Helper function to check if a user has permission to modify a calendar
   * @param userId The ID of the user
   * @param calendarId The ID of the calendar
   * @param requiredPermission The permission level required ('view' or 'edit')
   * @param req Express request object (needed for user email/username)
   * @returns Object with permission status and message
   */
  async function checkCalendarPermission(
    userId: number, 
    calendarId: number, 
    requiredPermission: 'view' | 'edit' = 'edit',
    req: Request
  ): Promise<{ permitted: boolean; message?: string }> {
    // Get the calendar
    const calendar = await storage.getCalendar(calendarId);
    if (!calendar) {
      return { permitted: false, message: "Calendar not found" };
    }
    
    // Allow if user is the owner of the calendar
    const isOwner = calendar.userId === userId;
    if (isOwner) {
      return { permitted: true };
    }
    
    // If not owner, check if calendar is shared with appropriate permissions
    const sharedCalendars = await storage.getSharedCalendars(userId);
    const isShared = sharedCalendars.some(c => c.id === calendar.id);
    
    if (!isShared) {
      return { 
        permitted: false, 
        message: `You don't have permission to access this calendar` 
      };
    }
    
    // Check permission level by getting the calendar sharing record
    const sharingRecords = await storage.getCalendarSharing(calendar.id);
    
    // Find the sharing record for this user
    const userSharing = sharingRecords.find(share => {
      return (
        (share.sharedWithUserId === userId) || 
        (share.sharedWithEmail && ((req.user as any).email === share.sharedWithEmail || 
                                   (req.user as any).username === share.sharedWithEmail))
      );
    });
    
    if (!userSharing) {
      return { 
        permitted: false, 
        message: "Sharing configuration not found" 
      };
    }
    
    // For view permission, both 'view' and 'edit' sharing is sufficient
    if (requiredPermission === 'view') {
      return { permitted: true };
    }
    
    // For edit permission, only 'edit' sharing is sufficient
    if (userSharing.permissionLevel !== 'edit') {
      return { 
        permitted: false, 
        message: "You have view-only access to this calendar" 
      };
    }
    
    return { permitted: true };
  }

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
  
  // Set up authentication using only CalDAV server
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      // First check if user exists in local storage
      let user = await storage.getUserByUsername(username);
      
      // Always validate with CalDAV server
      try {
        console.log(`Authenticating user ${username} with CalDAV server...`);
        const { DAVClient } = await import('tsdav');
        const davClient = new DAVClient({
          serverUrl: 'https://zpush.ajaydata.com/davical/',
          credentials: {
            username,
            password
          },
          authMethod: 'Basic',
          defaultAccountType: 'caldav'
        });
        
        // Try to connect to verify credentials
        await davClient.login();
        console.log(`Successfully authenticated ${username} with CalDAV server`);
        
        // If we reach here, credentials are valid
        if (!user) {
          // Create user if they don't exist in our local storage
          console.log(`Creating new user account for ${username}`);
          const hashedPassword = await bcrypt.hash(password, 10);
          user = await storage.createUser({
            username,
            password: hashedPassword,
            preferredTimezone: 'UTC'
          });
          console.log(`Created user ${username} with ID ${user.id}`);
        }
        
        // Store/update the server connection
        let serverConnection = await storage.getServerConnection(user.id);
        if (!serverConnection) {
          serverConnection = await storage.createServerConnection({
            userId: user.id,
            url: 'https://zpush.ajaydata.com/davical/',
            username,
            password,
            autoSync: true,
            syncInterval: 15,
            status: 'connected'
          });
          console.log(`Created server connection for user ${username}`);
        } else {
          // Update the connection with the latest credentials
          await storage.updateServerConnection(serverConnection.id, {
            username,
            password,
            status: 'connected',
            lastSync: new Date()
          });
          console.log(`Updated server connection for user ${username}`);
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
  
  // Format date for iCalendar - YYYYMMDDTHHMMSSZ format
  function formatICALDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  
  // Generate Thunderbird-compatible iCalendar data with properties 
  // that improve visibility with various CalDAV clients
  function generateThunderbirdCompatibleICS(
    event: {
      uid: string;
      title: string;
      startDate: Date;
      endDate: Date;
      description?: string;
      location?: string;
      attendees?: string[];
      resources?: string[];
      busyStatus?: string;
      recurrenceRule?: string;
      allDay?: boolean;
    }
  ): string {
    // Create a formatted UID that's compatible with Thunderbird
    // We'll use the provided UID, but ensure it has the right format
    const safeUid = event.uid.includes('@') ? event.uid : `${event.uid}@caldavclient.local`;
    
    // Format dates properly - use formatICALDate helper
    const now = formatICALDate(new Date());
    const startDate = formatICALDate(event.startDate);
    const endDate = formatICALDate(event.endDate);
    
    // Determine transparency based on busy status
    const transp = event.busyStatus === 'free' ? 'TRANSPARENT' : 'OPAQUE';
    
    // Determine status based on busyStatus
    let eventStatus = 'CONFIRMED';
    if (event.busyStatus === 'tentative') {
      eventStatus = 'TENTATIVE';
    } else if (event.busyStatus === 'cancelled') {
      eventStatus = 'CANCELLED';
    }
    
    // Prepare base event components
    const eventComponents = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CalDAV Client//NONSGML v1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${safeUid}`,
      `DTSTAMP:${now}`,
      `DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${startDate}`,
      `DTEND${event.allDay ? ';VALUE=DATE' : ''}:${endDate}`,
      `SUMMARY:${event.title}`,
      event.description ? `DESCRIPTION:${event.description}` : '',
      event.location ? `LOCATION:${event.location}` : '',
      `TRANSP:${transp}`,
      'SEQUENCE:0',
      `CREATED:${now}`,
      `LAST-MODIFIED:${now}`,
      `STATUS:${eventStatus}`,
    ];
    
    // Add recurrence rule if provided
    if (event.recurrenceRule) {
      eventComponents.push(event.recurrenceRule);
    }
    
    // Add attendees if provided
    if (event.attendees && event.attendees.length > 0) {
      event.attendees.forEach(attendee => {
        // Format email correctly for iCalendar
        let formattedAttendee = attendee;
        if (attendee.includes('@')) {
          formattedAttendee = `mailto:${attendee}`;
        }
        eventComponents.push(`ATTENDEE;CN=${attendee};ROLE=REQ-PARTICIPANT:${formattedAttendee}`);
      });
    }
    
    // Add resources if provided
    if (event.resources && event.resources.length > 0) {
      event.resources.forEach(resource => {
        eventComponents.push(`RESOURCES:${resource}`);
      });
    }
    
    // Add standard properties
    eventComponents.push(
      'X-MOZ-GENERATION:1',
      `X-MICROSOFT-CDO-ALLDAYEVENT:${event.allDay ? 'TRUE' : 'FALSE'}`,
      'X-MICROSOFT-CDO-IMPORTANCE:1',
      'END:VEVENT',
      'END:VCALENDAR'
    );
    
    return eventComponents.filter(Boolean).join('\r\n');
  }
  
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
  
  // Get all users (for sharing purposes)
  app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // Transform to safe format without passwords
      const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
      }));
      
      res.json(safeUsers);
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
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
      const allCalendars = await storage.getCalendars(userId);
      
      // Filter out proxy calendars and address books to match Thunderbird's behavior
      // This ensures we only show primary calendars that all CalDAV clients can see
      // Also include local calendars that have no URL (created by the user in the app)
      const filteredCalendars = allCalendars.filter(cal => 
        // Include local calendars (no URL)
        cal.isLocal === true ||
        // OR include non-proxy, non-address book remote calendars 
        (cal.url && !cal.url.includes("/calendar-proxy-") && !cal.url.includes("/addresses/"))
      );
      
      console.log(`Filtered ${allCalendars.length} calendars to ${filteredCalendars.length} primary calendars`);
      
      // Return the filtered calendars to the client
      return res.json(filteredCalendars);
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

  // Helper function to create a calendar on DAViCal server
  async function createCalendarOnDAViCal(
    serverConnection: typeof serverConnections.$inferSelect, 
    calendarName: string, 
    safeCalendarName: string
  ): Promise<{ success: boolean, url: string | null, errorMessage?: string }> {
    console.log(`Attempting to create calendar "${calendarName}" (${safeCalendarName}) on DAViCal server...`);
    
    // Normalize server URL
    let serverUrl = serverConnection.url;
    if (!serverUrl.startsWith('http')) {
      serverUrl = `https://${serverUrl}`;
    }
    if (serverUrl.endsWith('/')) {
      serverUrl = serverUrl.slice(0, -1);
    }
    
    // Create the CalDAV client for verification
    const { DAVClient } = await import('tsdav');
    
    const davClient = new DAVClient({
      serverUrl,
      credentials: {
        username: serverConnection.username,
        password: serverConnection.password
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    });
    
    try {
      // Verify login works
      await davClient.login();
      console.log("Successfully logged in to CalDAV server");
    } catch (loginError) {
      console.error("Failed to log in to CalDAV server:", loginError);
      return { 
        success: false, 
        url: null, 
        errorMessage: "Failed to authenticate with CalDAV server" 
      };
    }
    
    // DAViCal uses a specific URL structure for calendars
    const davicalBasePath = `${serverUrl}/caldav.php/${serverConnection.username}`;
    const calendarUrl = `${davicalBasePath}/${safeCalendarName}/`;
    
    console.log(`Attempting to create DAViCal calendar at: ${calendarUrl}`);
    
    // DAViCal API Approach 1: Try using the davical-specific API
    try {
      console.log("Trying DAViCal-specific creation method");
      
      // DAViCal often has a web interface with specific parameters for calendar creation
      const response = await fetch(`${serverUrl}/caldav.php/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml',
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        },
        body: new URLSearchParams({
          'create_calendar': '1',
          'calendar_name': safeCalendarName,
          'calendar_path': `/${serverConnection.username}/${safeCalendarName}/`,
          'displayname': calendarName
        }).toString()
      });
      
      console.log(`DAViCal creation API response status: ${response.status}`);
      
      if (response.ok || response.status === 302) {
        console.log("Successfully created calendar using DAViCal-specific API");
        return { success: true, url: calendarUrl };
      }
    } catch (davicalApiError) {
      console.log("DAViCal-specific API method failed:", davicalApiError);
      // Continue to next approach
    }
    
    // DAViCal Approach 2: Try a WebDAV MKCOL with specific properties for DAViCal
    try {
      console.log("Trying DAViCal-compatible MKCOL with special properties");
      
      const response = await fetch(calendarUrl, {
        method: 'MKCOL',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/">
            <D:set>
              <D:prop>
                <D:resourcetype>
                  <D:collection/>
                  <C:calendar/>
                </D:resourcetype>
                <D:displayname>${calendarName}</D:displayname>
                <C:supported-calendar-component-set>
                  <C:comp name="VEVENT"/>
                </C:supported-calendar-component-set>
                <I:calendar-color>#00AA33</I:calendar-color>
              </D:prop>
            </D:set>
          </D:mkcol>`
      });
      
      if (response.ok) {
        console.log("Successfully created calendar using enhanced MKCOL method");
        return { success: true, url: calendarUrl };
      } else {
        console.log(`MKCOL response: ${response.status} ${response.statusText}`);
      }
    } catch (mkcalError) {
      console.log("Enhanced MKCOL method failed:", mkcalError);
      // Continue to next approach
    }
    
    // DAViCal Approach 3: Try a simpler MKCOL without extra properties
    try {
      console.log("Trying simple DAViCal MKCOL");
      
      const response = await fetch(calendarUrl, {
        method: 'MKCOL',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        }
      });
      
      if (response.ok) {
        console.log("Successfully created basic collection, now setting calendar properties");
        
        // After creating the collection, set calendar properties with PROPPATCH
        try {
          const proppatchResponse = await fetch(calendarUrl, {
            method: 'PROPPATCH',
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
            },
            body: `<?xml version="1.0" encoding="utf-8"?>
              <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <D:set>
                  <D:prop>
                    <D:resourcetype>
                      <D:collection/>
                      <C:calendar/>
                    </D:resourcetype>
                    <D:displayname>${calendarName}</D:displayname>
                  </D:prop>
                </D:set>
              </D:propertyupdate>`
          });
          
          if (proppatchResponse.ok) {
            console.log("Successfully set calendar properties with PROPPATCH");
            return { success: true, url: calendarUrl };
          }
        } catch (proppatchError) {
          console.log("PROPPATCH failed:", proppatchError);
        }
        
        // Even if PROPPATCH fails, the collection was created
        return { success: true, url: calendarUrl };
      }
    } catch (mkolError) {
      console.log("Simple MKCOL method failed:", mkolError);
    }
    
    // DAViCal Approach 4: Try direct URL creation with PUT
    try {
      console.log("Trying PUT of an empty calendar item");
      
      // Create an empty calendar file first
      const putResponse = await fetch(`${calendarUrl}empty.ics`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        },
        body: `BEGIN:VCALENDAR
PRODID:-//DAViCal Client//NONSGML v1.0//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${calendarName}
END:VCALENDAR`
      });
      
      if (putResponse.ok) {
        console.log("Successfully created calendar via PUT method");
        return { success: true, url: calendarUrl };
      }
    } catch (putError) {
      console.log("PUT method failed:", putError);
    }
    
    // Verify if calendar was created despite errors
    try {
      console.log("Checking if calendar was created despite errors...");
      const check = await fetch(calendarUrl, {
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml',
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        },
        body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
      });
      
      if (check.ok || check.status === 207) {
        console.log("Calendar appears to exist when checked with PROPFIND");
        return { success: true, url: calendarUrl };
      }
    } catch (checkError) {
      console.log("Final verification check failed:", checkError);
    }
    
    return { 
      success: false, 
      url: null, 
      errorMessage: "All calendar creation methods failed" 
    };
  }
  
  // Helper function to delete a calendar on DAViCal server
  async function deleteCalendarFromDAViCal(
    serverConnection: typeof serverConnections.$inferSelect,
    calendarUrl: string
  ): Promise<{ success: boolean, errorMessage?: string }> {
    console.log(`Attempting to delete calendar from DAViCal server at URL: ${calendarUrl}`);
    
    // First try standard DELETE
    try {
      const response = await fetch(calendarUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64'),
          'Depth': 'infinity'
        }
      });
      
      console.log(`DELETE response: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        console.log("Successfully deleted calendar with standard DELETE");
        return { success: true };
      }
    } catch (deleteError) {
      console.log("Standard DELETE failed:", deleteError);
    }
    
    // Try DAViCal-specific deletion via web API
    try {
      // Extract the calendar path from the URL
      const urlObj = new URL(calendarUrl);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const username = pathParts[1]; // caldav.php/username/calendar
      const calendarName = pathParts[2];
      
      if (username && calendarName) {
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        
        console.log(`Trying DAViCal-specific deletion for ${username}/${calendarName}`);
        
        const response = await fetch(`${baseUrl}/caldav.php/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml',
            'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
          },
          body: new URLSearchParams({
            'delete_calendar': '1',
            'calendar_path': `/${username}/${calendarName}/`,
          }).toString()
        });
        
        console.log(`DAViCal deletion API response status: ${response.status}`);
        
        if (response.ok || response.status === 302) {
          console.log("Successfully deleted calendar using DAViCal-specific API");
          return { success: true };
        }
      }
    } catch (davicalApiError) {
      console.log("DAViCal-specific deletion API failed:", davicalApiError);
    }
    
    // Verify if calendar was actually deleted
    try {
      console.log("Verifying if calendar still exists...");
      const check = await fetch(calendarUrl, {
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml',
          'Authorization': 'Basic ' + Buffer.from(`${serverConnection.username}:${serverConnection.password}`).toString('base64')
        },
        body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
      });
      
      if (check.status === 404) {
        console.log("Calendar no longer exists - deletion was successful");
        return { success: true };
      } else {
        console.log(`Calendar still exists with status: ${check.status}`);
      }
    } catch (checkError) {
      // If the check fails with an error, the calendar might actually be gone
      console.log("Verification check failed, which could mean the calendar is gone:", checkError);
      return { success: true };
    }
    
    return { 
      success: false, 
      errorMessage: "All deletion methods failed, calendar may still exist on server" 
    };
  }

  app.post("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      // Get userId from authenticated user
      const userId = req.user!.id;
      
      // Check if calendar with the same name already exists for this user
      const existingCalendars = await storage.getCalendars(userId);
      const calendarName = req.body.name?.trim();
      
      if (!calendarName) {
        return res.status(400).json({ message: "Calendar name is required" });
      }
      
      const duplicateCalendar = existingCalendars.find(
        cal => cal.name.toLowerCase() === calendarName.toLowerCase()
      );
      
      if (duplicateCalendar) {
        return res.status(400).json({ 
          message: "A calendar with this name already exists. Please choose a different name." 
        });
      }
      
      // Add userId to request body and mark as a local calendar
      const calendarData = { 
        ...req.body, 
        userId,
        isLocal: true, // Mark as a local calendar (not from CalDAV server)
        url: null      // Local calendars don't have URLs
      };
      
      // Validate with zod
      const validatedData = insertCalendarSchema.parse(calendarData);
      
      // Create calendar in local storage
      const newCalendar = await storage.createCalendar(validatedData);
      console.log(`Created new calendar for user ${userId}:`, newCalendar);
      
      // Sync the new calendar to the CalDAV server if user has a connection
      const serverConnection = await storage.getServerConnection(userId);
      
      if (serverConnection && serverConnection.status === 'connected') {
        try {
          // Sanitize the calendar name for URL safety
          const safeCalendarName = calendarName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
          
          // Use our specialized DAViCal helper function
          const result = await createCalendarOnDAViCal(
            serverConnection, 
            calendarName,
            safeCalendarName
          );
          
          if (result.success && result.url) {
            // Update the local calendar with the URL from the server
            console.log(`Successfully created calendar on server: ${result.url}`);
            await storage.updateCalendar(newCalendar.id, {
              url: result.url,
              isLocal: false, // No longer just a local calendar
              syncToken: new Date().toISOString()
            });
            
            // Get the updated calendar to return to the client
            const updatedCalendar = await storage.getCalendar(newCalendar.id);
            if (updatedCalendar) {
              console.log(`Updated local calendar with server URL: ${updatedCalendar.url}`);
              res.status(201).json(updatedCalendar);
              return;
            }
          } else {
            console.log(`Could not create calendar "${calendarName}" on server: ${result.errorMessage || 'Unknown error'}`);
            console.log(`Will keep it as a local calendar.`);
          }
        } catch (syncError) {
          console.error(`Error syncing calendar to server:`, syncError);
          // We still return success since the local calendar was created
        }
      }
      
      // If we reach here, either there was no server connection or syncing failed
      // Still return the locally created calendar
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });

  app.put("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      const userId = req.user!.id;
      
      // Check if calendar belongs to user
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ message: "You don't have permission to update this calendar" });
      }
      
      // Validate with zod (partial validation for update)
      const validatedData = insertCalendarSchema.partial().parse(req.body);
      
      const updatedCalendar = await storage.updateCalendar(calendarId, validatedData);
      
      if (!updatedCalendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      console.log(`Updated calendar ${calendarId} for user ${userId}:`, updatedCalendar);
      res.json(updatedCalendar);
    } catch (err) {
      console.error("Error updating calendar:", err);
      return handleZodError(err, res);
    }
  });

  app.delete("/api/calendars/:id", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      const userId = req.user!.id;
      
      // Check if calendar exists
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if user owns this calendar
      if (calendar.userId !== userId) {
        return res.status(403).json({ message: "You don't have permission to delete this calendar" });
      }
      
      // Check if this is a primary calendar (should not be deleted)
      if (calendar.isPrimary) {
        return res.status(403).json({ message: "Cannot delete a primary calendar" });
      }
      
      // If the calendar has a URL (exists on server), try to delete it from the server
      if (calendar.url) {
        try {
          console.log(`Attempting to delete calendar "${calendar.name}" from CalDAV server at URL: ${calendar.url}`);

          // Get the server connection
          const serverConnection = await storage.getServerConnection(userId);
          
          if (serverConnection && serverConnection.status === 'connected') {
            // Use our specialized DAViCal helper function
            const result = await deleteCalendarFromDAViCal(serverConnection, calendar.url);
            
            if (result.success) {
              console.log(`Successfully deleted calendar from server: ${calendar.url}`);
            } else {
              console.error(`Failed to delete calendar from server: ${result.errorMessage || 'Unknown error'}`);
              console.log(`Server deletion failed but will continue with local deletion. Calendar URL: ${calendar.url}`);
            }
          }
        } catch (serverDeleteError) {
          console.error("Error during server-side calendar deletion:", serverDeleteError);
          // We still proceed with local deletion even if server deletion fails
        }
      }
      
      // Delete the calendar (this will also delete all events)
      const deleted = await storage.deleteCalendar(calendarId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      console.log(`Deleted calendar ${calendarId} for user ${userId}`);
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting calendar:", err);
      res.status(500).json({ message: "Failed to delete calendar" });
    }
  });
  
  // Calendar sharing endpoints
  app.get("/api/calendars/:id/shares", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      
      // Check if calendar exists
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if user is the owner of the calendar
      if (calendar.userId !== req.user!.id) {
        return res.status(403).json({ message: "You don't have permission to view sharing for this calendar" });
      }
      
      // Get sharing records
      const sharingRecords = await storage.getCalendarSharing(calendarId);
      
      // Transform to match client-side expected format
      const transformedRecords = sharingRecords.map(record => ({
        id: record.id,
        calendarId: record.calendarId,
        userId: record.sharedWithUserId,
        email: record.sharedWithEmail,
        username: null, // This would need to be fetched from users table
        permission: record.permissionLevel === 'view' ? 'read' : 'write'
      }));
      
      res.json(transformedRecords);
    } catch (err) {
      console.error("Error getting calendar sharing:", err);
      res.status(500).json({ message: "Failed to get calendar sharing" });
    }
  });
  
  app.post("/api/calendars/:id/shares", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.id);
      
      // Check if calendar exists
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if user is the owner of the calendar
      if (calendar.userId !== req.user!.id) {
        return res.status(403).json({ message: "You don't have permission to share this calendar" });
      }
      
      // Validate email and permission level
      if (!req.body.sharedWithEmail) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      if (!['view', 'edit'].includes(req.body.permissionLevel)) {
        return res.status(400).json({ message: "Permission level must be 'view' or 'edit'" });
      }
      
      // Check if already shared with this email
      const existingSharing = (await storage.getCalendarSharing(calendarId))
        .find(s => s.sharedWithEmail === req.body.sharedWithEmail);
      
      if (existingSharing) {
        return res.status(400).json({ message: "Calendar already shared with this email" });
      }
      
      // Try to find user ID for this email - several matching approaches
      let sharedWithUserId = null;
      
      console.log(`Trying to find user matching shared email: ${req.body.sharedWithEmail}`);
      
      // Get all users to try different matching approaches
      const allUsers = await storage.getAllUsers();
      console.log(`Checking ${allUsers.length} users to find a match for email: ${req.body.sharedWithEmail}`);
      
      // Priority 1: Exact match on user's email field
      for (const user of allUsers) {
        if (user.email && user.email === req.body.sharedWithEmail) {
          sharedWithUserId = user.id;
          console.log(`Found user ID ${sharedWithUserId} with email exactly matching: ${req.body.sharedWithEmail}`);
          break;
        }
      }
      
      // Priority 2: Case-insensitive match on user's email field
      if (!sharedWithUserId) {
        const lowerCaseEmail = req.body.sharedWithEmail.toLowerCase();
        for (const user of allUsers) {
          if (user.email && user.email.toLowerCase() === lowerCaseEmail) {
            sharedWithUserId = user.id;
            console.log(`Found user ID ${sharedWithUserId} with email case-insensitive matching: ${req.body.sharedWithEmail}`);
            break;
          }
        }
      }
      
      // Priority 3: Exact match on username
      if (!sharedWithUserId) {
        for (const user of allUsers) {
          if (user.username === req.body.sharedWithEmail) {
            sharedWithUserId = user.id;
            console.log(`Found user ID ${sharedWithUserId} with username exactly matching: ${req.body.sharedWithEmail}`);
            break;
          }
        }
      }
      
      // Priority 4: Case-insensitive match on username
      if (!sharedWithUserId) {
        const lowerCaseEmail = req.body.sharedWithEmail.toLowerCase();
        for (const user of allUsers) {
          if (user.username.toLowerCase() === lowerCaseEmail) {
            sharedWithUserId = user.id;
            console.log(`Found user ID ${sharedWithUserId} with username case-insensitive matching: ${req.body.sharedWithEmail}`);
            break;
          }
        }
      }
      
      // Priority 5: Check if username is part of the email address
      if (!sharedWithUserId) {
        // Split email into username and domain
        const [emailUsername, domain] = req.body.sharedWithEmail.split('@');
        if (emailUsername) {
          for (const user of allUsers) {
            if (user.username === emailUsername || 
                user.username.includes(emailUsername) || 
                emailUsername.includes(user.username)) {
              sharedWithUserId = user.id;
              console.log(`Found user ID ${sharedWithUserId} matching email username part: ${emailUsername}`);
              break;
            }
          }
        }
      }
      
      // Priority 6: Look for any partial match
      if (!sharedWithUserId) {
        for (const user of allUsers) {
          // Check for any kind of partial match in either direction
          if (user.username.includes(req.body.sharedWithEmail) || 
              req.body.sharedWithEmail.includes(user.username) ||
              (user.email && (
                user.email.includes(req.body.sharedWithEmail) ||
                req.body.sharedWithEmail.includes(user.email)
              ))) {
            sharedWithUserId = user.id;
            console.log(`Found user ID ${sharedWithUserId} with partial match between email/username: ${req.body.sharedWithEmail}`);
            break;
          }
        }
      }
      
      console.log(`Final user ID for sharing: ${sharedWithUserId || 'No user found - sharing with email only'}`);
      
      
      // Create sharing record
      const sharing = await storage.shareCalendar({
        calendarId,
        sharedWithEmail: req.body.sharedWithEmail,
        sharedWithUserId,
        permissionLevel: req.body.permissionLevel
      });
      
      // Transform to match client-side expected format
      const transformedSharing = {
        id: sharing.id,
        calendarId: sharing.calendarId,
        userId: sharing.sharedWithUserId,
        email: sharing.sharedWithEmail,
        username: null,
        permission: sharing.permissionLevel === 'view' ? 'read' : 'write'
      };
      
      // Sync with CalDAV server if sync flag is set and the calendar has a URL
      if (req.query.syncWithServer === 'true' && calendar.url) {
        try {
          // Get user's server connection
          const userId = req.user!.id;
          const connection = await storage.getServerConnection(userId);
          
          if (connection) {
            console.log(`Attempting to share calendar on CalDAV server: ${calendar.url}`);
            
            // Import and use our CalDAV client for sharing
            const { CalDAVClient } = await import('../client/src/lib/caldav');
            
            // Create CalDAV client with user's connection details
            const caldavClient = new CalDAVClient({
              serverUrl: connection.url,
              username: connection.username,
              password: connection.password
            });
            
            // Map permission level to CalDAV access level
            const caldavAccess = req.body.permissionLevel === 'edit' 
              ? 'read-write' 
              : 'read-only';
            
            // Share calendar on the server
            const serverShareResult = await caldavClient.shareCalendar(
              calendar.url,
              req.body.sharedWithEmail,
              caldavAccess
            );
            
            console.log(`CalDAV server sharing result: ${serverShareResult ? 'Success' : 'Failed'}`);
          } else {
            console.log(`No server connection found for user ${userId}, skipping CalDAV sharing`);
          }
        } catch (syncError) {
          console.error("Error syncing calendar sharing with CalDAV server:", syncError);
          // Don't fail the request, just log the error
        }
      }
      
      res.status(201).json(transformedSharing);
    } catch (err) {
      console.error("Error sharing calendar:", err);
      res.status(500).json({ message: "Failed to share calendar" });
    }
  });
  
  app.patch("/api/calendars/shares/:id", isAuthenticated, async (req, res) => {
    try {
      const sharingId = parseInt(req.params.id);
      console.log(`Attempting to update calendar sharing with ID ${sharingId}`);
      
      // If direct update is possible, try it first
      // Validate permission level if provided
      if (req.body.permissionLevel && !['view', 'edit'].includes(req.body.permissionLevel)) {
        return res.status(400).json({ message: "Permission level must be 'view' or 'edit'" });
      }
      
      // Update sharing record directly
      const updatedSharing = await storage.updateCalendarSharing(sharingId, {
        permissionLevel: req.body.permissionLevel
      });
      
      if (updatedSharing) {
        console.log(`Successfully updated calendar sharing with ID ${sharingId}`);
        // Transform to match client-side expected format
        const transformedSharing = {
          id: updatedSharing.id,
          calendarId: updatedSharing.calendarId,
          userId: updatedSharing.sharedWithUserId,
          email: updatedSharing.sharedWithEmail,
          username: null,
          permission: updatedSharing.permissionLevel === 'view' ? 'read' : 'write'
        };
        
        return res.json(transformedSharing);
      }
      
      // If direct update failed, we need to find the sharing record
      console.log(`Direct update failed, searching for sharing record with ID ${sharingId}`);
      const userId = req.user!.id;
      const userCalendars = await storage.getCalendars(userId);
      
      // Get sharing records for all user's calendars
      let allSharingRecords: CalendarSharing[] = [];
      for (const calendar of userCalendars) {
        const calendarShares = await storage.getCalendarSharing(calendar.id);
        allSharingRecords = [...allSharingRecords, ...calendarShares];
      }
      
      // Find the specific sharing record
      const sharing = allSharingRecords.find(s => s.id === sharingId);
      
      if (!sharing) {
        console.log(`Sharing record with ID ${sharingId} not found`);
        return res.status(404).json({ message: "Sharing record not found" });
      }
      
      // Get the calendar
      const calendar = await storage.getCalendar(sharing.calendarId);
      if (!calendar) {
        console.log(`Calendar ${sharing.calendarId} not found`);
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if user is the owner of the calendar
      if (calendar.userId !== userId) {
        console.log(`User ${userId} is not the owner of calendar ${calendar.id}`);
        return res.status(403).json({ message: "You don't have permission to update sharing for this calendar" });
      }
      
      // Try updating again
      const secondUpdateAttempt = await storage.updateCalendarSharing(sharingId, {
        permissionLevel: req.body.permissionLevel
      });
      
      if (!secondUpdateAttempt) {
        console.log(`Failed to update sharing record with ID ${sharingId} on second attempt`);
        return res.status(404).json({ message: "Failed to update sharing record" });
      }
      
      console.log(`Successfully updated calendar sharing with ID ${sharingId} on second attempt`);
      
      // Transform to match client-side expected format
      const transformedSharing = {
        id: secondUpdateAttempt.id,
        calendarId: secondUpdateAttempt.calendarId,
        userId: secondUpdateAttempt.sharedWithUserId,
        email: secondUpdateAttempt.sharedWithEmail,
        username: null,
        permission: secondUpdateAttempt.permissionLevel === 'view' ? 'read' : 'write'
      };
      
      // Sync with CalDAV server if sync flag is set and calendar has URL
      if (req.query.syncWithServer === 'true' && calendar.url) {
        try {
          // Get user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection) {
            console.log(`Attempting to update calendar sharing on CalDAV server: ${calendar.url}`);
            
            // Import and use our CalDAV client for updating sharing
            const { CalDAVClient } = await import('../client/src/lib/caldav');
            
            // Create CalDAV client with user's connection details
            const caldavClient = new CalDAVClient({
              serverUrl: connection.url,
              username: connection.username,
              password: connection.password
            });
            
            // Map permission level to CalDAV access level
            const caldavAccess = req.body.permissionLevel === 'edit' 
              ? 'read-write' 
              : 'read-only';
            
            // Update calendar sharing on the server
            const serverUpdateResult = await caldavClient.updateCalendarSharing(
              calendar.url,
              secondUpdateAttempt.sharedWithEmail,
              caldavAccess
            );
            
            console.log(`CalDAV server sharing update result: ${serverUpdateResult ? 'Success' : 'Failed'}`);
          } else {
            console.log(`No server connection found for user ${userId}, skipping CalDAV sharing update`);
          }
        } catch (syncError) {
          console.error("Error syncing calendar sharing update with CalDAV server:", syncError);
          // Don't fail the request, just log the error
        }
      }
      
      res.json(transformedSharing);
    } catch (err) {
      console.error("Error updating calendar sharing:", err);
      res.status(500).json({ message: "Failed to update calendar sharing" });
    }
  });
  
  app.delete("/api/calendars/shares/:id", isAuthenticated, async (req, res) => {
    try {
      const sharingId = parseInt(req.params.id);
      console.log(`Attempting to delete calendar sharing with ID ${sharingId}`);
      
      // First, directly delete the sharing record
      const deleted = await storage.removeCalendarSharing(sharingId);
      
      if (deleted) {
        console.log(`Successfully deleted calendar sharing with ID ${sharingId}`);
        return res.status(204).send();
      }
      
      // If direct deletion failed, get all sharing records for this user's calendars
      console.log(`Direct deletion failed, searching for sharing record with ID ${sharingId}`);
      const userId = req.user!.id;
      const userCalendars = await storage.getCalendars(userId);
      
      // Get sharing records for all user's calendars
      let allSharingRecords: CalendarSharing[] = [];
      for (const calendar of userCalendars) {
        const calendarShares = await storage.getCalendarSharing(calendar.id);
        allSharingRecords = [...allSharingRecords, ...calendarShares];
      }
      
      // Find the specific sharing record
      const sharing = allSharingRecords.find(s => s.id === sharingId);
      
      if (!sharing) {
        console.log(`Sharing record with ID ${sharingId} not found`);
        return res.status(404).json({ message: "Sharing record not found" });
      }
      
      // Get the calendar
      const calendar = await storage.getCalendar(sharing.calendarId);
      if (!calendar) {
        console.log(`Calendar ${sharing.calendarId} not found`);
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // Check if user is the owner of the calendar
      if (calendar.userId !== userId) {
        console.log(`User ${userId} is not the owner of calendar ${calendar.id}`);
        return res.status(403).json({ message: "You don't have permission to remove sharing for this calendar" });
      }
      
      // Try deleting again
      const secondDeleteAttempt = await storage.removeCalendarSharing(sharingId);
      
      if (!secondDeleteAttempt) {
        console.log(`Failed to delete sharing record with ID ${sharingId} on second attempt`);
        return res.status(404).json({ message: "Sharing record not found" });
      }
      
      console.log(`Successfully deleted calendar sharing with ID ${sharingId} on second attempt`);
      
      // Sync with CalDAV server if sync flag is set and calendar has URL
      if (req.query.syncWithServer === 'true' && calendar.url) {
        try {
          // Get user's server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection) {
            console.log(`Attempting to remove calendar sharing on CalDAV server: ${calendar.url}`);
            
            // Import and use our CalDAV client for unsharing
            const { CalDAVClient } = await import('../client/src/lib/caldav');
            
            // Create CalDAV client with user's connection details
            const caldavClient = new CalDAVClient({
              serverUrl: connection.url,
              username: connection.username,
              password: connection.password
            });
            
            // Remove calendar sharing on the server
            const serverUnshareResult = await caldavClient.unshareCalendar(
              calendar.url,
              sharing.sharedWithEmail
            );
            
            console.log(`CalDAV server unsharing result: ${serverUnshareResult ? 'Success' : 'Failed'}`);
          } else {
            console.log(`No server connection found for user ${userId}, skipping CalDAV unsharing`);
          }
        } catch (syncError) {
          console.error("Error syncing calendar unsharing with CalDAV server:", syncError);
          // Don't fail the request, just log the error
        }
      }
      
      res.status(204).send();
    } catch (err) {
      console.error("Error removing calendar sharing:", err);
      res.status(500).json({ message: "Failed to remove calendar sharing" });
    }
  });
  
  // Get calendars shared with the current user
  app.get("/api/shared-calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      console.log(`Getting shared calendars for user ID: ${userId}, username: ${req.user!.username}`);
      
      // First, get all shared calendars
      const sharedCalendars = await storage.getSharedCalendars(userId);
      console.log(`Found ${sharedCalendars.length} shared calendars for user ${req.user!.username}`);
      
      if (sharedCalendars.length === 0) {
        return res.json([]);
      }
      
      // For each calendar, get the sharing record to determine permissions
      const calendarIds = sharedCalendars.map(cal => cal.id);
      let allSharingRecords: any[] = [];
      
      // Get all sharing records
      for (const calendarId of calendarIds) {
        const sharingRecords = await storage.getCalendarSharing(calendarId);
        allSharingRecords = [...allSharingRecords, ...sharingRecords];
      }
      
      console.log(`Found ${allSharingRecords.length} total sharing records`);
      
      // Match sharing records with the current user using the same flexible matching
      const findSharingForUserAndCalendar = (calendarId: number) => {
        // Try several ways to match:
        // 1. By user ID (highest priority)
        const byUserId = allSharingRecords.find(s => 
          s.calendarId === calendarId && s.sharedWithUserId === userId
        );
        if (byUserId) return byUserId;
        
        // 2a. By exact email match if user has email
        if (req.user!.email) {
          const byEmail = allSharingRecords.find(s =>
            s.calendarId === calendarId && s.sharedWithEmail === req.user!.email
          );
          if (byEmail) return byEmail;
          
          // 2b. By case-insensitive email match
          const byEmailIgnoreCase = allSharingRecords.find(s =>
            s.calendarId === calendarId && 
            s.sharedWithEmail.toLowerCase() === req.user!.email!.toLowerCase()
          );
          if (byEmailIgnoreCase) return byEmailIgnoreCase;
        }
        
        // 3a. By exact username match (treat username as email)
        const byUsername = allSharingRecords.find(s =>
          s.calendarId === calendarId && s.sharedWithEmail === req.user!.username
        );
        if (byUsername) return byUsername;
        
        // 3b. By case-insensitive username match
        const byUsernameIgnoreCase = allSharingRecords.find(s =>
          s.calendarId === calendarId && 
          s.sharedWithEmail.toLowerCase() === req.user!.username.toLowerCase()
        );
        if (byUsernameIgnoreCase) return byUsernameIgnoreCase;
        
        // 4a. By partial email match if user has email
        if (req.user!.email) {
          const byPartialEmailMatch = allSharingRecords.find(s =>
            s.calendarId === calendarId && (
              s.sharedWithEmail.includes(req.user!.email!) ||
              req.user!.email!.includes(s.sharedWithEmail)
            )
          );
          if (byPartialEmailMatch) return byPartialEmailMatch;
        }
        
        // 4b. By partial username match
        const byPartialUsernameMatch = allSharingRecords.find(s =>
          s.calendarId === calendarId && (
            s.sharedWithEmail.includes(req.user!.username) ||
            req.user!.username.includes(s.sharedWithEmail)
          )
        );
        
        // Return the last match we could find, or undefined if nothing matched
        return byPartialUsernameMatch;
      };
      
      // Add permission level to each calendar and fetch owner information
      const calendarWithPermissionsPromises = sharedCalendars.map(async calendar => {
        const sharing = findSharingForUserAndCalendar(calendar.id);
        console.log(`Calendar ${calendar.id} (${calendar.name}) permission: ${sharing?.permissionLevel || 'unknown'}`);
        
        // Fetch the calendar owner's information
        const owner = await storage.getUser(calendar.userId);
        const ownerEmail = owner?.email || owner?.username || 'Unknown';
        
        return {
          ...calendar,
          permission: sharing?.permissionLevel || 'view', // Default to view-only if no record found
          isShared: true,
          ownerEmail
        };
      });
      
      // Resolve all promises
      const calendarWithPermissions = await Promise.all(calendarWithPermissionsPromises);
      
      res.json(calendarWithPermissions);
    } catch (err) {
      console.error("Error getting shared calendars:", err);
      res.status(500).json({ message: "Failed to get shared calendars" });
    }
  });

  // Event routes
  app.get("/api/calendars/:calendarId/events", isAuthenticated, async (req, res) => {
    try {
      const calendarId = parseInt(req.params.calendarId);
      const userId = req.user!.id;
      
      // Get the calendar
      const calendar = await storage.getCalendar(calendarId);
      
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // If calendar doesn't belong to user, check if it's shared with them
      if (calendar.userId !== userId) {
        console.log(`Calendar ${calendarId} is not owned by user ${userId}, checking if shared...`);
        const sharedCalendars = await storage.getSharedCalendars(userId);
        const isShared = sharedCalendars.some(sc => sc.id === calendarId);
        
        if (!isShared) {
          console.log(`Calendar ${calendarId} is not shared with user ${userId}`);
          return res.status(403).json({ message: "You don't have permission to access this calendar" });
        }
        console.log(`Calendar ${calendarId} is shared with user ${userId}`);
      }
      
      // Return events for the calendar
      const events = await storage.getEvents(calendarId);
      
      // Add calendar info to each event
      const eventsWithCalendarInfo = events.map(event => {
        return {
          ...event,
          rawData: {
            ...(event.rawData || {}),
            calendarName: calendar.name,
            calendarColor: calendar.color,
            isShared: calendar.userId !== userId
          }
        };
      });
      
      return res.json(eventsWithCalendarInfo);
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });
  
  // Get events from all visible calendars within a date range
  app.get("/api/events", isAuthenticated, async (req, res) => {
    try {
      // Get the user ID from the session
      const userId = req.user!.id;
      
      // Parse date range from query parameters
      const startDateParam = req.query.start as string;
      const endDateParam = req.query.end as string;
      
      // Default to current month if not specified
      const today = new Date();
      const startDate = startDateParam ? new Date(startDateParam) : 
        new Date(today.getFullYear(), today.getMonth(), 1);
      const endDate = endDateParam ? new Date(endDateParam) : 
        new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
      
      // Get all calendars for the user
      const allCalendars = await storage.getCalendars(userId);
      
      // Filter out proxy calendars and address books, then filter for enabled ones
      // Also include local calendars that have no URL (created by the user in the app)
      const filteredCalendars = allCalendars.filter(cal => 
        cal.isLocal === true ||
        (cal.url && !cal.url.includes("/calendar-proxy-") && !cal.url.includes("/addresses/"))
      );
      
      console.log(`Filtered ${allCalendars.length} calendars to ${filteredCalendars.length} primary calendars`);
      
      // Then filter for enabled calendars
      const enabledCalendars = filteredCalendars.filter(cal => cal.enabled);
      
      // ADDITIONAL: Get shared calendars
      const sharedCalendarsResponse = await storage.getSharedCalendars(userId);
      console.log(`Found ${sharedCalendarsResponse.length} shared calendars`);
      
      // Add enabled shared calendars to the list of enabled calendars
      const enabledSharedCalendars = sharedCalendarsResponse.filter(cal => cal.enabled);
      
      // Combine user's calendars and enabled shared calendars
      const allEnabledCalendars = [...enabledCalendars, ...enabledSharedCalendars];
      
      console.log(`Total calendars to fetch events from: ${allEnabledCalendars.length}`);
      
      if (allEnabledCalendars.length === 0) {
        return res.json([]);
      }
      
      // Fetch events for each calendar and combine them
      // Use any[] to avoid TypeScript errors since we're adding metadata
      let allEvents: any[] = [];
      
      for (const calendar of allEnabledCalendars) {
        const calendarEvents = await storage.getEvents(calendar.id);
        
        // Add all events from the calendar with minimal filtering
        // This ensures we don't miss any events due to timezone or date parsing issues
        const filteredEvents = calendarEvents;
        
        console.log(`Found ${calendarEvents.length} events in calendar ${calendar.name}`);
        // Log the first few events for debugging
        if (calendarEvents.length > 0) {
          console.log('Sample event:', {
            title: calendarEvents[0].title,
            startDate: calendarEvents[0].startDate,
            endDate: calendarEvents[0].endDate,
            requestedRange: {
              start: startDate.toISOString(),
              end: endDate.toISOString()
            }
          });
        }
        
        // Add calendar info to each event
        // Since we're using any[] type, we can just directly merge the data
        const eventsWithCalendarInfo = filteredEvents.map(event => {
          // Create a new object with all event properties plus calendar metadata
          return {
            ...event,
            // Store the raw calendar info in rawData field
            rawData: {
              ...(event.rawData || {}),
              calendarName: calendar.name,
              calendarColor: calendar.color,
              isShared: calendar.userId !== userId
            }
          };
        });
        
        allEvents = [...allEvents, ...eventsWithCalendarInfo];
      }
      
      // Sort events by start date
      allEvents.sort((a, b) => {
        const aStartDate = new Date(a.startDate);
        const bStartDate = new Date(b.startDate);
        return aStartDate.getTime() - bStartDate.getTime();
      });
      
      res.json(allEvents);
    } catch (error) {
      console.error('Error fetching combined events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
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

  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      // Get authenticated user ID 
      const userId = req.user!.id;
      console.log(`Event create request. Authenticated User ID: ${userId}`);
      console.log(`Event create payload:`, JSON.stringify(req.body, null, 2));
      
      // Check if user has permission to create events in this calendar
      const calendarId = req.body.calendarId;
      const permissionCheck = await checkCalendarPermission(userId, calendarId, 'edit', req);
      
      if (!permissionCheck.permitted) {
        return res.status(403).json({ message: permissionCheck.message || "Permission denied" });
      }
      
      // Generate a unique UID for the event if not provided
      const eventData = {
        ...req.body,
        uid: req.body.uid || `${Date.now()}-${Math.floor(Math.random() * 1000000)}@caldavclient`
      };
      
      // Properly handle date conversions, preserving the exact date/time
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
        console.log(`Event creation: ${eventData.title} - Start date string: ${req.body.startDate}, Converted: ${eventData.startDate.toISOString()}`);
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
        console.log(`Event creation: ${eventData.title} - End date string: ${req.body.endDate}, Converted: ${eventData.endDate.toISOString()}`);
      }
      
      // Validate with zod
      const validatedData = insertEventSchema.parse(eventData);
      
      // First save to our local database with initial sync status
      const eventWithSyncStatus = {
        ...validatedData,
        syncStatus: 'local', // Mark as local initially
        syncError: null,
        lastSyncAttempt: null
      };
      
      const newEvent = await storage.createEvent(eventWithSyncStatus);
      
      // If user is authenticated, sync with CalDAV server
      if (userId) {
        try {
          // Get user's CalDAV server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            console.log(`Attempting to sync new event "${eventData.title}" to CalDAV server...`);
            
            // Get the calendar for this event
            const calendar = await storage.getCalendar(eventData.calendarId);
            
            // ALWAYS use the primary calendar regardless of the selected calendar
            // This ensures events are always created in the main calendar that Thunderbird can see
            const forcePrimaryCalendar = true;
            
            // Default to the selected calendar (but we'll override this)
            let targetCalendarUrl = calendar?.url;
            let targetCalendar = calendar;
            
            // Get all calendars
            const allCalendars = await storage.getCalendars(userId);
            console.log(`Examining ${allCalendars.length} calendars to find a primary calendar...`);
            
            // First, log all calendars for debugging
            allCalendars.forEach((cal, index) => {
              console.log(`Calendar ${index + 1}: "${cal.name}" - URL: ${cal.url || 'N/A'}`);
            });
            
            // Filter out proxy calendars and address books first
            const nonProxyCalendars = allCalendars.filter(cal => {
              if (!cal.url) return false;
              if (cal.url.includes('/calendar-proxy-')) {
                console.log(`Excluding proxy calendar: ${cal.name} (${cal.url})`);
                return false;
              }
              if (cal.url.includes('/addresses/')) {
                console.log(`Excluding address book: ${cal.name} (${cal.url})`);
                return false;
              }
              return true;
            });
            
            console.log(`Found ${nonProxyCalendars.length} non-proxy calendars`);
            
            // Define a scoring function to identify the most likely primary calendar
            const scorePrimaryCalendar = (cal: any): number => {
              let score = 0;
              
              // Give points for common primary calendar names
              if (cal.name === "Calendar") score += 10;
              if (cal.name.includes("calendar")) score += 5;
              if (cal.name.includes("D K Pandey")) score += 8;
              if (cal.name.includes("dkpandey")) score += 8;
              if (cal.name === "default") score += 7;
              if (cal.name.toLowerCase().includes("primary")) score += 6;
              if (cal.name.toLowerCase() === connection.username) score += 9;
              if (cal.name.toLowerCase().includes(connection.username)) score += 7;
              
              // Give points for likely primary calendar URLs
              if (cal.url.includes(`/${connection.username}/calendar/`)) score += 10;
              if (cal.url.includes(`/${connection.username}/`)) score += 8;
              if (cal.url.includes('/calendar/')) score += 6;
              if (cal.url.includes('/calendars/')) score += 5;
              
              // Penalize URLs that are likely not primary
              if (cal.url.includes('/inbox/')) score -= 10;
              if (cal.url.includes('/outbox/')) score -= 10;
              if (cal.url.includes('/notification/')) score -= 10;
              
              return score;
            };
            
            // Score and sort calendars
            const scoredCalendars = nonProxyCalendars.map(cal => ({
              calendar: cal,
              score: scorePrimaryCalendar(cal)
            })).sort((a, b) => b.score - a.score);
            
            // Log the scored calendars
            scoredCalendars.forEach(({calendar, score}) => {
              console.log(`Calendar "${calendar.name}" (${calendar.url}) - Score: ${score}`);
            });
            
            // Use the highest scoring calendar if available
            if (scoredCalendars.length > 0 && scoredCalendars[0].score > 0) {
              const bestCalendar = scoredCalendars[0].calendar;
              console.log(`Selected primary calendar: "${bestCalendar.name}" (${bestCalendar.url}) with score ${scoredCalendars[0].score}`);
              targetCalendarUrl = bestCalendar.url;
              targetCalendar = bestCalendar;
            } else if (nonProxyCalendars.length > 0) {
              // If we couldn't score any calendars well, just use the first non-proxy calendar
              const fallbackCalendar = nonProxyCalendars[0];
              console.log(`Using fallback non-proxy calendar: "${fallbackCalendar.name}" (${fallbackCalendar.url})`);
              targetCalendarUrl = fallbackCalendar.url;
              targetCalendar = fallbackCalendar;
            } else {
              console.log(`Warning: Could not find any suitable primary calendar`);
            }
            
            if (targetCalendar && targetCalendarUrl) {
              // Initialize CalDAV client
              const { DAVClient } = await import('tsdav');
              
              // Create CalDAV client
              const davClient = new DAVClient({
                serverUrl: connection.url,
                credentials: {
                  username: connection.username,
                  password: connection.password
                },
                authMethod: 'Basic',
                defaultAccountType: 'caldav'
              });
              
              // Prepare event for CalDAV format (iCalendar)
              // Use our Thunderbird-compatible iCalendar generator
              console.log("Using Thunderbird-compatible iCalendar format");
              const icalEvent = generateThunderbirdCompatibleICS({
                uid: eventData.uid,
                title: eventData.title,
                startDate: eventData.startDate,
                endDate: eventData.endDate,
                description: eventData.description,
                location: eventData.location,
                // Include the new fields if they exist
                attendees: eventData.attendees,
                resources: eventData.resources,
                busyStatus: eventData.busyStatus,
                recurrenceRule: eventData.recurrenceRule,
                allDay: eventData.allDay
              });
              
              console.log(`Creating event on CalDAV server for calendar URL: ${targetCalendarUrl}`);
              
              // Create event on CalDAV server
              // Using a manual PUT request for better compatibility across servers
              try {
                // Construct a more compatible calendar URL
                // Ensure the calendar URL ends with a trailing slash
                const calendarUrlWithSlash = targetCalendarUrl.endsWith('/') 
                  ? targetCalendarUrl 
                  : `${targetCalendarUrl}/`;
                
                // Sanitize the UID to make it URL-safe
                const safeUid = eventData.uid.replace(/[^a-zA-Z0-9-_]/g, '');
                const eventUrl = `${calendarUrlWithSlash}${safeUid}.ics`;
                console.log(`Creating event at URL: ${eventUrl}`);
                console.log('Event data being sent:');
                console.log(`Title: ${eventData.title}`);
                console.log(`Start: ${eventData.startDate.toISOString()}`);
                console.log(`End: ${eventData.endDate.toISOString()}`);
                console.log(`Calendar ID: ${eventData.calendarId}`);
                console.log(`iCalendar data length: ${icalEvent.length} characters`);
                
                // Try DAV client approach first as it's more reliable across servers
                try {
                  console.log(`First approach: Using DAV client createCalendarObject`);
                  const calendarObject = await davClient.createCalendarObject({
                    calendar: { url: calendarUrlWithSlash },
                    filename: `${safeUid}.ics`,
                    iCalString: icalEvent
                  });
                  
                  console.log(`Successfully created event using DAV client: ${calendarObject.url}`);
                  
                  // Update the event URL and sync status in our database
                  await storage.updateEvent(newEvent.id, { 
                    url: calendarObject.url,
                    etag: calendarObject.etag || undefined,
                    rawData: icalEvent, // Store the raw iCalendar data for future reference
                    syncStatus: 'synced',
                    lastSyncAttempt: new Date()
                  });
                  
                  // Force immediate refresh to ensure the event is visible to other clients
                  try {
                    console.log("Forcing immediate server refresh...");
                    
                    // More efficient approach 1: First try a direct PROPFIND request to refresh the calendar
                    try {
                      const propfindResponse = await fetch(calendarUrlWithSlash, {
                        method: 'PROPFIND',
                        headers: {
                          'Content-Type': 'application/xml; charset=utf-8',
                          'Depth': '1',
                          'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                        },
                        body: `<?xml version="1.0" encoding="utf-8" ?>
                          <D:propfind xmlns:D="DAV:">
                            <D:prop>
                              <D:getetag/>
                            </D:prop>
                          </D:propfind>`
                      });
                      console.log(`PROPFIND response status: ${propfindResponse.status}`);
                    } catch (propfindError) {
                      console.error("Error during PROPFIND refresh:", propfindError);
                    }
                    
                    // Backup approach: Create a new DAV client with proper login for calendar fetch
                    try {
                      const { DAVClient } = await import('tsdav');
                      const refreshClient = new DAVClient({
                        serverUrl: connection.url,
                        credentials: {
                          username: connection.username,
                          password: connection.password
                        },
                        authMethod: 'Basic',
                        defaultAccountType: 'caldav'
                      });
                      
                      // Login first to establish account
                      await refreshClient.login();
                      
                      // Now fetch calendars should work
                      await refreshClient.fetchCalendars();
                      console.log("Server calendars refreshed successfully");
                    } catch (fetchError) {
                      console.error("Error with fetchCalendars refresh:", fetchError);
                    }
                    
                    // Send a REPORT request to make the changes visible to other clients
                    const reportResponse = await fetch(calendarUrlWithSlash, {
                      method: 'REPORT',
                      headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        'Depth': '1',
                        'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                      },
                      body: `<?xml version="1.0" encoding="utf-8" ?>
                        <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                          <D:prop>
                            <D:getetag/>
                            <C:calendar-data/>
                          </D:prop>
                          <C:filter>
                            <C:comp-filter name="VCALENDAR">
                              <C:comp-filter name="VEVENT"/>
                            </C:comp-filter>
                          </C:filter>
                        </C:calendar-query>`
                    });
                    console.log(`REPORT response status: ${reportResponse.status}`);
                  } catch (refreshError) {
                    console.error("Error during server refresh:", refreshError);
                    // Non-fatal, continue
                  }
                  
                  // Success
                  return;
                } catch (error) {
                  const davError = error as Error;
                  console.error(`DAV client approach failed:`, davError);
                  console.log(`Falling back to direct PUT method...`);
                }
                
                // Fallback: Try a direct PUT request
                const response = await fetch(eventUrl, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                  },
                  body: icalEvent
                });
                
                console.log(`PUT response status: ${response.status} ${response.statusText}`);
                
                if (response.ok) {
                  // Update the event URL in our database
                  const etag = response.headers.get('ETag');
                  console.log(`Event created successfully. ETag: ${etag || 'Not provided'}`);
                  
                  await storage.updateEvent(newEvent.id, { 
                    url: eventUrl,
                    etag: etag || undefined,
                    rawData: icalEvent, // Store the raw iCalendar data for future reference
                    syncStatus: 'synced',
                    lastSyncAttempt: new Date()
                  });
                } else {
                  throw new Error(`Failed to create event: ${response.status} ${response.statusText}`);
                }
              } catch (error) {
                const putError = error as Error;
                console.error('Error creating event with PUT:', putError);
                console.error('Error details:', putError.message);
                throw putError;
              }
              
              console.log(`Successfully synchronized event "${eventData.title}" to CalDAV server`);
            } else {
              console.log(`Calendar not found or missing URL for event ${eventData.title}`);
            }
          } else {
            console.log(`No active CalDAV server connection for user ${userId}`);
          }
        } catch (syncError) {
          console.error('Error syncing event to CalDAV server:', syncError);
          // Update the sync status to show it failed
          await storage.updateEvent(newEvent.id, { 
            syncStatus: 'sync_failed',
            syncError: (syncError as Error).message,
            lastSyncAttempt: new Date()
          });
          // Continue despite sync error - at least the event is in our local database
        }
      }
      
      res.status(201).json(newEvent);
    } catch (err) {
      console.error("Error creating event:", err);
      return handleZodError(err, res);
    }
  });

  app.put("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      // Get authenticated user ID
      const userId = req.user!.id;
      console.log(`Event update request for ID ${eventId}. Authenticated User ID: ${userId}`);
      console.log(`Event update payload:`, JSON.stringify(req.body, null, 2));
      
      // Get the original event to have complete data
      const originalEvent = await storage.getEvent(eventId);
      if (!originalEvent) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Check if user has permission to update this event
      const permissionCheck = await checkCalendarPermission(userId, originalEvent.calendarId, 'edit', req);
      
      if (!permissionCheck.permitted) {
        return res.status(403).json({ message: permissionCheck.message || "Permission denied" });
      }
      
      // Get the calendar for reference
      const calendar = await storage.getCalendar(originalEvent.calendarId);
      
      // Get owner status for later usage
      const isOwner = calendar?.userId === userId;
      
      // Now that permissions are validated, continue with the event update
      // Create a copy of the request body to make modifications
      const eventData = { ...req.body };
      
      // Properly handle date conversions, preserving timezone info
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
        console.log(`Event update: ${eventData.title || 'unnamed'} - Start date string: ${req.body.startDate}, Converted: ${eventData.startDate.toISOString()}`);
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
        console.log(`Event update: ${eventData.title || 'unnamed'} - End date string: ${req.body.endDate}, Converted: ${eventData.endDate.toISOString()}`);
      }
      
      // Validate with zod (partial validation for update)
      const validatedData = insertEventSchema.partial().parse(eventData);
      
      // Update event in our local database
      const updatedEvent = await storage.updateEvent(eventId, validatedData);
      
      if (!updatedEvent) {
        return res.status(404).json({ message: "Event not found after update" });
      }
      
      // If user is authenticated, sync changes to CalDAV server
      if (userId && updatedEvent.url) {
        try {
          // Get user's CalDAV server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            console.log(`Attempting to sync updated event "${updatedEvent.title}" to CalDAV server...`);
            
            // Get the calendar for this event
            const calendar = await storage.getCalendar(updatedEvent.calendarId);
            
            // ALWAYS use the primary calendar regardless of the selected calendar
            // This ensures events are always created in the main calendar that Thunderbird can see
            const forcePrimaryCalendar = true;
            
            // Default to the selected calendar (but we'll override this)
            let targetCalendarUrl = calendar?.url;
            let targetCalendar = calendar;
            
            // Get all calendars
            const allCalendars = await storage.getCalendars(userId);
            console.log(`Examining ${allCalendars.length} calendars to find a primary calendar...`);
            
            // First, log all calendars for debugging
            allCalendars.forEach((cal, index) => {
              console.log(`Calendar ${index + 1}: "${cal.name}" - URL: ${cal.url || 'N/A'}`);
            });
            
            // Filter out proxy calendars and address books first
            const nonProxyCalendars = allCalendars.filter(cal => {
              if (!cal.url) return false;
              if (cal.url.includes('/calendar-proxy-')) {
                console.log(`Excluding proxy calendar: ${cal.name} (${cal.url})`);
                return false;
              }
              if (cal.url.includes('/addresses/')) {
                console.log(`Excluding address book: ${cal.name} (${cal.url})`);
                return false;
              }
              return true;
            });
            
            console.log(`Found ${nonProxyCalendars.length} non-proxy calendars`);
            
            // Define a scoring function to identify the most likely primary calendar
            const scorePrimaryCalendar = (cal: any): number => {
              let score = 0;
              
              // Give points for common primary calendar names
              if (cal.name === "Calendar") score += 10;
              if (cal.name.includes("calendar")) score += 5;
              if (cal.name.includes("D K Pandey")) score += 8;
              if (cal.name.includes("dkpandey")) score += 8;
              if (cal.name === "default") score += 7;
              if (cal.name.toLowerCase().includes("primary")) score += 6;
              if (cal.name.toLowerCase() === connection.username) score += 9;
              if (cal.name.toLowerCase().includes(connection.username)) score += 7;
              
              // Give points for likely primary calendar URLs
              if (cal.url.includes(`/${connection.username}/calendar/`)) score += 10;
              if (cal.url.includes(`/${connection.username}/`)) score += 8;
              if (cal.url.includes('/calendar/')) score += 6;
              if (cal.url.includes('/calendars/')) score += 5;
              
              // Penalize URLs that are likely not primary
              if (cal.url.includes('/inbox/')) score -= 10;
              if (cal.url.includes('/outbox/')) score -= 10;
              if (cal.url.includes('/notification/')) score -= 10;
              
              return score;
            };
            
            // Score and sort calendars
            const scoredCalendars = nonProxyCalendars.map(cal => ({
              calendar: cal,
              score: scorePrimaryCalendar(cal)
            })).sort((a, b) => b.score - a.score);
            
            // Log the scored calendars
            scoredCalendars.forEach(({calendar, score}) => {
              console.log(`Calendar "${calendar.name}" (${calendar.url}) - Score: ${score}`);
            });
            
            // Use the highest scoring calendar if available
            if (scoredCalendars.length > 0 && scoredCalendars[0].score > 0) {
              const bestCalendar = scoredCalendars[0].calendar;
              console.log(`Selected primary calendar: "${bestCalendar.name}" (${bestCalendar.url}) with score ${scoredCalendars[0].score}`);
              targetCalendarUrl = bestCalendar.url;
              targetCalendar = bestCalendar;
            } else if (nonProxyCalendars.length > 0) {
              // If we couldn't score any calendars well, just use the first non-proxy calendar
              const fallbackCalendar = nonProxyCalendars[0];
              console.log(`Using fallback non-proxy calendar: "${fallbackCalendar.name}" (${fallbackCalendar.url})`);
              targetCalendarUrl = fallbackCalendar.url;
              targetCalendar = fallbackCalendar;
            } else {
              console.log(`Warning: Could not find any suitable primary calendar`);
            }
            
            // Get the base URL from the event URL for updating operations
            // This assumes the event URL format is: calendarUrl/eventUID.ics
            let eventBaseUrl = updatedEvent.url;
            if (updatedEvent.url && updatedEvent.url.includes('.ics')) {
              // Extract the base URL by removing the filename part
              const lastSlashIndex = updatedEvent.url.lastIndexOf('/');
              if (lastSlashIndex !== -1) {
                eventBaseUrl = updatedEvent.url.substring(0, lastSlashIndex + 1);
                console.log(`Extracted base URL for event: ${eventBaseUrl}`);
              }
            }
            
            if (targetCalendar && targetCalendarUrl) {
              // Initialize CalDAV client
              const { DAVClient } = await import('tsdav');
              
              // Create CalDAV client
              const davClient = new DAVClient({
                serverUrl: connection.url,
                credentials: {
                  username: connection.username,
                  password: connection.password
                },
                authMethod: 'Basic',
                defaultAccountType: 'caldav'
              });
              
              // Use our Thunderbird-compatible iCalendar generator for updates too
              console.log("Using Thunderbird-compatible iCalendar format for update");
              const icalEvent = generateThunderbirdCompatibleICS({
                uid: updatedEvent.uid,
                title: updatedEvent.title,
                startDate: updatedEvent.startDate,
                endDate: updatedEvent.endDate,
                description: updatedEvent.description,
                location: updatedEvent.location,
                // Include the new fields if they exist
                attendees: updatedEvent.attendees,
                resources: updatedEvent.resources,
                busyStatus: updatedEvent.busyStatus,
                recurrenceRule: updatedEvent.recurrenceRule,
                allDay: updatedEvent.allDay
              });
              
              console.log(`Updating event on CalDAV server at URL: ${updatedEvent.url}`);
              
              // Update event on CalDAV server - try multiple approaches
              try {
                console.log('Event data being sent for update:');
                console.log(`Title: ${updatedEvent.title}`);
                console.log(`Start: ${updatedEvent.startDate.toISOString()}`);
                console.log(`End: ${updatedEvent.endDate.toISOString()}`);
                console.log(`Calendar ID: ${updatedEvent.calendarId}`);
                console.log(`iCalendar data: ${icalEvent}`);
                
                // Ensure the calendar URL ends with a trailing slash
                const calendarUrlWithSlash = targetCalendarUrl.endsWith('/') 
                  ? targetCalendarUrl 
                  : `${targetCalendarUrl}/`;
                
                // Approach 1: Try direct PUT to the event URL with If-Match header
                console.log(`First approach: Direct PUT to event URL with If-Match: ${updatedEvent.url}`);
                try {
                  const directPutResponse = await fetch(updatedEvent.url, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'text/calendar; charset=utf-8',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                      'If-Match': updatedEvent.etag || '*'
                    },
                    body: icalEvent
                  });
                  
                  console.log(`Direct PUT response status: ${directPutResponse.status} ${directPutResponse.statusText}`);
                  
                  if (directPutResponse.ok) {
                    console.log('Direct PUT succeeded');
                    // Update etag and sync status in our database
                    await storage.updateEvent(updatedEvent.id, { 
                      etag: directPutResponse.headers.get('ETag') || undefined,
                      syncStatus: 'synced',
                      lastSyncAttempt: new Date(),
                      syncError: null
                    });
                    
                    // Force immediate refresh to ensure the event is visible to other clients
                    try {
                      console.log("Forcing immediate server refresh after direct PUT...");
                      
                      // More efficient approach 1: First try a direct PROPFIND request to refresh the calendar
                      try {
                        const propfindResponse = await fetch(calendarUrlWithSlash, {
                          method: 'PROPFIND',
                          headers: {
                            'Content-Type': 'application/xml; charset=utf-8',
                            'Depth': '1',
                            'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                          },
                          body: `<?xml version="1.0" encoding="utf-8" ?>
                            <D:propfind xmlns:D="DAV:">
                              <D:prop>
                                <D:getetag/>
                              </D:prop>
                            </D:propfind>`
                        });
                        console.log(`PROPFIND response status: ${propfindResponse.status}`);
                      } catch (propfindError) {
                        console.error("Error during PROPFIND refresh:", propfindError);
                      }
                      
                      // Backup approach: Create a new DAV client with proper login for calendar fetch
                      try {
                        const { DAVClient } = await import('tsdav');
                        const refreshClient = new DAVClient({
                          serverUrl: connection.url,
                          credentials: {
                            username: connection.username,
                            password: connection.password
                          },
                          authMethod: 'Basic',
                          defaultAccountType: 'caldav'
                        });
                        
                        // Login first to establish account
                        await refreshClient.login();
                        
                        // Now fetch calendars should work
                        await refreshClient.fetchCalendars();
                        console.log("Server calendars refreshed successfully");
                      } catch (fetchError) {
                        console.error("Error with fetchCalendars refresh:", fetchError);
                      }
                      
                      // Send a REPORT request to make the changes visible to other clients
                      const reportResponse = await fetch(calendarUrlWithSlash, {
                        method: 'REPORT',
                        headers: {
                          'Content-Type': 'application/xml; charset=utf-8',
                          'Depth': '1',
                          'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                        },
                        body: `<?xml version="1.0" encoding="utf-8" ?>
                          <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                            <D:prop>
                              <D:getetag/>
                              <C:calendar-data/>
                            </D:prop>
                            <C:filter>
                              <C:comp-filter name="VCALENDAR">
                                <C:comp-filter name="VEVENT"/>
                              </C:comp-filter>
                            </C:filter>
                          </C:calendar-query>`
                      });
                      console.log(`REPORT response status: ${reportResponse.status}`);
                    } catch (refreshError) {
                      console.error("Error during server refresh:", refreshError);
                      // Non-fatal, continue
                    }
                    
                    return; // Exit early if successful
                  }
                } catch (error) {
                  const directPutError = error as Error;
                  console.error('Error during direct PUT:', directPutError.message);
                  // Continue to next approach
                }
                
                // Approach 2: Delete and recreate
                console.log('Second approach: Delete and recreate');
                try {
                  console.log(`Deleting event at URL: ${updatedEvent.url}`);
                  // First try to delete the existing event
                  await davClient.deleteCalendarObject({
                    calendarObject: {
                      url: updatedEvent.url,
                      etag: updatedEvent.etag || undefined
                    }
                  });
                  
                  // Then create a new event with the updated data at the same URL
                  console.log(`Creating new version of event at URL: ${updatedEvent.url}`);
                  
                  const response = await fetch(updatedEvent.url, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'text/calendar; charset=utf-8',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                    },
                    body: icalEvent
                  });
                  
                  console.log(`Recreate response status: ${response.status} ${response.statusText}`);
                  
                  if (response.ok) {
                    console.log('Delete and recreate succeeded');
                    // Update etag and sync status in our database
                    await storage.updateEvent(updatedEvent.id, { 
                      etag: response.headers.get('ETag') || undefined,
                      syncStatus: 'synced',
                      lastSyncAttempt: new Date(),
                      syncError: null
                    });
                    return; // Exit early if successful
                  }
                } catch (error) {
                  const deleteRecreateError = error as Error;
                  console.error('Error during delete-recreate:', deleteRecreateError.message);
                  // Continue to next approach
                }
                
                // Approach 3: Create at new URL
                console.log('Third approach: Create at calendar-based URL');
                try {
                  // Create a new event URL based on the calendar URL and event UID
                  // Sanitize the UID to make it URL-safe
                  const safeUid = updatedEvent.uid.replace(/[^a-zA-Z0-9-_]/g, '');
                  const newEventUrl = `${calendarUrlWithSlash}${safeUid}.ics`;
                  console.log(`Creating event at new URL: ${newEventUrl}`);
                  
                  const newUrlResponse = await fetch(newEventUrl, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'text/calendar; charset=utf-8',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                    },
                    body: icalEvent
                  });
                  
                  console.log(`New URL response status: ${newUrlResponse.status} ${newUrlResponse.statusText}`);
                  
                  if (newUrlResponse.ok) {
                    console.log('New URL approach succeeded');
                    // Update the event URL, etag, and sync status in our database
                    await storage.updateEvent(updatedEvent.id, { 
                      url: newEventUrl,
                      etag: newUrlResponse.headers.get('ETag') || undefined,
                      syncStatus: 'synced',
                      lastSyncAttempt: new Date(),
                      syncError: null
                    });
                    return; // Exit early if successful
                  }
                } catch (error) {
                  const newUrlError = error as Error;
                  console.error('Error during new URL creation:', newUrlError.message);
                  // Continue to next approach
                }
                
                // Approach 4: Try using DAV client's updateCalendarObject method
                console.log('Fourth approach: Using DAV client updateCalendarObject');
                try {
                  const calendarObject = await davClient.updateCalendarObject({
                    calendarObject: {
                      url: updatedEvent.url,
                      etag: updatedEvent.etag || undefined,
                      data: icalEvent
                    }
                  });
                  
                  console.log('DAV client update succeeded');
                  // Update the event URL, etag and sync status in our database
                  if (updatedEvent) {
                    await storage.updateEvent(updatedEvent.id, { 
                      url: calendarObject.url,
                      etag: calendarObject.etag || undefined,
                      syncStatus: 'synced',
                      lastSyncAttempt: new Date(),
                      syncError: null
                    });
                  }
                  return; // Exit early if successful
                } catch (error) {
                  const davClientError = error as Error;
                  console.error('Error during DAV client update:', davClientError.message);
                  // If all approaches failed, throw an error
                  throw new Error('All update approaches failed');
                }
              } catch (error) {
                const updateError = error as Error;
                console.error('All update approaches failed:', updateError.message);
                throw updateError;
              }
              
              console.log(`Successfully synchronized updated event "${updatedEvent.title}" to CalDAV server`);
            } else {
              console.log(`Calendar not found or missing URL for event ${updatedEvent.title}`);
            }
          } else {
            console.log(`No active CalDAV server connection for user ${userId}`);
          }
        } catch (syncError) {
          console.error('Error syncing updated event to CalDAV server:', syncError);
          // Update sync status to reflect the failure
          await storage.updateEvent(eventId, { 
            syncStatus: 'sync_failed',
            syncError: (syncError as Error).message,
            lastSyncAttempt: new Date()
          });
          // Continue despite sync error - at least the event is updated in our local database
        }
      }
      
      res.json(updatedEvent);
    } catch (err) {
      console.error("Error updating event:", err);
      return handleZodError(err, res);
    }
  });

  app.delete("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      // Get authenticated user ID
      const userId = req.user!.id;
      console.log(`Event delete request for ID ${eventId}. Authenticated User ID: ${userId}`);
      
      // Get the event before deleting it so we have its URL and other data for CalDAV sync
      const eventToDelete = await storage.getEvent(eventId);
      if (!eventToDelete) {
        // Check if there's evidence this event was already deleted
        const recentlyDeletedEvents = req.session.recentlyDeletedEvents || [];
        if (recentlyDeletedEvents.includes(eventId)) {
          console.log(`Event with ID ${eventId} was already deleted earlier`);
          // Respond with success since the event is already gone
          return res.status(204).send();
        }
        
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Check if user has permission to delete this event
      const permissionCheck = await checkCalendarPermission(userId, eventToDelete.calendarId, 'edit', req);
      
      if (!permissionCheck.permitted) {
        return res.status(403).json({ message: permissionCheck.message || "Permission denied" });
      }
      
      // Get the calendar for reference
      const calendar = await storage.getCalendar(eventToDelete.calendarId);
      if (!calendar) {
        return res.status(404).json({ message: "Calendar not found" });
      }
      
      // For compatibility with existing code
      const isOwner = calendar.userId === userId;
      
      // First delete from our local database
      const deleted = await storage.deleteEvent(eventId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Event could not be deleted" });
      }
      
      // Track this event as deleted in the session
      if (!req.session.recentlyDeletedEvents) {
        req.session.recentlyDeletedEvents = [];
      }
      req.session.recentlyDeletedEvents.push(eventId);
      
      // Limit the size of the recently deleted events array
      if (req.session.recentlyDeletedEvents.length > 50) {
        req.session.recentlyDeletedEvents = req.session.recentlyDeletedEvents.slice(-50);
      }
      
      // If user is authenticated and the event has a URL, sync deletion with CalDAV server
      if (userId && eventToDelete.url) {
        try {
          // Get user's CalDAV server connection
          const connection = await storage.getServerConnection(userId);
          
          if (connection && connection.status === 'connected') {
            console.log(`Attempting to delete event "${eventToDelete.title}" from CalDAV server...`);
            
            // Initialize CalDAV client
            const { DAVClient } = await import('tsdav');
            
            // Create CalDAV client
            const davClient = new DAVClient({
              serverUrl: connection.url,
              credentials: {
                username: connection.username,
                password: connection.password
              },
              authMethod: 'Basic',
              defaultAccountType: 'caldav'
            });
            
            console.log(`Deleting event from CalDAV server at URL: ${eventToDelete.url}`);
            
            console.log(`Attempting to delete event with multiple approaches`);
            
            // Track if any deletion approach succeeded
            let deleteSucceeded = false;
            
            console.log(`Attempting to delete event "${eventToDelete.title}" with UID ${eventToDelete.uid}`);
            // First verify if the event still exists on the server
            try {
              console.log(`Checking if event still exists on server at URL: ${eventToDelete.url}`);
              const checkResponse = await fetch(eventToDelete.url, {
                method: 'HEAD',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                }
              });
              
              // If event doesn't exist on server (404), we can consider it already deleted
              if (checkResponse.status === 404) {
                console.log(`Event doesn't exist on server (404 Not Found), considering it already deleted`);
                deleteSucceeded = true;
              }
            } catch (checkError) {
              console.warn(`Error checking event existence: ${(checkError as Error).message}`);
              // Continue with deletion attempts even if check fails
            }
            
            // Approach 1: Try using DAV client's deleteCalendarObject method
            if (!deleteSucceeded) {
              try {
                console.log(`First approach: Using DAV client deleteCalendarObject for URL: ${eventToDelete.url}`);
                await davClient.deleteCalendarObject({
                  calendarObject: {
                    url: eventToDelete.url,
                    etag: eventToDelete.etag || '*'
                  }
                });
                console.log(`DAV client delete succeeded`);
                deleteSucceeded = true;
                
                // Double-check that it's really gone
                try {
                  const verifyResponse = await fetch(eventToDelete.url, {
                    method: 'HEAD',
                    headers: {
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                    }
                  });
                  
                  if (verifyResponse.status === 404) {
                    console.log(`Verified event is gone from server`);
                  } else {
                    console.warn(`Event still exists on server with status ${verifyResponse.status} after deletion`);
                    deleteSucceeded = false; // Reset to false to try other methods
                  }
                } catch (verifyError) {
                  console.warn(`Error verifying deletion: ${(verifyError as Error).message}`);
                  // Continue with other deletion approaches
                }
              } catch (davClientError) {
                console.error(`Error during DAV client delete: ${(davClientError as Error).message}`);
                // Continue to next approach
              }
            }
            
            // Approach 2: Try direct DELETE request
            if (!deleteSucceeded) {
              try {
                console.log(`Second approach: Direct DELETE request to URL: ${eventToDelete.url}`);
                const deleteResponse = await fetch(eventToDelete.url, {
                  method: 'DELETE',
                  headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                    'If-Match': eventToDelete.etag || '*'
                  }
                });
                
                console.log(`DELETE response status: ${deleteResponse.status} ${deleteResponse.statusText}`);
                
                if (deleteResponse.ok) {
                  console.log(`Direct DELETE succeeded`);
                  deleteSucceeded = true;
                }
              } catch (deleteError) {
                console.error(`Error during direct DELETE: ${(deleteError as Error).message}`);
                // Continue to last approach
              }
            }
            
            // Approach 3: Try to PUT an empty/tombstone event
            if (!deleteSucceeded) {
              try {
                console.log(`Third approach: PUT empty tombstone event to URL: ${eventToDelete.url}`);
                
                // Create a Thunderbird-compatible tombstone event with CANCELLED status
                console.log("Using Thunderbird-compatible iCalendar format for deletion (tombstone)");
                // Get current sequence number
                let currentSequence = 0;
                if (eventToDelete.rawData && typeof eventToDelete.rawData === 'string') {
                  const match = eventToDelete.rawData.match(/SEQUENCE:(\d+)/);
                  if (match && match[1]) {
                    currentSequence = parseInt(match[1]);
                  }
                }
                
                const tombstoneEvent = generateThunderbirdCompatibleICS({
                  uid: eventToDelete.uid,
                  title: 'CANCELLED: ' + eventToDelete.title,
                  startDate: eventToDelete.startDate,
                  endDate: eventToDelete.endDate,
                  description: 'This event has been cancelled.',
                  location: eventToDelete.location,
                  // Include same attendees and resources but with cancelled status
                  attendees: eventToDelete.attendees,
                  resources: eventToDelete.resources,
                  busyStatus: 'cancelled', // This will already set STATUS:CANCELLED
                  recurrenceRule: eventToDelete.recurrenceRule,
                  allDay: eventToDelete.allDay
                }).replace('SEQUENCE:0', `SEQUENCE:${currentSequence + 1}`);
                
                const putResponse = await fetch(eventToDelete.url, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                    'If-Match': eventToDelete.etag || '*'
                  },
                  body: tombstoneEvent
                });
                
                console.log(`Tombstone PUT response status: ${putResponse.status} ${putResponse.statusText}`);
                
                if (putResponse.ok) {
                  console.log(`Tombstone approach succeeded`);
                  deleteSucceeded = true;
                }
              } catch (tombstoneError) {
                console.error(`Error during tombstone approach: ${(tombstoneError as Error).message}`);
              }
            }
            
            // Approach 4: If previous approaches failed, use a special empty event with STATUS:CANCELLED
            if (!deleteSucceeded) {
              try {
                console.log(`Fourth approach: Creating empty event with STATUS:CANCELLED`);
                
                // Create a minimal cancellation event - just the essentials required by RFC
                // Get current sequence number for minimal event
                let minimalSequence = 0;
                if (eventToDelete.rawData && typeof eventToDelete.rawData === 'string') {
                  const match = eventToDelete.rawData.match(/SEQUENCE:(\d+)/);
                  if (match && match[1]) {
                    minimalSequence = parseInt(match[1]);
                  }
                }
                
                const minimalCancellationEvent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CalDAV Client//NONSGML v1.0//EN
METHOD:CANCEL
BEGIN:VEVENT
UID:${eventToDelete.uid}
DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z
DTSTART:${eventToDelete.startDate.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z
STATUS:CANCELLED
SEQUENCE:${minimalSequence + 1}
END:VEVENT
END:VCALENDAR`;
                
                const putResponse = await fetch(eventToDelete.url, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'text/calendar; charset=utf-8',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                    'If-None-Match': '*'  // Only create if it doesn't exist
                  },
                  body: minimalCancellationEvent
                });
                
                console.log(`Minimal CANCEL event PUT response status: ${putResponse.status} ${putResponse.statusText}`);
                
                if (putResponse.ok) {
                  console.log(`Minimal cancellation approach succeeded`);
                  deleteSucceeded = true;
                }
              } catch (minimalCancelError) {
                console.error(`Error during minimal cancellation approach: ${(minimalCancelError as Error).message}`);
              }
            }
            
            // Final check to see if any approach succeeded
            if (!deleteSucceeded) {
              throw new Error('All event deletion approaches failed');
            }
            
            console.log(`Successfully deleted event "${eventToDelete.title}" from CalDAV server`);
          } else {
            console.log(`No active CalDAV server connection for user ${userId}`);
          }
        } catch (syncError) {
          console.error('Error deleting event from CalDAV server:', syncError);
          // Add the error details to be logged for debugging
          await storage.updateEvent(eventId, {
            syncStatus: 'error',
            syncError: `Failed to delete from server: ${(syncError as Error).message}`,
            lastSyncAttempt: new Date()
          });
          
          // We'll still return success since the local deletion worked
          // But we log the failure for potential retry later
          console.warn(`Event with ID ${eventId} was deleted locally but not on the CalDAV server`);
        }
      }
      
      // Verify the event is truly gone from our database
      const eventStillExists = await storage.getEvent(eventId);
      if (eventStillExists) {
        console.error(`Event with ID ${eventId} still exists in database after deletion`);
        return res.status(500).json({ message: "Failed to delete event from database" });
      }
      
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting event:", err);
      res.status(500).json({ 
        message: "Failed to delete event", 
        details: (err as Error).message
      });
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

  app.put("/api/server-connection/:id", isAuthenticated, async (req, res) => {
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

  app.delete("/api/server-connection/:id", isAuthenticated, async (req, res) => {
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
    // Optional calendar ID parameter for targeted sync
    const calendarId = req.query.calendarId ? parseInt(req.query.calendarId as string) : null;
    const forceRefresh = req.query.forceRefresh === 'true';
    const syncMode = req.query.mode || 'full';
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
      
      // Normalize the server URL
      let serverUrl = connection.url;
      if (!serverUrl.startsWith('http')) {
        serverUrl = `https://${serverUrl}`;
      }
      
      // Create a URL object to properly handle the URL parts
      let baseUrl: string;
      let principalUrl: string;
      let calendarUrl: string;
      
      try {
        const serverUrlObj = new URL(serverUrl);
        // Remove trailing slash from the host + path
        baseUrl = serverUrlObj.origin + 
          (serverUrlObj.pathname === '/' ? '' : serverUrlObj.pathname.replace(/\/$/, ''));
        
        // Add /caldav.php/username/ and /caldav.php/username/calendar/ for principal and calendar URLs
        // These are common path patterns for DAViCal servers
        principalUrl = `${baseUrl}/caldav.php/${connection.username}/`;
        calendarUrl = `${baseUrl}/caldav.php/${connection.username}/calendar/`;
        
        // Ensure no double slashes in the path
        principalUrl = principalUrl.replace(/([^:])\/\//g, '$1/');
        calendarUrl = calendarUrl.replace(/([^:])\/\//g, '$1/');
      } catch (error) {
        console.error(`Error parsing server URL: ${serverUrl}`, error);
        // Fallback to simple string manipulation
        baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
        principalUrl = `${baseUrl}/caldav.php/${connection.username}/`;
        calendarUrl = `${baseUrl}/caldav.php/${connection.username}/calendar/`;
      }
      
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
        
        // Filter out proxy calendars and address books
        if (serverCalendars.length > 0) {
          const originalCount = serverCalendars.length;
          
          // Filter calendars to only include primary calendars
          serverCalendars = serverCalendars.filter((cal: any) => {
            // Skip proxy calendars of any type
            if (cal.url.includes('/calendar-proxy')) {
              console.log(`Filtering out proxy calendar: ${cal.displayName}`);
              return false;
            }
            
            // Skip address books
            if (cal.url.includes('/addresses/') || 
                cal.displayName.toLowerCase().includes('addressbook')) {
              console.log(`Filtering out address book: ${cal.displayName}`);
              return false;
            }
            
            // Prioritize primary calendars
            // Look for common primary calendar names
            const isPrimary = 
              cal.displayName === "Calendar" || 
              cal.displayName.includes("D K Pandey calendar") || 
              cal.displayName === "default" || 
              cal.displayName.toLowerCase().includes("primary");
            
            if (isPrimary) {
              console.log(`Found primary calendar: ${cal.displayName}`);
            }
            
            return true;
          });
          
          console.log(`Filtered calendars from ${originalCount} down to ${serverCalendars.length} primary calendars`);
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
                    let url = match.replace(/<[^>]*href>|<\/[^>]*href>/g, '');
                    
                    // Handle relative URLs by converting them to absolute URLs
                    if (url.startsWith('/') && !url.startsWith('//')) {
                      // Extract the base URL (scheme + host) from the server URL
                      const serverUrlObj = new URL(connection.url);
                      const baseUrl = `${serverUrlObj.protocol}//${serverUrlObj.host}`;
                      url = `${baseUrl}${url}`;
                    }
                    
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
                      
                      // Debug resource type for this URL
                      console.log(`Resource response for ${url}:`, calendarCheckText.substring(0, 300));
                      
                      // Check for any calendar resource identifiers
                      const isCalResource = 
                        calendarCheckText.includes('<C:calendar') || 
                        calendarCheckText.includes('<calendar') || 
                        calendarCheckText.includes('calendar-collection') ||
                        calendarCheckText.includes('resourcetype') && 
                        (
                          calendarCheckText.includes('calendar') ||
                          url.includes('/calendar/') ||
                          url.includes('/Lalii/') ||  // Looking for specific calendar names from logs
                          url.includes('/ashu/') ||
                          url.includes('/dkpandey/')
                        );
                      
                      if (isCalResource) {
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
            // First, get all events from this calendar in our database
            const localEvents = await storage.getEvents(calendarId);
            console.log(`Found ${localEvents.length} local events in database for calendar ${displayName}`);
            
            // Create maps to track events
            const localEventsByUID = new Map();
            const localEventsToSync = new Map(); // Events that need to be created on the server
            
            // Track locally created events that need to be synced to the server
            for (const localEvent of localEvents) {
              // Add all events to map for quick lookup
              localEventsByUID.set(localEvent.uid, localEvent);
              
              // If the event has no URL or etag, it's a local event that hasn't been synced yet
              if (!localEvent.url || !localEvent.etag) {
                localEventsToSync.set(localEvent.uid, localEvent);
              }
            }
            
            console.log(`Found ${localEventsToSync.size} local events that need to be synced to the server`);
            
            // Now fetch events from the server
            const calendarObjects = await davClient.fetchCalendarObjects({
              calendar: { url: serverCalendar.url }
            });
            
            console.log(`Found ${calendarObjects.length} events on the server for calendar ${displayName}`);
            
            // Create a set to track server event UIDs
            const serverEventUIDs = new Set<string>();
            
            // If no events found on server but we have local events, sync them to the server
            if (calendarObjects.length === 0 && localEvents.length > 0) {
              console.log(`No events found on server for calendar ${displayName}. Syncing ${localEventsToSync.size} local events to server.`);
              
              // Sync local events to server
              for (const [uid, event] of localEventsToSync.entries()) {
                try {
                  console.log(`Syncing local event "${event.title}" (${uid}) to server`);
                  
                  // Use our Thunderbird-compatible iCalendar generator for sync
                  console.log("Using Thunderbird-compatible iCalendar format for server sync");
                  const icalEvent = generateThunderbirdCompatibleICS({
                    uid: event.uid,
                    title: event.title,
                    startDate: event.startDate,
                    endDate: event.endDate,
                    description: event.description,
                    location: event.location
                  });
                  
                  // Ensure the calendar URL ends with a trailing slash
                  const calendarUrlWithSlash = serverCalendar.url.endsWith('/') 
                    ? serverCalendar.url 
                    : `${serverCalendar.url}/`;
                  
                  // Create event URL
                  const eventUrl = `${calendarUrlWithSlash}${event.uid}.ics`;
                  
                  // Create event on server
                  const response = await fetch(eventUrl, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'text/calendar; charset=utf-8',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                    },
                    body: icalEvent
                  });
                  
                  if (response.ok) {
                    const etag = response.headers.get('ETag');
                    console.log(`Successfully created event "${event.title}" on server with ETag: ${etag || 'Not provided'}`);
                    
                    // Update local event with URL and etag
                    await storage.updateEvent(event.id, {
                      url: eventUrl,
                      etag: etag || undefined
                    });
                    
                    // Add this event to the server UIDs set
                    serverEventUIDs.add(uid);
                  } else {
                    console.error(`Failed to create event "${event.title}" on server: ${response.status} ${response.statusText}`);
                  }
                } catch (error) {
                  console.error(`Error syncing event "${event.title}" to server:`, (error as Error).message);
                }
              }
            } else if (calendarObjects.length === 0) {
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
            
            // Process each event from the server
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
                
                // Add to our set of server UIDs
                serverEventUIDs.add(uid);
                
                // Parse dates with better error handling
                // iCalendar dates are often in format like: 20200425T120000Z
                let startDate: Date;
                let endDate: Date;
                
                try {
                  // Try to parse iCalendar format dates
                  if (dtstart.length === 8) {
                    // All-day event with date in format: 20200425
                    const year = parseInt(dtstart.substring(0, 4));
                    const month = parseInt(dtstart.substring(4, 6)) - 1; // Month is 0-indexed
                    const day = parseInt(dtstart.substring(6, 8));
                    startDate = new Date(year, month, day);
                    isAllDay = true;
                  } else if (dtstart.length >= 15) {
                    // Date-time format like: 20200425T120000Z
                    const year = parseInt(dtstart.substring(0, 4));
                    const month = parseInt(dtstart.substring(4, 6)) - 1; // Month is 0-indexed
                    const day = parseInt(dtstart.substring(6, 8));
                    const hour = parseInt(dtstart.substring(9, 11));
                    const minute = parseInt(dtstart.substring(11, 13));
                    const second = parseInt(dtstart.substring(13, 15));
                    startDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                  } else {
                    // Fallback to standard date parsing
                    startDate = new Date(dtstart);
                  }
                  
                  // Do the same for end date
                  if (dtend.length === 8) {
                    const year = parseInt(dtend.substring(0, 4));
                    const month = parseInt(dtend.substring(4, 6)) - 1;
                    const day = parseInt(dtend.substring(6, 8));
                    endDate = new Date(year, month, day);
                  } else if (dtend.length >= 15) {
                    const year = parseInt(dtend.substring(0, 4));
                    const month = parseInt(dtend.substring(4, 6)) - 1;
                    const day = parseInt(dtend.substring(6, 8));
                    const hour = parseInt(dtend.substring(9, 11));
                    const minute = parseInt(dtend.substring(11, 13));
                    const second = parseInt(dtend.substring(13, 15));
                    endDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                  } else {
                    endDate = new Date(dtend);
                  }
                } catch (error) {
                  console.error(`Error parsing dates for event "${summary}":`, error);
                  console.log(`DTSTART: ${dtstart}, DTEND: ${dtend}`);
                  // Use default dates if parsing fails - April 2025 since it's the current month
                  startDate = new Date(2025, 3, 15, 9, 0, 0);
                  endDate = new Date(2025, 3, 15, 10, 0, 0);
                }
                
                // Check if dates are valid
                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                  console.error(`Invalid date for event "${summary}": startDate=${startDate}, endDate=${endDate}`);
                  // Use default dates - April 2025 since it's the current month
                  startDate = new Date(2025, 3, 15, 9, 0, 0);
                  endDate = new Date(2025, 3, 15, 10, 0, 0);
                }
                
                // Check if event already exists
                let existingEvent = await storage.getEventByUID(uid);
                
                if (existingEvent) {
                  // Remove it from our map of events to sync to server as it already exists
                  localEventsToSync.delete(uid);
                  
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
            
            // Process deletions: remove events that are in our local database but not on the server
            // Only consider events that were previously synced (have a URL) but not found on the server now
            console.log(`Checking ${localEvents.length} local events against ${serverEventUIDs.size} server event UIDs`);
            console.log(`Server event UIDs: ${[...serverEventUIDs].join(', ')}`);
            
            // Find events to delete
            const eventsToDelete = [];
            for (const localEvent of localEvents) {
              // Check if this event has a URL (meaning it was already synced with the server)
              // but is now missing from the server's event list (not in serverEventUIDs)
              if (localEvent.url && !serverEventUIDs.has(localEvent.uid)) {
                console.log(`Event "${localEvent.title}" (${localEvent.uid}) exists locally with URL but not on server. Marking for deletion.`);
                eventsToDelete.push(localEvent);
              }
            }
            
            // Now delete the events we identified (in a separate loop to avoid modifying array during iteration)
            if (eventsToDelete.length > 0) {
              console.log(`Deleting ${eventsToDelete.length} events that were removed from the server`);
              for (const eventToDelete of eventsToDelete) {
                console.log(`Deleting local event "${eventToDelete.title}" (${eventToDelete.uid})`);
                await storage.deleteEvent(eventToDelete.id);
              }
            } else {
              console.log('No events to delete during sync');
            }
            
            // Try to sync any remaining local events to the server
            if (localEventsToSync.size > 0) {
              console.log(`Attempting to sync ${localEventsToSync.size} remaining local events to the server`);
              
              for (const [uid, event] of localEventsToSync.entries()) {
                try {
                  console.log(`Syncing local event "${event.title}" (${uid}) to server`);
                  
                  // Use our Thunderbird-compatible iCalendar generator for sync
                  console.log("Using Thunderbird-compatible iCalendar format for server sync");
                  const icalEvent = generateThunderbirdCompatibleICS({
                    uid: event.uid,
                    title: event.title,
                    startDate: event.startDate,
                    endDate: event.endDate,
                    description: event.description,
                    location: event.location
                  });
                  
                  // Ensure the calendar URL ends with a trailing slash
                  const calendarUrlWithSlash = serverCalendar.url.endsWith('/') 
                    ? serverCalendar.url 
                    : `${serverCalendar.url}/`;
                  
                  // Create event URL
                  const eventUrl = `${calendarUrlWithSlash}${event.uid}.ics`;
                  
                  // Create event on server
                  const response = await fetch(eventUrl, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'text/calendar; charset=utf-8',
                      'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64'),
                    },
                    body: icalEvent
                  });
                  
                  if (response.ok) {
                    const etag = response.headers.get('ETag');
                    console.log(`Successfully created event "${event.title}" on server with ETag: ${etag || 'Not provided'}`);
                    
                    // Update local event with URL and etag
                    await storage.updateEvent(event.id, {
                      url: eventUrl,
                      etag: etag || undefined
                    });
                  } else {
                    console.error(`Failed to create event "${event.title}" on server: ${response.status} ${response.statusText}`);
                  }
                } catch (error) {
                  console.error(`Error syncing event "${event.title}" to server:`, (error as Error).message);
                }
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
        
        // Additional forced server-wide refresh requests
        // This ensures changes are immediately propagated to all CalDAV clients
        if (forceRefresh || syncMode === 'full') {
          console.log("Performing additional forced refresh operations for better client compatibility");
          
          try {
            // For each calendar, perform a REPORT request to force updated event data
            for (const calendar of serverCalendars) {
              try {
                const calendarUrl = calendar.url;
                if (!calendarUrl) continue;
                
                // Ensure the URL ends with a trailing slash
                const calendarUrlWithSlash = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
                
                console.log(`Sending REPORT request to refresh calendar: ${calendar.displayName || 'Unnamed'}`);
                
                // First, a full REPORT query to force update
                const reportResponse = await fetch(calendarUrlWithSlash, {
                  method: 'REPORT',
                  headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Depth': '1',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                  },
                  body: `<?xml version="1.0" encoding="utf-8" ?>
                    <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                      <D:prop>
                        <D:getetag/>
                        <C:calendar-data/>
                      </D:prop>
                      <C:filter>
                        <C:comp-filter name="VCALENDAR">
                          <C:comp-filter name="VEVENT"/>
                        </C:comp-filter>
                      </C:filter>
                    </C:calendar-query>`
                });
                
                console.log(`REPORT response status: ${reportResponse.status}`);
                
                // Then, a sync-collection request to ensure immediate sync
                const syncResponse = await fetch(calendarUrlWithSlash, {
                  method: 'REPORT',
                  headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Depth': '1',
                    'Authorization': 'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
                  },
                  body: `<?xml version="1.0" encoding="utf-8" ?>
                    <D:sync-collection xmlns:D="DAV:">
                      <D:sync-token>1</D:sync-token>
                      <D:sync-level>1</D:sync-level>
                      <D:prop>
                        <D:getetag/>
                      </D:prop>
                    </D:sync-collection>`
                });
                
                console.log(`Sync-collection response status: ${syncResponse.status}`);
                
                // Force calendar refresh using fresh tsdav client
                if (calendarId) {
                  const { DAVClient } = await import('tsdav');
                  const refreshClient = new DAVClient({
                    serverUrl: connection.url,
                    credentials: {
                      username: connection.username,
                      password: connection.password
                    },
                    authMethod: 'Basic',
                    defaultAccountType: 'caldav'
                  });
                  
                  console.log(`Forcing calendar refresh with fresh DAV client`);
                  await refreshClient.login();
                  await refreshClient.fetchCalendars();
                }
              } catch (refreshError) {
                console.error(`Error refreshing calendar ${calendar.displayName || 'Unnamed'}:`, refreshError);
                // Continue with next calendar even if this one fails
              }
            }
          } catch (error) {
            console.error("Error during forced refresh operations:", error);
            // Non-fatal, continue to return success response
          }
        }
        
        // Return success response
        res.json({ 
          message: "Sync successful", 
          lastSync: updatedConnection?.lastSync,
          calendarsCount: serverCalendars.length,
          newCalendarsCount: newCalendarsCount,
          eventsCount: totalEventsCount,
          forceRefreshed: forceRefresh || syncMode === 'full'
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

  // Sync service routes
  
  // Get sync status
  app.get("/api/sync/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const status = syncService.getSyncStatus(userId);
      res.json(status);
    } catch (err) {
      console.error("Error getting sync status:", err);
      res.status(500).json({ message: "Failed to get sync status" });
    }
  });
  
  // Start or stop auto-sync
  app.post("/api/sync/auto", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: "The 'enabled' field must be a boolean" });
      }
      
      const success = await syncService.updateAutoSync(userId, enabled);
      
      if (success) {
        res.json({ 
          message: `Auto-sync ${enabled ? 'enabled' : 'disabled'} successfully`,
          autoSync: enabled
        });
      } else {
        res.status(500).json({ message: "Failed to update auto-sync setting" });
      }
    } catch (err) {
      console.error("Error updating auto-sync:", err);
      res.status(500).json({ message: "Failed to update auto-sync setting" });
    }
  });
  
  // Update sync interval
  app.post("/api/sync/interval", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { interval } = req.body;
      
      // Basic validation
      const intervalValue = parseInt(interval);
      if (isNaN(intervalValue) || intervalValue < 60 || intervalValue > 86400) {
        return res.status(400).json({ 
          message: "Interval must be a number between 60 and 86400 seconds (1 minute to 24 hours)" 
        });
      }
      
      const success = await syncService.updateSyncInterval(userId, intervalValue);
      
      if (success) {
        // Also update the interval in the database
        const connection = await storage.getServerConnection(userId);
        if (connection) {
          await storage.updateServerConnection(connection.id, {
            syncInterval: intervalValue
          });
        }
        
        res.json({ 
          message: `Sync interval updated to ${intervalValue} seconds`,
          interval: intervalValue
        });
      } else {
        res.status(500).json({ message: "Failed to update sync interval" });
      }
    } catch (err) {
      console.error("Error updating sync interval:", err);
      res.status(500).json({ message: "Failed to update sync interval" });
    }
  });
  
  // Sync immediately
  app.post("/api/sync/now", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // This will trigger a sync right away
      const success = await syncService.syncNow(userId);
      
      if (success) {
        res.json({ message: "Sync triggered successfully" });
      } else {
        res.status(500).json({ message: "Failed to trigger sync" });
      }
    } catch (err) {
      console.error("Error triggering sync:", err);
      res.status(500).json({ message: "Failed to trigger sync" });
    }
  });
  
  const httpServer = createServer(app);
  return httpServer;
}
