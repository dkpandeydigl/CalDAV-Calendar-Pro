import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Loader2, Info } from 'lucide-react';
import { useWebSocketClient } from '@/hooks/useWebSocketClient';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Type for tracking recent event notifications
interface RecentEventChange {
  eventId: number;
  uid: string | null;
  changeType: string;
  title: string | null;
  timestamp: number;
}

/**
 * WebSocket Status Indicator
 * 
 * A component that displays the current WebSocket connection status,
 * receives real-time updates from the server, and tracks UIDs for debugging.
 */
export function WebSocketStatusIndicator() {
  const { connected, connecting, error, addMessageListener } = useWebSocketClient();
  const { toast } = useToast();
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  // Track recent event changes for debugging
  const [recentChanges, setRecentChanges] = useState<RecentEventChange[]>([]);
  
  // Register for WebSocket event notifications
  useEffect(() => {
    // Listen for event changes
    const removeEventListener = addMessageListener('event_changed', (data) => {
      const { eventId, calendarId, changeType, uid, title, timestamp = Date.now() } = data;
      
      // Record last update time
      const updateTime = new Date().toLocaleTimeString();
      setLastUpdate(updateTime);
      
      // Track this event change for debugging
      setRecentChanges(prev => {
        // Add new change to the beginning
        const newChange = { 
          eventId, 
          uid: uid || null, 
          changeType, 
          title: title || null, 
          timestamp
        };
        
        // Keep only the last 5 changes
        const updatedChanges = [newChange, ...prev].slice(0, 5);
        return updatedChanges;
      });
      
      // Enhanced logging with UID tracking for debugging
      console.log(`[WS Event] ${changeType} - ID: ${eventId}, UID: ${uid || 'none'}, Title: ${title || 'Unnamed'}`);
      
      // Show toast notification for event changes with title and UID if available
      toast({
        title: `Event ${changeType}`,
        description: `${title ? `"${title}"` : 'Calendar event'} has been ${changeType} ${uid ? `[UID: ${uid.substring(0, 8)}...]` : ''}`,
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
          
          {/* UID Tracker for debugging */}
          {recentChanges.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1 cursor-help inline-flex">
                    <Info className="h-3.5 w-3.5 text-blue-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="w-80">
                  <div className="text-xs">
                    <div className="font-semibold mb-1">Recent Event UIDs:</div>
                    <ul className="space-y-1">
                      {recentChanges.map((change, index) => (
                        <li key={index} className="border-b border-gray-200 pb-1 last:border-0">
                          <span className="font-medium">{change.changeType}:</span> {change.title || 'Unnamed'} 
                          <div className="text-gray-500">
                            ID: {change.eventId}, 
                            <span className="text-blue-500 font-mono">UID: {change.uid ? 
                              `${change.uid.substring(0, 12)}...` : 'none'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
      )}
    </div>
  );
}

export default WebSocketStatusIndicator;