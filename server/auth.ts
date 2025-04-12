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
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          console.log(`Authentication failed: User ${username} not found`);
          return done(null, false, { message: "Invalid username or password" });
        }
        
        console.log(`User found: ${user.id}, checking password field:`, 
          user.password ? `Password exists (${user.password.length} chars)` : 'No password');
        
        if (!user.password) {
          console.log(`Authentication failed: User ${username} has no password set`);
          return done(null, false, { message: "User has no password set" });
        }
        
        let isPasswordValid = await comparePasswords(password, user.password);
        
        // If password check fails, try to check against server_connections table password
        if (!isPasswordValid) {
          console.log('Password check failed, trying to check against server_connections table...');
          try {
            const serverConnection = await storage.getServerConnectionByUsername(username);
            if (serverConnection && serverConnection.password === password) {
              console.log('Password matched server_connections table password!');
              
              // Update the user's password in the database to match the server_connection password
              const hashedPassword = await hashPassword(password);
              await storage.updateUser(user.id, { password: hashedPassword });
              console.log(`Updated user password hash in database for ${username}`);
              
              isPasswordValid = true;
            } else {
              console.log('Password did not match server_connections table password either');
            }
          } catch (serverConnectionError) {
            console.error('Error checking server_connections table:', serverConnectionError);
          }
        }
        
        if (!isPasswordValid) {
          console.log(`Authentication failed: Invalid password for user ${username}`);
          return done(null, false, { message: "Invalid username or password" });
        }
        
        console.log(`Authentication successful for user ${username}`);
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
    
    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }

      // App login successful, now check CalDAV credentials
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
        
        // Check if user already has a server connection
        const userId = (user as SelectUser).id;
        const existingConnection = await storage.getServerConnection(userId);
        
        if (existingConnection) {
          // Update existing connection
          await storage.updateServerConnection(existingConnection.id, {
            url: caldavServerUrl,
            username: username,
            password: password,
            status: "connected"
          });
          console.log(`Updated server connection for user ${(user as SelectUser).username}`);
        } else {
          // Create new server connection
          await storage.createServerConnection({
            userId: userId,
            url: caldavServerUrl,
            username: username,
            password: password,
            autoSync: true,
            syncInterval: 15,
            status: "connected"
          });
          console.log(`Created server connection for user ${(user as SelectUser).username}`);
        }
      } catch (error) {
        console.error("Error with CalDAV credentials:", error);
        return res.status(400).json({
          message: "Failed to verify CalDAV credentials. Please check your server URL, username and password."
        });
      }
      
      // Login and server connection successful
      req.login(user, async (err) => {
        if (err) return next(err);
        
        try {
          // Get the updated connection (after it was created/updated above)
          const userId = (user as SelectUser).id;
          const connection = await storage.getServerConnection(userId);
          
          // Set up background sync for this user's session
          if (connection) {
            await syncService.setupSyncForUser(userId, connection);
            console.log(`Started sync service for user ${(user as SelectUser).username}`);
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

  // Helper middleware for checking authentication
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  };

  return { isAuthenticated };
}