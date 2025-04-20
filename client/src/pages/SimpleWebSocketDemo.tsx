import React from 'react';
import { useLocation } from 'wouter';
import { SimpleWebSocketTest } from '@/components/SimpleWebSocketTest';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';

/**
 * A simple page to demonstrate WebSocket functionality
 */
export default function SimpleWebSocketDemo() {
  const [, setLocation] = useLocation();

  return (
    <div className="container mx-auto py-8 px-4">
      <Button 
        variant="outline" 
        className="mb-4" 
        onClick={() => setLocation('/')}
      >
        <ChevronLeft className="mr-2 h-4 w-4" /> Back to Home
      </Button>
      
      <h1 className="text-3xl font-bold mb-8 text-center">WebSocket Demo</h1>
      
      <SimpleWebSocketTest />
      
      <div className="mt-12 max-w-2xl mx-auto prose">
        <h2>About this WebSocket Implementation</h2>
        <p>
          This demo demonstrates a WebSocket implementation following the JavaScript WebSocket standards
          and the development guidelines. Key features:
        </p>
        <ul>
          <li>Uses WebSocket protocol with automatic secure/insecure detection</li>
          <li>Configures the connection with proper WebSocket paths:
            <ul>
              <li><code>/api/ws</code> - Primary path (from WebSocketServer in routes.ts)</li>
              <li><code>/ws</code> - Fallback path</li>
            </ul>
          </li>
          <li>Handles connection state and events properly</li>
          <li>Uses JSON for message format</li>
          <li>Provides error handling and reconnection capability</li>
        </ul>
        
        <h2>Implementation Details</h2>
        <p>
          The WebSocket server is initialized in <code>server/routes.ts</code> with:
        </p>
        <pre>
          <code>const wss = new WebSocketServer(&#123; server: httpServer, path: '/ws' &#125;);</code>
        </pre>
        
        <p>
          Client connection is established with the proper format:
        </p>
        <pre>
          <code>
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";<br/>
            const wsUrl = `$&#123;protocol&#125;//$&#123;window.location.host&#125;/ws`;<br/>
            const socket = new WebSocket(wsUrl);
          </code>
        </pre>
        
        <p>
          Ready state is checked properly:
        </p>
        <pre>
          <code>
            if (socket.readyState === WebSocket.OPEN) &#123;<br/>
              // Socket is open and ready<br/>
            &#125;
          </code>
        </pre>
      </div>
    </div>
  );
}