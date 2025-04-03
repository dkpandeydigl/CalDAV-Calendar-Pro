import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCcw } from "lucide-react";
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';

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
      const data = await response.json();
      setStatus(data);
      setAutoSync(data.autoSync || false);
      setInterval(data.interval || 300);
      setSyncInProgress(data.inProgress || false);
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch sync status',
        variant: 'destructive',
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
  
  // Trigger manual sync
  const syncNow = async () => {
    try {
      setSyncInProgress(true);
      const response = await apiRequest('POST', '/api/sync/now');
      
      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Synchronization started',
        });
        // Wait a moment to let the sync start
        setTimeout(fetchStatus, 1000);
      } else {
        throw new Error('Failed to trigger sync');
      }
    } catch (error) {
      console.error('Failed to trigger sync:', error);
      toast({
        title: 'Error',
        description: 'Failed to start synchronization',
        variant: 'destructive',
      });
    } finally {
      const resetSyncProgress = () => setSyncInProgress(false);
      setTimeout(resetSyncProgress, 2000);
    }
  };
  
  // Initial fetch
  useEffect(() => {
    fetchStatus();
    
    // Create a wrapper function to avoid binding issues
    const pollFn = () => fetchStatus();
    
    // Set up polling
    const pollInterval = setInterval(pollFn, 10000); // Check every 10 seconds
    
    // Clean up interval when component unmounts
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []);
  
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
        <div className="space-y-2">
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