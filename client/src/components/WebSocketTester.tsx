/**
 * WebSocket Tester Component
 * 
 * This component provides a simple interface to test WebSocket connectivity
 * and verify that real-time communication is working correctly.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/hooks/useUser';

export const WebSocketTester = () => {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [connectionPath, setConnectionPath] = useState('/api/ws');
  const [latency, setLatency] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectCountRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const { user, isLoading } = useUser();
  
  const connectWebSocket = () => {
    // Close existing connection if any
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    try {
      // Determine correct WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}${connectionPath}`;
      
      setConnectionStatus('Connecting...');
      addMessage(`Connecting to ${wsUrl}...`);
      
      // Create WebSocket connection
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;
      
      // Connection opened
      socket.addEventListener('open', () => {
        setConnected(true);
        setConnectionStatus('Connected');
        reconnectCountRef.current = 0;
        addMessage('Connection established!');
        
        // Authenticate if user is available
        if (user && user.id) {
          const authMessage = {
            type: 'auth',
            userId: user.id
          };
          socket.send(JSON.stringify(authMessage));
          addMessage(`Sent authentication: ${JSON.stringify(authMessage)}`);
        } else {
          addMessage('Not logged in - cannot authenticate WebSocket');
        }
      });
      
      // Listen for messages
      socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'pong' && data.latency) {
          setLatency(data.latency);
        }
        
        addMessage(`Received: ${event.data}`);
      });
      
      // Listen for socket closing
      socket.addEventListener('close', (event) => {
        setConnected(false);
        setConnectionStatus(`Disconnected (${event.code})`);
        addMessage(`Connection closed: code=${event.code}, reason=${event.reason || 'No reason provided'}`);
        
        // Auto-reconnect logic
        if (!event.wasClean && reconnectCountRef.current < 5) {
          setReconnecting(true);
          reconnectCountRef.current++;
          
          const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30000);
          addMessage(`Reconnecting in ${delay / 1000} seconds... (attempt ${reconnectCountRef.current}/5)`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnecting(false);
            connectWebSocket();
          }, delay);
        }
      });
      
      // Connection error
      socket.addEventListener('error', (error) => {
        addMessage(`WebSocket error: ${error}`);
        setConnectionStatus('Error');
      });
      
    } catch (error) {
      setConnectionStatus('Error');
      addMessage(`Error creating WebSocket: ${error}`);
    }
  };
  
  const disconnectWebSocket = () => {
    if (socketRef.current) {
      socketRef.current.close(1000, 'User disconnected');
      socketRef.current = null;
      setConnected(false);
      setConnectionStatus('Disconnected');
      addMessage('Disconnected by user');
      
      // Cancel any pending reconnects
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        setReconnecting(false);
      }
    }
  };
  
  const sendTestMessage = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        const testMsg = inputMessage || JSON.stringify({ type: 'test', data: 'Test message', timestamp: Date.now() });
        socketRef.current.send(testMsg);
        addMessage(`Sent: ${testMsg}`);
        setInputMessage('');
      } catch (error) {
        addMessage(`Error sending message: ${error}`);
      }
    } else {
      addMessage('Cannot send message: WebSocket not connected');
    }
  };
  
  const sendPing = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        const pingMessage = JSON.stringify({ 
          type: 'ping', 
          timestamp: Date.now()
        });
        socketRef.current.send(pingMessage);
        addMessage(`Sent ping`);
      } catch (error) {
        addMessage(`Error sending ping: ${error}`);
      }
    } else {
      addMessage('Cannot send ping: WebSocket not connected');
    }
  };
  
  const addMessage = (message: string) => {
    setMessages((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);
  
  // When the path changes, reconnect if already connected
  useEffect(() => {
    if (connected) {
      disconnectWebSocket();
      setTimeout(connectWebSocket, 500);
    }
  }, [connectionPath]);
  
  const clearMessages = () => {
    setMessages([]);
  };
  
  const toggleConnection = () => {
    if (connected) {
      disconnectWebSocket();
    } else {
      connectWebSocket();
    }
  };
  
  const switchPath = () => {
    setConnectionPath(prev => prev === '/api/ws' ? '/ws' : '/api/ws');
  };
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>WebSocket Tester</span>
          <Badge 
            variant={connected ? "success" : reconnecting ? "warning" : "destructive"}
            className={`ml-2 ${connected ? 'bg-green-500' : reconnecting ? 'bg-yellow-500' : 'bg-red-500'}`}
          >
            {connectionStatus}
          </Badge>
        </CardTitle>
        <CardDescription>
          Test WebSocket connectivity for real-time updates
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button onClick={toggleConnection} variant={connected ? "destructive" : "default"}>
              {connected ? "Disconnect" : "Connect"}
            </Button>
            
            <Button onClick={switchPath} variant="outline">
              Switch to {connectionPath === '/api/ws' ? '/ws' : '/api/ws'}
            </Button>
            
            <Button onClick={sendPing} variant="outline" disabled={!connected}>
              Ping
            </Button>
            
            {latency !== null && (
              <Badge variant="outline" className="ml-auto">
                Latency: {latency}ms
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Enter a test message or JSON"
              disabled={!connected}
            />
            <Button onClick={sendTestMessage} disabled={!connected}>
              Send
            </Button>
          </div>
          
          <div>
            <div className="flex justify-between mb-2">
              <h3 className="text-sm font-medium">Message Log</h3>
              <Button onClick={clearMessages} variant="ghost" size="sm">
                Clear
              </Button>
            </div>
            <Textarea
              readOnly
              className="font-mono text-xs h-60"
              value={messages.join('\n')}
            />
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="text-xs text-muted-foreground">
        <p>
          {user ? `Logged in as: ${user.username} (ID: ${user.id})` : 
           isLoading ? "Loading user information..." : "Not logged in"}
        </p>
      </CardFooter>
    </Card>
  );
};

export default WebSocketTester;