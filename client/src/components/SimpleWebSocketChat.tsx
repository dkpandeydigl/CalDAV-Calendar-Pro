import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Send, Wifi, WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Simple WebSocket Chat Component
 * Demonstrates WebSocket communication following development guidelines
 */
export const SimpleWebSocketChat: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Array<{ text: string; sender: 'me' | 'server' | 'system' }>>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState(() => `User-${Math.floor(Math.random() * 10000)}`);
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Connect to WebSocket server
  useEffect(() => {
    connectToWebSocket();

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const connectToWebSocket = () => {
    try {
      // Follow WebSocket development guidelines for URL construction
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      // Log connection attempt
      setMessages(prev => [...prev, { 
        text: `Connecting to ${wsUrl}...`, 
        sender: 'system' 
      }]);
      
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setError(null);
        setMessages(prev => [...prev, { 
          text: 'Connected to chat server', 
          sender: 'system' 
        }]);
        
        // Send a join message
        sendMessage({
          type: 'join',
          username: username,
          timestamp: new Date().toISOString()
        });
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          let messageText = '';
          
          // Format different message types
          if (data.type === 'chat') {
            messageText = `${data.username || 'Anonymous'}: ${data.message}`;
          } else if (data.type === 'join') {
            messageText = `${data.username || 'Someone'} joined the chat`;
          } else if (data.type === 'leave') {
            messageText = `${data.username || 'Someone'} left the chat`;
          } else if (data.type === 'pong') {
            messageText = `Server: Pong (latency: ${Date.now() - new Date(data.timestamp).getTime()}ms)`;
          } else {
            messageText = `Received: ${JSON.stringify(data)}`;
          }
          
          setMessages(prev => [...prev, { 
            text: messageText, 
            sender: 'server' 
          }]);
        } catch (e) {
          // If not JSON, display as plain text
          setMessages(prev => [...prev, { 
            text: `Server: ${event.data}`, 
            sender: 'server' 
          }]);
        }
      };

      socket.onclose = (event) => {
        setConnected(false);
        if (event.wasClean) {
          setMessages(prev => [...prev, { 
            text: `Connection closed cleanly, code=${event.code}`, 
            sender: 'system' 
          }]);
        } else {
          setMessages(prev => [...prev, { 
            text: `Connection died`, 
            sender: 'system' 
          }]);
        }
        
        // Try to reconnect after delay
        setTimeout(() => {
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            setMessages(prev => [...prev, { 
              text: 'Attempting to reconnect...', 
              sender: 'system' 
            }]);
            connectToWebSocket();
          }
        }, 5000);
      };

      socket.onerror = () => {
        setError('WebSocket connection error');
        setMessages(prev => [...prev, { 
          text: 'Connection error occurred', 
          sender: 'system' 
        }]);
      };
    } catch (err) {
      setError(`Failed to create WebSocket: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setMessages(prev => [...prev, { 
        text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        sender: 'system' 
      }]);
    }
  };

  const sendChatMessage = () => {
    if (!inputMessage.trim()) return;
    
    // Display message in the chat
    setMessages(prev => [...prev, { 
      text: `${username}: ${inputMessage}`, 
      sender: 'me' 
    }]);
    
    // Send via WebSocket
    sendMessage({
      type: 'chat',
      username: username,
      message: inputMessage,
      timestamp: new Date().toISOString()
    });
    
    setInputMessage('');
  };

  const sendPing = () => {
    sendMessage({
      type: 'ping',
      timestamp: new Date().toISOString()
    });
    
    setMessages(prev => [...prev, { 
      text: 'Ping sent to server', 
      sender: 'system' 
    }]);
  };

  const sendMessage = (data: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    } else {
      setError('WebSocket is not connected');
      setMessages(prev => [...prev, { 
        text: 'Cannot send message: WebSocket is not connected', 
        sender: 'system' 
      }]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>WebSocket Chat</span>
          <Badge 
            variant={connected ? "outline" : "secondary"}
            className={connected ? "bg-green-100 text-green-800" : ""}
          >
            {connected ? (
              <><Wifi className="h-3 w-3 mr-1" /> Connected</>
            ) : (
              <><WifiOff className="h-3 w-3 mr-1" /> Disconnected</>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center space-x-2 mb-2">
          <span className="text-sm font-medium">Your name:</span>
          <Input 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1"
            placeholder="Enter your name"
            maxLength={20}
          />
        </div>

        <ScrollArea className="h-[300px] rounded border p-4">
          {messages.map((msg, index) => (
            <div 
              key={index} 
              className={`mb-2 text-sm ${
                msg.sender === 'me' 
                  ? 'text-right text-blue-600 dark:text-blue-400' 
                  : msg.sender === 'server' 
                    ? 'text-left text-green-600 dark:text-green-400'
                    : 'text-center text-gray-500 italic'
              }`}
            >
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={sendPing}
            disabled={!connected}
          >
            Ping
          </Button>
          
          <Input
            placeholder="Type a message..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!connected}
            className="flex-1"
          />
          
          <Button
            size="icon"
            onClick={sendChatMessage}
            disabled={!connected || !inputMessage.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>

      <CardFooter className="text-xs text-gray-500">
        Messages are not stored and will be lost on reload
      </CardFooter>
    </Card>
  );
};

export default SimpleWebSocketChat;