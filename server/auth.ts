import { type Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import { storage } from "./memory-storage";
import bcrypt from "bcryptjs";
import { InsertUser, User } from "@shared/schema";
import { DAVClient } from "tsdav";
import fetch from "node-fetch";
import { syncService } from "./sync-service";
import { syncSmtpPasswordWithCalDAV } from "./smtp-sync-utility";

// For use in request object type extension
interface DeletedEventInfo {
  id: number;
  uid?: string;
  url?: string;
  timestamp: string;
}

// Extend the Express.Request type
declare global {
  namespace Express {
    interface Request {
      caldavServerUrl?: string;  // Add property for CalDAV server URL during authentication
    }
    // Define the User interface with all the fields from shared/schema.ts
    interface User {
      id: number;
      username: string;
      password: string;
      preferredTimezone?: string;
      email?: string | null;
      fullName?: string | null;
    }
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePasswords(supplied: string, stored: string) {
  return bcrypt.compare(supplied, stored);
}

// Define a CalDAVUserInfo interface
interface CalDAVUserInfo {
  authenticated: boolean;
  displayName?: string;
  email?: string;
  principalUrl?: string;
  calendars?: any[]; // Calendar objects from the server
}

// Enhanced function to verify credentials with the CalDAV server and extract user data
async function verifyCalDAVCredentials(
  serverUrl: string, 
  username: string, 
  password: string
): Promise<boolean | CalDAVUserInfo> {
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
      
      // Initialize user info with authenticated status
      const userInfo: CalDAVUserInfo = {
        authenticated: true
      };
      
      // Try to get user info
      try {
        // Find principal URL using custom PROPFIND request
        const principalResponse = await fetch(serverUrl, {
          method: 'PROPFIND',
          headers: {
            'Depth': '0',
            'Content-Type': 'application/xml; charset=utf-8',
            'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
          },
          body: `<?xml version="1.0" encoding="utf-8" ?>
          <propfind xmlns="DAV:">
            <prop>
              <current-user-principal/>
            </prop>
          </propfind>`
        });
        
        if (principalResponse.ok || principalResponse.status === 207) {
          const responseText = await principalResponse.text();
          const principalMatch = responseText.match(/<current-user-principal><href>(.*?)<\/href><\/current-user-principal>/);
          
          if (principalMatch && principalMatch[1]) {
            const principalUrl = new URL(principalMatch[1], serverUrl).href;
            userInfo.principalUrl = principalUrl;
            console.log(`Found principal URL: ${principalUrl}`);
            
            // Try to get display name and email from principal properties
            try {
              const principalProps = await fetch(principalUrl, {
                method: 'PROPFIND',
                headers: {
                  'Depth': '0',
                  'Content-Type': 'application/xml; charset=utf-8',
                  'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
                },
                body: `<?xml version="1.0" encoding="utf-8" ?>
                <propfind xmlns="DAV:">
                  <prop>
                    <displayname/>
                    <email/>
                    <calendar-user-address-set xmlns="urn:ietf:params:xml:ns:caldav"/>
                  </prop>
                </propfind>`
              });
              
              if (principalProps && principalProps.status === 207) {
                const responseText = await principalProps.text();
                
                // Extract display name from XML response
                const displayNameMatch = responseText.match(/<displayname>(.*?)<\/displayname>/);
                if (displayNameMatch && displayNameMatch[1]) {
                  userInfo.displayName = displayNameMatch[1];
                  console.log(`Found display name: ${userInfo.displayName}`);
                }
                
                // Extract email from XML response
                const emailMatch = responseText.match(/<email>(.*?)<\/email>/);
                if (emailMatch && emailMatch[1]) {
                  userInfo.email = emailMatch[1];
                  console.log(`Found email: ${userInfo.email}`);
                }
                
                // Extract calendar user address if email is not found
                if (!userInfo.email) {
                  const addressMatch = responseText.match(/<href>mailto:(.*?)<\/href>/);
                  if (addressMatch && addressMatch[1]) {
                    userInfo.email = addressMatch[1];
                    console.log(`Found email from calendar-user-address-set: ${userInfo.email}`);
                  }
                }
              }
            } catch (propError) {
              console.error("Error fetching principal properties:", propError);
            }
          }
        }
      } catch (principalError) {
        console.error("Error fetching principal URL:", principalError);
      }
      
      // Try fetching calendars
      try {
        const calendars = await davClient.fetchCalendars();
        console.log(`CalDAV fetchCalendars successful: ${calendars.length} calendars found`);
        userInfo.calendars = calendars;
      } catch (fetchError) {
        console.log("CalDAV fetchCalendars failed, but login was successful:", fetchError);
        // Even if fetching calendars fails, consider auth successful if login worked
      }
      
      return userInfo;
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
        return { authenticated: true };
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
  // Use session with enhanced configuration for Replit environment
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "calendar-app-secret",
    resave: true, // Ensure session is saved on each request
    saveUninitialized: true, // Ensure new sessions are saved
    cookie: {
      secure: false, // Set to false for development in Replit
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true, 
      sameSite: 'lax', // Allows cross-site requests for better compatibility
      path: '/' // Ensure cookie is available across all paths
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ passReqToCallback: true }, async (req, username, password, done) => {
      try {
        console.log(`Attempting to authenticate user: ${username}`);
        
        // Get server URL from request object
        // Note: We set this in the req object in the login route
        const serverUrl = (req as any).caldavServerUrl || '';
        
        // First check if user exists in our system
        const existingUser = await storage.getUserByUsername(username);
        
        // Try to authenticate with CalDAV server first, regardless of whether user exists
        // since we prioritize CalDAV authentication over local authentication
        try {
          if (serverUrl) {
            console.log(`Attempting CalDAV authentication for ${username} at ${serverUrl}`);
            const isCalDAVValid = await verifyCalDAVCredentials(serverUrl, username, password);
            
            if (!isCalDAVValid) {
              console.log(`CalDAV authentication failed for ${username}`);
              return done(null, false, { message: "Invalid CalDAV credentials. Please check your username and password." });
            }
            
            console.log(`CalDAV authentication successful for ${username}`);
            
            // If user doesn't exist in our system yet, create them
            if (!existingUser) {
              console.log(`User ${username} authenticated via CalDAV but not found in local database. Creating user.`);
              
              // Create the user with the provided credentials
              const hashedPassword = await hashPassword(password);
              const newUser = await storage.createUser({
                username,
                password: hashedPassword,
                email: username.includes('@') ? username : null,
                fullName: null // This will be populated later from server data if available
              });
              
              console.log(`Created new user ${username} with ID ${newUser.id}`);
              
              // Also create server connection for the new user
              await storage.createServerConnection({
                userId: newUser.id,
                url: serverUrl,
                username,
                password, // Store the plain password for CalDAV access
                autoSync: true,
                syncInterval: 15,
                status: "connected"
              });
              
              console.log(`Created server connection for new user ${username}`);
              
              // Set up SMTP config with same credentials for email sending
              try {
                // Check if email is valid format
                if (username.includes('@')) {
                  const smtpConfig = await storage.getSmtpConfig(newUser.id);
                  
                  if (!smtpConfig) {
                    // Create default SMTP config with CalDAV password
                    await storage.createSmtpConfig({
                      userId: newUser.id,
                      host: 'smtps.xgen.in',
                      port: 465,
                      secure: true,
                      username: username,
                      password: password, // Use CalDAV password for SMTP
                      fromEmail: username,
                      fromName: newUser.fullName || username.split('@')[0],
                      enabled: true
                    });
                    
                    console.log(`Created SMTP configuration for new user ${username} using CalDAV credentials`);
                  } else {
                    // Update existing SMTP config with CalDAV password
                    await storage.updateSmtpConfig(smtpConfig.id, {
                      password: password
                    });
                    
                    console.log(`Updated SMTP password for user ${username} using CalDAV credentials`);
                  }
                }
              } catch (smtpError) {
                console.error(`Error setting up SMTP for user ${username}:`, smtpError);
                // Continue with authentication even if SMTP setup fails
              }
              
              return done(null, newUser);
            }
            
            // At this point, user exists in our system and CalDAV authentication succeeded
            // Update server connection if needed
            try {
              const existingConnection = await storage.getServerConnection(existingUser.id);
              
              if (existingConnection) {
                // Update existing connection with latest credentials
                await storage.updateServerConnection(existingConnection.id, {
                  url: serverUrl,
                  username,
                  password,
                  status: "connected"
                });
                console.log(`Updated server connection for ${username}`);
              } else {
                // Create new connection if none exists
                await storage.createServerConnection({
                  userId: existingUser.id,
                  url: serverUrl,
                  username,
                  password,
                  autoSync: true,
                  syncInterval: 15,
                  status: "connected"
                });
                console.log(`Created new server connection for existing user ${username}`);
              }
              
              // Update SMTP config with the same credentials
              try {
                // Only proceed for username that looks like an email
                if (username.includes('@')) {
                  const smtpConfig = await storage.getSmtpConfig(existingUser.id);
                  
                  if (!smtpConfig) {
                    // Create default SMTP config with CalDAV password
                    await storage.createSmtpConfig({
                      userId: existingUser.id,
                      host: 'smtps.xgen.in',
                      port: 465,
                      secure: true,
                      username: username,
                      password: password, // Use CalDAV password for SMTP
                      fromEmail: username,
                      fromName: existingUser.fullName || username.split('@')[0],
                      enabled: true
                    });
                    
                    console.log(`Created SMTP configuration for existing user ${username} using CalDAV credentials`);
                  } else {
                    // Update existing SMTP config with CalDAV password
                    await storage.updateSmtpConfig(smtpConfig.id, {
                      password: password
                    });
                    
                    console.log(`Updated SMTP password for user ${username} using CalDAV credentials`);
                  }
                }
              } catch (smtpError) {
                console.error(`Error setting up SMTP for user ${username}:`, smtpError);
                // Continue with authentication even if SMTP setup fails
              }
            } catch (connectionError) {
              console.error(`Error updating server connection for ${username}:`, connectionError);
              // Continue login process even if connection update fails
            }
            
            // Update user's password hash if it's different
            try {
              const isStoredPasswordValid = await comparePasswords(password, existingUser.password);
              if (!isStoredPasswordValid) {
                console.log(`Updating password hash for ${username} to match CalDAV credentials`);
                const hashedPassword = await hashPassword(password);
                await storage.updateUser(existingUser.id, { password: hashedPassword });
              }
            } catch (passwordUpdateError) {
              console.error(`Error updating password for ${username}:`, passwordUpdateError);
              // Continue login process even if password update fails
            }
            
            return done(null, existingUser);
          }
        } catch (caldavError) {
          console.error(`Error during CalDAV authentication for ${username}:`, caldavError);
          // Fall back to local authentication if CalDAV authentication fails
        }
        
        // If we reach here, either CalDAV auth failed or serverUrl wasn't provided
        // Fall back to standard local authentication
        
        if (!existingUser) {
          console.log(`Authentication failed: User ${username} not found`);
          return done(null, false, { message: "Invalid username or password" });
        }
        
        console.log(`User found: ${existingUser.id}, checking password field:`, 
          existingUser.password ? `Password exists (${existingUser.password.length} chars)` : 'No password');
        
        if (!existingUser.password) {
          console.log(`Authentication failed: User ${username} has no password set`);
          return done(null, false, { message: "User has no password set" });
        }
        
        let isPasswordValid = await comparePasswords(password, existingUser.password);
        
        // If password check fails, try to check against server_connections table password
        if (!isPasswordValid) {
          console.log('Password check failed, trying to check against server_connections table...');
          try {
            const serverConnection = await storage.getServerConnectionByUsername(username);
            if (serverConnection && serverConnection.password === password) {
              console.log('Password matched server_connections table password!');
              
              // Update the user's password in the database to match the server_connection password
              const hashedPassword = await hashPassword(password);
              await storage.updateUser(existingUser.id, { password: hashedPassword });
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
        return done(null, existingUser);
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
      
      // Will hold the newly created user
      let user;
      
      try {
        // Verify CalDAV credentials first and get user info
        const caldavResult = await verifyCalDAVCredentials(
          caldavServerUrl,
          username,
          password
        );
        
        if (!caldavResult || (typeof caldavResult === 'boolean' && !caldavResult)) {
          return res.status(400).json({ 
            message: "Invalid CalDAV credentials. Please check your server URL, username and password." 
          });
        }
        
        // Extract user info from the CalDAV response (if available)
        const caldavUserInfo = typeof caldavResult === 'object' ? caldavResult : null;
        
        // Create new user with CalDAV info if available
        const hashedPassword = await hashPassword(password);
        const userData: InsertUser = {
          username,
          password: hashedPassword,
        };
        
        // Add email and fullName if available from CalDAV
        if (caldavUserInfo) {
          if (caldavUserInfo.email) {
            userData.email = caldavUserInfo.email;
            console.log(`Using email from CalDAV for new user: ${caldavUserInfo.email}`);
          }
          
          if (caldavUserInfo.displayName) {
            userData.fullName = caldavUserInfo.displayName;
            console.log(`Using display name from CalDAV for new user: ${caldavUserInfo.displayName}`);
          }
        }
        
        // For email-like usernames, use as email if not already set
        if (!userData.email && username.includes('@')) {
          userData.email = username;
          console.log(`Using username as email for new user: ${username}`);
        }
        
        // If no full name is available but we have an email, extract name part
        if (!userData.fullName && userData.email) {
          const namePart = userData.email.split('@')[0];
          if (namePart) {
            // Convert name formats like "john.doe" or "johndoe" to "John Doe"
            const formattedName = namePart
              .replace(/\./g, ' ')
              .split(' ')
              .map(part => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ');
            
            userData.fullName = formattedName;
            console.log(`Generated full name from email: ${formattedName}`);
          }
        }
        
        // Create the user in the database
        user = await storage.createUser(userData);
        console.log(`Created new user: ${username} with ID ${user.id}`);
        
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
          
          // Also create SMTP configuration with same credentials
          try {
            if (username.includes('@')) {
              await storage.createSmtpConfig({
                userId: user.id,
                host: 'smtps.xgen.in',
                port: 465,
                secure: true,
                username: username,
                password: password, // Use CalDAV password for SMTP
                fromEmail: username,
                fromName: userData.fullName || username.split('@')[0],
                enabled: true
              });
              
              console.log(`Created SMTP configuration for new user ${username} using CalDAV credentials`);
            }
          } catch (smtpError) {
            console.error(`Error setting up SMTP for user ${username}:`, smtpError);
            // Continue with registration even if SMTP setup fails
          }
        } catch (serverConnectionError) {
          console.error("Error creating server connection:", serverConnectionError);
          // Continue even if server connection creation fails
          // We've already created the user
        }
      } catch (error) {
        console.error("Registration error:", error);
        return res.status(400).json({
          message: "Failed to register. Please check your server URL, username and password."
        });
      }
      
      // If we got this far without user being set, something went wrong
      if (!user) {
        console.error("User creation failed in an unexpected way");
        return res.status(500).json({ message: "Error creating user" });
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
    
    // Store caldavServerUrl in req so it can be accessed by the LocalStrategy
    (req as any).caldavServerUrl = caldavServerUrl;
    
    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }

      // App login successful, now check CalDAV credentials
      try {
        const caldavResult = await verifyCalDAVCredentials(
          caldavServerUrl,
          username,
          password
        );
        
        if (!caldavResult || (typeof caldavResult === 'boolean' && !caldavResult)) {
          return res.status(400).json({ 
            message: "Invalid CalDAV credentials. Please check your server URL, username and password." 
          });
        }
        
        // Extract user info from the CalDAV server response
        const caldavUserInfo = typeof caldavResult === 'object' ? caldavResult : null;
        
        // Check if user already has a server connection
        const userId = user.id;
        const existingConnection = await storage.getServerConnection(userId);
        
        // Update user profile with CalDAV info if available
        const updateData: Partial<User> = {};
        
        // First try to get data from CalDAV server response
        if (caldavUserInfo) {
          // Update full name if available from CalDAV
          if (caldavUserInfo.displayName && (!user.fullName || user.fullName.trim() === '')) {
            updateData.fullName = caldavUserInfo.displayName;
            console.log(`Updating user fullName to ${caldavUserInfo.displayName} from CalDAV`);
          }
          
          // Update email if available from CalDAV
          if (caldavUserInfo.email && (!user.email || user.email.trim() === '')) {
            updateData.email = caldavUserInfo.email;
            console.log(`Updating user email to ${caldavUserInfo.email} from CalDAV`);
          }
        }
        
        // If no full name from CalDAV but it's missing, generate one from email/username
        if (!updateData.fullName && (!user.fullName || user.fullName.trim() === '')) {
          // Use email to generate name if available
          const emailToUse = user.email || username;
          if (emailToUse && emailToUse.includes('@')) {
            // Extract name part from email (before @)
            const namePart = emailToUse.split('@')[0];
            if (namePart) {
              // Convert name formats like "john.doe" or "johndoe" to "John Doe"
              const formattedName = namePart
                .replace(/\./g, ' ')  // Replace dots with spaces
                .replace(/_/g, ' ')   // Replace underscores with spaces
                .split(' ')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                .join(' ');
                
              updateData.fullName = formattedName;
              console.log(`Generated full name from email: ${formattedName}`);
            }
          }
        }
        
        // Apply updates if any fields changed
        if (Object.keys(updateData).length > 0) {
          await storage.updateUser(userId, updateData);
          console.log(`Updated user profile with new data`);
          
          // Also update the user object in memory so changes reflect immediately
          Object.assign(user, updateData);
        }
        
        if (existingConnection) {
          // Update existing connection
          await storage.updateServerConnection(existingConnection.id, {
            url: caldavServerUrl,
            username: username,
            password: password,
            status: "connected"
          });
          console.log(`Updated server connection for user ${user.username}`);
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
          console.log(`Created server connection for user ${user.username}`);
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
          const userId = user.id;
          const connection = await storage.getServerConnection(userId);
          
          // Synchronize SMTP password with CalDAV password to ensure email invitations work
          try {
            const smtpSyncResult = await syncSmtpPasswordWithCalDAV(userId);
            if (smtpSyncResult) {
              console.log(`Successfully synchronized SMTP password with CalDAV password for user ${user.username}`);
            } else {
              console.log(`No SMTP password synchronization needed for user ${user.username}`);
            }
          } catch (smtpSyncError) {
            console.error(`Error synchronizing SMTP password for user ${user.username}:`, smtpSyncError);
            // Don't fail login if SMTP sync fails
          }
          
          // Set up background sync for this user's session
          if (connection) {
            await syncService.setupSyncForUser(userId, connection);
            console.log(`Started sync service for user ${user.username}`);
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