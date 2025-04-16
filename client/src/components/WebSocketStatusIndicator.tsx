import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useWebSocketClient } from '@/hooks/useWebSocketClient';
import { useToast } from '@/hooks/use-toast';

/**
 * WebSocket Status Indicator
 * 
 * A simple component that displays the current WebSocket connection status
 * and receives real-time updates from the server.
 */
export function WebSocketStatusIndicator() {
  const { connected, connecting, error, addMessageListener } = useWebSocketClient();
  const { toast } = useToast();
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  
  // Register for WebSocket event notifications
  useEffect(() => {
    // Listen for event changes
    const removeEventListener = addMessageListener('event_changed', (data) => {
      const { eventId, calendarId, changeType, timestamp } = data;
      
      // Record last update time
      const updateTime = new Date().toLocaleTimeString();
      setLastUpdate(updateTime);
      
      // Show toast notification for event changes
      toast({
        title: `Event ${changeType}`,
        description: `Calendar event has been ${changeType} (ID: ${eventId})`,
        variant: 'default',
      });
    });
    
    // Listen for calendar changes
    const removeCalendarListener = addMessageListener('calendar_changed', (data) => {
      const { calendarId, changeType, timestamp } = data;
      
      // Record last update time
      const updateTime = new Date().toLocaleTimeString();
      setLastUpdate(updateTime);
      
      // Show toast notification for calendar changes
      toast({
        title: `Calendar ${changeType}`,
        description: `Calendar has been ${changeType} (ID: ${calendarId})`,
        variant: 'default',
      });
    });
    
    // Listen for notifications
    const removeNotificationListener = addMessageListener('notification', (data) => {
      const { notification } = data;
      
      // Record last update time
      const updateTime = new Date().toLocaleTimeString();
      setLastUpdate(updateTime);
      
      // Show toast notification for all other notifications
      toast({
        title: notification.title || 'New Notification',
        description: notification.message,
        variant: 'default',
      });
    });
    
    // Listen for connection confirmation
    const removeConnectedListener = addMessageListener('connected', (data) => {
      const updateTime = new Date().toLocaleTimeString();
      setLastUpdate(updateTime);
      
      toast({
        title: 'Real-time Updates Connected',
        description: 'You will now receive live updates for calendar changes.',
        variant: 'default',
      });
    });
    
    // Clean up event listeners when component unmounts
    return () => {
      removeEventListener();
      removeCalendarListener();
      removeNotificationListener();
      removeConnectedListener();
    };
  }, [addMessageListener, toast]);
  
  // Determine indicator appearance based on connection status
  let indicatorIcon;
  let indicatorText;
  let indicatorVariant: "default" | "destructive" | "outline" | "secondary" | null | undefined;
  
  if (connected) {
    indicatorIcon = <Wifi className="h-3 w-3 mr-1" />;
    indicatorText = 'Live Updates';
    indicatorVariant = 'outline';
  } else if (connecting) {
    indicatorIcon = <Loader2 className="h-3 w-3 mr-1 animate-spin" />;
    indicatorText = 'Connecting...';
    indicatorVariant = 'secondary';
  } else {
    indicatorIcon = <WifiOff className="h-3 w-3 mr-1" />;
    indicatorText = error ? 'Connection Error' : 'Offline';
    indicatorVariant = 'destructive';
  }
  
  return (
    <div className="flex items-center">
      <Badge variant={indicatorVariant} className="text-xs h-5 flex items-center">
        {indicatorIcon}
        <span>{indicatorText}</span>
      </Badge>
      
      {lastUpdate && connected && (
        <span className="text-xs text-gray-500 ml-2">
          Last update: {lastUpdate}
        </span>
      )}
    </div>
  );
}

export default WebSocketStatusIndicator;