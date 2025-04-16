import React from 'react';
import { SimpleWebSocketChat } from '@/components/SimpleWebSocketChat';
import { WebSocketTest } from '@/components/WebSocketTest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function WebSocketChatPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8 text-center">WebSocket Testing Center</h1>
      
      <Tabs defaultValue="simple" className="w-full max-w-4xl mx-auto">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="simple">Simple Chat</TabsTrigger>
          <TabsTrigger value="advanced">Advanced Testing</TabsTrigger>
        </TabsList>
        
        <TabsContent value="simple" className="mt-6">
          <SimpleWebSocketChat />
        </TabsContent>
        
        <TabsContent value="advanced" className="mt-6">
          <WebSocketTest />
        </TabsContent>
      </Tabs>
      
      <div className="mt-12 max-w-4xl mx-auto prose">
        <h2>About WebSocket Implementation</h2>
        <p>
          This application uses WebSockets for real-time communication following RFC 6455 standard.
          The implementation includes:
        </p>
        <ul>
          <li>Client-side connection management with automatic reconnection</li>
          <li>Server-side WebSocket server with dual paths for compatibility</li>
          <li>JSON message format for structured communication</li>
          <li>Connection status monitoring and heartbeat</li>
          <li>Error handling and recovery mechanisms</li>
        </ul>
        
        <h2>How to Use</h2>
        <p>
          The simple chat interface demonstrates basic WebSocket functionality. You can:
        </p>
        <ul>
          <li>Send and receive messages in real-time</li>
          <li>Test connection with ping messages</li>
          <li>Observe connection status changes</li>
        </ul>
        
        <p>
          The advanced testing interface provides more detailed control and monitoring:
        </p>
        <ul>
          <li>Manual connection/disconnection</li>
          <li>Message log with sent/received indicators</li>
          <li>Custom message sending capability</li>
          <li>Connection status with diagnostics</li>
        </ul>
        
        <h2>Implementation Details</h2>
        <p>
          The WebSocket server is configured with dual paths:
        </p>
        <ul>
          <li><code>/api/ws</code> - Primary WebSocket endpoint</li>
          <li><code>/ws</code> - Fallback WebSocket endpoint</li>
        </ul>
        <p>
          The client automatically tries both paths for maximum compatibility.
        </p>
      </div>
    </div>
  );
}

export default WebSocketChatPage;