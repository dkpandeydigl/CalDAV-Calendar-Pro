import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * WebSocket debugging component that implements proper WebSocket connection
 * following the development guidelines for JavaScript WebSockets
 */
export function WebSocketDebugger() {
  const { user } = useAuth();
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [messages, setMessages] = useState<{type: string, data: any, timestamp: string}[]>([]);
  const [primaryStatus, setPrimaryStatus] = useState<boolean | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<boolean | null>(null);

  // Connect to WebSocket
  const connectWebSocket = (path: string) => {
    // Close existing connections
    if (socket) {
      socket.close();
      setSocket(null);
    }

    // Construct WebSocket URL according to the development guidelines
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}${path}?userId=${user?.id || ''}`;
    
    console.log(`Connecting to WebSocket at: ${wsUrl}`);
    setConnectionStatus('connecting');

    try {
      const newSocket = new WebSocket(wsUrl);
      setSocket(newSocket);

      newSocket.onopen = () => {
        console.log(`WebSocket connected on ${path}`);
        setConnectionStatus('connected');
        
        if (path === '/api/ws') {
          setPrimaryStatus(true);
        } else if (path === '/ws') {
          setFallbackStatus(true);
        }

        // Send auth message
        if (user?.id) {
          newSocket.send(JSON.stringify({
            type: 'auth',
            userId: user.id,
            timestamp: new Date().toISOString()
          }));
        }
      };

      newSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message received:', data);
          
          setMessages(prev => [
            {
              type: data.type || 'unknown',
              data: data,
              timestamp: new Date().toISOString()
            },
            ...prev.slice(0, 9) // Keep last 10 messages
          ]);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      newSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
        
        if (path === '/api/ws') {
          setPrimaryStatus(false);
        } else if (path === '/ws') {
          setFallbackStatus(false);
        }
      };

      newSocket.onclose = (event) => {
        console.log(`WebSocket closed with code ${event.code}`);
        setConnectionStatus('disconnected');
      };

      return () => {
        if (newSocket.readyState === WebSocket.OPEN) {
          newSocket.close();
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      setConnectionStatus('disconnected');
      
      if (path === '/api/ws') {
        setPrimaryStatus(false);
      } else if (path === '/ws') {
        setFallbackStatus(false);
      }
    }
  };

  // Send a test ping message
  const sendPing = () => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'ping',
        message: 'Test ping from WebSocketDebugger',
        timestamp: new Date().toISOString(),
        userId: user?.id
      }));
    } else {
      console.error('Cannot send message, socket not connected');
    }
  };

  // Get user authentication status for display
  const getAuthenticationInfo = () => {
    if (!user) return 'Not authenticated';
    return `Authenticated as ${user.username} (ID: ${user.id})`;
  };

  // Get readable connection status
  const getConnectionStatusText = () => {
    if (!socket) return 'Not connected';
    
    switch (socket.readyState) {
      case WebSocket.CONNECTING: return 'Connecting...';
      case WebSocket.OPEN: return 'Connected';
      case WebSocket.CLOSING: return 'Closing...';
      case WebSocket.CLOSED: return 'Closed';
      default: return 'Unknown';
    }
  };

  // Get status badge color
  const getStatusColor = () => {
    if (!socket) return 'secondary';
    
    switch (socket.readyState) {
      case WebSocket.OPEN: return 'success';
      case WebSocket.CONNECTING: return 'warning';
      case WebSocket.CLOSING: return 'destructive';
      case WebSocket.CLOSED: return 'secondary';
      default: return 'secondary';
    }
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>WebSocket Connection Tester</CardTitle>
        <CardDescription>
          Test and debug WebSocket connections using the proper implementation
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">Status:</span>
            <Badge variant={getStatusColor() as any}>{getConnectionStatusText()}</Badge>
          </div>
          <div>
            <span className="font-medium">Authentication:</span> {getAuthenticationInfo()}
          </div>
        </div>

        <Tabs defaultValue="connect">
          <TabsList className="mb-4">
            <TabsTrigger value="connect">Connect</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
          </TabsList>
          
          <TabsContent value="connect" className="space-y-4">
            <div className="flex gap-2">
              <Button 
                onClick={() => connectWebSocket('/api/ws')} 
                variant="outline"
                disabled={connectionStatus === 'connecting'}
              >
                Connect (Primary)
              </Button>
              <Button 
                onClick={() => connectWebSocket('/ws')} 
                variant="outline"
                disabled={connectionStatus === 'connecting'}
              >
                Connect (Fallback)
              </Button>
              <Button 
                onClick={() => socket?.close()} 
                variant="destructive"
                disabled={connectionStatus !== 'connected'}
              >
                Disconnect
              </Button>
            </div>
            
            <div className="mt-4">
              <h3 className="text-sm font-medium mb-2">Connection Tests:</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span>Primary (/api/ws):</span>
                  {primaryStatus === null ? (
                    <Badge variant="secondary">Not Tested</Badge>
                  ) : primaryStatus ? (
                    <Badge variant="outline" className="bg-green-100 text-green-800">Working</Badge>
                  ) : (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span>Fallback (/ws):</span>
                  {fallbackStatus === null ? (
                    <Badge variant="secondary">Not Tested</Badge>
                  ) : fallbackStatus ? (
                    <Badge variant="outline" className="bg-green-100 text-green-800">Working</Badge>
                  ) : (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="messages">
            <div className="space-y-2">
              <Button 
                onClick={sendPing}
                disabled={connectionStatus !== 'connected'}
                size="sm"
              >
                Send Ping
              </Button>
              
              <div className="mt-4 border rounded-md p-2 max-h-60 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No messages received
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg, i) => (
                      <div key={i} className="text-xs border-b pb-2 last:border-0">
                        <div className="flex justify-between">
                          <Badge variant="outline" className="mb-1">{msg.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <pre className="text-xs bg-secondary/30 p-1 rounded overflow-x-auto">
                          {JSON.stringify(msg.data, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        <p>WebSocket connection following the proper development guidelines</p>
      </CardFooter>
    </Card>
  );
}

export default WebSocketDebugger;