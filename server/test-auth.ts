/**
 * Test authentication module
 * 
 * This module provides a test login route that bypasses the CalDAV authentication
 * for testing purposes. It allows us to test the WebSocket functionality without
 * needing to connect to the CalDAV server.
 */

import { Express, Request, Response } from "express";
import { storage } from "./database-storage";
import passport from "passport";
import bcrypt from "bcryptjs";
import { syncService } from "./sync-service";

// Test user credentials
const TEST_USERNAME = "test@example.com";
const TEST_PASSWORD = "testpassword";
const TEST_FULLNAME = "Test User";

// Hash a password
async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

// Add test login route for development
export function setupTestAuth(app: Express) {
  app.post("/api/test-login", async (req: Request, res: Response) => {
    try {
      // Get the username and password from the request body
      const { username, password } = req.body;
      
      // Check credentials against test credentials
      if (username === TEST_USERNAME && password === TEST_PASSWORD) {
        // Look for existing test user
        let user = await storage.getUserByUsername(username);
        
        // Create test user if it doesn't exist
        if (!user) {
          console.log(`Creating test user: ${username}`);
          const hashedPassword = await hashPassword(password);
          user = await storage.createUser({
            username,
            password: hashedPassword,
            email: username,
            fullName: TEST_FULLNAME
          });
          
          // Create a server connection for the test user
          await storage.createServerConnection({
            userId: user.id,
            url: "https://zpush.ajaydata.com/davical/",
            username,
            password,
            autoSync: true,
            syncInterval: 15,
            status: "connected"
          });
          
          // Create a test calendar
          const calendar = await storage.createCalendar({
            userId: user.id,
            name: "Test Calendar",
            color: "#4285f4",
            description: "Test calendar for development",
            url: null,
            enabled: true,
            isPrimary: true,
            isLocal: true,
            syncToken: null
          });
          
          console.log(`Created test calendar ID ${calendar.id} for test user ${username}`);
        }
        
        // Log in the user with Passport
        req.login(user, (err) => {
          if (err) {
            console.error("Error logging in test user:", err);
            return res.status(500).json({ message: "Error during login" });
          }
          
          // Start background sync for this user
          syncService.startSync(user.id);
          
          return res.json({
            message: "Test login successful",
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              fullName: user.fullName
            }
          });
        });
      } else {
        // Invalid credentials
        return res.status(401).json({ message: "Invalid test credentials" });
      }
    } catch (error) {
      console.error("Error in test login:", error);
      return res.status(500).json({ message: "Error during test login" });
    }
  });
  
  // Add test logout route
  app.post("/api/test-logout", (req: Request, res: Response) => {
    req.logout((err) => {
      if (err) {
        console.error("Error logging out test user:", err);
        return res.status(500).json({ message: "Error during logout" });
      }
      res.json({ message: "Test logout successful" });
    });
  });
}