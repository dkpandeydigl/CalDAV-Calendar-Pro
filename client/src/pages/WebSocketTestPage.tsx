/**
 * WebSocket Test Page
 * 
 * This page hosts the WebSocket tester component for testing
 * real-time communication functionality.
 */

import React from 'react';
import WebSocketTester from '@/components/websocket-tester';

function WebSocketTestPage() {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-6">WebSocket Testing</h1>
      <p className="mb-6 text-muted-foreground">
        This page allows you to test the WebSocket implementation for real-time notifications and event updates.
      </p>
      
      <WebSocketTester />
      
      <div className="mt-8 p-4 border rounded-md">
        <h2 className="text-lg font-semibold mb-2">How to Test</h2>
        <ol className="list-decimal list-inside space-y-2">
          <li>Connect to the WebSocket server (automatic on page load)</li>
          <li>Type a message and click Send to broadcast it</li>
          <li>
            Use the API endpoint to send a test message:
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-x-auto">
              POST /api/test-websocket
              {"\n"}
              {"{"}
              {"\n"}
              {"  \"message\": \"Test notification\","}
              {"\n"}
              {"  \"type\": \"event\",  // optional"}
              {"\n"}
              {"  \"action\": \"update\" // optional"}
              {"\n"}
              {"}"}
            </pre>
          </li>
          <li>
            To send to a specific user, include the userId:
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-x-auto">
              {"{"}
              {"\n"}
              {"  \"userId\": 1,"}
              {"\n"}
              {"  \"message\": \"Message for specific user\""}
              {"\n"}
              {"}"}
            </pre>
          </li>
        </ol>
      </div>
    </div>
  );
}

export default WebSocketTestPage;