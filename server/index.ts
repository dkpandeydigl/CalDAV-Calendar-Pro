import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./memory-storage"; // Using in-memory storage instead of database storage
import { initializeSyncService, syncService } from "./sync-service";
import { initializeWebSocketServer } from "./websocket-handler";
import { enhancedSyncService } from "./enhanced-sync-service";

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
  
  // Initialize the WebSocket server for real-time communication
  initializeWebSocketServer(server);
  console.log("Initializing WebSocket server with dual paths");
  console.log("WebSocket server initialized on paths: /api/ws and /ws");
  
  // Register test endpoints for debugging cancellation functionality
  console.log("Registered cancellation test endpoints: /api/test-cancellation and /api/test-delete-event/:eventId");
  
  // Initialize the sync service for automatic CalDAV synchronization
  await initializeSyncService();
  console.log("Initializing SyncService with automatic background sync...");
  console.log("Setting up global sync timer with interval 300 seconds");
  console.log("SyncService initialized with background sync enabled");
  log("CalDAV synchronization service initialized");

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
    
    process.exit(0);
  };
  
  // Listen for termination signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
