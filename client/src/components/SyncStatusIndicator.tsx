/**
 * Sync Status Indicator
 * 
 * Displays the current sync status and provides a button to manually trigger sync
 * Shows prominent loading indicator during automatic syncs
 */

import { useState, useEffect } from 'react';
import { useClientSync } from '../hooks/useClientSync';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Progress } from '@/components/ui/progress';

interface SyncStatusIndicatorProps {
  className?: string;
}

export function SyncStatusIndicator({ className }: SyncStatusIndicatorProps) {
  const { syncing, lastSyncTime, error, syncData } = useClientSync();
  const [expanded, setExpanded] = useState(false);
  const [progressValue, setProgressValue] = useState(0);

  // Auto-expand when syncing starts
  useEffect(() => {
    if (syncing) {
      setExpanded(true);
    }
  }, [syncing]);

  // Animated progress bar for syncing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (syncing) {
      // Reset progress when sync starts
      setProgressValue(0);
      
      // Simulate progress (actual sync has no progress indicator)
      interval = setInterval(() => {
        setProgressValue(prev => {
          // Cap at 90% so it jumps to 100% only when sync completes
          const next = prev + (Math.random() * 5);
          return Math.min(next, 90);
        });
      }, 500);
    } else if (progressValue > 0) {
      // Complete progress when sync ends
      setProgressValue(100);
      
      // Reset progress after a delay
      const timeout = setTimeout(() => {
        setProgressValue(0);
      }, 1000);
      
      return () => clearTimeout(timeout);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [syncing, progressValue]);

  // Format last sync time
  const getLastSyncText = () => {
    if (!lastSyncTime) return 'Never synced';
    return `Last sync: ${formatDistanceToNow(lastSyncTime, { addSuffix: true })}`;
  };

  // Determine icon and color based on sync status
  const getSyncIcon = () => {
    if (syncing) return <Loader2 className="h-4 w-4 animate-spin" />;
    if (error) return <XCircle className="h-4 w-4 text-destructive" />;
    if (lastSyncTime) return <CheckCircle className="h-4 w-4 text-green-500" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  // Handle manual sync button click
  const handleSync = async () => {
    await syncData();
  };

  return (
    <div className={cn("flex flex-col items-center space-y-2", className)}>
      {/* Main indicator button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant={syncing ? "default" : "outline"}
              size="sm" 
              className={cn(
                "flex items-center gap-2 relative", 
                syncing ? "bg-primary text-primary-foreground" : "",
                error ? "text-destructive border-destructive" : ""
              )}
              onClick={() => setExpanded(!expanded)}
            >
              {getSyncIcon()}
              <span className="text-xs">
                {syncing ? 'Syncing...' : 'Sync'}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{getLastSyncText()}</p>
            {error && <p className="text-destructive">Error: {error}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Expanded sync status panel */}
      {expanded && (
        <div className="p-4 border rounded-md bg-background shadow-md w-64 absolute top-16 right-4 z-10">
          <div className="font-medium mb-2 flex items-center gap-1">
            {getSyncIcon()}
            <span>{syncing ? 'Syncing in progress' : 'Sync Status'}</span>
          </div>
          
          {/* Progress indicator */}
          {(syncing || progressValue > 0) && (
            <div className="mb-3">
              <Progress value={progressValue} className="h-2 mb-1" />
              <p className="text-xs text-muted-foreground">
                {syncing ? 'Synchronizing with server...' : 'Sync complete!'}
              </p>
            </div>
          )}
          
          <div className="text-xs text-muted-foreground mb-2">
            {getLastSyncText()}
          </div>
          
          {error && (
            <div className="text-xs text-destructive mb-2 max-h-24 overflow-auto p-2 bg-destructive/10 rounded">
              {error}
            </div>
          )}
          
          <div className="flex justify-between">
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              disabled={syncing}
              onClick={handleSync}
            >
              {syncing ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Sync Now
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}