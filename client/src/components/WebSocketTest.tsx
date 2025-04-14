import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from '@/components/ui/badge';
import { Loader2, Wifi, WifiOff, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * WebSocket testing component following JavaScript WebSocket development guidelines
 */
export function WebSocketTest() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [messages, setMessages] = useState<string[]>([]);
  const [reconnectCount, setReconnectCount] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const { user } = useAuth();

  const addMessage = (message: string) => {
    setMessages(prev => [message, ...prev].slice(0, 50)); // Keep last 50 messages
  };

  const connect = () => {
    try {
      // Close existing connection if any
      if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
        socketRef.current.close();
      }

      setStatus('connecting');
      addMessage('Connecting to WebSocket server...');

      // Construct WebSocket URL according to guidelines
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      
      // Use different construction based on environment
      let wsUrl;
      
      // For Replit environment
      if (host.includes('replit') || host.includes('replit.dev')) {
        // For Replit, use relative path format
        wsUrl = `/ws?userId=${user?.id || ''}`;
        addMessage(`Using Replit-compatible relative URL: ${wsUrl}`);
      } else {
        // Standard format for other environments
        wsUrl = `${protocol}//${host}/ws?userId=${user?.id || ''}`;
        addMessage(`Using standard WebSocket URL: ${wsUrl}`);
      }
      
      addMessage(`Connecting to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        addMessage('✅ Connection established!');
        // Send a test message
        ws.send(JSON.stringify({ 
          type: 'ping', 
          message: 'Hello from WebSocketTest',
          timestamp: new Date().toISOString()
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addMessage(`📩 Received: ${JSON.stringify(data)}`);
        } catch (e) {
          addMessage(`📩 Received: ${event.data}`);
        }
      };

      ws.onerror = (error) => {
        setStatus('error');
        addMessage(`❌ Connection error: ${error.type}`);
        console.error('WebSocket error:', error);
      };

      ws.onclose = (event) => {
        setStatus('disconnected');
        addMessage(`Connection closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
        
        // Auto-reconnect if not closed cleanly
        if (event.code !== 1000 && event.code !== 1001) {
          setReconnectCount(prev => prev + 1);
          const delay = Math.min(1000 * Math.pow(1.5, Math.min(reconnectCount, 10)), 30000);
          addMessage(`Reconnecting in ${Math.round(delay/1000)} seconds... (Attempt ${reconnectCount + 1})`);
          
          setTimeout(() => {
            if (document.visibilityState !== 'hidden') {
              connect();
            }
          }, delay);
        }
      };
    } catch (error) {
      setStatus('error');
      addMessage(`❌ Exception: ${error instanceof Error ? error.message : String(error)}`);
      console.error('WebSocket connection exception:', error);
    }
  };

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.close(1000, 'User disconnected');
      addMessage('Manually disconnected');
    }
  };

  const sendPing = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const pingMessage = {
        type: 'ping',
        timestamp: new Date().toISOString(),
        userId: user?.id
      };
      
      try {
        socketRef.current.send(JSON.stringify(pingMessage));
        addMessage(`📤 Sent ping message`);
      } catch (error) {
        addMessage(`❌ Error sending ping: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      addMessage('❌ Cannot send ping: Not connected');
    }
  };

  // Handle page visibility changes to reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && 
          (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)) {
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close(1000, 'Component unmounted');
      }
    };
  }, []);

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

        <div className="border rounded-md p-2 mt-4 max-h-40 overflow-y-auto">
          <h3 className="text-sm font-semibold mb-2">Messages:</h3>
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500">No messages yet</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {messages.map((msg, index) => (
                <li key={index} className="border-b pb-1 last:border-0">
                  {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      <CardFooter className="text-xs text-gray-500">
        Following JavaScript WebSocket development guidelines
      </CardFooter>
    </Card>
  );
}

export default WebSocketTest;