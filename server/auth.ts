import { type Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import { storage } from "./storage";
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
      preferredTimezone: string;
      email: string | null;
      fullName: string | null;
    }
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePasswords(supplied: string, stored: string) {
  return bcrypt.compare(supplied, stored);
}

// Helper function to normalize user objects to match Express.User interface
function normalizeUserForAuth(user: any): Express.User {
  return {
    id: user.id,
    username: user.username,
    password: user.password || "[FILTERED]",
    preferredTimezone: user.preferredTimezone || "UTC", // Never undefined/null, always a string
    email: user.email || null, // Ensure it's null rather than undefined
    fullName: user.fullName || null // Ensure it's null rather than undefined
  };
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
      
      // Initialize user info with authenticated status and default display name derived from username
      // This ensures we always have at least a basic display name
      let formattedName = "";
      if (username.includes('@')) {
        // Get the username part before the @ symbol
        const namePart = username.split('@')[0];
        // Convert from formats like "john.doe" or "john_doe" to "John Doe"
        formattedName = namePart
          .replace(/[._-]/g, ' ')
          .split(' ')
          .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join(' ');
      } else {
        // For non-email username formats
        formattedName = username
          .replace(/[._-]/g, ' ')
          .split(' ')
          .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join(' ');
      }
      
      const userInfo: CalDAVUserInfo = {
        authenticated: true,
        displayName: formattedName,  // Set a default display name
        email: username.includes('@') ? username : undefined
      };
      
      console.log(`Initial displayName set to: ${userInfo.displayName}`);
      
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
                <propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                  <prop>
                    <displayname/>
                    <email/>
                    <C:calendar-user-address-set/>
                    <C:calendar-user-type/>
                    <C:calendar-home-set/>
                    <current-user-privilege-set/>
                    <principal-URL/>
                    <resourcetype/>
                  </prop>
                </propfind>`
              });
              
              if (principalProps && principalProps.status === 207) {
                const responseText = await principalProps.text();
                
                // Log the full response for debugging
                console.log(`[DEBUG] Principal properties response (first 800 chars): ${responseText.substring(0, 800)}...`);
                if (responseText.includes('displayname')) {
                  console.log('Response contains "displayname" tag');
                  // Try to get context around displayname tag
                  try {
                    // Look for displayname tag with surrounding context (100 chars before and after)
                    const startIndex = Math.max(0, responseText.indexOf('<displayname>') - 100);
                    const endIndex = Math.min(responseText.length, responseText.indexOf('</displayname>') + 13 + 100);
                    if (startIndex >= 0 && endIndex > startIndex) {
                      const context = responseText.substring(startIndex, endIndex);
                      console.log('Context around displayname tag:', context);
                    }
                  } catch (contextError) {
                    console.log('Error getting context around displayname tag:', contextError);
                  }
                } else {
                  console.log('Warning: Response does not contain "displayname" tag');
                }
                
                // Extract display name from XML response - more comprehensive to handle different formats
                // Try multiple patterns as different servers might format the XML differently
                
                // Pattern 1: Standard format
                let displayNameMatch = responseText.match(/<displayname>(.*?)<\/displayname>/);
                
                // Pattern 2: With namespace prefix
                if (!displayNameMatch) {
                  displayNameMatch = responseText.match(/<[^:]+:displayname>(.*?)<\/[^:]+:displayname>/);
                }
                
                // Pattern 3: With XML escaped characters
                if (!displayNameMatch) {
                  displayNameMatch = responseText.match(/<displayname>([^<]*?)&lt;\/displayname&gt;/);
                }
                
                // Pattern 4: In CDATA section
                if (!displayNameMatch) {
                  displayNameMatch = responseText.match(/<displayname><!\[CDATA\[(.*?)\]\]><\/displayname>/);
                }
                
                // Pattern 5: With whitespace and newlines
                if (!displayNameMatch) {
                  displayNameMatch = responseText.match(/<displayname>\s*([\s\S]*?)\s*<\/displayname>/);
                }
                
                if (displayNameMatch && displayNameMatch[1]) {
                  userInfo.displayName = displayNameMatch[1].trim();
                  console.log(`Found display name: ${userInfo.displayName}`);
                } else {
                  console.log("Could not extract display name from principal properties"); 
                  // Extract from username as fallback (will handle below)
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
        
        // If we couldn't get display name from principal properties, try getting it from calendars
        if (!userInfo.displayName && calendars && calendars.length > 0) {
          // Log the first calendar data to see its structure
          if (calendars[0]) {
            console.log('First calendar data structure:', JSON.stringify(calendars[0]).substring(0, 500));
          }
          
          // Try to find owner info in calendar data - safely access properties
          for (const calendar of calendars) {
            // Safe property access with type checking
            const calendarAny = calendar as any; // Cast to any to access properties
            
            // Try to get owner display name if it exists
            if (calendarAny.owner && typeof calendarAny.owner === 'object' && calendarAny.owner.displayName) {
              userInfo.displayName = calendarAny.owner.displayName;
              console.log(`Using owner displayName from calendar: ${userInfo.displayName}`);
              break;
            }
            
            // Sometimes the display name is in the principalURL or calendar URL
            // Extract username part and use as display name if it looks like a name (not an email)
            const principalUrl = calendarAny.principalUrl || calendarAny.url || '';
            if (!userInfo.displayName && principalUrl && typeof principalUrl === 'string') {
              const principalUrlParts = principalUrl.split('/');
              const potentialName = principalUrlParts[principalUrlParts.length - 1];
              
              if (potentialName && !potentialName.includes('@') && !potentialName.includes('.')) {
                // Convert to title case for better display
                const formattedName = potentialName
                  .replace(/[._-]/g, ' ')
                  .split(' ')
                  .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                  .join(' ');
                
                userInfo.displayName = formattedName;
                console.log(`Extracted display name from principal URL: ${userInfo.displayName}`);
                break;
              }
            }
          }
        }
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
        
        // Generate a display name from username for consistent behavior
        let formattedName = "";
        if (username.includes('@')) {
          // Get the username part before the @ symbol
          const namePart = username.split('@')[0];
          // Convert from formats like "john.doe" or "john_doe" to "John Doe"
          formattedName = namePart
            .replace(/[._-]/g, ' ')
            .split(' ')
            .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
        } else {
          // For non-email username formats
          formattedName = username
            .replace(/[._-]/g, ' ')
            .split(' ')
            .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
        }
        
        return {
          authenticated: true,
          displayName: formattedName,
          email: username.includes('@') ? username : undefined
        };
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
  // Enhanced session configuration with more robust settings for better persistence
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "calendar-app-secret-key-enhanced-version",
    resave: true, // Save session on every request to avoid timeouts
    saveUninitialized: false, // Don't create session until something stored
    store: storage.sessionStore, // Use our storage's session store for persistence
    name: 'caldav_app.sid', // Use a distinct name to avoid conflicts
    rolling: true, // Forces a cookie set on every response, keeps session alive
    cookie: {
      secure: process.env.NODE_ENV === 'production', // Secure in production, allow HTTP in dev
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days for longer persistence
      httpOnly: true, // Prevents client-side JS from reading the cookie
      sameSite: 'lax', // Allows cross-site requests with some restrictions
      path: '/', // Ensure cookie is available across all paths
      domain: undefined // Allow the browser to set the cookie domain automatically
    }
  };
  
  console.log("[Auth] Configuring session with persistence store:", 
              storage.sessionStore ? "Session store available" : "No session store");

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
              
              return done(null, normalizeUserForAuth(newUser));
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
            
            // Try to get CalDAV user information for profile update
            try {
              // Get user info from CalDAV server to update profile
              const caldavUserInfo = typeof isCalDAVValid === 'object' ? isCalDAVValid : null;
              
              // Update profile with display name and email from CalDAV if available
              if (caldavUserInfo) {
                // Use type that matches the database schema
                let userUpdates: {
                  fullName?: string | null;
                  email?: string | null;
                } = {};
                let needsUpdate = false;
                
                // Update display name if available from CalDAV and different from current
                if (caldavUserInfo.displayName && 
                    (!existingUser.fullName || existingUser.fullName !== caldavUserInfo.displayName)) {
                  userUpdates.fullName = caldavUserInfo.displayName;
                  console.log(`Updating display name for ${username} from CalDAV: ${caldavUserInfo.displayName}`);
                  needsUpdate = true;
                }
                
                // Update email if available from CalDAV and different from current
                if (caldavUserInfo.email && 
                    (!existingUser.email || existingUser.email !== caldavUserInfo.email)) {
                  userUpdates.email = caldavUserInfo.email;
                  console.log(`Updating email for ${username} from CalDAV: ${caldavUserInfo.email}`);
                  needsUpdate = true;
                }
                
                // Apply updates if needed
                if (needsUpdate) {
                  await storage.updateUser(existingUser.id, userUpdates);
                  console.log(`Updated profile information for ${username} with CalDAV data`);
                  
                  // Note: we don't need to refresh the user object here.
                  // The changes have been saved to the database and will be available in future requests.
                  // The current authentication process will continue with the existing user object.
                }
              }
            } catch (profileUpdateError) {
              console.error(`Error updating profile for ${username} from CalDAV data:`, profileUpdateError);
              // Continue login process even if profile update fails
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
            
            return done(null, normalizeUserForAuth(existingUser));
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
        return done(null, normalizeUserForAuth(existingUser));
      } catch (error) {
        console.error(`Authentication error for user ${username}:`, error);
        return done(error);
      }
    }),
  );

  passport.serializeUser((user: Express.User, done) => {
    try {
      console.log(`Serializing user to session: ${user.id} (${user.username})`);
      done(null, user.id);
    } catch (error) {
      console.error("Error during user serialization:", error);
      done(error, null);
    }
  });
  
  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log(`Deserializing user from session ID: ${id}`);
      
      if (!id || isNaN(Number(id))) {
        console.error(`Invalid user ID in session: ${id}`);
        return done(null, false);
      }
      
      const user = await storage.getUser(Number(id));
      
      if (!user) {
        console.error(`User with ID ${id} not found during deserialization`);
        return done(null, false);
      }
      
      // Use our helper function to normalize user
      const normalizedUser = normalizeUserForAuth(user);
      
      console.log(`User ${id} (${user.username}) successfully deserialized from session`);
      done(null, normalizedUser);
    } catch (error) {
      console.error(`Error deserializing user ${id}:`, error);
      done(error, null);
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

      // Log in the new user - normalize the user first
      req.login(normalizeUserForAuth(user), async (err) => {
        if (err) {
          console.error("Register session error:", err);
          return next(err);
        }
        
        // Ensure session is saved immediately
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error during registration:", saveErr);
            return next(saveErr);
          }
          
          console.log(`New user ${user.username} session established. Session ID: ${req.session.id}`);
          console.log(`Session cookie during registration: ${req.headers.cookie ? 'Present' : 'Not present'}`);
        });
        
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

  app.post("/api/login", (req, res, next) => {
    const { username, password, caldavServerUrl } = req.body;
    
    // Add enhanced logging for debugging
    console.log(`Login attempt for user ${username} with CalDAV server URL: ${caldavServerUrl || 'not provided'}`);
    
    // Store caldavServerUrl in req so it can be accessed by the LocalStrategy
    (req as any).caldavServerUrl = caldavServerUrl;
    
    // Handle missing required fields
    if (!username || !password) {
      console.log('Login attempt failed: Missing username or password');
      return res.status(400).json({ message: "Username and password are required" });
    }
    
    // Basic passport authentication
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) {
        console.error('Authentication error in passport strategy:', err);
        return next(err);
      }
      
      if (!user) {
        console.log(`Authentication failed for user ${username}: ${info?.message || 'Unknown reason'}`);
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }
      
      // Regenerate session before login to prevent session fixation
      req.session.regenerate((regErr) => {
        if (regErr) {
          console.error("Session regeneration error:", regErr);
          return res.status(500).json({ message: "Session error during login" });
        }
        
        // Log the user in with the fresh session - normalize the user object
        req.login(normalizeUserForAuth(user), (loginErr) => {
          if (loginErr) {
            console.error("Login error after session regeneration:", loginErr);
            return next(loginErr);
          }
          
          // Add custom data to session for debugging
          (req.session as any).loginSuccess = true;
          (req.session as any).loginTimestamp = Date.now();
          (req.session as any).username = user.username;
          
          console.log(`User ${user.username} (${user.id}) authenticated and session established. ID: ${req.sessionID}`);
          
          // Ensure session is saved
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("Session save error:", saveErr);
              return res.status(500).json({ message: "Session save error during login" });
            }
            
            // Successfully authenticated
            console.log(`Session saved successfully for user ${user.username}`);
            
            // Return user data without password
            const { password, ...userWithoutPassword } = user;
            res.status(200).json(userWithoutPassword);
          });
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    const userId = req.user?.id;
    const username = req.user?.username;
    
    console.log(`Logout requested for user: ${username} (${userId})`);
    
    req.logout(async (err) => {
      if (err) {
        console.error("Error during logout:", err);
        return next(err);
      }
      
      // Handle sync service cleanup on logout
      if (userId) {
        try {
          await syncService.handleUserLogout(userId);
          console.log(`Updated sync service for user logout: ${userId}`);
        } catch (syncError) {
          console.error("Error handling sync service on logout:", syncError);
        }
      }
      
      // Explicitly destroy the session to ensure complete cleanup
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("Error destroying session during logout:", destroyErr);
          // Continue with the response anyway
        } else {
          console.log(`Session destroyed for user ${username} (${userId})`);
        }
        
        // Clear the cookie on the client side as well
        res.clearCookie('caldav_app.sid');
        res.status(200).json({ success: true, message: "Logged out successfully" });
      });
    });
  });

  app.get("/api/user", async (req, res) => {
    // Enhanced logging for debugging authentication issues
    console.log("GET /api/user - Authentication check:", {
      isAuthenticated: req.isAuthenticated(),
      hasSession: !!req.session,
      sessionID: req.sessionID,
      hasUser: !!req.user,
      userId: req.user?.id || 'unknown',
      username: req.user?.username || 'unknown',
      cookies: req.headers.cookie ? 'Present' : 'Not present',
      cookieCount: req.headers.cookie ? req.headers.cookie.split(';').length : 0
    });
    
    // Check for authenticated session
    if (req.isAuthenticated() && req.user) {
      try {
        // Double-check that user still exists in database
        const userId = req.user.id;
        const verifiedUser = await storage.getUser(userId);
        
        if (!verifiedUser) {
          console.error(`User ${userId} found in session but not in database - session is stale`);
          
          // Clear the corrupted session
          req.session.destroy((err) => {
            if (err) {
              console.error("Session destroy error:", err);
            } else {
              console.log("Stale session destroyed successfully");
            }
            // Clear cookie
            res.clearCookie('caldav_app.sid');
            res.status(401).json({ message: "Session expired. Please log in again." });
          });
          return;
        }
        
        // User is authenticated and exists in database
        const { password, ...userWithoutPassword } = req.user;
        console.log(`User ${req.user.id} (${req.user.username}) authenticated successfully`);
        
        // Touch session to extend expiration
        if (req.session) {
          req.session.touch();
          req.session.save((err) => {
            if (err) {
              console.error("Session save error:", err);
            } else {
              console.log(`Session refreshed for user ${req.user!.id}`);
            }
          });
        }
        
        res.json(userWithoutPassword);
      } catch (error) {
        console.error(`Error verifying user ${req.user.id}:`, error);
        res.status(500).json({ message: "Error retrieving user data" });
      }
    } else {
      console.log("Authentication failed: User not authenticated or user object missing");
      
      // Try to determine the cause of authentication failure
      if (req.session) {
        console.log("Session exists but no authentication");
        
        // If there's a session but no auth, simply return 401 without trying to regenerate
        // This simplifies the flow and avoids potential race conditions
        res.status(401).json({ 
          message: "Not authenticated. Please log in.",
          sessionExists: true,
          sessionId: req.sessionID
        });
        
        // In the background, clean up the corrupted session 
        // without waiting for it to complete before responding
        req.session.destroy((err) => {
          if (err) {
            console.error("Error destroying corrupted session:", err);
          } else {
            console.log("Successfully cleaned up corrupted session in background");
          }
        });
      } else {
        console.log("No session found for user authentication");
        res.status(401).json({ message: "Not authenticated. No session found." });
      }
    }
  });
  
  // Diagnostic endpoint for checking authentication status details
  app.get("/api/auth-check", (req, res) => {
    const authStatus = {
      isAuthenticated: req.isAuthenticated(),
      sessionExists: !!req.session,
      hasUser: !!req.user,
      userId: req.user?.id,
      username: req.user?.username,
      // Don't include password or sensitive data
      sessionId: req.sessionID,
      hasCookies: !!req.headers.cookie,
      cookieCount: req.headers.cookie ? req.headers.cookie.split(';').length : 0,
    };
    
    console.log("Auth check requested:", authStatus);
    
    res.json({
      status: authStatus.isAuthenticated ? "authenticated" : "unauthenticated",
      details: authStatus
    });
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