/**
 * Hook for client-side synchronization with IndexedDB
 * 
 * This hook provides functionality to interact with the client-side sync service
 * that handles synchronization between IndexedDB and the server.
 * Now includes auto-sync on login.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
  
  // Keep track of if user has changed since last render
  const prevUserIdRef = useRef<number | null>(null);
  // Ref to track if an auto-sync has already been triggered for this user session
  const hasSyncedRef = useRef<boolean>(false);

  // Update user ID in sync service when authenticated user changes
  useEffect(() => {
    if (user) {
      clientSyncService.setUserId(user.id);
      
      // Check if this is a new login (user ID changed or first login)
      const isNewLogin = prevUserIdRef.current !== user.id;
      prevUserIdRef.current = user.id;
      
      // Reset the sync flag when user ID changes
      if (isNewLogin) {
        hasSyncedRef.current = false;
      }

      // Auto-trigger sync on login if not already synced for this user session
      if (isNewLogin && !hasSyncedRef.current) {
        console.log('Auto-triggering sync after login');
        // Short delay to ensure components are mounted
        setTimeout(() => {
          setSyncState(prev => ({ ...prev, syncing: true, error: null }));
          
          clientSyncService.syncAll({ forceFullSync: true })
            .catch(error => {
              const errorMessage = error instanceof Error ? error.message : String(error);
              setSyncState(prev => ({ ...prev, syncing: false, error: errorMessage }));
              console.error('Auto-sync error:', errorMessage);
            });
            
          hasSyncedRef.current = true; // Mark as synced for this session
        }, 500);
      }
    } else {
      clientSyncService.setUserId(null);
      prevUserIdRef.current = null;
      hasSyncedRef.current = false;
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
            description: `Synchronized ${totalPulled} items from server`,
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