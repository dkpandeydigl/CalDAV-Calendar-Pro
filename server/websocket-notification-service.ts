/**
 * WebSocket Notification Service
 * 
 * Provides real-time notifications for UID changes across clients.
 * This service handles the broadcast of UID changes to all connected clients.
 */

import WebSocket from 'ws';
import { Server } from 'http';

interface UIDChangeNotification {
  type: 'event';
  action: 'uid-sync';
  timestamp: number;
  data: {
    eventId: number;
    uid: string;
    operation: 'add' | 'update' | 'delete';
    timestamp: number;
  };
  sourceUserId?: number | null;
}

export class WebSocketNotificationService {
  private static primaryWss: WebSocket.Server | null = null;
  private static fallbackWss: WebSocket.Server | null = null;
  private static connections: Map<number, WebSocket[]> = new Map();
  
  /**
   * Initialize the WebSocket service with the HTTP server
   */
  public static init(httpServer: Server): void {
    // Initialize primary WebSocket server on /api/ws path
    this.primaryWss = new WebSocket.Server({ 
      server: httpServer, 
      path: '/api/ws' 
    });
    
    // Initialize fallback WebSocket server on /ws path
    this.fallbackWss = new WebSocket.Server({
      server: httpServer,
      path: '/ws'
    });
    
    // Setup event handlers for primary server
    this.primaryWss.on('connection', (ws, req) => {
      this.handleConnection(ws, req, 'primary');
    });
    
    // Setup event handlers for fallback server
    this.fallbackWss.on('connection', (ws, req) => {
      this.handleConnection(ws, req, 'fallback');
    });
    
    console.log('[INFO] WebSocket Notification Service initialized');
    console.log('[INFO] Primary WebSocket server initialized on path /api/ws');
    console.log('[INFO] Fallback WebSocket server initialized on path /ws');
  }
  
  /**
   * Handle a new WebSocket connection
   */
  private static handleConnection(ws: WebSocket, req: any, serverType: 'primary' | 'fallback'): void {
    // Extract user ID from query parameters
    const url = new URL(req.url, 'http://localhost');
    const userId = parseInt(url.searchParams.get('userId') || '0', 10);
    
    if (!userId) {
      console.warn(`[WARN] WebSocket connection rejected: No user ID provided (${serverType} server)`);
      ws.close(1008, 'User ID required');
      return;
    }
    
    console.log(`[INFO] WebSocket client connected on ${serverType} server for user ID ${userId}`);
    
    // Add to connections map
    if (!this.connections.has(userId)) {
      this.connections.set(userId, []);
    }
    this.connections.get(userId)?.push(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'system',
      action: 'connected',
      message: `Connected to ${serverType} WebSocket server`,
      timestamp: Date.now()
    }));
    
    // Setup event handlers
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle different message types
        if (data.type === 'event' && data.action === 'uid-sync') {
          // Process UID synchronization message
          this.handleUIDSyncMessage(data, userId);
        }
      } catch (error) {
        console.error(`[ERROR] Error processing WebSocket message:`, error);
      }
    });
    
    ws.on('close', () => {
      console.log(`[INFO] WebSocket client disconnected for user ID ${userId}`);
      
      // Remove from connections map
      const userConnections = this.connections.get(userId) || [];
      const index = userConnections.indexOf(ws);
      
      if (index !== -1) {
        userConnections.splice(index, 1);
      }
      
      if (userConnections.length === 0) {
        this.connections.delete(userId);
      }
    });
    
    ws.on('error', (error) => {
      console.error(`[ERROR] WebSocket error for user ID ${userId}:`, error);
    });
  }
  
  /**
   * Handle a UID synchronization message
   */
  private static handleUIDSyncMessage(message: UIDChangeNotification, sourceUserId: number): void {
    // Relay the message to all other users
    this.broadcastUIDChange(
      message.data.eventId, 
      message.data.uid, 
      message.data.operation, 
      sourceUserId
    );
  }
  
  /**
   * Broadcast a UID change to all connected clients
   */
  public static broadcastUIDChange(
    eventId: number, 
    uid: string, 
    operation: 'add' | 'update' | 'delete',
    sourceUserId?: number | null
  ): void {
    const notification: UIDChangeNotification = {
      type: 'event',
      action: 'uid-sync',
      timestamp: Date.now(),
      data: {
        eventId,
        uid,
        operation,
        timestamp: Date.now()
      },
      sourceUserId
    };
    
    // Convert to JSON string once for performance
    const message = JSON.stringify(notification);
    
    // Count how many clients we send to for logging
    let sentCount = 0;
    let totalConnections = 0;
    
    // Send to all connected clients
    this.connections.forEach((connections, userId) => {
      // Skip sending back to the source user to avoid loops
      if (sourceUserId && userId === sourceUserId) {
        return;
      }
      
      totalConnections += connections.length;
      
      connections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          sentCount++;
        }
      });
    });
    
    console.log(`[INFO] Broadcast notification to all users, sent to ${sentCount}/${totalConnections} connections`);
  }
  
  /**
   * Close all connections and clean up resources
   */
  public static close(): void {
    if (this.primaryWss) {
      this.primaryWss.close();
      this.primaryWss = null;
    }
    
    if (this.fallbackWss) {
      this.fallbackWss.close();
      this.fallbackWss = null;
    }
    
    this.connections.clear();
  }
}