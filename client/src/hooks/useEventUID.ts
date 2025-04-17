/**
 * Event UID Hook
 * 
 * This hook provides an easy way for components to interact with the UID persistence service.
 * It offers methods to get, store, and generate UIDs for events throughout their lifecycle.
 */

import { useState, useCallback, useEffect } from 'react';
import { uidPersistenceService } from '../services/uidPersistenceService';

interface UseEventUIDOptions {
  eventId?: number;
  uid?: string;
  autoLoad?: boolean;
}

export function useEventUID({ eventId, uid: initialUid, autoLoad = true }: UseEventUIDOptions = {}) {
  const [uid, setUid] = useState<string | null>(initialUid || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Load UID for an event ID if specified
  const loadUID = useCallback(async (id?: number) => {
    if (!id) return null;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const storedUid = await uidPersistenceService.getUID(id);
      setUid(storedUid);
      return storedUid;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load UID');
      setError(error);
      console.error('Error loading UID:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Store a UID for an event ID
  const storeUID = useCallback(async (id: number, eventUid: string) => {
    if (!id || !eventUid) return false;
    
    try {
      setIsLoading(true);
      setError(null);
      
      await uidPersistenceService.storeUID(id, eventUid);
      setUid(eventUid);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to store UID');
      setError(error);
      console.error('Error storing UID:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Generate a new UID (but don't store it yet)
  const generateUID = useCallback(() => {
    const newUid = uidPersistenceService.generateUID();
    setUid(newUid);
    return newUid;
  }, []);
  
  // Handle auto-loading on mount or when eventId changes
  useEffect(() => {
    if (autoLoad && eventId && !uid) {
      loadUID(eventId);
    }
  }, [autoLoad, eventId, uid, loadUID]);
  
  // Get event ID by UID
  const getEventIdByUID = useCallback(async (uidToFind: string) => {
    if (!uidToFind) return null;
    
    try {
      setIsLoading(true);
      setError(null);
      
      return await uidPersistenceService.getEventIdByUID(uidToFind);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to find event ID by UID');
      setError(error);
      console.error('Error finding event ID by UID:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Delete a UID mapping
  const deleteUIDMapping = useCallback(async (id: number) => {
    if (!id) return false;
    
    try {
      setIsLoading(true);
      setError(null);
      
      await uidPersistenceService.deleteUIDMapping(id);
      if (eventId === id) {
        setUid(null);
      }
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete UID mapping');
      setError(error);
      console.error('Error deleting UID mapping:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);
  
  return {
    uid,
    isLoading,
    error,
    loadUID,
    storeUID,
    generateUID,
    getEventIdByUID,
    deleteUIDMapping,
    isServiceReady: uidPersistenceService.isReady()
  };
}