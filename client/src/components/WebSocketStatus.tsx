import { useState, useEffect } from 'react';
import websocketService from '../services/websocket-service';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

/**
 * A component that displays the status of the WebSocket connection
 * and allows the user to manually test the connection
 */
export function WebSocketStatus() {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'unknown'>('unknown');
  const [testing, setTesting] = useState(false);
  const [lastTestedAt, setLastTestedAt] = useState<Date | null>(null);

  // Initialize WebSocket connections and listeners
  useEffect(() => {
    // Initial connection
    websocketService.connect();

    // Set up listeners
    const connectListener = () => setConnectionStatus('connected');
    const disconnectListener = () => setConnectionStatus('disconnected');

    // Subscribe to connection/disconnection events
    const connectUnsubscribe = websocketService.onConnect(connectListener);
    const disconnectUnsubscribe = websocketService.onDisconnect(disconnectListener);

    // Update status if already connected
    if (websocketService.isWebSocketConnected()) {
      setConnectionStatus('connected');
    }

    // Clean up event listeners on unmount
    return () => {
      connectUnsubscribe();
      disconnectUnsubscribe();
    };
  }, []);

  // Function to test the WebSocket connection
  const testConnection = () => {
    setTesting(true);
    setConnectionStatus('connecting');

    websocketService.testConnectivity((isWorking) => {
      setConnectionStatus(isWorking ? 'connected' : 'disconnected');
      setTesting(false);
      setLastTestedAt(new Date());
    });
  };

  // Determine status badge color and text
  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 hover:bg-green-100">
            <CheckCircle className="h-3 w-3 mr-1" />
            Connected
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="outline" className="bg-red-100 text-red-800 hover:bg-red-100">
            <XCircle className="h-3 w-3 mr-1" />
            Disconnected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Connecting...
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-800 hover:bg-gray-100">
            Unknown
          </Badge>
        );
    }
  };

  return (
    <div className="p-4 border rounded-md shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">WebSocket Status</h3>
        {getStatusBadge()}
      </div>

      {connectionStatus === 'disconnected' && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle className="text-xs font-medium">Connection Issue Detected</AlertTitle>
          <AlertDescription className="text-xs">
            The WebSocket connection is not working. This may affect real-time updates.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center space-x-2 mt-3">
        <Button 
          size="sm" 
          variant="outline" 
          onClick={testConnection} 
          disabled={testing}
          className="text-xs h-7"
        >
          {testing ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3 mr-1" />
              Test Connection
            </>
          )}
        </Button>
      </div>

      {lastTestedAt && (
        <p className="text-xs text-muted-foreground mt-2">
          Last tested: {lastTestedAt.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

export default WebSocketStatus;