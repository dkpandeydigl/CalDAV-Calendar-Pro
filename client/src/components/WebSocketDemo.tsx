import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { MessageType, websocketService, WebSocketMessage } from '@/services/websocket-service';
import { ConnectionState } from '@/utils/websocket';
import WebSocketStatus from './WebSocketStatus';

export const WebSocketDemo: React.FC = () => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [selectedMessageType, setSelectedMessageType] = useState<MessageType>(MessageType.PING);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    websocketService.getConnectionState()
  );
  const messageEndRef = useRef<HTMLDivElement>(null);
  
  // Subscribe to WebSocket messages
  useEffect(() => {
    // Connection state changes
    const removeStateListener = websocketService.addGlobalListener((message) => {
      setMessages((prev) => [...prev, message]);
    });
    
    // Listen for connection state changes 
    const stateListener = websocketService.addGlobalListener(() => {
      setConnectionState(websocketService.getConnectionState());
    });
    
    return () => {
      removeStateListener();
      stateListener();
    };
  }, []);
  
  // Auto-scroll to the bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messageEndRef.current) {
      messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);
  
  // Handle sending a message
  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    
    try {
      // Try to parse as JSON if it looks like JSON
      let payload: any;
      if (inputMessage.trim().startsWith('{') && inputMessage.trim().endsWith('}')) {
        try {
          payload = JSON.parse(inputMessage);
        } catch (error) {
          payload = inputMessage;
        }
      } else {
        payload = inputMessage;
      }
      
      const message: WebSocketMessage = {
        type: selectedMessageType,
        payload,
        timestamp: Date.now()
      };
      
      const sent = websocketService.sendMessage(message);
      
      if (sent) {
        setMessages((prev) => [...prev, { ...message, direction: 'outgoing' } as any]);
        setInputMessage('');
      } else {
        toast({
          title: 'Failed to send message',
          description: 'WebSocket connection is not open',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Error sending message',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };
  
  // Clear messages
  const handleClearMessages = () => {
    setMessages([]);
  };
  
  // Format timestamp
  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString();
  };
  
  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-bold">WebSocket Console</CardTitle>
        <WebSocketStatus />
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Connection Controls */}
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            onClick={() => websocketService.connect()}
            disabled={connectionState === ConnectionState.OPEN || connectionState === ConnectionState.CONNECTING}
          >
            Connect
          </Button>
          <Button 
            variant="outline" 
            onClick={() => websocketService.disconnect()}
            disabled={connectionState === ConnectionState.CLOSED || connectionState === ConnectionState.CLOSING}
          >
            Disconnect
          </Button>
        </div>
        
        {/* Messages Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Messages</h3>
            <div className="flex items-center space-x-2">
              <Switch 
                id="auto-scroll" 
                checked={autoScroll} 
                onCheckedChange={setAutoScroll} 
              />
              <Label htmlFor="auto-scroll">Auto-scroll</Label>
              <Button size="sm" variant="ghost" onClick={handleClearMessages}>Clear</Button>
            </div>
          </div>
          
          <ScrollArea className="h-60 w-full border rounded-md">
            <div className="p-4 space-y-2">
              {messages.length === 0 ? (
                <p className="text-center text-muted-foreground italic">No messages yet</p>
              ) : (
                messages.map((message, index) => (
                  <div 
                    key={index} 
                    className={`p-2 rounded-md border text-sm ${
                      (message as any).direction === 'outgoing' 
                        ? 'border-blue-200 bg-blue-50' 
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={message.type === MessageType.SERVER_ERROR ? 'destructive' : 'outline'}>
                        {message.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(message.timestamp)}
                      </span>
                      {(message as any).direction === 'outgoing' && (
                        <Badge variant="secondary">Sent</Badge>
                      )}
                    </div>
                    <pre className="text-xs overflow-auto whitespace-pre-wrap">
                      {typeof message.payload === 'object' 
                        ? JSON.stringify(message.payload, null, 2) 
                        : String(message.payload)}
                    </pre>
                  </div>
                ))
              )}
              <div ref={messageEndRef} />
            </div>
          </ScrollArea>
        </div>
        
        {/* Message Composer */}
        <div className="space-y-2">
          <div className="flex space-x-2">
            <Select 
              value={selectedMessageType} 
              onValueChange={(value) => setSelectedMessageType(value as MessageType)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Message Type" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(MessageType).map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button 
              variant="outline" 
              onClick={() => websocketService.sendMessage({ type: MessageType.PING })}
              disabled={connectionState !== ConnectionState.OPEN}
            >
              Send Ping
            </Button>
          </div>
          
          <Textarea 
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Enter message payload (plain text or JSON)"
            rows={3}
          />
        </div>
      </CardContent>
      
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={() => setInputMessage('')}>
          Clear
        </Button>
        <Button 
          onClick={handleSendMessage}
          disabled={connectionState !== ConnectionState.OPEN || !inputMessage.trim()}
        >
          Send Message
        </Button>
      </CardFooter>
    </Card>
  );
};

export default WebSocketDemo;