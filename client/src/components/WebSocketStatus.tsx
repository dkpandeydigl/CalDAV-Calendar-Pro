import React, { useState, useEffect } from 'react';
import { sharedWebSocket, ConnectionState } from '@/utils/websocket';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';

// Map connection states to colors and icons
interface StatusConfig {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  text: string;
}

const statusConfigs: Record<ConnectionState, StatusConfig> = {
  [ConnectionState.CONNECTING]: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: <Wifi className="h-4 w-4 animate-pulse text-amber-500" />,
    text: 'Connecting...'
  },
  [ConnectionState.OPEN]: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    icon: <Wifi className="h-4 w-4 text-green-600" />,
    text: 'Connected'
  },
  [ConnectionState.CLOSING]: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: <Wifi className="h-4 w-4 text-amber-500" />,
    text: 'Closing...'
  },
  [ConnectionState.CLOSED]: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: <WifiOff className="h-4 w-4 text-red-600" />,
    text: 'Disconnected'
  },
  [ConnectionState.RECONNECTING]: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: <AlertTriangle className="h-4 w-4 animate-ping text-blue-600" />,
    text: 'Reconnecting...'
  }
};

export const WebSocketStatus: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    sharedWebSocket.getState()
  );
  
  // Track message exchange to show activity
  const [lastActivity, setLastActivity] = useState<number>(0);
  const [showActivity, setShowActivity] = useState<boolean>(false);
  
  useEffect(() => {
    // Listen for state changes
    const removeStateListener = sharedWebSocket.on('stateChange', (state: ConnectionState) => {
      setConnectionState(state);
    });
    
    // Listen for messages to show activity
    const removeMessageListener = sharedWebSocket.on('message', () => {
      setLastActivity(Date.now());
      setShowActivity(true);
      
      // Reset activity indicator after a delay
      setTimeout(() => {
        setShowActivity(false);
      }, 500);
    });
    
    // Auto-connect on mount
    if (sharedWebSocket.getState() === ConnectionState.CLOSED) {
      sharedWebSocket.connect();
    }
    
    // Clean up listeners on unmount
    return () => {
      removeStateListener();
      removeMessageListener();
    };
  }, []);
  
  const config = statusConfigs[connectionState];
  
  return (
    <div className={`flex items-center gap-2 py-1 px-2 rounded-md border ${config.borderColor} ${config.bgColor}`}>
      <div className="relative">
        {config.icon}
        {showActivity && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-500 animate-ping" />
        )}
      </div>
      <span className={`text-xs font-medium ${config.color}`}>{config.text}</span>
    </div>
  );
};

export default WebSocketStatus;