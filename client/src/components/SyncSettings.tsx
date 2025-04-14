import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useCalendarSync } from '@/hooks/useCalendarSync';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';

interface SyncStatus {
  syncing: boolean;
  configured: boolean;
  lastSync: string | null;
  interval: number;
  inProgress: boolean;
  autoSync: boolean;
}

export function SyncSettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  const [interval, setInterval] = useState(300); // 5 minutes in seconds
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  
  // Initialize anti-flicker mode from localStorage or default to true
  const [antiFlickerMode, setAntiFlickerMode] = useState(() => {
    const savedPreference = localStorage.getItem('calendar-anti-flicker-mode');
    // If we have a saved preference, use it. Otherwise default to true.
    return savedPreference === null ? true : savedPreference === 'true';
  });
  
  // Get access to our new calendar sync hook
  const { 
    syncAllCalendars, 
    requestRealTimeSync,
    lastSyncTime,
    socket
  } = useCalendarSync();
  
  // Convert seconds to human-readable format
  const formatInterval = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds} seconds`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) !== 1 ? 's' : ''}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''}`;
    }
  };
  
  // Fetch the current sync status
  const fetchStatus = async () => {
    try {
      const response = await apiRequest('GET', '/api/sync/status');
      
      // Check if the response is OK before trying to parse JSON
      if (response.ok) {
        try {
          const data = await response.json();
          setStatus(data);
          setAutoSync(data.autoSync || false);
          setInterval(data.interval || 300);
          setSyncInProgress(data.inProgress || false);
        } catch (jsonError) {
          console.error('Failed to parse sync status JSON:', jsonError);
          // Use fallback values if we can't parse the response
          setStatus({
            syncing: false,
            configured: false,
            lastSync: null,
            interval: 300,
            inProgress: false,
            autoSync: false
          });
        }
      } else {
        console.error('Failed to fetch sync status, status code:', response.status);
        // Create a reasonable default state when the API fails
        setStatus({
          syncing: false,
          configured: false,
          lastSync: null,
          interval: 300,
          inProgress: false,
          autoSync: false
        });
      }
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch sync status',
        variant: 'destructive',
      });
      
      // Create a reasonable default state when the API fails
      setStatus({
        syncing: false,
        configured: false,
        lastSync: null,
        interval: 300,
        inProgress: false,
        autoSync: false
      });
    } finally {
      setLoading(false);
    }
  };
  
  // Toggle auto-sync
  const toggleAutoSync = async () => {
    try {
      const response = await apiRequest('POST', '/api/sync/auto', {
        enabled: !autoSync
      });
      
      if (response.ok) {
        setAutoSync(!autoSync);
        toast({
          title: 'Success',
          description: `Automatic synchronization ${!autoSync ? 'enabled' : 'disabled'}`,
        });
        fetchStatus();
      } else {
        throw new Error('Failed to update auto-sync setting');
      }
    } catch (error) {
      console.error('Failed to toggle auto-sync:', error);
      toast({
        title: 'Error',
        description: 'Failed to update automatic synchronization setting',
        variant: 'destructive',
      });
    }
  };
  
  // Update sync interval
  const updateInterval = async () => {
    try {
      const response = await apiRequest('POST', '/api/sync/interval', {
        interval
      });
      
      if (response.ok) {
        toast({
          title: 'Success',
          description: `Sync interval updated to ${formatInterval(interval)}`,
        });
        fetchStatus();
      } else {
        throw new Error('Failed to update sync interval');
      }
    } catch (error) {
      console.error('Failed to update sync interval:', error);
      toast({
        title: 'Error',
        description: 'Failed to update sync interval',
        variant: 'destructive',
      });
    }
  };
  
  // Trigger manual sync using WebSocket for real-time feedback
  const syncNow = async () => {
    try {
      setSyncInProgress(true);
      
      // First try to use WebSocket for real-time sync if available
      if (wsConnected) {
        console.log('Attempting real-time sync via WebSocket...');
        const success = await requestRealTimeSync({ forceRefresh: true });
        
        if (success) {
          console.log('✅ WebSocket sync completed successfully');
          toast({
            title: 'Success',
            description: 'Synchronization completed in real-time',
          });
          fetchStatus();
          return;
        } else {
          console.log('⚠️ WebSocket sync was not successful, falling back to REST API');
        }
      } else {
        // Try to check WebSocket connection one more time
        console.log('WebSocket not connected, attempting to establish connection...');
        checkWebSocketConnection();
        
        // Wait a moment to see if connection succeeds
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // If we managed to connect, try WebSocket sync
        if (wsConnected) {
          console.log('WebSocket connected successfully, attempting real-time sync...');
          const success = await requestRealTimeSync({ forceRefresh: true });
          
          if (success) {
            console.log('✅ WebSocket sync completed successfully after reconnection');
            toast({
              title: 'Success',
              description: 'Synchronization completed in real-time',
            });
            fetchStatus();
            return;
          }
        }
      }
      
      console.log('Falling back to REST API for synchronization');
      // Fall back to REST API if WebSocket is not connected or sync failed
      const response = await apiRequest('POST', '/api/sync/now');
      
      if (response.ok) {
        console.log('✅ REST API sync initiated successfully');
        toast({
          title: 'Success',
          description: 'Synchronization started',
        });
        // Wait a moment to let the sync start
        setTimeout(fetchStatus, 1000);
      } else {
        console.error('❌ REST API sync failed with status:', response.status);
        throw new Error('Failed to trigger sync');
      }
    } catch (error) {
      console.error('❌ Failed to trigger sync:', error);
      toast({
        title: 'Error',
        description: 'Failed to start synchronization',
        variant: 'destructive',
      });
    } finally {
      // Add a slight delay before resetting the progress indicator
      // to give a better visual indication that something happened
      const resetSyncProgress = () => setSyncInProgress(false);
      setTimeout(resetSyncProgress, 2000);
    }
  };
  
  // Get authentication context to access user info
  const { user: authUser } = useAuth();
  
  // Check for WebSocket connection
  const checkWebSocketConnection = useCallback((useFallbackPath = false) => {
    // First check if we already have a socket from the calendar sync hook
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('✅ Using existing WebSocket connection from useCalendarSync');
      setWsConnected(true);
      return;
    }
    
    // Otherwise try to establish a test connection
    try {
      // Determine the WebSocket protocol based on current HTTP protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // Determine the right WebSocket path
      const wsPath = useFallbackPath ? '/ws' : '/api/ws';
      
      // Get the current host
      const currentHost = window.location.host;
      let wsUrl;
      
      // For Replit deployment
      if (currentHost.includes('replit') || currentHost.includes('replit.dev')) {
        // Use just the path for Replit
        wsUrl = `${wsPath}?userId=${authUser?.id || ''}`;
        console.log(`🔄 Using relative WebSocket URL for Replit: ${wsUrl}${useFallbackPath ? ' (fallback)' : ''}`);
      } 
      // For localhost (avoid protocol & port issues)
      else if (window.location.hostname === 'localhost') {
        const port = window.location.port || '5000';
        wsUrl = `ws://localhost:${port}${wsPath}?userId=${authUser?.id || ''}`;
        console.log(`🔄 Using explicit localhost WebSocket URL: ${wsUrl}${useFallbackPath ? ' (fallback)' : ''}`);
      } 
      // Standard case for other deployments
      else {
        wsUrl = `${protocol}//${currentHost}${wsPath}?userId=${authUser?.id || ''}`;
        console.log(`🔄 Using standard WebSocket URL: ${wsUrl}${useFallbackPath ? ' (fallback)' : ''}`);
      }
      
      console.log('🔄 Checking WebSocket connection to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      
      const checkState = () => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log('✅ WebSocket connection test successful');
          setWsConnected(true);
          
          // Send a test message to confirm authentication works
          try {
            ws.send(JSON.stringify({
              type: 'ping',
              message: 'Connection test from SyncSettings',
              userId: authUser?.id
            }));
          } catch (e) {
            console.error('❌ Error sending test message:', e);
          }
          
          // Close this test connection after a short delay
          setTimeout(() => ws.close(1000, 'Connection test complete'), 500);
        } else {
          console.log('❌ WebSocket not connected in checkState');
          setWsConnected(false);
        }
      };
      
      ws.onopen = checkState;
      
      ws.onerror = (error) => {
        console.error('❌ Error checking WebSocket connection:', error);
        
        // If this is the primary path and we have an error, try the fallback path
        if (!useFallbackPath) {
          console.log('Primary WebSocket path failed, attempting fallback path');
          
          // Try to close the failed connection
          try {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.close(1000, 'Switching to fallback path');
            }
          } catch (e) {
            // Ignore errors on close
          }
          
          // Try the fallback path after a short delay
          setTimeout(() => checkWebSocketConnection(true), 100);
          return;
        }
        
        setWsConnected(false);
      };
      
      ws.onclose = (event) => {
        // If this was an error close and not our manual close for the test,
        // and we're using the primary path, try the fallback
        if (event.code !== 1000 && !useFallbackPath) {
          console.log('Primary WebSocket connection closed unexpectedly, trying fallback path');
          setTimeout(() => checkWebSocketConnection(true), 100);
          return;
        }
      };
      
      // Set a timeout in case connection takes too long
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log(`⚠️ WebSocket connection check timed out${useFallbackPath ? ' (fallback path)' : ''}`);
          
          // If primary path timed out, try fallback
          if (!useFallbackPath) {
            console.log('Trying fallback WebSocket path after timeout');
            checkWebSocketConnection(true);
          } else {
            setWsConnected(false);
          }
          
          try {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.close(1000, 'Connection test timeout');
            }
          } catch (e) {
            // Ignore errors on timeout close
          }
        }
      }, 3000);
    } catch (error) {
      console.error(`❌ Exception checking WebSocket connection${useFallbackPath ? ' (fallback path)' : ''}:`, error);
      
      // If this is the primary path and we encountered an exception, try the fallback
      if (!useFallbackPath) {
        console.log('Exception with primary path, trying fallback WebSocket path');
        setTimeout(() => checkWebSocketConnection(true), 100);
        return;
      }
      
      setWsConnected(false);
    }
  }, [authUser?.id, socket]);
  
  // Initial fetch
  useEffect(() => {
    fetchStatus();
    checkWebSocketConnection();
    
    // Create a wrapper function to avoid binding issues
    const pollFn = () => fetchStatus();
    
    // Set up polling with the correct return type
    const pollInterval = window.setInterval(pollFn, 10000); // Check every 10 seconds
    const wsCheckInterval = window.setInterval(checkWebSocketConnection, 30000); // Check WebSocket every 30 seconds
    
    // Clean up interval when component unmounts
    return () => {
      clearInterval(pollInterval);
      clearInterval(wsCheckInterval);
    };
  }, [checkWebSocketConnection]);
  
  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Synchronization</CardTitle>
          <CardDescription>Loading sync settings...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>CalDAV Synchronization</CardTitle>
        <CardDescription>
          Configure automatic synchronization with your CalDAV server
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {wsConnected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm font-medium">
              {wsConnected ? "Real-time sync available" : "Using standard sync"}
            </span>
          </div>
          <Badge 
            variant={wsConnected ? "outline" : "secondary"}
            className={`${wsConnected ? "bg-green-50 hover:bg-green-100 text-green-700" : "bg-amber-50 hover:bg-amber-100 text-amber-700"}`}
          >
            {wsConnected ? "WebSocket Connected" : "WebSocket Disconnected"}
          </Badge>
        </div>
      
        <div className="space-y-2 pt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-sync" className="text-base">
              Automatic Sync
            </Label>
            <Switch
              id="auto-sync"
              checked={autoSync}
              onCheckedChange={toggleAutoSync}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {autoSync
              ? "Your calendars will be automatically synchronized with the server"
              : "Your calendars will only be synchronized when you manually trigger a sync"}
          </p>
        </div>
        
        <div className="space-y-2 pt-4 border-t border-border mt-4">
          <div className="flex items-center justify-between pt-2">
            <Label htmlFor="anti-flicker" className="text-base">
              Anti-Flicker Mode
            </Label>
            <Switch
              id="anti-flicker"
              checked={antiFlickerMode}
              onCheckedChange={(checked) => {
                setAntiFlickerMode(checked);
                // Store in localStorage to make the setting persistent
                localStorage.setItem('calendar-anti-flicker-mode', checked ? 'true' : 'false');
                toast({
                  title: checked ? 'Anti-Flicker Enabled' : 'Anti-Flicker Disabled',
                  description: checked 
                    ? 'Events will be preserved during sync to prevent flickering' 
                    : 'Standard sync mode enabled',
                  variant: 'default',
                });
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {antiFlickerMode
              ? "Preserves events in the UI during sync operations to prevent flickering"
              : "Standard sync mode - events may briefly disappear during updates"}
          </p>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="interval" className="text-base">
            Sync Interval: {formatInterval(interval)}
          </Label>
          <div className="px-1">
            <Slider
              id="interval"
              disabled={!autoSync}
              min={60}
              max={3600}
              step={30}
              value={[interval]}
              onValueChange={(value) => setInterval(value[0])}
              onValueCommit={updateInterval}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1 minute</span>
            <span>1 hour</span>
          </div>
        </div>
        
        <div className="space-y-2 pt-2">
          <Label className="text-base">Last Sync</Label>
          <p className="text-sm font-medium">
            {status?.lastSync
              ? format(new Date(status.lastSync), "MMM d, yyyy 'at' h:mm a")
              : "Never synced"}
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                onClick={syncNow}
                disabled={syncInProgress}
                className="w-full"
              >
                {syncInProgress ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Sync Now
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Manually sync with the CalDAV server</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}

export default SyncSettings;