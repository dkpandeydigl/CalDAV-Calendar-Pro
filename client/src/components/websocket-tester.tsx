/**
 * WebSocket Tester Component
 * 
 * This component demonstrates WebSocket connectivity
 * and allows real-time message testing.
 */

import React, { useState, useEffect } from 'react';
import useWebSocket from '@/hooks/useWebSocket';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';

function WebSocketTester() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [userId, setUserId] = useState<number | undefined>(undefined);
  
  // Use our WebSocket hook
  const { isConnected, sendMessage, lastMessage, connect, disconnect } = useWebSocket({
    autoConnect: true,
    onOpen: () => {
      addSystemMessage('Connected to WebSocket server');
    },
    onClose: (event) => {
      addSystemMessage(`Disconnected from WebSocket server: ${event.reason} (${event.code})`);
    },
    onError: (event) => {
      addSystemMessage(`WebSocket error: ${JSON.stringify(event)}`);
    }
  });
  
  // Add a message to our messages array
  const addMessage = (message: any) => {
    setMessages(prev => [...prev, message]);
  };
  
  // Add a system message
  const addSystemMessage = (text: string) => {
    addMessage({
      type: 'system',
      timestamp: new Date().toISOString(),
      data: { message: text }
    });
  };
  
  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) return;
    
    // Send a message via WebSocket
    sendMessage({
      type: 'chat',
      action: 'message',
      timestamp: Date.now(),
      data: {
        message,
        userId
      }
    });
    
    // Clear the input
    setMessage('');
  };
  
  // Format timestamp
  const formatTime = (timestamp: string | number) => {
    const date = typeof timestamp === 'string' 
      ? new Date(timestamp) 
      : new Date(timestamp);
      
    return date.toLocaleTimeString();
  };
  
  // Auto-scroll to bottom when messages change
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Add received messages to our list
  useEffect(() => {
    if (lastMessage) {
      addMessage(lastMessage);
    }
  }, [lastMessage]);
  
  // Fetch user ID on mount
  useEffect(() => {
    // Try to get the current user ID
    fetch('/api/user')
      .then(res => res.json())
      .then(data => {
        if (data && data.id) {
          setUserId(data.id);
          addSystemMessage(`User ID set to ${data.id}`);
        }
      })
      .catch(err => {
        console.error('Error fetching user ID:', err);
        addSystemMessage('Could not fetch user ID');
      });
  }, []);
  
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>WebSocket Tester</CardTitle>
        <CardDescription>
          Test real-time communication using WebSockets
        </CardDescription>
        <div className="flex items-center justify-between mt-2">
          <Badge variant={isConnected ? "default" : "destructive"} className={isConnected ? "bg-green-500 hover:bg-green-600" : ""}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
          <div className="flex gap-2">
            <Button 
              size="sm"
              variant="outline"
              onClick={connect}
              disabled={isConnected}
            >
              Connect
            </Button>
            <Button 
              size="sm"
              variant="outline"
              onClick={disconnect}
              disabled={!isConnected}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] p-4 rounded-md border">
          {messages.length === 0 ? (
            <Alert>
              <AlertTitle>No messages yet</AlertTitle>
              <AlertDescription>
                Messages will appear here once you send or receive them.
              </AlertDescription>
            </Alert>
          ) : (
            messages.map((msg, i) => (
              <div 
                key={i} 
                className={`mb-2 p-2 rounded ${
                  msg.type === 'system' 
                    ? 'bg-muted text-muted-foreground' 
                    : msg.type === 'chat' && msg.data?.userId === userId
                      ? 'bg-primary/10 text-primary ml-auto max-w-[80%]'
                      : 'bg-accent text-accent-foreground max-w-[80%]'
                }`}
              >
                <div className="text-xs opacity-70">
                  {msg.type} · {formatTime(msg.timestamp)}
                </div>
                <div>{msg.data?.message || JSON.stringify(msg.data)}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </ScrollArea>
      </CardContent>
      <CardFooter>
        <form onSubmit={handleSubmit} className="w-full flex space-x-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={!isConnected}
          />
          <Button type="submit" disabled={!isConnected || !message.trim()}>
            Send
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}

export default WebSocketTester;