import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Send, RefreshCw } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import websocketService from '../services/websocket-service';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * A simple component that demonstrates WebSocket connectivity
 * This can be included in the app to provide real-time WebSocket status information
 */
export function WebSocketDemo() {
  const [messages, setMessages] = useState<{ type: string; data?: any; timestamp: number }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Initialize WebSocket on component mount
  useEffect(() => {
    // Connect to the WebSocket server
    websocketService.connect();

    // Set up connection and disconnection handlers
    const connectUnsubscribe = websocketService.onConnect(() => {
      setIsConnected(true);
      addMessage({ type: 'system', data: 'Connected to WebSocket server', timestamp: Date.now() });
    });

    const disconnectUnsubscribe = websocketService.onDisconnect(() => {
      setIsConnected(false);
      addMessage({ type: 'system', data: 'Disconnected from WebSocket server', timestamp: Date.now() });
    });

    // Set up message handlers
    const messageUnsubscribe = websocketService.subscribe('*', (data) => {
      addMessage({ type: data.type, data: data.data, timestamp: data.timestamp || Date.now() });
    });

    // Check initial connection state
    setIsConnected(websocketService.isWebSocketConnected());

    // Clean up event handlers on unmount
    return () => {
      connectUnsubscribe();
      disconnectUnsubscribe();
      messageUnsubscribe();
    };
  }, []);

  // Helper function to add a message to the list
  const addMessage = (message: { type: string; data?: any; timestamp: number }) => {
    setMessages((prevMessages) => [...prevMessages, message].slice(-10)); // Keep the last 10 messages
  };

  // Send a test ping message
  const sendPing = () => {
    if (!isConnected) {
      addMessage({ 
        type: 'error', 
        data: 'Cannot send message - not connected to WebSocket server', 
        timestamp: Date.now() 
      });
      return;
    }

    const sent = websocketService.send('ping', { message: 'Ping from WebSocket Demo' });
    
    if (sent) {
      addMessage({ 
        type: 'sent', 
        data: 'Ping message sent', 
        timestamp: Date.now() 
      });
    } else {
      addMessage({ 
        type: 'error', 
        data: 'Failed to send ping message', 
        timestamp: Date.now() 
      });
    }
  };

  // Test WebSocket connectivity
  const testConnection = () => {
    setIsTesting(true);
    
    websocketService.testConnectivity((isWorking) => {
      setIsConnected(isWorking);
      
      addMessage({ 
        type: isWorking ? 'success' : 'error', 
        data: isWorking ? 'WebSocket connectivity test passed' : 'WebSocket connectivity test failed', 
        timestamp: Date.now() 
      });
      
      setIsTesting(false);
    });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">WebSocket Demo</CardTitle>
        <CardDescription>
          Test real-time communication functionality
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div 
              className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm font-medium">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          
          <Button 
            size="sm" 
            variant="outline" 
            onClick={testConnection} 
            disabled={isTesting}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Test Connection
              </>
            )}
          </Button>
        </div>
        
        {!isConnected && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Connection Issue</AlertTitle>
            <AlertDescription>
              WebSocket connection is not available. Real-time updates may not work.
            </AlertDescription>
          </Alert>
        )}
        
        <Separator className="my-2" />
        
        <div className="mt-4">
          <h3 className="text-sm font-medium mb-2">Recent Messages</h3>
          <div className="border rounded-md overflow-hidden max-h-[200px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No messages yet. Click "Send Ping" to test WebSocket communication.
              </div>
            ) : (
              <div className="divide-y">
                {messages.map((msg, index) => (
                  <div key={index} className="p-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span 
                        className={`font-medium ${
                          msg.type === 'error' ? 'text-red-500' : 
                          msg.type === 'success' ? 'text-green-500' :
                          msg.type === 'sent' ? 'text-blue-500' : ''
                        }`}
                      >
                        {msg.type}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1">
                      {typeof msg.data === 'string' 
                        ? msg.data
                        : JSON.stringify(msg.data)
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
      
      <CardFooter>
        <Button 
          onClick={sendPing} 
          disabled={!isConnected}
          className="w-full"
        >
          <Send className="h-4 w-4 mr-2" />
          Send Ping
        </Button>
      </CardFooter>
    </Card>
  );
}

export default WebSocketDemo;