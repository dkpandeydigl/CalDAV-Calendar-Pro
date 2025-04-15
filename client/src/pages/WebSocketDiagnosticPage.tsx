import React, { useState, useEffect } from 'react';
import { Container } from '@/components/ui/container';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface LogMessage {
  type: 'info' | 'error' | 'success';
  message: string;
  timestamp: Date;
}

export default function WebSocketDiagnosticPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  
  // Add a log message
  const addLog = (type: 'info' | 'error' | 'success', message: string) => {
    setMessages(prev => [...prev, {
      type,
      message,
      timestamp: new Date()
    }]);
  };
  
  // Method 1: Standard WebSocket connection
  const testStandardConnection = () => {
    setStatus('connecting');
    addLog('info', 'Testing standard connection method (protocol + host + path)');
    
    try {
      // Standard approach using the current protocol and host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws?userId=${user?.id || '1'}`;
      
      addLog('info', `Connecting to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        setStatus('connected');
        addLog('success', `Connected successfully to ${wsUrl}`);
        setSocket(ws);
      };
      
      ws.onerror = (error) => {
        setStatus('error');
        addLog('error', `Error connecting to ${wsUrl}: ${error.type}`);
      };
      
      ws.onclose = (event) => {
        setStatus('disconnected');
        addLog('info', `Connection closed: ${event.code} ${event.reason}`);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog('info', `Received message: ${JSON.stringify(data)}`);
        } catch (e) {
          addLog('info', `Received non-JSON message: ${event.data}`);
        }
      };
    } catch (error) {
      setStatus('error');
      addLog('error', `Exception: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Method 2: Relative URL approach (Replit friendly)
  const testRelativeConnection = () => {
    setStatus('connecting');
    addLog('info', 'Testing relative URL connection method (just path)');
    
    try {
      // Using a relative URL without protocol or host
      const wsUrl = `/ws?userId=${user?.id || '1'}`;
      
      addLog('info', `Connecting to relative URL: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        setStatus('connected');
        addLog('success', `Connected successfully to ${wsUrl}`);
        setSocket(ws);
      };
      
      ws.onerror = (error) => {
        setStatus('error');
        addLog('error', `Error connecting to ${wsUrl}: ${error.type}`);
      };
      
      ws.onclose = (event) => {
        setStatus('disconnected');
        addLog('info', `Connection closed: ${event.code} ${event.reason}`);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog('info', `Received message: ${JSON.stringify(data)}`);
        } catch (e) {
          addLog('info', `Received non-JSON message: ${event.data}`);
        }
      };
    } catch (error) {
      setStatus('error');
      addLog('error', `Exception: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Method 3: Direct Replit approach
  const testReplitConnection = () => {
    setStatus('connecting');
    addLog('info', 'Testing Replit-specific connection method');
    
    try {
      // For Replit environment: Derive WebSocket URL from current window.location
      // Uses same hostname but with ws/wss protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const replitUrl = `${protocol}//${window.location.host}/ws?userId=${user?.id || '1'}`;
      
      addLog('info', `Connecting to Replit URL: ${replitUrl}`);
      const ws = new WebSocket(replitUrl);
      
      ws.onopen = () => {
        setStatus('connected');
        addLog('success', `Connected successfully to ${replitUrl}`);
        setSocket(ws);
      };
      
      ws.onerror = (error) => {
        setStatus('error');
        addLog('error', `Error connecting to ${replitUrl}: ${error.type}`);
      };
      
      ws.onclose = (event) => {
        setStatus('disconnected');
        addLog('info', `Connection closed: ${event.code} ${event.reason}`);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog('info', `Received message: ${JSON.stringify(data)}`);
        } catch (e) {
          addLog('info', `Received non-JSON message: ${event.data}`);
        }
      };
    } catch (error) {
      setStatus('error');
      addLog('error', `Exception: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Send a ping message
  const sendPing = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        const pingMessage = {
          type: 'ping',
          timestamp: Date.now(),
          userId: user?.id || '1'
        };
        
        socket.send(JSON.stringify(pingMessage));
        addLog('info', `Sent ping: ${JSON.stringify(pingMessage)}`);
      } catch (error) {
        addLog('error', `Error sending ping: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      addLog('error', 'Cannot send ping - Socket is not connected');
    }
  };
  
  // Disconnect
  const disconnect = () => {
    if (socket) {
      socket.close();
      setSocket(null);
      setStatus('disconnected');
      addLog('info', 'Manually disconnected');
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [socket]);
  
  // Get current status details
  const getStatusDetails = () => {
    if (!socket) return 'Not connected';
    
    switch (socket.readyState) {
      case WebSocket.CONNECTING: return 'Connecting...';
      case WebSocket.OPEN: return 'Connected';
      case WebSocket.CLOSING: return 'Closing...';
      case WebSocket.CLOSED: return 'Closed';
      default: return 'Unknown';
    }
  };
  
  // Get badge color
  const getStatusColor = () => {
    switch (status) {
      case 'connected': return 'bg-green-500 text-white';
      case 'connecting': return 'bg-blue-500 text-white';
      case 'error': return 'bg-red-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };
  
  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString();
  };
  
  return (
    <Container className="py-6">
      <h1 className="text-2xl font-bold mb-6">WebSocket Connection Diagnostic</h1>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              WebSocket Connection Tester
              <Badge className={getStatusColor()}>
                {status.charAt(0).toUpperCase() + status.slice(1)} - {getStatusDetails()}
              </Badge>
            </CardTitle>
            <CardDescription>
              Test WebSocket connection with different strategies
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button 
                  onClick={testStandardConnection} 
                  disabled={status === 'connecting'}
                  variant="outline"
                >
                  Test Standard Connection
                </Button>
                <Button 
                  onClick={testRelativeConnection} 
                  disabled={status === 'connecting'}
                  variant="outline"
                >
                  Test Relative URL Connection
                </Button>
                <Button 
                  onClick={testReplitConnection} 
                  disabled={status === 'connecting'}
                  variant="outline"
                >
                  Test Replit Connection
                </Button>
                <Button 
                  onClick={sendPing} 
                  disabled={!socket || socket.readyState !== WebSocket.OPEN}
                >
                  Send Ping
                </Button>
                <Button 
                  onClick={disconnect} 
                  disabled={!socket || socket.readyState !== WebSocket.OPEN}
                  variant="destructive"
                >
                  Disconnect
                </Button>
              </div>
              
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">Connection Log</h3>
                <ScrollArea className="h-64 w-full border rounded-md p-2">
                  {messages.map((msg, index) => (
                    <div
                      key={index}
                      className={`mb-2 p-2 rounded ${
                        msg.type === 'error' ? 'bg-red-100' :
                        msg.type === 'success' ? 'bg-green-100' :
                        'bg-gray-100'
                      }`}
                    >
                      <div className="text-xs text-gray-500">
                        {formatTime(msg.timestamp)}
                      </div>
                      <div className="mt-1 text-sm break-all">
                        {msg.message}
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col items-start text-sm text-gray-500">
            <p>User ID: {user?.id || 'Not logged in'}</p>
            <p className="mt-1">
              This diagnostic page helps identify and fix WebSocket connection issues
              in different environments, especially Replit.
            </p>
          </CardFooter>
        </Card>
      </div>
    </Container>
  );
}