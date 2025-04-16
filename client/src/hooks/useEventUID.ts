/**
 * Event UID Hook
 * 
 * This hook provides consistent access to event UIDs
 * using the persistence service to ensure the same UID
 * is used throughout an event's lifecycle.
 */

import { useState, useEffect, useCallback } from 'react';
import { uidPersistenceService } from '../services/uidPersistenceService';

export function useEventUID(eventId?: number | null) {
  const [uid, setUid] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Load the UID on component mount if eventId is provided
  useEffect(() => {
    // Reset states when eventId changes
    setUid(null);
    setError(null);
    
    if (eventId) {
      setIsLoading(true);
      
      uidPersistenceService.getUID(eventId)
        .then(existingUid => {
          if (existingUid) {
            setUid(existingUid);
          } else {
            // Don't automatically generate new UIDs for existing events
            // as this might indicate a problem
            console.log(`No UID found for existing event ${eventId}`);
            setUid(null);
          }
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Error retrieving event UID:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        });
    }
  }, [eventId]);
  
  // Create or retrieve a UID
  const getOrCreateUID = useCallback(async (id?: number): Promise<string> => {
    // Use the provided ID or fall back to eventId from props
    const effectiveId = id || eventId;
    
    if (!effectiveId) {
      throw new Error('Cannot get or create UID without an event ID');
    }
    
    setIsLoading(true);
    try {
      const resultUid = await uidPersistenceService.getOrCreateUID(effectiveId);
      setUid(resultUid);
      setIsLoading(false);
      return resultUid;
    } catch (err) {
      console.error('Error getting/creating event UID:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      throw error;
    }
  }, [eventId]);
  
  // Store a specific UID for an event
  const storeUID = useCallback(async (id: number, specificUid: string): Promise<string> => {
    setIsLoading(true);
    try {
      const resultUid = await uidPersistenceService.storeUID(id, specificUid);
      setUid(resultUid);
      setIsLoading(false);
      return resultUid;
    } catch (err) {
      console.error('Error storing event UID:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      throw error;
    }
  }, []);
  
  // Delete a UID
  const deleteUID = useCallback(async (id?: number): Promise<boolean> => {
    // Use the provided ID or fall back to eventId from props
    const effectiveId = id || eventId;
    
    if (!effectiveId) {
      throw new Error('Cannot delete UID without an event ID');
    }
    
    setIsLoading(true);
    try {
      const success = await uidPersistenceService.deleteUID(effectiveId);
      if (success) {
        setUid(null);
      }
      setIsLoading(false);
      return success;
    } catch (err) {
      console.error('Error deleting event UID:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      throw error;
    }
  }, [eventId]);
  
  // Extract UID from iCalendar data
  const extractUIDFromICS = useCallback((icsData: string): string | null => {
    const uidMatch = icsData.match(/UID:([^\r\n]+)/i);
    return uidMatch ? uidMatch[1].trim() : null;
  }, []);
  
  // Store UID extracted from ICS data
  const storeUIDFromICS = useCallback(async (id: number, icsData: string): Promise<string | null> => {
    const extractedUid = extractUIDFromICS(icsData);
    
    if (extractedUid) {
      return storeUID(id, extractedUid);
    }
    
    return null;
  }, [storeUID, extractUIDFromICS]);
  
  return {
    uid,
    isLoading,
    error,
    getOrCreateUID,
    storeUID,
    deleteUID,
    extractUIDFromICS,
    storeUIDFromICS
  };
}