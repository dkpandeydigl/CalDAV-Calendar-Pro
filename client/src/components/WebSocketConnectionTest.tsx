import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// Define message types for WebSocket communication
export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: number;
  id?: string;
}

// Connection status type
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export const WebSocketConnectionTest: React.FC = () => {
  // State for WebSocket connection
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [userId, setUserId] = useState<string>('1'); // Default user ID for testing
  const [latency, setLatency] = useState<number | null>(null);
  const [lastPing, setLastPing] = useState<number | null>(null);
  const [useFallbackPath, setUseFallbackPath] = useState<boolean>(false);
  const [connectionAttempts, setConnectionAttempts] = useState<number>(0);
  const [customMessage, setCustomMessage] = useState<string>('');
  
  // References
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Utility to get current time
  const now = () => Date.now();
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Function to establish WebSocket connection
  const connect = useCallback(() => {
    if (socket !== null) {
      // Clean up existing connection first
      socket.close();
    }
    
    setStatus('connecting');
    setConnectionAttempts(prev => prev + 1);
    
    try {
      // Simplified WebSocket URL construction for better Replit compatibility
      // Using relative paths directly without protocol/host for maximum compatibility
      const path = useFallbackPath ? '/ws' : '/api/ws';
      const wsUrl = `${path}?userId=${userId}`;
      
      console.log(`Connecting to WebSocket at relative path: ${wsUrl}`);
      
      const newSocket = new WebSocket(wsUrl);
      
      // Set up event handlers
      newSocket.onopen = () => {
        console.log('WebSocket connection established');
        setStatus('connected');
        setMessages(prev => [...prev, {
          type: 'system',
          payload: 'Connected to server',
          timestamp: now()
        }]);
        
        // Set up ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        
        pingIntervalRef.current = setInterval(() => {
          if (newSocket.readyState === WebSocket.OPEN) {
            const pingTime = now();
            setLastPing(pingTime);
            newSocket.send(JSON.stringify({
              type: 'ping',
              timestamp: pingTime
            }));
          }
        }, 10000); // Ping every 10 seconds
      };
      
      newSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received message:', message);
          
          // Handle ping/pong for latency calculation
          if (message.type === 'pong' && lastPing !== null) {
            const pongTime = now();
            const calculatedLatency = pongTime - message.originalTimestamp;
            setLatency(calculatedLatency);
          }
          
          setMessages(prev => [...prev, message]);
        } catch (error) {
          console.error('Error parsing message:', error);
          setMessages(prev => [...prev, {
            type: 'error',
            payload: `Failed to parse message: ${event.data}`,
            timestamp: now()
          }]);
        }
      };
      
      newSocket.onclose = (event) => {
        console.log(`WebSocket closed: ${event.code} ${event.reason}`);
        setStatus('disconnected');
        setMessages(prev => [...prev, {
          type: 'system',
          payload: `Disconnected from server: ${event.code} ${event.reason}`,
          timestamp: now()
        }]);
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Attempt to reconnect after delay
        if (!event.wasClean) {
          setStatus('reconnecting');
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000); // Reconnect after 3 seconds
        }
      };
      
      newSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
        setMessages(prev => [...prev, {
          type: 'error',
          payload: 'Connection error',
          timestamp: now()
        }]);
      };
      
      setSocket(newSocket);
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setStatus('error');
      setMessages(prev => [...prev, {
        type: 'error',
        payload: `Failed to create WebSocket: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: now()
      }]);
      
      // Try again after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000); // Retry after 5 seconds
    }
  }, [userId, useFallbackPath, socket, lastPing]);
  
  // Handle manual reconnection
  const handleReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    connect();
  };
  
  // Handle manual disconnect
  const handleDisconnect = () => {
    if (socket) {
      socket.close();
      setSocket(null);
      setStatus('disconnected');
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
  };
  
  // Handle switching between main and fallback paths
  const handlePathToggle = () => {
    const newPathValue = !useFallbackPath;
    setUseFallbackPath(newPathValue);
    
    if (status === 'connected') {
      // Reconnect if already connected
      handleDisconnect();
      setTimeout(() => {
        connect();
      }, 500);
    }
  };
  
  // Handle sending custom message
  const handleSendMessage = () => {
    if (socket && socket.readyState === WebSocket.OPEN && customMessage.trim()) {
      try {
        const parsedMessage = JSON.parse(customMessage);
        socket.send(JSON.stringify(parsedMessage));
        
        setMessages(prev => [...prev, {
          type: 'outgoing',
          payload: parsedMessage,
          timestamp: now()
        }]);
        
        setCustomMessage('');
      } catch (error) {
        console.error('Error sending message:', error);
        setMessages(prev => [...prev, {
          type: 'error',
          payload: `Invalid JSON format: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: now()
        }]);
      }
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [socket]);
  
  // Helper function to format timestamp
  const formatTime = (timestamp: number | undefined) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString();
  };
  
  // Status color mapping
  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-blue-500';
      case 'reconnecting': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          WebSocket Connection Test
          <Badge className={`ml-2 ${getStatusColor(status)}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Test WebSocket connection with the server. Current attempts: {connectionAttempts}
          {latency !== null && (
            <span className="ml-2">
              Latency: <Badge variant="outline">{latency}ms</Badge>
            </span>
          )}
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID"
              className="w-24"
            />
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fallbackPath"
                checked={useFallbackPath}
                onCheckedChange={handlePathToggle}
              />
              <Label htmlFor="fallbackPath">Use fallback path (/ws)</Label>
            </div>
            
            <Button
              variant={status === 'connected' ? 'destructive' : 'default'}
              onClick={status === 'connected' ? handleDisconnect : handleReconnect}
            >
              {status === 'connected' ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
          
          <Separator />
          
          <div className="space-y-2">
            <Label htmlFor="messageLog">Message Log</Label>
            <ScrollArea className="h-[300px] w-full border rounded-md p-2">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`mb-2 p-2 rounded ${
                    msg.type === 'error' ? 'bg-red-100' :
                    msg.type === 'system' ? 'bg-blue-50' :
                    msg.type === 'outgoing' ? 'bg-green-50' :
                    'bg-gray-50'
                  }`}
                >
                  <div className="text-xs text-gray-500">
                    {formatTime(msg.timestamp)} [{msg.type}]
                  </div>
                  <div className="mt-1 text-sm break-all">
                    {typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload, null, 2)}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </ScrollArea>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="customMessage">Custom Message (JSON format)</Label>
            <div className="flex space-x-2">
              <Input
                id="customMessage"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder='{"type":"ping"}'
                className="flex-1"
              />
              <Button onClick={handleSendMessage} disabled={!socket || socket.readyState !== WebSocket.OPEN}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="flex flex-col items-start">
        <div className="text-sm text-gray-500">
          Connection URL: {`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${useFallbackPath ? '/ws' : '/api/ws'}?userId=${userId}`}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Send ping messages to test latency. Messages are displayed in the log.
        </div>
      </CardFooter>
    </Card>
  );
};

export default WebSocketConnectionTest;