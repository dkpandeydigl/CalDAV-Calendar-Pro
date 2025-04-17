/**
 * WebSocket Server Implementation
 * 
 * This module sets up a dedicated WebSocket server for real-time communication
 * with the client, specifically on a distinct path to avoid conflicts with
 * Vite's HMR websocket.
 */

import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// Interface for WebSocket messages
export interface WSMessage {
  type: string;
  action: string;
  data: any;
  timestamp: number;
}

// Keep track of all connections
const connections = new Set<WebSocket>();

// Client connection tracking by userId
const userConnections = new Map<number, Set<WebSocket>>();

/**
 * Initialize a WebSocket server attached to the provided HTTP server
 * @param httpServer The HTTP server to attach the WebSocket server to
 */
export function initializeWebSocketServer(httpServer: Server): WebSocketServer {
  // Create a WebSocket server on a distinct path (not the root)
  // to avoid conflicts with Vite's HMR websocket
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws' 
  });
  
  console.log('WebSocket server initialized on path /ws');
  
  // Set up connection handling
  wss.on('connection', (socket) => {
    console.log('WebSocket client connected');
    
    // Add to our connections pool
    connections.add(socket);
    
    // Handle messages from clients
    socket.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message.toString());
        handleMessage(socket, parsedMessage);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });
    
    // Handle disconnection
    socket.on('close', () => {
      console.log('WebSocket client disconnected');
      // Remove from our connections pool
      connections.delete(socket);
      
      // Remove from user connections if registered
      userConnections.forEach((sockets, userId) => {
        if (sockets.has(socket)) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            userConnections.delete(userId);
          }
        }
      });
    });
    
    // Send a welcome message
    socket.send(JSON.stringify({
      type: 'system',
      action: 'connected',
      timestamp: Date.now(),
      data: { message: 'Connected to WebSocket server' }
    }));
  });
  
  return wss;
}

/**
 * Handle incoming messages from clients
 */
function handleMessage(socket: WebSocket, message: any) {
  // Handle authentication/registration message
  if (message.type === 'auth' && message.userId) {
    registerUserConnection(parseInt(message.userId), socket);
    return;
  }
  
  // Handle other message types as needed
  console.log('Received message:', message);
}

/**
 * Register a WebSocket connection for a specific user
 */
function registerUserConnection(userId: number, socket: WebSocket) {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  
  userConnections.get(userId)?.add(socket);
  console.log(`Registered WebSocket connection for user ${userId}`);
  
  // Notify the client of successful registration
  socket.send(JSON.stringify({
    type: 'auth',
    action: 'registered',
    timestamp: Date.now(),
    data: { userId }
  }));
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcastMessage(message: WSMessage) {
  const messageStr = JSON.stringify(message);
  
  connections.forEach(socket => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(messageStr);
    }
  });
}

/**
 * Send a message to a specific user's connections
 */
export function sendToUser(userId: number, message: WSMessage) {
  const userSockets = userConnections.get(userId);
  if (!userSockets || userSockets.size === 0) {
    return;
  }
  
  const messageStr = JSON.stringify(message);
  
  userSockets.forEach(socket => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(messageStr);
    }
  });
}