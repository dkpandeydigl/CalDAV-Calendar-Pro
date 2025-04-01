import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { DAVClient } from "tsdav";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Function to verify credentials with the CalDAV server
async function verifyCalDAVCredentials(serverUrl: string, username: string, password: string): Promise<boolean> {
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
    
    // Try to login and fetch calendars
    await davClient.login();
    await davClient.fetchCalendars();
    
    return true;
  } catch (error) {
    console.error("CalDAV auth failed:", error);
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
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        const isPasswordValid = await comparePasswords(password, user.password);
        if (!isPasswordValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        return done(null, user);
      } catch (error) {
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
        caldavUsername, 
        caldavPassword, 
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
          caldavUsername,
          caldavPassword
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
          username: caldavUsername,
          password: caldavPassword,
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
      req.login(user, (err) => {
        if (err) return next(err);
        const { password, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.post("/api/login", async (req, res, next) => {
    const { caldavUsername, caldavPassword, caldavServerUrl } = req.body;
    
    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }

      // App login successful, now check CalDAV credentials
      try {
        const isValidCalDAV = await verifyCalDAVCredentials(
          caldavServerUrl,
          caldavUsername,
          caldavPassword
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
            username: caldavUsername,
            password: caldavPassword,
            status: "connected"
          });
          console.log(`Updated server connection for user ${(user as SelectUser).username}`);
        } else {
          // Create new server connection
          await storage.createServerConnection({
            userId: userId,
            url: caldavServerUrl,
            username: caldavUsername,
            password: caldavPassword,
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
      req.login(user, (err) => {
        if (err) return next(err);
        const { password, ...userWithoutPassword } = user as Express.User;
        res.status(200).json(userWithoutPassword);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
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

  // Helper middleware for checking authentication
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  };

  return { isAuthenticated };
}