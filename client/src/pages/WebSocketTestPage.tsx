import React from 'react';
import { WebSocketTester } from '@/components/WebSocketTester';
import { SyncSettings } from '@/components/SyncSettings';

export function WebSocketTestPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">WebSocket Testing</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <WebSocketTester />
        </div>
        
        <div className="space-y-6">
          <SyncSettings />
        </div>
      </div>
      
      <div className="mt-8 p-6 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">WebSocket Implementation Details</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium">Dual Path Strategy</h3>
            <p className="text-sm text-gray-600">
              Our application implements a dual WebSocket path strategy: a primary path at '/api/ws' and a fallback path at '/ws'.
              This provides redundancy in case one path is not accessible due to network configurations.
            </p>
          </div>
          
          <div>
            <h3 className="text-lg font-medium">Resilient Connection Logic</h3>
            <p className="text-sm text-gray-600">
              The WebSocket connection logic features automatic retries with exponential backoff, smart fallback logic to
              switch between paths as needed, and handles reconnection when network conditions change.
            </p>
          </div>
          
          <div>
            <h3 className="text-lg font-medium">Environment-Aware URL Construction</h3>
            <p className="text-sm text-gray-600">
              WebSocket URLs are constructed based on the environment - providing special handling for Replit deployments,
              localhost development, and standard production deployments. This ensures compatibility across all environments.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WebSocketTestPage;