import React from 'react';
import { WifiOff, Wifi, AlertTriangle } from 'lucide-react';
import useWebSocket from '../hooks/useWebSocket';
import { cn } from '@/lib/utils';

interface WebSocketStatusIndicatorProps {
  userId?: number | null;
  showLabel?: boolean;
  className?: string;
}

/**
 * Component to display WebSocket connection status
 * 
 * Shows a visual indicator of the WebSocket connection status:
 * - Green: Connected
 * - Amber: Connecting
 * - Red: Disconnected
 */
const WebSocketStatusIndicator: React.FC<WebSocketStatusIndicatorProps> = ({
  userId,
  showLabel = true,
  className
}) => {
  const { connectionStatus } = useWebSocket({
    userId,
    autoConnect: !!userId,
    notificationTypes: ['system']
  });

  // Map connection status to visual indicators
  const getStatusInfo = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          icon: <Wifi className="h-4 w-4 text-green-500" />,
          label: 'Connected',
          color: 'text-green-500'
        };
      case 'connecting':
        return {
          icon: <AlertTriangle className="h-4 w-4 text-amber-500 animate-pulse" />,
          label: 'Connecting',
          color: 'text-amber-500'
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="h-4 w-4 text-red-500" />,
          label: 'Disconnected',
          color: 'text-red-500'
        };
      default:
        return {
          icon: <WifiOff className="h-4 w-4 text-gray-500" />,
          label: 'Unknown',
          color: 'text-gray-500'
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {statusInfo.icon}
      {showLabel && (
        <span className={cn("text-xs font-medium", statusInfo.color)}>
          {statusInfo.label}
        </span>
      )}
    </div>
  );
};

export default WebSocketStatusIndicator;