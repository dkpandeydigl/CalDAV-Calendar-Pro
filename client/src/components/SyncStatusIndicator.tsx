/**
 * Sync Status Indicator
 * 
 * Displays the current sync status and provides a button to manually trigger sync
 */

import { useState } from 'react';
import { useClientSync } from '../hooks/useClientSync';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SyncStatusIndicatorProps {
  className?: string;
}

export function SyncStatusIndicator({ className }: SyncStatusIndicatorProps) {
  const { syncing, lastSyncTime, error, syncData } = useClientSync();
  const [expanded, setExpanded] = useState(false);

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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              className={cn(
                "flex items-center gap-2", 
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

      {expanded && (
        <div className="p-3 border rounded-md bg-background shadow-sm w-60">
          <div className="text-xs text-muted-foreground mb-2">
            {getLastSyncText()}
          </div>
          
          {error && (
            <div className="text-xs text-destructive mb-2 max-h-24 overflow-auto">
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