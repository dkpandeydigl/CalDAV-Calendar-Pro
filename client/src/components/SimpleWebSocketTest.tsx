import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Send, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

/**
 * A simple WebSocket chat component following the JavaScript WebSocket guidelines
 */
export function SimpleWebSocketTest() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<{text: string; isSent: boolean; timestamp: Date}[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Connect to WebSocket when component mounts
  useEffect(() => {
    connectWebSocket();

    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Connect to WebSocket
  const connectWebSocket = () => {
    try {
      // Create WebSocket connection according to guidelines
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // Add the user ID as a query parameter if available
      let wsUrl = `${protocol}//${window.location.host}/ws`;
      if (user?.id) {
        wsUrl += `?userId=${user.id}`;
      }
      
      console.log(`Connecting to WebSocket at: ${wsUrl}`);
      
      // Create new WebSocket
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      // Connection event handlers
      socket.addEventListener('open', () => {
        console.log('WebSocket connection established');
        setConnected(true);
        toast({
          title: 'Connected',
          description: 'WebSocket connection established successfully.',
        });
        
        // Send a welcome message
        if (user) {
          sendMessage(`${user.username} has joined the chat`);
        } else {
          sendMessage('A new user has joined the chat');
        }
      });

      socket.addEventListener('message', (event) => {
        console.log('WebSocket message received:', event.data);
        
        try {
          // Try to parse as JSON
          const data = JSON.parse(event.data);
          addMessage(data.message || JSON.stringify(data), false);
        } catch (e) {
          // If not JSON, display as text
          addMessage(event.data, false);
        }
      });

      socket.addEventListener('close', () => {
        console.log('WebSocket connection closed');
        setConnected(false);
        toast({
          title: 'Disconnected',
          description: 'WebSocket connection closed.',
          variant: 'destructive',
        });
      });

      socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        setConnected(false);
        toast({
          title: 'Connection Error',
          description: 'Failed to connect to WebSocket server.',
          variant: 'destructive',
        });
      });
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      toast({
        title: 'Connection Error',
        description: 'Failed to initialize WebSocket connection.',
        variant: 'destructive',
      });
    }
  };

  // Add a message to the list
  const addMessage = (text: string, isSent: boolean) => {
    setMessages((prev) => [...prev, { text, isSent, timestamp: new Date() }]);
  };

  // Send a message
  const sendMessage = (text: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      toast({
        title: 'Not Connected',
        description: 'Cannot send message. WebSocket is not connected.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Send as JSON format
      socketRef.current.send(JSON.stringify({ message: text }));
      addMessage(text, true);
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Send Error',
        description: 'Failed to send message.',
        variant: 'destructive',
      });
    }
  };

  // Handle form submission
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      sendMessage(inputMessage);
      setInputMessage('');
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>WebSocket Chat</CardTitle>
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? (
              <>
                <Wifi className="w-4 h-4 mr-1" /> Connected
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 mr-1" /> Disconnected
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="bg-muted rounded p-3 h-60 overflow-y-auto mb-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2" />
              <p>No messages yet</p>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`mb-2 p-2 rounded-lg max-w-[80%] ${
                  msg.isSent
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'mr-auto bg-secondary text-secondary-foreground'
                }`}
              >
                <div>{msg.text}</div>
                <div className={`text-xs mt-1 ${msg.isSent ? 'text-primary-foreground/70' : 'text-secondary-foreground/70'}`}>
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={!connected}
          />
          <Button type="submit" disabled={!connected || !inputMessage.trim()}>
            <Send className="h-4 w-4 mr-2" />
            Send
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          onClick={connectWebSocket}
          disabled={connected}
        >
          Reconnect
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            // Send a ping to test connection
            if (connected) {
              sendMessage("PING: Testing connection");
            }
          }}
          disabled={!connected}
        >
          Send Ping
        </Button>
      </CardFooter>
    </Card>
  );
}

export default SimpleWebSocketTest;