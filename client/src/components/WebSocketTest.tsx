import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Simple WebSocket test component following the JavaScript WebSocket development guidelines
 */
export function WebSocketTest() {
  const { user } = useAuth();
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Connect to the WebSocket server
  const connect = () => {
    try {
      // Close existing socket if any
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }

      // Using the correct protocol based on the current connection
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      console.log(`Connecting to WebSocket at: ${wsUrl}`);
      setStatus('connecting');
      setError(null);

      const newSocket = new WebSocket(wsUrl);
      setSocket(newSocket);

      newSocket.onopen = () => {
        console.log('WebSocket connected');
        setStatus('connected');
        setMessages(prev => ['Connected successfully', ...prev]);

        // Send auth message if user is available
        if (user?.id) {
          const authMessage = JSON.stringify({
            type: 'auth',
            userId: user.id,
            timestamp: new Date().toISOString()
          });
          newSocket.send(authMessage);
          setMessages(prev => [`Sent: ${authMessage}`, ...prev]);
        }
      };

      newSocket.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        setMessages(prev => [`Received: ${event.data}`, ...prev]);
      };

      newSocket.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error occurred');
        setStatus('disconnected');
      };

      newSocket.onclose = (event) => {
        console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
        setStatus('disconnected');
        setMessages(prev => [`Connection closed: ${event.code}`, ...prev]);
      };
    } catch (err) {
      console.error('Failed to connect to WebSocket:', err);
      setError(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('disconnected');
    }
  };

  // Send a ping message
  const sendPing = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const pingMessage = JSON.stringify({
        type: 'ping',
        timestamp: new Date().toISOString(),
        userId: user?.id
      });
      socket.send(pingMessage);
      setMessages(prev => [`Sent: ${pingMessage}`, ...prev]);
    } else {
      setError('Cannot send message - not connected');
    }
  };

  // Disconnect the socket
  const disconnect = () => {
    if (socket) {
      socket.close();
      setStatus('disconnected');
      setMessages(prev => ['Manually disconnected', ...prev]);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>WebSocket Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span>Status:</span>
          <Badge
            variant={
              status === 'connected' 
                ? 'default' 
                : status === 'connecting' 
                  ? 'outline' 
                  : 'secondary'
            }
            className={status === 'connected' ? 'bg-green-500 hover:bg-green-600' : ''}
          >
            {status}
          </Badge>
        </div>

        {error && (
          <div className="bg-red-50 p-2 rounded border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="flex space-x-2">
          <Button 
            onClick={connect} 
            disabled={status === 'connecting' || status === 'connected'}
          >
            Connect
          </Button>
          <Button 
            onClick={sendPing} 
            disabled={status !== 'connected'}
            variant="outline"
          >
            Send Ping
          </Button>
          <Button 
            onClick={disconnect} 
            disabled={status !== 'connected'}
            variant="outline"
          >
            Disconnect
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