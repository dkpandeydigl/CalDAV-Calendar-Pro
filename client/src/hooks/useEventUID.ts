/**
 * useEventUID Hook
 * 
 * A React hook that provides access to the UID persistence service.
 * This hook allows components to easily manage event UIDs without
 * directly interacting with IndexedDB.
 */

import { useState, useEffect, useCallback } from 'react';
import { uidPersistenceService } from '@/services/uidPersistenceService';

interface UseEventUIDOptions {
  eventId?: number;  // Optional if generating a new UID
  calendarId?: number; // Required when storing a new UID
}

interface UseEventUIDResult {
  uid: string | null;
  loading: boolean;
  error: Error | null;
  storeUID: (uid: string, eventId: number, calendarId: number) => Promise<void>;
  generateUID: () => string;
  getOrCreateUID: (eventId: number, calendarId: number) => Promise<string>;
}

export function useEventUID(options: UseEventUIDOptions = {}): UseEventUIDResult {
  const { eventId, calendarId } = options;
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!eventId);
  const [error, setError] = useState<Error | null>(null);

  // Fetch UID for a given event ID
  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    uidPersistenceService.getUID(eventId)
      .then((fetchedUid) => {
        setUid(fetchedUid);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching UID:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [eventId]);

  // Store a UID for an event
  const storeUID = useCallback(async (
    uidToStore: string, 
    eventIdToStore: number, 
    calendarIdToStore: number
  ): Promise<void> => {
    if (!uidToStore || !eventIdToStore || !calendarIdToStore) {
      throw new Error('Missing required parameters for storing UID');
    }

    try {
      await uidPersistenceService.storeUID(eventIdToStore, uidToStore, calendarIdToStore);
      if (eventId === eventIdToStore) {
        setUid(uidToStore);
      }
    } catch (err) {
      console.error('Error storing UID:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [eventId]);

  // Generate a new UID
  const generateUID = useCallback((): string => {
    return uidPersistenceService.generateUID();
  }, []);

  // Get existing UID or create and store a new one
  const getOrCreateUID = useCallback(async (
    eventIdToUse: number, 
    calendarIdToUse: number
  ): Promise<string> => {
    if (!eventIdToUse || !calendarIdToUse) {
      throw new Error('Event ID and Calendar ID are required');
    }

    try {
      // Try to get existing UID
      const existingUid = await uidPersistenceService.getUID(eventIdToUse);
      
      if (existingUid) {
        return existingUid;
      }
      
      // Generate and store a new UID
      const newUid = uidPersistenceService.generateUID();
      await uidPersistenceService.storeUID(eventIdToUse, newUid, calendarIdToUse);
      
      return newUid;
    } catch (err) {
      console.error('Error in getOrCreateUID:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, []);

  return {
    uid,
    loading,
    error,
    storeUID,
    generateUID,
    getOrCreateUID
  };
}

export default useEventUID;