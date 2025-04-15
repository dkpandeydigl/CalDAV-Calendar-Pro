import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

// Define message types for WebSocket communication
interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: number;
  id?: string;
}

// Connection status type
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Define log message interface for tracking connection activity
interface LogMessage {
  type: 'info' | 'error' | 'success' | 'warning';
  message: string;
  timestamp: Date;
}

export default function WebSocketTestPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [primaryWorking, setPrimaryWorking] = useState<boolean | null>(null);
  const [fallbackWorking, setFallbackWorking] = useState<boolean | null>(null);
  const [messagesSent, setMessagesSent] = useState(0);
  const [messagesReceived, setMessagesReceived] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [selectedTab, setSelectedTab] = useState('simplest');
  const [lastEvent, setLastEvent] = useState<any | null>(null);
  
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Add a log message
  const addLog = (type: 'info' | 'error' | 'success' | 'warning', message: string) => {
    const newLog = {
      type,
      message,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newLog]);
    
    // Scroll to bottom
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
    
    return newLog;
  };
  
  // Close any existing connections before testing a new method
  const closeExistingConnection = () => {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.close(1000, 'User initiated disconnect');
        addLog('info', 'Closed previous connection before starting new test');
      } catch (error) {
        addLog('error', `Error closing previous connection: ${error}`);
      }
    }
    setSocket(null);
  };
  
  // Method 1: Simplest possible WebSocket connection - just use relative URL
  const testSimplestConnection = (useFallbackPath = false) => {
    closeExistingConnection();
    setStatus('connecting');
    
    const path = useFallbackPath ? '/ws' : '/api/ws';
    addLog('info', `Testing simplest connection method with ${useFallbackPath ? 'fallback' : 'primary'} path: ${path}`);
    
    try {
      // Just use a relative path - this is the most reliable approach
      const wsUrl = `${path}?userId=${user?.id || '1'}`;
      addLog('info', `Connecting to: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl);
      setSocket(ws);
      
      ws.onopen = () => {
        setStatus('connected');
        const msg = addLog('success', `Connected successfully to ${wsUrl} 🎉`);
        useFallbackPath ? setFallbackWorking(true) : setPrimaryWorking(true);
        
        toast({
          title: 'WebSocket Connected',
          description: `Successfully connected to ${useFallbackPath ? 'fallback' : 'primary'} path`,
        });
        
        // Send auth message
        sendMessage('auth', { userId: user?.id });
      };
      
      ws.onmessage = (event) => {
        handleMessage(event);
      };
      
      ws.onerror = (error) => {
        setStatus('error');
        addLog('error', `Error connecting to ${wsUrl}: ${error.type}`);
        useFallbackPath ? setFallbackWorking(false) : setPrimaryWorking(false);
        setErrorCount(prev => prev + 1);
      };
      
      ws.onclose = (event) => {
        setStatus('disconnected');
        addLog('info', `Connection closed: ${event.code} ${event.reason || ''}`);
        
        // If it was a normal closure, don't increment error count
        if (event.code !== 1000) {
          setErrorCount(prev => prev + 1);
        }
      };
    } catch (error) {
      setStatus('error');
      addLog('error', `Exception trying to connect: ${error}`);
      useFallbackPath ? setFallbackWorking(false) : setPrimaryWorking(false);
      setErrorCount(prev => prev + 1);
    }
  };
  
  // Method 2: Standard WebSocket connection with protocol and host
  const testStandardConnection = (useFallbackPath = false) => {
    closeExistingConnection();
    setStatus('connecting');
    
    const path = useFallbackPath ? '/ws' : '/api/ws';
    addLog('info', `Testing standard connection method with ${useFallbackPath ? 'fallback' : 'primary'} path: ${path}`);
    
    try {
      // Standard approach using the current protocol and host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}${path}?userId=${user?.id || '1'}`;
      
      addLog('info', `Connecting to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      setSocket(ws);
      
      ws.onopen = () => {
        setStatus('connected');
        addLog('success', `Connected successfully to ${wsUrl} 🎉`);
        useFallbackPath ? setFallbackWorking(true) : setPrimaryWorking(true);
        
        toast({
          title: 'WebSocket Connected',
          description: `Successfully connected to ${useFallbackPath ? 'fallback' : 'primary'} path`,
        });
        
        // Send auth message
        sendMessage('auth', { userId: user?.id });
      };
      
      ws.onmessage = (event) => {
        handleMessage(event);
      };
      
      ws.onerror = (error) => {
        setStatus('error');
        addLog('error', `Error connecting to ${wsUrl}: ${error.type}`);
        useFallbackPath ? setFallbackWorking(false) : setPrimaryWorking(false);
        setErrorCount(prev => prev + 1);
      };
      
      ws.onclose = (event) => {
        setStatus('disconnected');
        addLog('info', `Connection closed: ${event.code} ${event.reason || ''}`);
        
        // If it was a normal closure, don't increment error count
        if (event.code !== 1000) {
          setErrorCount(prev => prev + 1);
        }
      };
    } catch (error) {
      setStatus('error');
      addLog('error', `Exception trying to connect: ${error}`);
      useFallbackPath ? setFallbackWorking(false) : setPrimaryWorking(false);
      setErrorCount(prev => prev + 1);
    }
  };
  
  // Send a message to the server
  const sendMessage = (type: string, payload: any = {}) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      addLog('error', 'Cannot send message - WebSocket is not connected');
      toast({
        title: 'Connection Error',
        description: 'WebSocket is not connected. Try reconnecting first.',
        variant: 'destructive',
      });
      return false;
    }
    
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: Date.now(),
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    };
    
    try {
      socket.send(JSON.stringify(message));
      addLog('info', `Sent message: ${type}`);
      setMessagesSent(prev => prev + 1);
      return true;
    } catch (error) {
      addLog('error', `Error sending message: ${error}`);
      return false;
    }
  };
  
  // Handle incoming messages
  const handleMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      setLastEvent(data);
      addLog('success', `Received: ${data.type || 'unknown'}`);
      setMessagesReceived(prev => prev + 1);
    } catch (error) {
      addLog('error', `Error parsing message: ${error}`);
    }
  };
  
  // Ping the server to test the connection
  const pingServer = () => {
    sendMessage('ping', { message: 'Ping from diagnostic page' });
  };
  
  // Disconnect
  const disconnect = () => {
    if (socket) {
      socket.close(1000, 'User initiated disconnect');
      addLog('info', 'Disconnected by user');
      setSocket(null);
    }
  };
  
  // Effect to clean up the connection when the component unmounts
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close(1000, 'Component unmounted');
      }
    };
  }, [socket]);
  
  // Get color for connection status
  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };
  
  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">WebSocket Diagnostic Tool</h1>
          <p className="text-muted-foreground">
            Test WebSocket connectivity and troubleshoot connection issues
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(status)}`}></div>
            <span className="font-medium">
              {status === 'connected' ? 'Connected' : 
               status === 'connecting' ? 'Connecting...' : 
               status === 'error' ? 'Error' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connection Test</CardTitle>
              <CardDescription>
                Use different methods to test WebSocket connectivity
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs 
                defaultValue="simplest" 
                value={selectedTab}
                onValueChange={setSelectedTab}
                className="w-full"
              >
                <TabsList className="grid grid-cols-2 mb-4">
                  <TabsTrigger value="simplest">Relative Path</TabsTrigger>
                  <TabsTrigger value="standard">Full URL</TabsTrigger>
                </TabsList>
                
                <TabsContent value="simplest" className="space-y-4">
                  <div className="text-sm">
                    <p>This method uses a simple relative URL without explicitly specifying the protocol or host.</p>
                    <p className="mt-1 text-muted-foreground">Example: <code>/api/ws</code> or <code>/ws</code></p>
                  </div>
                  
                  <div className="flex flex-col space-y-3">
                    <Button 
                      onClick={() => testSimplestConnection(false)} 
                      className="w-full"
                      variant={primaryWorking === true ? "outline" : "default"}
                      disabled={status === 'connecting'}
                    >
                      Test Primary Path (/api/ws)
                      {primaryWorking === true && <Badge className="ml-2 bg-green-500">Working</Badge>}
                      {primaryWorking === false && <Badge className="ml-2 bg-red-500">Failed</Badge>}
                    </Button>
                    
                    <Button 
                      onClick={() => testSimplestConnection(true)} 
                      className="w-full"
                      variant={fallbackWorking === true ? "outline" : "default"}
                      disabled={status === 'connecting'}
                    >
                      Test Fallback Path (/ws)
                      {fallbackWorking === true && <Badge className="ml-2 bg-green-500">Working</Badge>}
                      {fallbackWorking === false && <Badge className="ml-2 bg-red-500">Failed</Badge>}
                    </Button>
                  </div>
                </TabsContent>
                
                <TabsContent value="standard" className="space-y-4">
                  <div className="text-sm">
                    <p>This method constructs a full WebSocket URL with protocol and host.</p>
                    <p className="mt-1 text-muted-foreground">
                      Example: <code>ws://hostname/api/ws</code> or <code>wss://hostname/ws</code>
                    </p>
                  </div>
                  
                  <div className="flex flex-col space-y-3">
                    <Button 
                      onClick={() => testStandardConnection(false)} 
                      className="w-full"
                      variant={primaryWorking === true ? "outline" : "default"}
                      disabled={status === 'connecting'}
                    >
                      Test Primary Path (/api/ws)
                      {primaryWorking === true && <Badge className="ml-2 bg-green-500">Working</Badge>}
                      {primaryWorking === false && <Badge className="ml-2 bg-red-500">Failed</Badge>}
                    </Button>
                    
                    <Button 
                      onClick={() => testStandardConnection(true)} 
                      className="w-full"
                      variant={fallbackWorking === true ? "outline" : "default"}
                      disabled={status === 'connecting'}
                    >
                      Test Fallback Path (/ws)
                      {fallbackWorking === true && <Badge className="ml-2 bg-green-500">Working</Badge>}
                      {fallbackWorking === false && <Badge className="ml-2 bg-red-500">Failed</Badge>}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
            
            <CardFooter className="flex-col items-start space-y-4">
              <Alert 
                variant={
                  primaryWorking === true || fallbackWorking === true ? "default" : 
                  errorCount > 0 ? "destructive" : "default"
                }
                className={
                  primaryWorking === true || fallbackWorking === true ? "border-green-500" : 
                  errorCount > 0 ? "border-red-500" : "border-gray-400"
                }
              >
                <AlertTitle>
                  {primaryWorking === true || fallbackWorking === true
                    ? "Connection successful!"
                    : errorCount > 0
                    ? "Connection failed"
                    : "Not tested yet"}
                </AlertTitle>
                <AlertDescription>
                  {primaryWorking === true 
                    ? "Primary path (/api/ws) is working correctly."
                    : fallbackWorking === true
                    ? "Fallback path (/ws) is working, but primary path failed."
                    : errorCount > 0
                    ? "All connection attempts failed. Check the logs for more details."
                    : "Click one of the test buttons to check WebSocket connectivity."}
                </AlertDescription>
              </Alert>
              
              <div className="flex space-x-2 w-full">
                <Button 
                  onClick={pingServer} 
                  className="flex-1"
                  disabled={!socket || socket.readyState !== WebSocket.OPEN}
                >
                  Send Ping
                </Button>
                <Button 
                  onClick={disconnect} 
                  variant="outline" 
                  className="flex-1"
                  disabled={!socket || socket.readyState !== WebSocket.OPEN}
                >
                  Disconnect
                </Button>
              </div>
              
              {lastEvent && (
                <div className="w-full">
                  <h3 className="text-sm font-medium mb-1">Last received message:</h3>
                  <div className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                    <pre>{JSON.stringify(lastEvent, null, 2)}</pre>
                  </div>
                </div>
              )}
            </CardFooter>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Environment Information</CardTitle>
              <CardDescription>Current browser and connection details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1">
                  <div className="text-sm font-medium">Protocol</div>
                  <div className="col-span-2 text-sm">{window.location.protocol}</div>
                  
                  <div className="text-sm font-medium">Host</div>
                  <div className="col-span-2 text-sm">{window.location.host}</div>
                  
                  <div className="text-sm font-medium">Socket Status</div>
                  <div className="col-span-2 text-sm">
                    {!socket ? 'No socket' : 
                     socket.readyState === WebSocket.CONNECTING ? 'Connecting' :
                     socket.readyState === WebSocket.OPEN ? 'Open' :
                     socket.readyState === WebSocket.CLOSING ? 'Closing' :
                     socket.readyState === WebSocket.CLOSED ? 'Closed' : 'Unknown'}
                  </div>
                  
                  <div className="text-sm font-medium">Current URL</div>
                  <div className="col-span-2 text-sm break-all">{socket?.url || 'N/A'}</div>
                  
                  <div className="text-sm font-medium">User ID</div>
                  <div className="col-span-2 text-sm">{user?.id || 'Not logged in'}</div>
                  
                  <div className="text-sm font-medium">Messages</div>
                  <div className="col-span-2 text-sm">Sent: {messagesSent}, Received: {messagesReceived}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>Connection Log</CardTitle>
            <CardDescription>Activity log for WebSocket testing</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <ScrollArea className="h-[400px]" ref={scrollRef}>
              <div className="space-y-2">
                {messages.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    No activity yet. Start a connection test to see logs.
                  </div>
                ) : (
                  messages.map((msg, index) => (
                    <div 
                      key={index} 
                      className={`p-2 rounded text-sm ${
                        msg.type === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                        msg.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                        msg.type === 'warning' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      <div className="flex items-start">
                        <span className="text-xs opacity-70 mr-2 whitespace-nowrap">
                          {msg.timestamp.toLocaleTimeString()}
                        </span>
                        <span>{msg.message}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
          <CardFooter>
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => setMessages([])}
              disabled={messages.length === 0}
            >
              Clear Log
            </Button>
          </CardFooter>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Troubleshooting Guide</CardTitle>
          <CardDescription>Common WebSocket issues and their solutions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Invalid URL error</h3>
              <p className="text-sm text-muted-foreground">
                If you see "Failed to construct 'WebSocket': The URL is invalid" error, try the simplest connection method
                which uses relative paths. This avoids issues with mismatched protocols or undefined ports.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium">Connection refused</h3>
              <p className="text-sm text-muted-foreground">
                If connection is refused, check if the server is running and the WebSocket server is properly initialized.
                Also verify that the port is correct and not blocked by firewalls.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium">SSL/TLS errors</h3>
              <p className="text-sm text-muted-foreground">
                When using secure WebSocket (wss://), ensure that your server has valid SSL certificates.
                In development environments, relative paths are recommended to avoid certificate issues.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium">Recommended approach</h3>
              <p className="text-sm text-muted-foreground">
                The most reliable approach for WebSocket connections is to use simple relative paths like "/ws" or "/api/ws".
                This works across all environments including Replit, local development, and production.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}