import React, { useState, useEffect } from 'react';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { WebSocketMessage } from '@/components/WebSocketConnectionTest';

export function WebSocketDebugPage() {
  const [status, setStatus] = useState<string>('initializing');
  const [logs, setLogs] = useState<WebSocketMessage[]>([]);
  const [primarySupported, setPrimarySupported] = useState<boolean | null>(null);
  const [fallbackSupported, setFallbackSupported] = useState<boolean | null>(null);
  const [testResults, setTestResults] = useState<{[key: string]: boolean | null}>({
    primaryPath: null,
    fallbackPath: null,
    ping: null,
    messageReceive: null,
    messageSend: null,
    reconnection: null
  });
  
  useEffect(() => {
    runDiagnostics();
  }, []);
  
  const addLog = (type: string, message: string) => {
    setLogs(prev => [...prev, {
      type,
      payload: message,
      timestamp: Date.now()
    }]);
  };
  
  const updateTestResult = (test: string, result: boolean) => {
    setTestResults(prev => ({
      ...prev,
      [test]: result
    }));
  };
  
  // Function to test basic WebSocket connectivity
  const testWebSocketConnection = async (path: string): Promise<boolean> => {
    return new Promise((resolve) => {
      addLog('info', `Testing WebSocket connection to ${path}...`);
      setStatus(`testing ${path}`);
      
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}${path}?userId=1`;
        
        const socket = new WebSocket(wsUrl);
        let connectionSuccessful = false;
        let timeoutId: NodeJS.Timeout;
        
        socket.onopen = () => {
          addLog('success', `Successfully connected to ${path}`);
          connectionSuccessful = true;
          if (timeoutId) clearTimeout(timeoutId);
          
          // Send a ping message and wait for response
          try {
            socket.send(JSON.stringify({
              type: 'ping',
              timestamp: Date.now()
            }));
            
            // Close after a short delay to clean up
            setTimeout(() => {
              socket.close();
              resolve(true);
            }, 1000);
          } catch (error) {
            addLog('error', `Error sending ping to ${path}: ${error instanceof Error ? error.message : String(error)}`);
            socket.close();
            resolve(false);
          }
        };
        
        socket.onerror = (error) => {
          addLog('error', `Error connecting to ${path}`);
          if (timeoutId) clearTimeout(timeoutId);
          socket.close();
          resolve(false);
        };
        
        socket.onclose = () => {
          if (!connectionSuccessful) {
            addLog('error', `Connection to ${path} was closed before establishing`);
            resolve(false);
          }
        };
        
        // Set a timeout for the connection
        timeoutId = setTimeout(() => {
          addLog('error', `Connection to ${path} timed out`);
          socket.close();
          resolve(false);
        }, 5000);
      } catch (error) {
        addLog('error', `Error creating WebSocket to ${path}: ${error instanceof Error ? error.message : String(error)}`);
        resolve(false);
      }
    });
  };
  
  const runDiagnostics = async () => {
    addLog('info', 'Starting WebSocket diagnostics...');
    setStatus('running');
    
    // Test primary path
    const primaryResult = await testWebSocketConnection('/api/ws');
    setPrimarySupported(primaryResult);
    updateTestResult('primaryPath', primaryResult);
    
    // Test fallback path
    const fallbackResult = await testWebSocketConnection('/ws');
    setFallbackSupported(fallbackResult);
    updateTestResult('fallbackPath', fallbackResult);
    
    // Overall summary
    if (primaryResult || fallbackResult) {
      addLog('success', 'WebSocket connectivity test passed - at least one endpoint is available.');
      setStatus('completed');
    } else {
      addLog('error', 'WebSocket connectivity test failed - no endpoints available.');
      setStatus('failed');
    }
    
    // Browser information for debugging
    addLog('info', `Browser: ${navigator.userAgent}`);
    addLog('info', `Protocol: ${window.location.protocol}`);
    addLog('info', `Host: ${window.location.host}`);
  };
  
  // Format the timestamp
  const formatTime = (timestamp: number | undefined) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString();
  };
  
  return (
    <Container className="py-6">
      <h1 className="text-2xl font-bold mb-6">WebSocket Diagnostics</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Connection Tests
            <Badge className={
              status === 'completed' ? 'bg-green-500' :
              status === 'failed' ? 'bg-red-500' :
              status === 'running' ? 'bg-blue-500' :
              'bg-gray-500'
            }>
              {status.toUpperCase()}
            </Badge>
          </CardTitle>
          <CardDescription>
            Testing WebSocket connectivity with the server
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>Primary WebSocket Path (/api/ws):</span>
                <Badge className={
                  primarySupported === true ? 'bg-green-500' :
                  primarySupported === false ? 'bg-red-500' :
                  'bg-gray-500'
                }>
                  {primarySupported === true ? 'SUPPORTED' :
                   primarySupported === false ? 'NOT SUPPORTED' :
                   'TESTING...'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span>Fallback WebSocket Path (/ws):</span>
                <Badge className={
                  fallbackSupported === true ? 'bg-green-500' :
                  fallbackSupported === false ? 'bg-red-500' :
                  'bg-gray-500'
                }>
                  {fallbackSupported === true ? 'SUPPORTED' :
                   fallbackSupported === false ? 'NOT SUPPORTED' :
                   'TESTING...'}
                </Badge>
              </div>
            </div>
            
            <div className="flex flex-col justify-center items-center">
              <Button 
                onClick={runDiagnostics}
                disabled={status === 'running'}
                className="w-full"
              >
                {status === 'running' ? 'Testing...' : 'Run Diagnostics Again'}
              </Button>
              
              <p className="text-xs text-gray-500 mt-2">
                These tests check WebSocket connections using different paths
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Diagnostic Logs</CardTitle>
          <CardDescription>
            Detailed information about WebSocket connection tests
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <ScrollArea className="h-[300px] w-full border rounded-md p-2">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`mb-2 p-2 rounded ${
                  log.type === 'error' ? 'bg-red-100 text-red-800' :
                  log.type === 'success' ? 'bg-green-100 text-green-800' :
                  log.type === 'info' ? 'bg-blue-50 text-blue-800' :
                  'bg-gray-50'
                }`}
              >
                <div className="text-xs opacity-70">
                  {formatTime(log.timestamp)} [{log.type.toUpperCase()}]
                </div>
                <div className="text-sm">
                  {typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload)}
                </div>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
        
        <CardFooter className="flex flex-col items-start">
          <Separator className="mb-4" />
          <div className="text-sm text-gray-500">
            <p>Recommendation: {
              primarySupported && fallbackSupported 
                ? 'Both WebSocket paths are working. You can use either one.'
                : primarySupported 
                ? 'Use the primary WebSocket path (/api/ws) for connections.'
                : fallbackSupported
                ? 'Use the fallback WebSocket path (/ws) for connections.'
                : 'WebSocket connections are not available. Check network configuration.'
            }</p>
            <p className="mt-2 text-xs">
              Note: WebSocket issues can be related to network configuration, firewalls, or proxy settings.
            </p>
          </div>
        </CardFooter>
      </Card>
    </Container>
  );
}

export default WebSocketDebugPage;