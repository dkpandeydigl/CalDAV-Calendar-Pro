import React from 'react';
import { WebSocketTest } from '@/components/WebSocketTest';
import { Container } from '@/components/ui/container';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { InfoIcon } from 'lucide-react';

/**
 * Test page for WebSocket implementation
 * This page demonstrates proper WebSocket connection following the JavaScript WebSocket development guidelines
 */
export function WebSocketTestPage() {
  return (
    <Container className="py-8">
      <h1 className="text-2xl font-bold mb-4">WebSocket Connection Test</h1>
      <p className="text-muted-foreground mb-6">
        This page demonstrates a proper WebSocket connection implementation following
        the JavaScript WebSocket development guidelines.
      </p>
      
      <Alert className="mb-6">
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>Implementation notes</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-4 space-y-1.5 mt-2">
            <li>Following WebSocket development guidelines with proper URL construction</li>
            <li>Relative URL construction for Replit environment compatibility</li>
            <li>Checking <code>readyState</code> against <code>WebSocket.OPEN</code></li>
            <li>Robust reconnection with exponential backoff</li>
            <li>Full message handling and state management</li>
          </ul>
        </AlertDescription>
      </Alert>
      
      <WebSocketTest />
    </Container>
  );
}

export default WebSocketTestPage;