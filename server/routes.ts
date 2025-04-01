import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCalendarSchema, 
  insertEventSchema, 
  insertServerConnectionSchema 
} from "@shared/schema";
import { parse, formatISO } from "date-fns";
import { ZodError } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Calendar routes
  app.get("/api/calendars", async (req, res) => {
    try {
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
      const calendars = await storage.getCalendars(userId);
      res.json(calendars);
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
  app.get("/api/calendars/:calendarId/events", async (req, res) => {
    try {
      const calendarId = parseInt(req.params.calendarId);
      const events = await storage.getEvents(calendarId);
      res.json(events);
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
  app.get("/api/server-connection", async (req, res) => {
    try {
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
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

  app.post("/api/server-connection", async (req, res) => {
    try {
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
      
      // Add userId to request body
      const connectionData = { ...req.body, userId };
      
      // Validate with zod
      const validatedData = insertServerConnectionSchema.parse(connectionData);
      
      const newConnection = await storage.createServerConnection(validatedData);
      
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
  app.post("/api/sync", async (req, res) => {
    try {
      // In a real app, this would use a CalDAV client to sync with the server
      // For this demo, we'll just return a success message
      
      // In a real app, you'd get the userId from the authenticated user
      const userId = 1; // Using default user for demo
      
      // Update the last sync time
      const connection = await storage.getServerConnection(userId);
      
      if (!connection) {
        return res.status(404).json({ message: "Server connection not found" });
      }
      
      const updatedConnection = await storage.updateServerConnection(connection.id, {
        lastSync: new Date(),
        status: "connected"
      });
      
      res.json({ message: "Sync successful", lastSync: updatedConnection?.lastSync });
    } catch (err) {
      console.error("Error syncing with CalDAV server:", err);
      res.status(500).json({ message: "Failed to sync with CalDAV server" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
