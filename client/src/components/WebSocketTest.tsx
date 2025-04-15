import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Loader2, Zap, ArrowDown, ArrowUp } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * WebSocket testing component following JavaScript WebSocket development guidelines
 */
export function WebSocketTest() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [messages, setMessages] = useState<string[]>([]);
  const [customMessage, setCustomMessage] = useState('');
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [reconnectTimer, setReconnectTimer] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second base delay

  // WebSocket URL construction following development guidelines
  const getWebSocketUrl = useCallback(() => {
    // Use relative URL construction for Replit environment compatibility
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Try primary path first '/api/ws', fallback to '/ws'
    // This handles both development and production environments
    const wsPath = connectionAttempts % 2 === 0 ? '/api/ws' : '/ws';
    
    // Properly construct URL with host and port from current page
    // This ensures it works in all environments including Replit
    return `${protocol}//${window.location.host}${wsPath}`;
  }, [connectionAttempts]);

  // Connect to WebSocket server
  const connect = useCallback(() => {
    // Cleanup any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Clear any pending reconnect timer
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      setReconnectTimer(null);
    }
    
    setStatus('connecting');
    
    try {
      // Log browser environment details to help diagnose connection issues
      const environmentInfo = {
        protocol: window.location.protocol,
        host: window.location.host,
        hostname: window.location.hostname,
        port: window.location.port || '(default)',
        pathname: window.location.pathname,
        userAgent: navigator.userAgent,
        connectionAttempt: connectionAttempts + 1
      };
      
      console.log('WebSocket connection environment:', environmentInfo);
      
      const wsUrl = getWebSocketUrl();
      
      // Log connection details before attempting to connect
      setMessages(prev => [
        ...prev, 
        `Connecting to ${wsUrl}...`,
        `Protocol: ${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}`,
        `Host: ${window.location.host}`
      ]);
      
      // Create WebSocket with explicit error handling
      const newWs = new WebSocket(wsUrl);
      wsRef.current = newWs;
      
      // Connection event handlers
      newWs.onopen = () => {
        console.log(`✅ WebSocket connected successfully to ${wsUrl}`);
        setStatus('connected');
        setMessages(prev => [...prev, `Connected successfully to ${wsUrl}`]);
        setConnectionAttempts(0); // Reset attempts on successful connection
        
        // Send a test message to verify the connection is working in both directions
        try {
          const testMsg = JSON.stringify({ 
            type: 'auth', 
            timestamp: new Date().toISOString(),
            client: 'WebSocketTest component'
          });
          newWs.send(testMsg);
          setMessages(prev => [...prev, `→ Sent authentication message`]);
        } catch (sendError) {
          console.error('Error sending initial message:', sendError);
        }
      };
      
      newWs.onmessage = (event) => {
        try {
          // Try to parse as JSON first
          const data = JSON.parse(event.data);
          console.log('WebSocket message received:', data);
          setMessages(prev => [...prev, `← Received: ${JSON.stringify(data)}`]);
        } catch (e) {
          // If not JSON, treat as plain text
          console.log('WebSocket text message received:', event.data);
          setMessages(prev => [...prev, `← Received: ${event.data}`]);
        }
      };
      
      newWs.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setStatus('error');
        
        // Log detailed error information
        const errorInfo = {
          error: error,
          wsUrl: wsUrl,
          readyState: newWs.readyState,
          readyStateText: 
            newWs.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
            newWs.readyState === WebSocket.OPEN ? 'OPEN' :
            newWs.readyState === WebSocket.CLOSING ? 'CLOSING' :
            newWs.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
          timestamp: new Date().toISOString()
        };
        
        console.error('WebSocket error details:', errorInfo);
        
        // Add more detailed error message
        setMessages(prev => [
          ...prev, 
          `Error: Connection failed (Ready state: ${errorInfo.readyStateText})`,
          `WebSocket URL used: ${wsUrl}`
        ]);
        
        // Increment connection attempts for the next try
        setConnectionAttempts(prev => prev + 1);
        
        // Attempt to reconnect if under max attempts
        if (connectionAttempts < maxReconnectAttempts) {
          // Exponential backoff for reconnection
          const delay = baseReconnectDelay * Math.pow(2, connectionAttempts);
          
          setMessages(prev => [...prev, `Will try to reconnect in ${delay/1000} seconds...`]);
          
          const timerId = window.setTimeout(() => {
            setReconnectTimer(null);
            connect();
          }, delay);
          
          setReconnectTimer(timerId);
        } else {
          setMessages(prev => [
            ...prev, 
            `Max reconnection attempts (${maxReconnectAttempts}) reached. Please try manually reconnecting.`,
            `If the error persists, check the browser console for detailed logs.`
          ]);
        }
      };
      
      newWs.onclose = (event) => {
        console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
        
        // Only change status if not already in error state
        if (status !== 'error') {
          setStatus('disconnected');
          setMessages(prev => [
            ...prev, 
            `Disconnected. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`
          ]);
          
          // Log with more details about close codes
          const closeReason = 
            event.code === 1000 ? 'Normal closure' :
            event.code === 1001 ? 'Going away (e.g., page close)' :
            event.code === 1006 ? 'Abnormal closure (no close frame)' :
            event.code === 1008 ? 'Policy violation' :
            event.code === 1011 ? 'Server error' : 'Other';
            
          console.log(`WebSocket close details: ${closeReason} (${event.code})`);
        }
        
        wsRef.current = null;
      };
    } catch (error) {
      console.error('❌ Error creating WebSocket:', error);
      setStatus('error');
      
      // Get more specific error information
      const errorMessage = error instanceof Error ? 
        `${error.name}: ${error.message}` : 
        'Failed to create WebSocket';
      
      setMessages(prev => [
        ...prev, 
        `Error: ${errorMessage}`,
        `Check network connection and try again.`
      ]);
    }
  }, [connectionAttempts, getWebSocketUrl, reconnectTimer, status]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      setMessages(prev => [...prev, 'Disconnecting...']);
    }
  }, []);

  // Send a ping message
  const sendPing = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const pingMessage = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() });
      wsRef.current.send(pingMessage);
      setMessages(prev => [...prev, `→ Sent: ${pingMessage}`]);
    } else {
      setMessages(prev => [...prev, 'Cannot send: WebSocket is not connected']);
    }
  }, []);

  // Send a custom message
  const sendCustomMessage = useCallback(() => {
    if (!customMessage.trim()) {
      return;
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(customMessage);
      setMessages(prev => [...prev, `→ Sent: ${customMessage}`]);
      setCustomMessage('');
    } else {
      setMessages(prev => [...prev, 'Cannot send: WebSocket is not connected']);
    }
  }, [customMessage]);

  // Clean up WebSocket connection when component unmounts
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [reconnectTimer]);

  return (
    <Card className="w-full mb-8">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>WebSocket Connection</span>
          <Badge variant={
            status === 'connected' ? 'outline' : 
            status === 'connecting' ? 'secondary' : 
            status === 'error' ? 'destructive' : 'outline'
          } className={status === 'connected' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : ''}>
            {status === 'connected' ? 'Connected' : 
             status === 'connecting' ? 'Connecting...' : 
             status === 'error' ? 'Error' : 'Disconnected'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Test WebSocket connection following RFC and development guidelines
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          {status === 'connected' ? (
            <Wifi className="h-5 w-5 text-green-500" />
          ) : status === 'connecting' ? (
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          ) : status === 'error' ? (
            <WifiOff className="h-5 w-5 text-red-500" />
          ) : (
            <WifiOff className="h-5 w-5 text-gray-400" />
          )}
          <span>WebSocket Status: {status}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={connect} 
            variant="outline" 
            size="sm"
            disabled={status === 'connecting' || status === 'connected'}
          >
            {status === 'connecting' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</>
            ) : (
              <><Wifi className="mr-2 h-4 w-4" /> Connect</>
            )}
          </Button>
          
          <Button 
            onClick={disconnect} 
            variant="destructive" 
            size="sm"
            disabled={status !== 'connected'}
          >
            <WifiOff className="mr-2 h-4 w-4" /> Disconnect
          </Button>
          
          <Button 
            onClick={sendPing} 
            variant="secondary" 
            size="sm"
            disabled={status !== 'connected'}
          >
            <Zap className="mr-2 h-4 w-4" /> Send Ping
          </Button>
        </div>

        <Tabs defaultValue="messages" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="send">Send Message</TabsTrigger>
          </TabsList>
          
          <TabsContent value="messages" className="space-y-4">
            <div className="border rounded-md p-2 h-40 overflow-y-auto">
              <h3 className="text-sm font-semibold mb-2">Communication Log:</h3>
              {messages.length === 0 ? (
                <p className="text-sm text-gray-500">No messages yet</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {messages.map((msg, index) => (
                    <li key={index} className={`
                      py-1 px-1 
                      ${msg.startsWith('→') ? 'text-blue-600 dark:text-blue-400' : ''} 
                      ${msg.startsWith('←') ? 'text-green-600 dark:text-green-400' : ''} 
                      ${msg.startsWith('Error') ? 'text-red-600 dark:text-red-400' : ''}
                    `}>
                      {msg.startsWith('→') && <ArrowUp className="inline h-3 w-3 mr-1" />}
                      {msg.startsWith('←') && <ArrowDown className="inline h-3 w-3 mr-1" />}
                      {msg}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="send" className="space-y-4">
            <div className="space-y-2">
              <Textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Enter a message to send..."
                disabled={status !== 'connected'}
                className="min-h-[100px] resize-none"
              />
              <div className="flex justify-end">
                <Button 
                  onClick={sendCustomMessage} 
                  disabled={status !== 'connected' || !customMessage.trim()}
                  size="sm"
                >
                  <ArrowUp className="mr-2 h-4 w-4" /> Send Message
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="text-xs text-gray-500">
        Following JavaScript WebSocket development guidelines
      </CardFooter>
    </Card>
  );
}

export default WebSocketTest;