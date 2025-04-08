import { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./database-storage";
import { 
  insertEventSchema, 
  insertCalendarSchema,
  insertServerConnectionSchema,
  insertCalendarSharingSchema,
  insertSmtpConfigSchema,
  type Event
} from "@shared/schema";
import { WebSocketServer } from "ws";
import { setupAuth } from "./auth";
import { createDAVClient } from "tsdav";
import { emailService } from "./email-service";
import { z } from "zod";
import { registerExportRoutes } from "./export-routes";
import { registerImportRoutes } from "./import-routes";
import fetch from "node-fetch";
import { generateThunderbirdCompatibleICS } from "./ical-utils";

declare module 'express-session' {
  interface SessionData {
    recentlyDeletedEvents?: number[];
  }
}

declare module 'express' {
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

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);
  
  // Register the export and import routes
  registerExportRoutes(app);
  registerImportRoutes(app);
  
  function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  }
  
  function handleZodError(err: unknown, res: Response) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ errors: err.errors });
    }
    return res.status(500).json({ message: (err as Error).message || "An error occurred" });
  }
  
  // USERS API
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.filter((user: { id: number }) => user.id !== req.user!.id)); // Don't include the current user
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  
  // CALENDARS API
  app.get("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendars = await storage.getCalendars(userId);
      res.json(calendars);
    } catch (err) {
      console.error("Error fetching calendars:", err);
      res.status(500).json({ message: "Failed to fetch calendars" });
    }
  });
  
  app.post("/api/calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const calendarData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertCalendarSchema.parse(calendarData);
      const newCalendar = await storage.createCalendar(validatedData);
      
      res.status(201).json(newCalendar);
    } catch (err) {
      console.error("Error creating calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // EVENTS API
  app.get("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      let allEvents: Event[] = [];
      
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
  
  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Generate a unique UID for the event if not provided
      const eventData = {
        ...req.body,
        uid: req.body.uid || `${Date.now()}-${Math.floor(Math.random() * 1000000)}@caldavclient`
      };
      
      // Handle date conversions
      if (typeof eventData.startDate === 'string') {
        eventData.startDate = new Date(eventData.startDate);
      }
      
      if (typeof eventData.endDate === 'string') {
        eventData.endDate = new Date(eventData.endDate);
      }
      
      // Convert arrays to JSON strings
      if (eventData.attendees && Array.isArray(eventData.attendees)) {
        eventData.attendees = JSON.stringify(eventData.attendees);
      }
      
      if (eventData.resources && Array.isArray(eventData.resources)) {
        eventData.resources = JSON.stringify(eventData.resources);
      }
      
      const validatedData = insertEventSchema.parse(eventData);
      const newEvent = await storage.createEvent(validatedData);
      
      res.status(201).json(newEvent);
    } catch (err) {
      console.error("Error creating event:", err);
      return handleZodError(err, res);
    }
  });
  
  // CALENDAR SHARING API
  app.get("/api/shared-calendars", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const sharedCalendars = await storage.getSharedCalendars(userId);
      res.json(sharedCalendars);
    } catch (err) {
      console.error("Error fetching shared calendars:", err);
      res.status(500).json({ message: "Failed to fetch shared calendars" });
    }
  });
  
  app.post("/api/calendar-sharing", isAuthenticated, async (req, res) => {
    try {
      const sharingData = {
        ...req.body,
        sharedByUserId: req.user!.id
      };
      
      const validatedData = insertCalendarSharingSchema.parse(sharingData);
      const newSharing = await storage.shareCalendar(validatedData);
      
      res.status(201).json(newSharing);
    } catch (err) {
      console.error("Error sharing calendar:", err);
      return handleZodError(err, res);
    }
  });
  
  // SERVER CONNECTION API
  app.get("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connection = await storage.getServerConnection(userId);
      res.json(connection || null);
    } catch (err) {
      console.error("Error fetching server connection:", err);
      res.status(500).json({ message: "Failed to fetch server connection" });
    }
  });
  
  app.post("/api/server-connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const connectionData = {
        ...req.body,
        userId,
        status: 'pending'
      };
      
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      const newConnection = await storage.createServerConnection(validatedData);
      
      res.status(201).json(newConnection);
    } catch (err) {
      console.error("Error creating server connection:", err);
      return handleZodError(err, res);
    }
  });
  
  // SMTP CONFIG API
  app.get("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const config = await storage.getSmtpConfig(userId);
      res.json(config || null);
    } catch (err) {
      console.error("Error fetching SMTP config:", err);
      res.status(500).json({ message: "Failed to fetch SMTP config" });
    }
  });
  
  app.post("/api/smtp-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const configData = {
        ...req.body,
        userId
      };
      
      const validatedData = insertSmtpConfigSchema.parse(configData);
      const newConfig = await storage.createSmtpConfig(validatedData);
      
      res.status(201).json(newConfig);
    } catch (err) {
      console.error("Error creating SMTP config:", err);
      return handleZodError(err, res);
    }
  });
  
  // EMAIL PREVIEW API
  app.post("/api/email-preview", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      await emailService.initialize(userId);
      
      const previewHtml = emailService.generateEmailPreview(req.body);
      res.json({ html: previewHtml });
    } catch (err) {
      console.error("Error generating email preview:", err);
      res.status(500).json({ message: "Failed to generate email preview" });
    }
  });
  
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Add WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data);
        
        // Echo back
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({ echo: data }));
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    // Send a welcome message
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ message: 'Connected to server' }));
    }
  });
  
  return httpServer;
}
