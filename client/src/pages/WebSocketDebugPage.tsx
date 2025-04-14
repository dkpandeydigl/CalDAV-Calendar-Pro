import React from 'react';
import WebSocketDebugger from '@/components/WebSocketDebugger';
import { Container } from '@/components/ui/container';

export function WebSocketDebugPage() {
  return (
    <Container className="py-8">
      <h1 className="text-2xl font-bold mb-6">WebSocket Debugger</h1>
      <p className="text-muted-foreground mb-6">
        This tool helps diagnose WebSocket connectivity issues by implementing 
        a proper WebSocket connection following the development guidelines.
      </p>
      <WebSocketDebugger />
    </Container>
  );
}

export default WebSocketDebugPage;