import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import bcrypt from 'bcryptjs';
import { storage } from "./database-storage";
import { syncService } from "./sync-service";
import { User as SelectUser } from "@shared/schema";
import { DAVClient } from "tsdav";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  // Use bcrypt for new passwords to match existing database format
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

async function comparePasswords(supplied: string, stored: string) {
  if (!stored || typeof stored !== 'string') {
    console.error('Invalid stored password:', stored);
    return false;
  }

  try {
    // Detect if the password is in bcrypt format (starts with $2a$ or $2b$)
    if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
      console.log('Detected bcrypt format password, using bcrypt compare');
      console.log(`Password length: ${stored.length}, format: ${stored.substring(0, 7)}...`);
      
      try {
        const result = await bcrypt.compare(supplied, stored);
        console.log(`Bcrypt compare result: ${result}`);
        return result;
      } catch (bcryptError) {
        console.error('Bcrypt compare error:', bcryptError);
        return false;
      }
    } 
    // For scrypt format (contains a dot separating hash and salt)
    else if (stored.includes('.')) {
      console.log('Detected scrypt format password, using scrypt compare');
      const [hashed, salt] = stored.split(".");
      
      if (!hashed || !salt) {
        console.error('Failed to extract hash or salt from stored password');
        return false;
      }

      const hashedBuf = Buffer.from(hashed, "hex");
      const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
      return timingSafeEqual(hashedBuf, suppliedBuf);
    } 
    // Unrecognized format
    else {
      console.error('Unrecognized password hash format, cannot compare');
      return false;
    }
  } catch (error) {
    console.error('Error comparing passwords:', error);
    return false;
  }
}

// Function to verify credentials with the CalDAV server
async function verifyCalDAVCredentials(serverUrl: string, username: string, password: string): Promise<boolean> {
  try {
    console.log(`Verifying CalDAV credentials for ${username} at ${serverUrl}`);
    
    // First try using tsdav library
    try {
      const davClient = new DAVClient({
        serverUrl,
        credentials: {
          username,
          password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Try to login
      await davClient.login();
      console.log("CalDAV login successful with tsdav");
      
      // Try fetching calendars (but don't fail auth if this fails)
      try {
        await davClient.fetchCalendars();
        console.log("CalDAV fetchCalendars successful");
      } catch (fetchError) {
        console.log("CalDAV fetchCalendars failed, but login was successful:", fetchError);
        // Even if fetching calendars fails, consider auth successful if login worked
      }
      
      return true;
    } catch (tsdavError) {
      console.log("tsdav client failed, trying fallback method:", tsdavError);
      
      // Fallback to a direct PROPFIND request to verify auth
      const normalizedUrl = serverUrl.endsWith('/') ? serverUrl : serverUrl + '/';
      const response = await fetch(`${normalizedUrl}`, {
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml',
          'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
        },
        body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
      });
      
      console.log(`PROPFIND auth check status: ${response.status}`);
      
      if (response.ok || response.status === 207) {
        console.log("CalDAV auth successful with direct PROPFIND");
        return true;
      } else {
        console.log("Direct PROPFIND auth failed with status:", response.status);
        return false;
      }
    }
  } catch (error) {
    console.error("CalDAV auth failed with all methods:", error);
    return false;
  }
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "calendar-app-secret",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log(`Attempting to authenticate user: ${username}`);
        
        // Always authenticate directly against the CalDAV server first
        const defaultServerUrl = process.env.DEFAULT_CALDAV_SERVER || "https://zpush.ajaydata.com/davical/caldav.php";
        const formattedServerUrl = `${defaultServerUrl}/${encodeURIComponent(username)}/`;
        
        console.log(`Authenticating ${username} directly with CalDAV server: ${formattedServerUrl}`);
        
        // Try to authenticate against CalDAV server
        let isValidCalDAV = false;
        try {
          isValidCalDAV = await verifyCalDAVCredentials(
            formattedServerUrl,
            username,
            password
          );
        } catch (caldavError) {
          console.error(`Error verifying CalDAV credentials for ${username}:`, caldavError);
          return done(null, false, { message: "Error verifying credentials with CalDAV server" });
        }
        
        // If CalDAV authentication fails, reject the login attempt
        if (!isValidCalDAV) {
          console.log(`CalDAV authentication failed for ${username}`);
          return done(null, false, { message: "Invalid username or password" });
        }
        
        console.log(`CalDAV authentication successful for ${username}`);
        
        // Check if the user exists in our local database
        const user = await storage.getUserByUsername(username);
        
        // Extract user's full name from username - will be enhanced later
        // In a real implementation, we would try to get the full name from CalDAV server
        // For now, use email username as fallback
        let fullName = username.split('@')[0];
        // Convert to title case
        fullName = fullName.split('.').map(part => 
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join(' ');
        
        if (!user) {
          console.log(`User ${username} not found in local database. Creating new user.`);
          
          // Create the user first
          const hashedPassword = await hashPassword(password);
          const newUser = await storage.createUser({
            username,
            password: hashedPassword,
            email: username, // Email is same as username for CalDAV users
            preferredTimezone: "Asia/Kolkata", // Default timezone
            fullName: fullName // Use extracted full name
          });
          
          // Create server connection record with CalDAV credentials
          await storage.createServerConnection({
            userId: newUser.id,
            url: formattedServerUrl,
            username: username,
            password: password,
            autoSync: true,
            syncInterval: 15, // 15 minutes default
            status: "connected"
          });
          
          console.log(`Created user ${username} with ID ${newUser.id} and fullName: ${fullName}`);
          return done(null, newUser);
        }
        
        // User exists in local database, update credentials and other details
        console.log(`Updating existing user ${username} with ID ${user.id}`);
        
        // Update username and password if needed
        const hashedPassword = await hashPassword(password);
        await storage.updateUser(user.id, { 
          password: hashedPassword,
          fullName: user.fullName || fullName // Use existing full name or update with new one
        });
        
        // Update server connection or create if it doesn't exist
        const serverConnection = await storage.getServerConnection(user.id);
        if (serverConnection) {
          await storage.updateServerConnection(serverConnection.id, {
            url: formattedServerUrl,
            username: username,
            password: password,
            status: "connected"
          });
          console.log(`Updated server connection for ${username}`);
        } else {
          await storage.createServerConnection({
            userId: user.id,
            url: formattedServerUrl,
            username: username,
            password: password,
            autoSync: true,
            syncInterval: 15,
            status: "connected"
          });
          console.log(`Created new server connection for ${username}`);
        }
        
        console.log(`Authentication and update successful for user ${username}`);
        return done(null, user);
      } catch (error) {
        console.error(`Authentication error for user ${username}:`, error);
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const { 
        username, 
        password, 
        caldavServerUrl 
      } = req.body;
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      // Verify CalDAV credentials first
      try {
        const isValidCalDAV = await verifyCalDAVCredentials(
          caldavServerUrl,
          username,
          password
        );
        
        if (!isValidCalDAV) {
          return res.status(400).json({ 
            message: "Invalid CalDAV credentials. Please check your server URL, username and password." 
          });
        }
      } catch (error) {
        console.error("CalDAV credential verification error:", error);
        return res.status(400).json({
          message: "Failed to verify CalDAV credentials. Please check your server URL, username and password."
        });
      }
      
      // Create new user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
      });
      
      // Create server connection record with CalDAV credentials
      try {
        await storage.createServerConnection({
          userId: user.id,
          url: caldavServerUrl,
          username: username,
          password: password,
          autoSync: true,
          syncInterval: 15, // 15 minutes default
          status: "connected"
        });
        
        console.log(`Created server connection for user ${username}`);
      } catch (error) {
        console.error("Error creating server connection:", error);
        // Continue even if server connection creation fails
        // We've already created the user
      }

      // Log in the new user
      req.login(user, async (err) => {
        if (err) return next(err);
        
        try {
          // Get the server connection to set up sync
          const connection = await storage.getServerConnection(user.id);
          
          // Set up background sync for this user's session
          if (connection) {
            await syncService.setupSyncForUser(user.id, connection);
            console.log(`Started sync service for new user ${user.username}`);
            
            // Force an immediate full calendar sync with server for new users
            try {
              console.log(`Triggering immediate full calendar sync for new user ${user.username}`);
              await syncService.syncNow(user.id, { 
                forceRefresh: true,
                preserveLocalEvents: false,
                preserveLocalDeletes: false
              });
            } catch (syncNowError) {
              console.error(`Error during immediate sync for new user ${user.username}:`, syncNowError);
              // Don't fail registration if immediate sync fails
            }
          }
        } catch (syncError) {
          console.error("Error setting up sync service for new user:", syncError);
          // Don't fail registration if sync setup fails
        }
        
        const { password, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.post("/api/login", async (req, res, next) => {
    const { username, password, caldavServerUrl } = req.body;
    
    // Set default CalDAV server URL if not provided
    const serverUrl = caldavServerUrl || 
      `${process.env.DEFAULT_CALDAV_SERVER || "https://zpush.ajaydata.com/davical/caldav.php"}/${encodeURIComponent(username)}/`;
    
    console.log(`Login attempt for ${username} with server URL: ${serverUrl}`);
    
    // We'll use the passport authenticate which uses our custom local strategy
    // Our strategy already handles CalDAV verification and user creation/update
    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }
      
      // User is authenticated, now log them in
      req.login(user, async (err) => {
        if (err) return next(err);
        
        try {
          // Get the user's connection
          const userId = (user as SelectUser).id;
          const connection = await storage.getServerConnection(userId);
          
          // Set up background sync for this user's session
          if (connection) {
            await syncService.setupSyncForUser(userId, connection);
            console.log(`Started sync service for user ${(user as SelectUser).username}`);
            
            // Force an immediate full calendar sync with server
            try {
              console.log(`Triggering immediate full calendar sync for user ${(user as SelectUser).username}`);
              await syncService.syncNow(userId, { 
                forceRefresh: true,
                preserveLocalEvents: false,
                preserveLocalDeletes: false
              });
            } catch (syncNowError) {
              console.error(`Error during immediate sync for ${(user as SelectUser).username}:`, syncNowError);
              // Don't fail login if immediate sync fails
            }
          }
        } catch (syncError) {
          console.error("Error setting up sync service:", syncError);
          // Don't fail the login if sync setup fails
        }
        
        const { password, ...userWithoutPassword } = user as Express.User;
        res.status(200).json(userWithoutPassword);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    const userId = req.user?.id;
    
    req.logout(async (err) => {
      if (err) return next(err);
      
      // Handle sync service cleanup on logout
      if (userId) {
        try {
          await syncService.handleUserLogout(userId);
          console.log(`Updated sync service for user logout: ${userId}`);
        } catch (syncError) {
          console.error("Error handling sync service on logout:", syncError);
        }
      }
      
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      const { password, ...userWithoutPassword } = req.user;
      res.json(userWithoutPassword);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });
  
  // Update user timezone preference
  app.put("/api/user/timezone", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const userId = req.user.id;
      const { timezone } = req.body;
      
      if (!timezone || typeof timezone !== 'string') {
        return res.status(400).json({ message: "Invalid timezone" });
      }
      
      // Validate timezone (basic validation)
      if (timezone.length > 100) {
        return res.status(400).json({ message: "Timezone string too long" });
      }
      
      // Update the user's preferred timezone
      storage.updateUser(userId, {
        preferredTimezone: timezone
      }).then(updatedUser => {
        if (!updatedUser) {
          return res.status(404).json({ message: "User not found" });
        }
        
        res.json({
          success: true,
          message: "Timezone preference updated successfully",
          timezone
        });
      }).catch(error => {
        console.error("Error updating timezone preference:", error);
        res.status(500).json({ 
          message: "Failed to update timezone preference",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } catch (err) {
      console.error("Error updating timezone preference:", err);
      res.status(500).json({ 
        message: "Failed to update timezone preference",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  // Update user full name
  app.put("/api/user/fullname", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const userId = req.user.id;
      const { fullName } = req.body;
      
      if (!fullName || typeof fullName !== 'string') {
        return res.status(400).json({ message: "Invalid full name" });
      }
      
      // Validate full name (basic validation)
      if (fullName.length > 100) {
        return res.status(400).json({ message: "Full name string too long" });
      }
      
      // Update the user's full name
      storage.updateUser(userId, {
        fullName
      }).then(updatedUser => {
        if (!updatedUser) {
          return res.status(404).json({ message: "User not found" });
        }
        
        // If the user has SMTP config, update that as well to match the new full name
        storage.getSmtpConfig(userId).then(smtpConfig => {
          if (smtpConfig) {
            storage.updateSmtpConfig(smtpConfig.id, { 
              fromName: fullName 
            }).catch(error => {
              console.error("Error updating SMTP config with new full name:", error);
              // We'll continue even if this fails
            });
          }
        }).catch(error => {
          console.error("Error fetching SMTP config:", error);
          // We'll continue even if this fails
        });
        
        res.json({
          success: true,
          message: "Full name updated successfully",
          fullName
        });
      }).catch(error => {
        console.error("Error updating full name:", error);
        res.status(500).json({ 
          message: "Failed to update full name",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } catch (err) {
      console.error("Error updating full name:", err);
      res.status(500).json({ 
        message: "Failed to update full name",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  // Helper middleware for checking authentication
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  };

  return { isAuthenticated };
}