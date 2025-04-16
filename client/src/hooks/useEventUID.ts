/**
 * Event UID Hook
 * 
 * This hook provides consistent access to event UIDs
 * using the persistence service to ensure the same UID
 * is used throughout an event's lifecycle.
 */

import { useState, useEffect } from 'react';
import { uidPersistenceService } from '../services/uidPersistenceService';

// Ignore TypeScript errors for now since we're doing this incrementally

/**
 * Hook to get a consistent UID for an event
 * 
 * If an eventId is provided, it will attempt to fetch the UID from storage.
 * If no eventId is provided or no UID is found in storage, it will generate a new one.
 * 
 * @param eventId Optional event ID to fetch a stored UID
 * @returns An object containing the UID and related utility functions
 */
export function useEventUID(eventId?: number | null) {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch or generate a UID on initial render or when eventId changes
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    async function getUID() {
      try {
        if (eventId) {
          // Try to fetch an existing UID for this event
          const existingUid = await uidPersistenceService.getUID(eventId);
          
          if (existingUid && mounted) {
            console.log(`[useEventUID] Retrieved existing UID for event ${eventId}: ${existingUid}`);
            setUid(existingUid);
            setLoading(false);
            return;
          }
        }
        
        // No eventId provided or no UID found for the event, generate a new one
        if (mounted) {
          const newUid = uidPersistenceService.generateUID();
          console.log(`[useEventUID] Generated new UID: ${newUid}`);
          setUid(newUid);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useEventUID] Error fetching/generating UID:', err);
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          
          // Fallback to generating a new UID
          const fallbackUid = uidPersistenceService.generateUID();
          console.log(`[useEventUID] Generated fallback UID due to error: ${fallbackUid}`);
          setUid(fallbackUid);
          setLoading(false);
        }
      }
    }

    getUID();

    return () => {
      mounted = false;
    };
  }, [eventId]);

  /**
   * Store the current UID for the given event ID
   */
  const storeUidForEvent = async (eventIdToStore: number) => {
    if (!uid) {
      console.error('[useEventUID] Cannot store null UID');
      return;
    }

    try {
      await uidPersistenceService.storeUID(eventIdToStore, uid);
      console.log(`[useEventUID] Stored UID ${uid} for event ${eventIdToStore}`);
    } catch (err) {
      console.error('[useEventUID] Error storing UID:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  /**
   * Delete the UID mapping for an event
   */
  const deleteUidMapping = async (eventIdToDelete: number) => {
    try {
      await uidPersistenceService.deleteUID(eventIdToDelete);
      console.log(`[useEventUID] Deleted UID mapping for event ${eventIdToDelete}`);
    } catch (err) {
      console.error('[useEventUID] Error deleting UID mapping:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  /**
   * Generate a new UID and update the state
   */
  const refreshUid = () => {
    const newUid = uidPersistenceService.generateUID();
    console.log(`[useEventUID] Refreshed UID: ${newUid}`);
    setUid(newUid);
    return newUid;
  };

  return {
    uid,
    loading,
    error,
    storeUidForEvent,
    deleteUidMapping,
    refreshUid
  };
}