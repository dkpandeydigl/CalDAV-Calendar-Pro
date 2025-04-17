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
 * - Red: Disconnected
 */
const WebSocketStatusIndicator: React.FC<WebSocketStatusIndicatorProps> = ({
  userId,
  showLabel = true,
  className
}) => {
  const { isConnected } = useWebSocket({
    userId: userId ? Number(userId) : undefined,
    autoConnect: !!userId,
    onOpen: () => console.log('WebSocket connected'),
    onClose: () => console.log('WebSocket disconnected')
  });

  // Map connection status to visual indicators
  const getStatusInfo = () => {
    if (isConnected) {
      return {
        icon: <Wifi className="h-4 w-4 text-green-500" />,
        label: 'Connected',
        color: 'text-green-500'
      };
    } else {
      return {
        icon: <WifiOff className="h-4 w-4 text-red-500" />,
        label: 'Disconnected',
        color: 'text-red-500'
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