import React from 'react';
import { Container } from '@/components/ui/container';
import WebSocketConnectionTest from '@/components/WebSocketConnectionTest';

export function WebSocketTestPage() {
  return (
    <Container className="py-6">
      <h1 className="text-2xl font-bold mb-6">WebSocket Connection Test</h1>
      <p className="mb-4 text-muted-foreground">
        This page allows you to test WebSocket connections with the server.
        You can use either the primary WebSocket endpoint (/api/ws) or the fallback endpoint (/ws).
      </p>
      <div className="space-y-6">
        <WebSocketConnectionTest />
      </div>
    </Container>
  );
}

export default WebSocketTestPage;