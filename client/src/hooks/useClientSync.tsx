/**
 * Hook for client-side synchronization with IndexedDB
 * 
 * This hook provides functionality to interact with the client-side sync service
 * that handles synchronization between IndexedDB and the server.
 */

import { useState, useEffect, useCallback } from 'react';
import { clientSyncService } from '../lib/client-sync-service';
import { useAuth } from './use-auth';
import { useToast } from './use-toast';

interface SyncState {
  syncing: boolean;
  lastSyncTime: Date | null;
  error: string | null;
}

interface SyncSummary {
  success: boolean;
  timestamp: Date;
  entities: Record<string, {
    pushed: number;
    pulled: number;
    errors: number;
  }>;
  error?: string;
}

export function useClientSync() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [syncState, setSyncState] = useState<SyncState>({
    syncing: false,
    lastSyncTime: null,
    error: null,
  });

  // Update user ID in sync service when authenticated user changes
  useEffect(() => {
    if (user) {
      clientSyncService.setUserId(user.id);
    } else {
      clientSyncService.setUserId(null);
    }
  }, [user]);

  // Register for sync status updates
  useEffect(() => {
    // Function to handle sync summary updates
    const handleSyncUpdate = (summary: SyncSummary) => {
      setSyncState({
        syncing: false,
        lastSyncTime: summary.timestamp,
        error: summary.error || null,
      });

      // Notify user of sync completion with toast
      if (summary.success) {
        // Count total entities synced
        let totalPushed = 0;
        let totalPulled = 0;
        
        Object.values(summary.entities).forEach(entity => {
          totalPushed += entity.pushed;
          totalPulled += entity.pulled;
        });

        if (totalPushed > 0 || totalPulled > 0) {
          toast({
            title: 'Sync Completed',
            description: `Pushed ${totalPushed} and pulled ${totalPulled} items`,
            variant: 'default'
          });
        }
      } else if (summary.error) {
        toast({
          title: 'Sync Error',
          description: summary.error,
          variant: 'destructive'
        });
      }
    };

    // Register listener for sync updates
    const unsubscribe = clientSyncService.addSyncListener(handleSyncUpdate);

    // Initialize sync state from service
    setSyncState(prev => ({
      ...prev,
      lastSyncTime: clientSyncService.getLastSyncTime(),
      syncing: clientSyncService.isSyncInProgress(),
    }));

    // Cleanup listener on unmount
    return () => {
      unsubscribe();
    };
  }, [toast]);

  // Function to trigger sync
  const syncData = useCallback(async (options = {}) => {
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    if (syncState.syncing) {
      return { success: false, error: 'Sync already in progress' };
    }

    setSyncState(prev => ({ ...prev, syncing: true, error: null }));

    try {
      const summary = await clientSyncService.syncAll(options);
      return summary;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSyncState(prev => ({ ...prev, syncing: false, error: errorMessage }));
      return { success: false, error: errorMessage };
    }
  }, [user, syncState.syncing]);

  return {
    ...syncState,
    syncData,
  };
}