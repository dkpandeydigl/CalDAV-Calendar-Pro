import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage"; // Using standardized storage import
import { initializeSyncService, syncService } from "./sync-service";
import { initializeWebSocketServer } from "./websocket-handler";
import { enhancedSyncService } from "./enhanced-sync-service";
import { registerEnhancedEmailTestEndpoints } from "./enhanced-email-test";
import { sequenceService } from "./sequence-service"; // Import the sequence service for RFC 5545 compliance

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database storage
  await storage.initializeDatabase();
  
  // Register API routes
  const server = await registerRoutes(app);
  
  // WebSocket server is initialized in routes.ts
  log("WebSocket server initialization handled in routes.ts");
  
  // Register test endpoints for debugging cancellation functionality
  log("Registered cancellation test endpoints for event management");
  
  // Register enhanced email test endpoints
  registerEnhancedEmailTestEndpoints(app);
  log("Registered enhanced RFC 5545 compliant email test endpoints");
  
  // Initialize the sync service for automatic CalDAV synchronization
  await initializeSyncService();
  log("CalDAV synchronization service initialized with background sync");
  
  // Initialize the sequence service for RFC 5545 compliance
  try {
    await sequenceService.init();
    log("RFC 5545 sequence tracking service initialized")
  } catch (error) {
    console.error("Error initializing sequence service:", error);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
  
  // Handle graceful shutdown
  const shutdown = () => {
    log("Server is shutting down...");
    
    // Gracefully shut down sync service
    syncService.shutdownAll();
    log("Sync service shut down");
    
    // Gracefully shut down enhanced sync service
    enhancedSyncService.shutdown();
    log("Enhanced sync service shut down");
    
    process.exit(0);
  };
  
  // Listen for termination signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
