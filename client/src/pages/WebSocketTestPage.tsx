import React from 'react';
import { WebSocketTest } from '@/components/WebSocketTest';
import { Container } from '@/components/ui/container';

/**
 * Test page for the WebSocket implementation
 */
export function WebSocketTestPage() {
  return (
    <Container className="py-8">
      <h1 className="text-2xl font-bold mb-4">WebSocket Connection Test</h1>
      <p className="text-muted-foreground mb-6">
        This page demonstrates a proper WebSocket connection implementation following
        the JavaScript WebSocket development guidelines.
      </p>
      <WebSocketTest />
    </Container>
  );
}

export default WebSocketTestPage;