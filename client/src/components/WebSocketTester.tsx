import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wifi, WifiOff, RotateCcw, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';

export function WebSocketTester() {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [primaryWorking, setPrimaryWorking] = useState<boolean | null>(null);
  const [fallbackWorking, setFallbackWorking] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [testCount, setTestCount] = useState(0);
  
  // Get authentication context to access user info
  const { user } = useAuth();
  
  // Test a specific WebSocket path
  const testPath = (useFallbackPath = false) => {
    try {
      // Close any existing websocket
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const currentHost = window.location.host;
      const wsPath = useFallbackPath ? '/ws' : '/api/ws';
      
      let wsUrl;
      
      // For Replit deployment
      if (currentHost.includes('replit') || currentHost.includes('replit.dev')) {
        wsUrl = `${wsPath}?userId=${user?.id || ''}`;
        console.log(`Testing relative WebSocket URL for Replit: ${wsUrl}`);
      } 
      // For localhost (avoid protocol & port issues)
      else if (window.location.hostname === 'localhost') {
        const port = window.location.port || '5000';
        wsUrl = `ws://localhost:${port}${wsPath}?userId=${user?.id || ''}`;
        console.log(`Testing explicit localhost WebSocket URL: ${wsUrl}`);
      } 
      // Standard case for other deployments
      else {
        wsUrl = `${protocol}//${currentHost}${wsPath}?userId=${user?.id || ''}`;
        console.log(`Testing standard WebSocket URL: ${wsUrl}`);
      }
      
      setConnectionStatus('connecting');
      setErrorMessage(null);
      
      if (useFallbackPath) {
        setFallbackWorking(null);
      } else {
        setPrimaryWorking(null);
      }
      
      console.log(`Testing WebSocket connection to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      setSocket(ws);
      
      ws.onopen = () => {
        console.log(`✅ WebSocket connection test successful for ${useFallbackPath ? 'fallback' : 'primary'} path`);
        
        if (useFallbackPath) {
          setFallbackWorking(true);
        } else {
          setPrimaryWorking(true);
        }
        
        setConnectionStatus('connected');
        toast({
          title: 'WebSocket Connected',
          description: `Successfully connected to ${useFallbackPath ? 'fallback' : 'primary'} WebSocket path`,
        });
        
        // Send a test message
        try {
          ws.send(JSON.stringify({
            type: 'ping',
            message: 'Connection test from WebSocketTester',
            userId: user?.id || '',
            timestamp: new Date().toISOString()
          }));
          console.log('Sent test ping message');
        } catch (e) {
          console.error('Error sending test message:', e);
        }
        
        // Close this test connection after a short delay if we're just testing
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Test complete');
            setConnectionStatus('disconnected');
          }
        }, 2000);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket test message received:', data);
          
          toast({
            title: 'Message Received',
            description: `Received message of type: ${data.type}`,
          });
        } catch (err) {
          console.error('Error processing WebSocket message:', err);
        }
      };
      
      ws.onerror = (error) => {
        console.error(`❌ WebSocket error for ${useFallbackPath ? 'fallback' : 'primary'} path:`, error);
        
        if (useFallbackPath) {
          setFallbackWorking(false);
        } else {
          setPrimaryWorking(false);
        }
        
        setErrorMessage(`Failed to connect to ${useFallbackPath ? 'fallback' : 'primary'} WebSocket path`);
        setConnectionStatus('error');
      };
      
      ws.onclose = (event) => {
        console.log(`WebSocket connection closed with code ${event.code}`);
        setConnectionStatus('disconnected');
      };
      
      // Set a timeout in case connection takes too long
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log(`⚠️ WebSocket connection check timed out for ${useFallbackPath ? 'fallback' : 'primary'} path`);
          
          if (useFallbackPath) {
            setFallbackWorking(false);
          } else {
            setPrimaryWorking(false);
          }
          
          setErrorMessage(`Connection timeout for ${useFallbackPath ? 'fallback' : 'primary'} WebSocket path`);
          setConnectionStatus('error');
          
          try {
            ws.close(1000, 'Connection test timeout');
          } catch (e) {
            // Ignore errors on timeout close
          }
        }
      }, 5000);
    } catch (error) {
      console.error(`❌ Exception testing WebSocket connection for ${useFallbackPath ? 'fallback' : 'primary'} path:`, error);
      
      if (useFallbackPath) {
        setFallbackWorking(false);
      } else {
        setPrimaryWorking(false);
      }
      
      setErrorMessage(`Exception: ${error instanceof Error ? error.message : String(error)}`);
      setConnectionStatus('error');
    }
  };
  
  const runTest = () => {
    setTestCount(prev => prev + 1);
    testPath(false); // Test primary path first
  };
  
  // When primary test finishes, test fallback path
  useEffect(() => {
    if (primaryWorking !== null && testCount > 0) {
      setTimeout(() => testPath(true), 2500);
    }
  }, [primaryWorking, testCount]);
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>WebSocket Connection Tester</CardTitle>
        <CardDescription>
          Test WebSocket connections for this application
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {connectionStatus === 'connected' ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : connectionStatus === 'connecting' ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            ) : connectionStatus === 'error' ? (
              <WifiOff className="h-5 w-5 text-red-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-gray-500" />
            )}
            <span className="text-sm font-medium">
              {connectionStatus === 'connected' ? "Connected" : 
               connectionStatus === 'connecting' ? "Connecting..." : 
               connectionStatus === 'error' ? "Connection Error" : 
               "Disconnected"}
            </span>
          </div>
          <Badge 
            variant={connectionStatus === 'connected' ? "outline" : 
                   connectionStatus === 'connecting' ? "secondary" : 
                   connectionStatus === 'error' ? "destructive" : "default"}
          >
            {connectionStatus === 'connected' ? "Connected" : 
             connectionStatus === 'connecting' ? "Connecting..." : 
             connectionStatus === 'error' ? "Error" : 
             "Disconnected"}
          </Badge>
        </div>
        
        {errorMessage && (
          <div className="text-sm text-red-500 mt-2">
            {errorMessage}
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="flex flex-col items-center p-4 border rounded-md">
            <div className="text-sm font-medium mb-2">Primary Path (/api/ws)</div>
            {primaryWorking === true ? (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            ) : primaryWorking === false ? (
              <XCircle className="h-8 w-8 text-red-500" />
            ) : primaryWorking === null ? (
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            ) : (
              <div className="h-8 w-8 rounded-full border-2 border-gray-200" />
            )}
            <div className="text-xs mt-2">
              {primaryWorking === true ? "Working" : 
               primaryWorking === false ? "Not Working" : 
               primaryWorking === null ? "Testing..." : 
               "Not Tested"}
            </div>
          </div>
          
          <div className="flex flex-col items-center p-4 border rounded-md">
            <div className="text-sm font-medium mb-2">Fallback Path (/ws)</div>
            {fallbackWorking === true ? (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            ) : fallbackWorking === false ? (
              <XCircle className="h-8 w-8 text-red-500" />
            ) : fallbackWorking === null ? (
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            ) : (
              <div className="h-8 w-8 rounded-full border-2 border-gray-200" />
            )}
            <div className="text-xs mt-2">
              {fallbackWorking === true ? "Working" : 
               fallbackWorking === false ? "Not Working" : 
               fallbackWorking === null ? "Testing..." : 
               "Not Tested"}
            </div>
          </div>
        </div>
        
      </CardContent>
      <CardFooter>
        <Button 
          variant="outline" 
          onClick={runTest}
          disabled={connectionStatus === 'connecting'}
          className="w-full"
        >
          {connectionStatus === 'connecting' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          Test WebSocket Connection
        </Button>
      </CardFooter>
    </Card>
  );
}

export default WebSocketTester;