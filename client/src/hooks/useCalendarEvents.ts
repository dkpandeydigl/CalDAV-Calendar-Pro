import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Event } from '@shared/schema';
import { useCalendars } from './useCalendars';
import { useSharedCalendars } from './useSharedCalendars';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useDeletedEventsTracker } from './useDeletedEventsTracker';

// Type declarations to help with TanStack Query types
type QueryKey = unknown;
type EventFilter = (e: Event) => boolean;

// Add a cache version counter type
interface CacheVersionData {
  version: number;
  lastUpdated: number;
  source: string;
}

// Global reference to track cache versions across the application
const globalCacheVersion: CacheVersionData = {
  version: 0,
  lastUpdated: Date.now(),
  source: 'init'
};

export const useCalendarEvents = (startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();
  const localQueryClient = useQueryClient();
  const { calendars } = useCalendars();
  const { sharedCalendars } = useSharedCalendars();
  
  // Multi-level caching system to better handle event retention during sync operations
  // Main cache for all events
  const eventsCache = useRef<Event[]>([]);
  // Temporary cache for new events that might not have been synced yet
  const newEventsCache = useRef<Event[]>([]);
  // Last known event count to detect significant changes
  const lastEventCount = useRef<number>(0);
  
  // Track recently deleted events by both ID and UID to prevent them from reappearing
  const recentlyDeletedEventIds = useRef<Set<number>>(new Set());
  const recentlyDeletedEventUids = useRef<Set<string>>(new Set());
  // Also track by title and start date to catch duplicates with different IDs
  const recentlyDeletedEventSignatures = useRef<Set<string>>(new Set());
  
  // Store a deleted event in our tracking system with enhanced deduplication
  const trackDeletedInMemory = useCallback((event: Event) => {
    console.log(`Tracking deleted event for in-memory filtering - ID: ${event.id}, UID: ${event.uid}`);
    
    // Store basic identifiers in memory
    recentlyDeletedEventIds.current.add(event.id);
    if (event.uid) {
      recentlyDeletedEventUids.current.add(event.uid);
    }
    
    // Create multiple signature formats to improve catching duplicates
    let signature = '';
    let crossCalendarSignature = '';
    let endSignature = '';
    let endCrossCalSignature = '';
    
    if (event.title && event.startDate && event.calendarId) {
      // Create standard signature: calendarId-title-startTime
      const startTime = new Date(event.startDate).getTime();
      signature = `${event.calendarId}-${event.title}-${startTime}`;
      recentlyDeletedEventSignatures.current.add(signature);
      console.log(`Created deletion signature: ${signature}`);
      
      // Add an additional format without calendarId to catch cross-calendar duplicates
      crossCalendarSignature = `${event.title}-${startTime}`;
      recentlyDeletedEventSignatures.current.add(crossCalendarSignature);
      console.log(`Created cross-calendar deletion signature: ${crossCalendarSignature}`);
      
      // Also track end time for all-day events that might have different start/end
      if (event.endDate) {
        const endTime = new Date(event.endDate).getTime();
        endSignature = `${event.calendarId}-${event.title}-${endTime}`;
        endCrossCalSignature = `${event.title}-${endTime}`;
        recentlyDeletedEventSignatures.current.add(endSignature);
        recentlyDeletedEventSignatures.current.add(endCrossCalSignature);
      }
    }
    
    // Prepare event details for storage
    const eventDetails = {
      id: event.id,
      uid: event.uid || null,
      title: event.title || null,
      startDate: event.startDate || null,
      endDate: event.endDate || null,
      calendarId: event.calendarId,
      deleteTime: Date.now(),
      permanent: true, // Mark as a permanent deletion
      signatures: {
        main: signature || null,
        crossCal: crossCalendarSignature || null,
        end: endSignature || null,
        endCrossCal: endCrossCalSignature || null
      }
    };
    
    // STORE IN SESSION STORAGE for persistence across refreshes
    try {
      // 1. Basic ID list for simple lookups
      const deletedIdsJson = sessionStorage.getItem('deletedEventIds') || '[]';
      const deletedIds = JSON.parse(deletedIdsJson);
      if (!deletedIds.includes(event.id)) {
        deletedIds.push(event.id);
        sessionStorage.setItem('deletedEventIds', JSON.stringify(deletedIds));
      }
      
      // 2. UIDs list for matching recurring events and sync ops
      if (event.uid) {
        const deletedUidsJson = sessionStorage.getItem('deletedEventUids') || '[]';
        const deletedUids = JSON.parse(deletedUidsJson);
        if (!deletedUids.includes(event.uid)) {
          deletedUids.push(event.uid);
          sessionStorage.setItem('deletedEventUids', JSON.stringify(deletedUids));
        }
      }
      
      // 3. Store signatures for better cross-calendar matching
      if (signature) {
        const deletedSignaturesJson = sessionStorage.getItem('deletedEventSignatures') || '[]';
        const deletedSignatures = JSON.parse(deletedSignaturesJson);
        
        // Add all our signatures
        const newSignatures = [signature, crossCalendarSignature];
        if (endSignature) {
          newSignatures.push(endSignature, endCrossCalSignature);
        }
        
        // Add any new signatures that don't already exist
        let updated = false;
        newSignatures.forEach(sig => {
          if (!deletedSignatures.includes(sig)) {
            deletedSignatures.push(sig);
            updated = true;
          }
        });
        
        if (updated) {
          sessionStorage.setItem('deletedEventSignatures', JSON.stringify(deletedSignatures));
        }
      }
      
      // 4. Store complete event details for comprehensive matching in sessionStorage
      const deletedDetailsJson = sessionStorage.getItem('deletedEventDetails') || '[]';
      const deletedDetails = JSON.parse(deletedDetailsJson);
      
      // Check if we already have this event by ID
      const existingIndex = deletedDetails.findIndex((e: any) => e.id === event.id);
      if (existingIndex >= 0) {
        // Update existing entry
        deletedDetails[existingIndex] = eventDetails;
      } else {
        // Add new entry
        deletedDetails.push(eventDetails);
      }
      
      // Save the updated details to sessionStorage
      sessionStorage.setItem('deletedEventDetails', JSON.stringify(deletedDetails));
      console.log(`Stored deleted event details in session storage:`, eventDetails);
      
      // 5. ALSO STORE IN LOCAL STORAGE for persistence across browser sessions
      try {
        // First, get existing permanent deletions
        const permanentDeletedJson = localStorage.getItem('permanent_deleted_events') || '[]';
        const permanentDeleted = JSON.parse(permanentDeletedJson);
        
        // Check if we already have this event
        const existingPermanentIndex = permanentDeleted.findIndex((e: any) => 
          e.id === event.id || (e.uid && event.uid && e.uid === event.uid)
        );
        
        if (existingPermanentIndex >= 0) {
          // Update existing entry
          permanentDeleted[existingPermanentIndex] = eventDetails;
        } else {
          // Add new entry, but maintain a reasonable limit (keep last 100 deletions)
          permanentDeleted.push(eventDetails);
          if (permanentDeleted.length > 100) {
            // Sort by deleteTime and keep most recent 100
            permanentDeleted.sort((a: any, b: any) => b.deleteTime - a.deleteTime);
            permanentDeleted.length = 100;
          }
        }
        
        // Save back to localStorage
        localStorage.setItem('permanent_deleted_events', JSON.stringify(permanentDeleted));
        console.log(`Stored deleted event in localStorage for permanent tracking`);
        
        // 6. Store a simplified deletion map for quicker lookups
        const deletionLookupMap = JSON.parse(localStorage.getItem('deletion_lookup_map') || '{}');
        
        // Add all identifiers to the map
        deletionLookupMap[`id:${event.id}`] = Date.now();
        if (event.uid) deletionLookupMap[`uid:${event.uid}`] = Date.now();
        if (signature) deletionLookupMap[`sig:${signature}`] = Date.now();
        if (crossCalendarSignature) deletionLookupMap[`sig:${crossCalendarSignature}`] = Date.now();
        
        // Save the updated map
        localStorage.setItem('deletion_lookup_map', JSON.stringify(deletionLookupMap));
      } catch (localStorageError) {
        console.error('Error storing deleted event in localStorage:', localStorageError);
      }
      
      // 5. Apply CSS hiding to any matching DOM elements for this event
      try {
        // Hide elements by ID
        const elements = document.querySelectorAll(`[data-event-id="${event.id}"]`);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} DOM elements for deleted event ${event.id} - applying permanent hiding`);
          elements.forEach(el => {
            (el as HTMLElement).style.display = 'none';
            (el as HTMLElement).style.opacity = '0';
            (el as HTMLElement).style.pointerEvents = 'none';
            el.setAttribute('data-deleted', 'true');
            el.setAttribute('data-permanent-delete', 'true');
          });
        }
        
        // Hide elements by UID if available
        if (event.uid) {
          const uidElements = document.querySelectorAll(`[data-event-uid="${event.uid}"]`);
          if (uidElements.length > 0) {
            console.log(`Found ${uidElements.length} DOM elements by UID for deleted event - applying permanent hiding`);
            uidElements.forEach(el => {
              (el as HTMLElement).style.display = 'none';
              (el as HTMLElement).style.opacity = '0';
              (el as HTMLElement).style.pointerEvents = 'none';
              el.setAttribute('data-deleted', 'true');
              el.setAttribute('data-permanent-delete', 'true');
            });
          }
        }
      } catch (domErr) {
        console.error('Error applying CSS hiding to deleted event elements:', domErr);
      }
    } catch (storageErr) {
      console.error('Error storing deleted event in session storage:', storageErr);
    }
    
    // Immediately invalidate queries to ensure deleted event disappears
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    
    // Clean up expired entries after 24 hours (extended from 60 minutes)
    // This is longer than normal sync intervals to ensure events don't reappear
    setTimeout(() => {
      recentlyDeletedEventIds.current.delete(event.id);
      if (event.uid) {
        recentlyDeletedEventUids.current.delete(event.uid);
      }
      
      // Also clean up the signatures if they exist
      if (event.title && event.startDate && event.calendarId) {
        const startTime = new Date(event.startDate).getTime();
        
        // Clean up standard signature
        const signature = `${event.calendarId}-${event.title}-${startTime}`;
        recentlyDeletedEventSignatures.current.delete(signature);
        
        // Clean up cross-calendar signature
        const crossCalendarSignature = `${event.title}-${startTime}`;
        recentlyDeletedEventSignatures.current.delete(crossCalendarSignature);
        
        // Clean up end-time signature
        if (event.endDate) {
          const endTime = new Date(event.endDate).getTime();
          const endSignature = `${event.calendarId}-${event.title}-${endTime}`;
          recentlyDeletedEventSignatures.current.delete(endSignature);
        }
      }
      
      console.log(`Removed event ID ${event.id} from in-memory deleted events tracking`);
      
      // NOTE: We intentionally DON'T remove from session storage until page reload
      // This helps maintain deletion state across sync operations
    }, 24 * 60 * 60 * 1000); // 24 hours (increased from 60 minutes)
  }, [queryClient]);
  
  // Enhanced cache preservation system with specific handling for new events
  const preserveEventsCache = useCallback(() => {
    try {
      const currentEvents = localQueryClient.getQueryData<Event[]>(['/api/events']);
      if (currentEvents && currentEvents.length > 0) {
        // Make a deep copy to avoid reference issues
        const eventsCopy = JSON.parse(JSON.stringify(currentEvents));
        
        // Preserve current event count for comparison
        lastEventCount.current = currentEvents.length;
        
        // Update the main cache
        eventsCache.current = eventsCopy;
        
        // Identify new events (those that have temp IDs or were recently added)
        // Simplified detection logic to avoid using updatedAt that might not be available
        const newEvents = currentEvents.filter(e => 
          typeof e.id === 'string' || // Temp ID is a string 
          (e.id && e.id < 0) || // Negative IDs are temporary
          (e.lastModifiedAt && new Date(e.lastModifiedAt).getTime() > Date.now() - 30000) // Modified in last 30 seconds
        );
        
        if (newEvents.length > 0) {
          // Add to new events cache
          newEventsCache.current = [...newEventsCache.current, ...JSON.parse(JSON.stringify(newEvents))];
          console.log(`Preserved ${newEvents.length} new events in dedicated cache`);
        }
        
        console.log(`Preserved ${currentEvents.length} events in local cache`);
      }
    } catch (error) {
      console.error("Error preserving events cache:", error);
      // Don't update cache if there was an error
    }
  }, [localQueryClient]);
  
  // Filter function to remove deleted events from the cache before restoration
  const filterDeletedEventsFromCache = useCallback((events: Event[]): Event[] => {
    // First, ensure we load deleted event data from session storage and localStorage into memory
    try {
      // Load basic IDs list from sessionStorage
      const deletedIdsJson = sessionStorage.getItem('deletedEventIds') || '[]';
      const deletedIds = JSON.parse(deletedIdsJson);
      if (deletedIds.length > 0) {
        console.log(`Loading ${deletedIds.length} deleted event IDs from session storage`);
        deletedIds.forEach((id: number) => {
          recentlyDeletedEventIds.current.add(id);
        });
      }
      
      // Load UIDs list from sessionStorage
      const deletedUidsJson = sessionStorage.getItem('deletedEventUids') || '[]';
      const deletedUids = JSON.parse(deletedUidsJson);
      if (deletedUids.length > 0) {
        console.log(`Loading ${deletedUids.length} deleted event UIDs from session storage`);
        deletedUids.forEach((uid: string) => {
          recentlyDeletedEventUids.current.add(uid);
        });
      }
      
      // Load signatures list from sessionStorage
      const deletedSignaturesJson = sessionStorage.getItem('deletedEventSignatures') || '[]';
      const deletedSignatures = JSON.parse(deletedSignaturesJson);
      if (deletedSignatures.length > 0) {
        console.log(`Loading ${deletedSignatures.length} deleted event signatures from session storage`);
        deletedSignatures.forEach((signature: string) => {
          recentlyDeletedEventSignatures.current.add(signature);
        });
      }
      
      // Load detailed deletion info from sessionStorage
      const deletedDetailsJson = sessionStorage.getItem('deletedEventDetails') || '[]';
      const deletedDetails = JSON.parse(deletedDetailsJson);
      console.log(`Loaded ${deletedDetails.length} detailed deletion records from session storage`);
      
      // Load permanent deletion data from localStorage (persists across browser sessions)
      try {
        // Get the quick lookup map first, which is more efficient
        const deletionLookupMapJson = localStorage.getItem('deletion_lookup_map') || '{}';
        const deletionLookupMap = JSON.parse(deletionLookupMapJson);
        
        if (Object.keys(deletionLookupMap).length > 0) {
          console.log(`Loading ${Object.keys(deletionLookupMap).length} deletion lookup entries from localStorage`);
        }
        
        // Also load the full permanent deletion records for detailed matching
        const permanentDeletedJson = localStorage.getItem('permanent_deleted_events') || '[]';
        const permanentDeleted = JSON.parse(permanentDeletedJson);
        
        if (permanentDeleted.length > 0) {
          console.log(`Loading ${permanentDeleted.length} permanent deletion records from localStorage`);
          
          // Add all permanent deletions to our in-memory tracking
          permanentDeleted.forEach((detail: any) => {
            // Add ID
            if (detail.id) recentlyDeletedEventIds.current.add(detail.id);
            
            // Add UID
            if (detail.uid) recentlyDeletedEventUids.current.add(detail.uid);
            
            // Add signatures if available
            if (detail.signatures) {
              if (detail.signatures.main) recentlyDeletedEventSignatures.current.add(detail.signatures.main);
              if (detail.signatures.crossCal) recentlyDeletedEventSignatures.current.add(detail.signatures.crossCal);
              if (detail.signatures.end) recentlyDeletedEventSignatures.current.add(detail.signatures.end);
              if (detail.signatures.endCrossCal) recentlyDeletedEventSignatures.current.add(detail.signatures.endCrossCal);
            }
          });
        }
      } catch (localStorageError) {
        console.error('Error loading permanent deleted events from localStorage:', localStorageError);
      }
    } catch (error) {
      console.error('Error loading deleted events from storage:', error);
    }
    
    return events.filter(event => {
      // Filter out by ID
      if (recentlyDeletedEventIds.current.has(event.id)) {
        console.log(`Filtering deleted event from cache restoration - ID: ${event.id}`);
        return false;
      }
      
      // Filter out by UID
      if (event.uid && recentlyDeletedEventUids.current.has(event.uid)) {
        console.log(`Filtering deleted event from cache restoration - UID: ${event.uid}`);
        return false;
      }
      
      // Filter out by signature (calendarId + title + start date)
      if (event.calendarId && event.title && event.startDate) {
        const startTime = new Date(event.startDate).getTime();
        const signature = `${event.calendarId}-${event.title}-${startTime}`;
        if (recentlyDeletedEventSignatures.current.has(signature)) {
          console.log(`Filtering deleted event from cache restoration - Signature: ${signature}`);
          return false;
        }
        
        // Also check cross-calendar signature
        const crossCalendarSignature = `${event.title}-${startTime}`;
        if (recentlyDeletedEventSignatures.current.has(crossCalendarSignature)) {
          console.log(`Filtering deleted event from cache restoration - Cross-Calendar Signature: ${crossCalendarSignature}`);
          return false;
        }
      }
      
      // Legacy check for older session storage format
      try {
        const deletedEventsKey = 'recently_deleted_events';
        const sessionDeletedEvents = JSON.parse(sessionStorage.getItem(deletedEventsKey) || '[]');
        
        const isInDeletedList = sessionDeletedEvents.some(
          (deleted: any) => {
            if (deleted.id === event.id) return true;
            if (deleted.uid && event.uid && deleted.uid === event.uid) return true;
            if (deleted.signature && event.title && event.startDate && 
                deleted.signature === `${event.title}_${new Date(event.startDate).toISOString()}`) {
              return true;
            }
            return false;
          }
        );
        
        if (isInDeletedList) {
          console.log(`Filtering deleted event from cache restoration - Found in legacy session storage: ${event.id}`);
          return false;
        }
      } catch (e) {
        // Ignore session storage errors
      }
      
      // Advanced check with detailed deletion records
      try {
        const deletedDetailsJson = sessionStorage.getItem('deletedEventDetails') || '[]';
        const deletedDetails = JSON.parse(deletedDetailsJson);
        
        if (deletedDetails.length > 0) {
          // Check for ID match
          if (deletedDetails.some((d: any) => d.id === event.id)) {
            console.log(`Filtering deleted event from cache restoration - Found in detailed storage by ID: ${event.id}`);
            return false;
          }
          
          // Check for UID match if available
          if (event.uid && deletedDetails.some((d: any) => d.uid === event.uid)) {
            console.log(`Filtering deleted event from cache restoration - Found in detailed storage by UID: ${event.uid}`);
            return false;
          }
          
          // Check for signature matches
          if (event.title && event.startDate && event.calendarId) {
            const startTime = new Date(event.startDate).getTime();
            const eventSignature = `${event.calendarId}-${event.title}-${startTime}`;
            const eventCrossCalSignature = `${event.title}-${startTime}`;
            
            // Check all detailed records for matching signatures
            const matchesSignature = deletedDetails.some((d: any) => {
              // Check main signature
              if (d.signatures?.main === eventSignature) return true;
              if (d.signatures?.crossCal === eventCrossCalSignature) return true;
              
              // Also check basic matching if title and start time match
              if (d.title === event.title && 
                  d.startDate && 
                  Math.abs(new Date(d.startDate).getTime() - startTime) < 1000) {
                return true;
              }
              
              return false;
            });
            
            if (matchesSignature) {
              console.log(`Filtering deleted event from cache restoration - Found in detailed storage by signature match`);
              return false;
            }
          }
        }
      } catch (error) {
        console.error('Error checking detailed deletion records:', error);
      }
      
      return true; // Not deleted, keep this event
    });
  }, []);

  // Advanced restoration function that handles multiple cache scenarios
  const restoreEventsIfNeeded = useCallback(() => {
    try {
      const currentEvents = localQueryClient.getQueryData<Event[]>(['/api/events']);
      
      // Scenario 1: Events disappeared completely
      if (!currentEvents || currentEvents.length === 0) {
        if (eventsCache.current && eventsCache.current.length > 0) {
          // CRITICAL FIX: Filter out deleted events from cache before restoration
          const filteredCache = filterDeletedEventsFromCache([...eventsCache.current]);
          
          console.log(`Restoring ${filteredCache.length} events from main cache (complete disappearance)`);
          // Make a deep copy to avoid reference issues
          const cacheSnapshot = JSON.parse(JSON.stringify(filteredCache));
          localQueryClient.setQueryData(['/api/events'], cacheSnapshot);
          return; // Restoration complete
        }
      } 
      // Scenario 2: Significant event loss (more than just a new event being processed)
      else if (currentEvents.length < lastEventCount.current - 1) {
        console.log(`Detected significant event loss: ${currentEvents.length} vs ${lastEventCount.current} previously`);
        if (eventsCache.current && eventsCache.current.length > lastEventCount.current - 1) {
          // CRITICAL FIX: Filter out deleted events from cache before restoration
          const filteredCache = filterDeletedEventsFromCache([...eventsCache.current]);
          
          console.log(`Restoring ${filteredCache.length} events from main cache (significant loss)`);
          const cacheSnapshot = JSON.parse(JSON.stringify(filteredCache));
          localQueryClient.setQueryData(['/api/events'], cacheSnapshot);
          return; // Restoration complete
        }
      }
      // Scenario 3: New events disappeared (common during sync)
      else if (newEventsCache.current.length > 0) {
        // Check if any of our new events are missing from current events
        const missingNewEvents = newEventsCache.current.filter(cachedEvent => {
          // Check by ID first (if it's a real ID)
          if (typeof cachedEvent.id === 'number') {
            return !currentEvents.some(e => e.id === cachedEvent.id);
          }
          // For temp IDs, check by uid
          else if (cachedEvent.uid) {
            return !currentEvents.some(e => e.uid === cachedEvent.uid);
          }
          // If no way to match, consider it missing
          return true;
        });
        
        if (missingNewEvents.length > 0) {
          console.log(`Restoring ${missingNewEvents.length} missing new events from dedicated cache`);
          // Add missing events to current events
          const combinedEvents = [...currentEvents, ...missingNewEvents];
          localQueryClient.setQueryData(['/api/events'], combinedEvents);
        }
      }
    } catch (error) {
      console.error("Error restoring events from cache:", error);
      // Prevent the error from bubbling up
    }
  }, [localQueryClient]);
  
  // Get calendar IDs that are enabled (from regular calendars)
  const enabledUserCalendarIds = calendars
    .filter(calendar => calendar.enabled)
    .map(calendar => calendar.id);
    
  // Get calendar IDs that are enabled (from shared calendars)
  const enabledSharedCalendarIds = sharedCalendars
    .filter(calendar => calendar.enabled)
    .map(calendar => calendar.id);
    
  // Combine all enabled calendar IDs
  const enabledCalendarIds = [...enabledUserCalendarIds, ...enabledSharedCalendarIds];
  
  // Setup events query key with filtering parameters
  const eventsQueryKey = ['/api/events', enabledCalendarIds, startDate?.toISOString(), endDate?.toISOString()];
  
  // Load events for all calendars with date range filtering in a single API call
  const eventsQueries = useQuery<Event[]>({
    queryKey: eventsQueryKey,
    enabled: enabledCalendarIds.length > 0,
    queryFn: getQueryFn({ on401: "continueWithEmpty" }), // Use continueWithEmpty to handle user session expiry gracefully
    // Critical: Use stale time to prevent immediate refetching
    staleTime: 1000, // Short stale time to reduce refetches during sync operations
    // Don't trash data if query fails
    retry: 3,
    retryDelay: 500,
    // Use eventsCache as placeholder for guaranteed continuity
    placeholderData: () => {
      return eventsCache.current || [];
    },
    // In TanStack Query v5, use gcTime instead of keepPreviousData
    gcTime: 5 * 60 * 1000, // Keep data in cache for 5 minutes
    // When new data arrives, update our cache
    onSuccess: (data) => {
      if (Array.isArray(data) && data.length > 0) {
        console.log(`📸 Updating events cache with ${data.length} events from successful query`);
        // Update our local cache reference
        eventsCache.current = [...data];
      }
    },
    // If query fails, log error (local cache will be used automatically)
    onError: (error) => {
      console.log(`🚨 Query error, using local cache instead:`, error);
    }
  });
  
  // Setup effect to preserve and restore events during state transitions
  useEffect(() => {
    // Preserve events on mount
    preserveEventsCache();
    
    // Set up a more aggressive interval to check and restore events if they disappear
    // Run more frequently to catch any flickers immediately
    const checkInterval = setInterval(() => {
      restoreEventsIfNeeded();
    }, 100); // Check every 100ms for faster response
    
    // Clean up interval on unmount
    return () => clearInterval(checkInterval);
  }, [preserveEventsCache, restoreEventsIfNeeded]);
  
  // Add extra check when eventsQueries.data changes
  useEffect(() => {
    // Type guard function to check if data has events
    const hasEvents = (data: Event[] | undefined): data is Event[] => {
      return !!data && Array.isArray(data) && data.length > 0;
    };
    
    if (!hasEvents(eventsQueries.data)) {
      // Data went missing, try to restore from cache
      restoreEventsIfNeeded();
    } else {
      // New data arrived, update our cache
      preserveEventsCache();
    }
  }, [eventsQueries.data, preserveEventsCache, restoreEventsIfNeeded]);
  
  // Filter events client-side to ensure we only show events from enabled calendars
  // If data is empty but our cache has events, use the cache
  // Type guard function to check if data has events
  const hasEvents = (data: Event[] | undefined): data is Event[] => {
    return !!data && Array.isArray(data) && data.length > 0;
  };
  
  const eventsData: Event[] = hasEvents(eventsQueries.data)
    ? eventsQueries.data 
    : (eventsCache.current && Array.isArray(eventsCache.current) && eventsCache.current.length > 0 
        ? eventsCache.current 
        : []);
    
  // First deduplicate the events based on signature to prevent seeing the same event twice
  // This addresses the issue where events show up twice after deletion
  const deduplicatedEvents = [...new Map(eventsData.map(event => {
    // Create a signature for deduplication
    let signature = `${event.id}`;
    if (event.uid) signature += `-${event.uid}`;
    if (event.title && event.startDate && event.calendarId) {
      signature += `-${event.calendarId}-${event.title}-${new Date(event.startDate).getTime()}`;
    }
    return [signature, event];
  })).values()];
  
  // Log if we deduplicated any events
  if (deduplicatedEvents.length < eventsData.length) {
    console.log(`Deduplication: removed ${eventsData.length - deduplicatedEvents.length} duplicate events`);
  }
  
  const filteredEvents = deduplicatedEvents.filter((event: Event) => {
    // STEP 1: Quick lookup in localStorage map for maximum performance
    try {
      const lookupMapJson = localStorage.getItem('deletion_lookup_map');
      if (lookupMapJson) {
        const lookupMap = JSON.parse(lookupMapJson);
        
        // Check by ID (fastest check)
        if (lookupMap[`id:${event.id}`]) {
          console.log(`Filtering out event with ID ${event.id} - found in permanent deletion map`);
          return false;
        }
        
        // Check by UID if available
        if (event.uid && lookupMap[`uid:${event.uid}`]) {
          console.log(`Filtering out event with UID ${event.uid} - found in permanent deletion map`);
          return false;
        }
        
        // Check by signature if we have necessary data
        if (event.title && event.startDate) {
          // First with calendarId for exact match
          if (event.calendarId) {
            const startTime = new Date(event.startDate).getTime();
            const signature = `${event.calendarId}-${event.title}-${startTime}`;
            if (lookupMap[`sig:${signature}`]) {
              console.log(`Filtering out event - found in permanent deletion map by signature`);
              return false;
            }
          }
          
          // Then try cross-calendar signature for shared events
          const startTime = new Date(event.startDate).getTime();
          const crossCalSignature = `${event.title}-${startTime}`;
          if (lookupMap[`sig:${crossCalSignature}`]) {
            console.log(`Filtering out event - found in permanent deletion map by cross-calendar signature`);
            return false;
          }
        }
      }
    } catch (e) {
      // Silent fail - we'll fall back to other checks
    }
    
    // STEP 2: Check in-memory tracking (faster than storage checks)
    // Check for deleted ID
    if (recentlyDeletedEventIds.current.has(event.id)) {
      console.log(`Filtering out event with ID ${event.id} - found in memory deletion tracker`);
      return false;
    }
    
    // Check for deleted UID
    if (event.uid && recentlyDeletedEventUids.current.has(event.uid)) {
      console.log(`Filtering out event with UID ${event.uid} - found in memory deletion tracker`);
      return false;
    }
    
    // Check for deleted signature
    if (event.calendarId && event.title && event.startDate) {
      const startTime = new Date(event.startDate).getTime();
      
      // Check calendar-specific signature
      const signature = `${event.calendarId}-${event.title}-${startTime}`;
      if (recentlyDeletedEventSignatures.current.has(signature)) {
        console.log(`Filtering out event - found in memory deletion tracker by signature`);
        return false;
      }
      
      // Check cross-calendar signature
      const crossCalSignature = `${event.title}-${startTime}`;
      if (recentlyDeletedEventSignatures.current.has(crossCalSignature)) {
        console.log(`Filtering out event - found in memory deletion tracker by cross-calendar signature`);
        return false;
      }
    }
    
    // STEP 3: Check sessionStorage for full deletion records
    try {
      const deletedDetailsJson = sessionStorage.getItem('deletedEventDetails') || '[]';
      const deletedDetails = JSON.parse(deletedDetailsJson);
      
      if (deletedDetails.length > 0) {
        // Check if event matches any deletion record
        const isDeleted = deletedDetails.some((record: any) => {
          // Check by ID
          if (record.id === event.id) return true;
          
          // Check by UID
          if (record.uid && event.uid && record.uid === event.uid) return true;
          
          // Check by signature
          if (record.signatures && event.title && event.startDate) {
            const startTime = new Date(event.startDate).getTime();
            
            // Check with calendarId if available
            if (event.calendarId) {
              const signature = `${event.calendarId}-${event.title}-${startTime}`;
              if (record.signatures.main === signature) return true;
            }
            
            // Check cross-calendar signature
            const crossCalSignature = `${event.title}-${startTime}`;
            if (record.signatures.crossCal === crossCalSignature) return true;
            
            // Check by time proximity with same title (within 1 second)
            if (record.title === event.title && record.startDate) {
              if (Math.abs(new Date(record.startDate).getTime() - startTime) < 1000) {
                return true;
              }
            }
          }
          
          return false;
        });
        
        if (isDeleted) {
          console.log(`Filtering out event ${event.id} - found in sessionStorage deletion records`);
          return false;
        }
      }
    } catch (e) {
      // Silent fail - move to next check
    }
    
    // STEP 4: Legacy check for older session storage format
    try {
      const deletedEventsKey = 'recently_deleted_events';
      const sessionDeletedEvents = JSON.parse(sessionStorage.getItem(deletedEventsKey) || '[]');
      
      const isInDeletedList = sessionDeletedEvents.some(
        (deleted: any) => {
          // Direct ID match
          if (deleted.id === event.id) return true;
          
          // UID match if available
          if (deleted.uid && event.uid && deleted.uid === event.uid) return true;
          
          // Title + start date signature match
          if (deleted.signature && 
              event.title && event.startDate && 
              deleted.signature === `${event.title}_${new Date(event.startDate).toISOString()}`) {
            return true;
          }
          
          return false;
        }
      );
      
      if (isInDeletedList) {
        console.log(`Filtering out event ${event.id} - found in legacy session storage format`);
        return false;
      }
    } catch (e) {
      // Ignore any session storage errors
    }
    
    // STEP 5: Final detailed comparison with localStorage permanent records
    try {
      const permanentDeletedJson = localStorage.getItem('permanent_deleted_events');
      if (permanentDeletedJson) {
        const permanentDeleted = JSON.parse(permanentDeletedJson);
        
        // Do a detailed object comparison for each deletion record
        const isPermanentlyDeleted = permanentDeleted.some((record: any) => {
          // Time window for fuzzy matching (within 2 minutes)
          const TIME_WINDOW = 2 * 60 * 1000;
          
          // Match by signature if both have necessary properties
          if (record.title && record.startDate && event.title && event.startDate) {
            const recordStartTime = new Date(record.startDate).getTime();
            const eventStartTime = new Date(event.startDate).getTime();
            
            // If titles match and start times are close, consider it a match
            if (record.title === event.title && 
                Math.abs(recordStartTime - eventStartTime) < TIME_WINDOW) {
              return true;
            }
          }
          
          return false;
        });
        
        if (isPermanentlyDeleted) {
          console.log(`Filtering out event ${event.id} - found by detailed matching in permanent deletion records`);
          return false;
        }
      }
    } catch (e) {
      // Silently continue if localStorage check fails
    }
    
    // Standard filter - only keep events from enabled calendars
    return enabledCalendarIds.includes(event.calendarId);
  });

  type CreateMutationContext = {
    tempEvent?: Event;
    previousEvents?: Event[];
    allQueryKeys?: QueryKey[];
  };

  const createEventMutation = useMutation<Event, Error, Partial<Event>, CreateMutationContext>({
    mutationFn: async (newEvent) => {
      // Short delay to ensure UI updates finish before server request
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Handle the rawData object that might contain attendees and other information from the advanced form
      // Make sure rawData is properly serialized if it's present
      if (newEvent.rawData && typeof newEvent.rawData === 'object') {
        newEvent = {
          ...newEvent,
          rawData: typeof newEvent.rawData === 'string' ? newEvent.rawData : JSON.stringify(newEvent.rawData)
        };
      }
      
      // Make sure attendees are properly serialized if they're present
      if (newEvent.attendees && typeof newEvent.attendees === 'object' && !Array.isArray(newEvent.attendees)) {
        newEvent = {
          ...newEvent,
          attendees: JSON.stringify(newEvent.attendees)
        };
      } else if (newEvent.attendees && Array.isArray(newEvent.attendees)) {
        newEvent = {
          ...newEvent,
          attendees: JSON.stringify(newEvent.attendees)
        };
      }
      
      // Make sure resources are properly serialized if they're present
      if (newEvent.resources && typeof newEvent.resources === 'object' && !Array.isArray(newEvent.resources)) {
        newEvent = {
          ...newEvent,
          resources: JSON.stringify(newEvent.resources)
        };
      } else if (newEvent.resources && Array.isArray(newEvent.resources)) {
        newEvent = {
          ...newEvent,
          resources: JSON.stringify(newEvent.resources)
        };
      }
      
      // Make sure recurrenceRule is properly serialized if it's present
      if (newEvent.recurrenceRule && typeof newEvent.recurrenceRule === 'object') {
        newEvent = {
          ...newEvent,
          recurrenceRule: JSON.stringify(newEvent.recurrenceRule)
        };
      }
      
      console.log("Creating event with data:", newEvent);
      const res = await apiRequest('POST', '/api/events', newEvent);
      return res.json();
    },
    onMutate: async (newEventData) => {
      console.log(`Starting optimistic create for event ${newEventData.title}`);
      
      // Cancel all outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries();
      
      // Store the current state for possible rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const allQueryKeys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
      
      // Create a realistic-looking temporary event with all required fields
      const tempId = -Math.floor(Math.random() * 1000000); // Use negative ID to avoid conflicts
      const now = new Date();
      const tempEvent: Event = {
        ...newEventData as any, // Type assertion to match required fields
        id: tempId,
        uid: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        createdAt: now,
        updatedAt: now,
        rawData: null,
        url: null,
        etag: null,
        recurrenceRule: null,
        syncStatus: 'syncing', // Show as syncing initially
        syncError: null,
        lastSyncAttempt: now
      };
      
      console.log(`Creating optimistic event with temp ID: ${tempId}`, tempEvent);
      
      // 1. Update the main events cache immediately
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        return [...oldEvents, tempEvent];
      });
      
      // 2. Update any date-filtered event caches
      allQueryKeys.forEach((key: QueryKey) => {
        if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
          // Check if this should include the event based on date filtering
          // For now, add to all query caches to ensure visibility
          queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
            return [...oldEvents, tempEvent];
          });
        }
      });
      
      // 3. Also update the calendar-specific cache
      queryClient.setQueryData<Event[]>(
        ['/api/calendars', tempEvent.calendarId, 'events'], 
        (oldEvents = []) => [...oldEvents, tempEvent]
      );
      
      return { tempEvent, previousEvents, allQueryKeys };
    },
    onSuccess: (serverEvent, newEventData, context) => {
      console.log(`Event created successfully on server:`, serverEvent);
      
      // Create a function to update all caches consistently that can be called multiple times
      const updateAllEventCaches = () => {
        console.log(`Updating all caches for new event ${serverEvent.title} (ID: ${serverEvent.id})`);
        
        // 1. Update main events cache
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          if (!oldEvents) return [serverEvent];
          
          // First ensure we don't add duplicate events
          const eventsWithoutDuplicates = oldEvents.filter(e => 
            // Keep if it's the temp event we're replacing
            (context?.tempEvent && e.id === context.tempEvent.id) ||
            // Or it's not a duplicate by UID or ID
            (e.id !== serverEvent.id && (!e.uid || e.uid !== serverEvent.uid))
          );
          
          // Then update the temporary event or add the new event
          if (context?.tempEvent) {
            return eventsWithoutDuplicates.map(e => 
              e.id === context.tempEvent?.id ? serverEvent : e
            );
          } else {
            return [...eventsWithoutDuplicates, serverEvent];
          }
        });
        
        // 2. Update calendar-specific cache
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', serverEvent.calendarId, 'events'], 
          (oldEvents = []) => {
            if (!oldEvents) return [serverEvent];
            
            // Apply the same deduplication logic
            const eventsWithoutDuplicates = oldEvents.filter(e => 
              // Keep if it's the temp event we're replacing
              (context?.tempEvent && e.id === context.tempEvent.id) ||
              // Or it's not a duplicate by UID or ID
              (e.id !== serverEvent.id && (!e.uid || e.uid !== serverEvent.uid))
            );
            
            // Then update the temporary event or add the new event
            if (context?.tempEvent) {
              return eventsWithoutDuplicates.map(e => 
                e.id === context.tempEvent?.id ? serverEvent : e
              );
            } else {
              return [...eventsWithoutDuplicates, serverEvent];
            }
          }
        );
        
        // 3. Update any date-filtered caches
        if (context?.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
                if (!oldEvents) return [serverEvent];
                
                // Apply the same deduplication logic
                const eventsWithoutDuplicates = oldEvents.filter(e => 
                  // Keep if it's the temp event we're replacing
                  (context?.tempEvent && e.id === context.tempEvent.id) ||
                  // Or it's not a duplicate by UID or ID
                  (e.id !== serverEvent.id && (!e.uid || e.uid !== serverEvent.uid))
                );
                
                // Then update the temporary event or add the new event
                if (context?.tempEvent) {
                  return eventsWithoutDuplicates.map(e => 
                    e.id === context.tempEvent?.id ? serverEvent : e
                  );
                } else {
                  return [...eventsWithoutDuplicates, serverEvent];
                }
              });
            }
          });
        }
      };
      
      // Update all caches immediately
      updateAllEventCaches();
      
      // Show success toast
      toast({
        title: "Event Created",
        description: "New event has been created successfully."
      });
      
      // We'll do a server sync in a separate async function
      const syncEventWithServer = async () => {
        try {
          // Update caches again before sync to ensure UI consistency
          updateAllEventCaches();
          
          // Store the server event in a ref to ensure it persists through sync
          const eventRef = serverEvent;

          // Create a guard function that ensures the event stays in cache
          const guardEventInCache = () => {
            // Check if event is still in cache
            const mainCache = queryClient.getQueryData<Event[]>(['/api/events']) || [];
            const calendarCache = queryClient.getQueryData<Event[]>(['/api/calendars', eventRef.calendarId, 'events']) || [];
            
            // If event is missing from any cache, restore it
            const isInMainCache = mainCache.some(e => e.id === eventRef.id || e.uid === eventRef.uid);
            const isInCalendarCache = calendarCache.some(e => e.id === eventRef.id || e.uid === eventRef.uid);
            
            console.log(`Guarding event ${eventRef.title} (${eventRef.id}): Main cache: ${isInMainCache}, Calendar cache: ${isInCalendarCache}`);
            
            if (!isInMainCache) {
              console.log(`Restoring event ${eventRef.title} to main cache`);
              queryClient.setQueryData<Event[]>(['/api/events'], [...mainCache, eventRef]);
            }
            
            if (!isInCalendarCache) {
              console.log(`Restoring event ${eventRef.title} to calendar cache`);
              queryClient.setQueryData<Event[]>(['/api/calendars', eventRef.calendarId, 'events'], [...calendarCache, eventRef]);
            }
          };
          
          // Set up a recurring guard that keeps the event in cache during sync
          const guardIntervalId = setInterval(guardEventInCache, 100);
          
          // Trigger an immediate sync with the CalDAV server
          console.log('Triggering immediate sync for newly created event');
          const syncResponse = await apiRequest('POST', '/api/sync/now', {
            forceRefresh: true,
            calendarId: serverEvent.calendarId,
            preserveLocalEvents: true // Add parameter to prevent event deletion during sync
          });
          
          const syncResult = await syncResponse.json();
          
          // Update caches again after sync to ensure event remains in UI
          updateAllEventCaches();
          guardEventInCache();
          
          // Clear the guard interval after sync completes
          clearInterval(guardIntervalId);
          
          // Check if sync was successful based on the response format
          if (syncResponse.ok && syncResult.synced === true) {
            console.log('Immediate sync completed successfully after creation:', syncResult);
            
            // Update caches once more to prevent event from disappearing
            updateAllEventCaches();
            guardEventInCache();
            
            // Also schedule a delayed cache refresh to handle any edge cases
            setTimeout(() => {
              updateAllEventCaches();
              guardEventInCache();
              
              // After successful sync, do a final refresh of the events list after a short delay
              setTimeout(() => {
                // Double ensure our event is still in the cache
                updateAllEventCaches();
                guardEventInCache();
                
                // Now we can safely invalidate queries
                queryClient.invalidateQueries({ queryKey: ['/api/events'] });
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/calendars', serverEvent.calendarId, 'events'] 
                });
              }, 500);
            }, 200);
          } else {
            // Not a critical error - we handle 202 status codes here which mean
            // the event was created locally but not synced to the server
            console.log('Sync status after creation:', syncResult);
            
            // Make sure event is still in cache even if sync didn't complete
            updateAllEventCaches();
            
            // We provide a more specific message based on the response type
            if (syncResult.requiresAuth) {
              toast({
                title: "Event Created Locally",
                description: "Event created in your local calendar. Sign in to sync with server.",
                variant: "default"
              });
            } else if (syncResult.requiresConnection) {
              toast({
                title: "Event Created Locally",
                description: "Event created in your local calendar. Configure a server connection to sync.",
                variant: "default"
              });
            } else {
              toast({
                title: "Event Created Locally",
                description: "Event created in your local calendar, but sync with server failed. Will retry automatically.",
                variant: "default"
              });
            }
            
            // Make sure event is still in cache
            setTimeout(() => updateAllEventCaches(), 200);
          }
        } catch (error) {
          console.error('Error during immediate sync:', error);
          // Ensure event is still in cache even if sync failed
          updateAllEventCaches();
          
          // Still show the event locally even if sync failed
          toast({
            title: "Event Created",
            description: "Event created locally, but sync with server failed. Will retry automatically.",
            variant: "default"
          });
          
          // Make sure event is still in cache
          setTimeout(() => updateAllEventCaches(), 200);
        }
      };
      
      // Execute sync after a short delay to ensure UI updates first
      setTimeout(syncEventWithServer, 50);
    },
    onError: (error, newEventData, context) => {
      console.error("Error creating event:", error);
      
      // Remove the optimistic event immediately
      if (context?.tempEvent) {
        // 1. Update main events cache
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          return oldEvents.filter(e => e.id !== context.tempEvent?.id);
        });
        
        // 2. Update any date-filtered caches
        if (context.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
                return oldEvents.filter(e => e.id !== context.tempEvent?.id);
              });
            }
          });
        }
        
        // 3. Update calendar-specific cache
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', context.tempEvent.calendarId, 'events'], 
          (oldEvents = []) => {
            return oldEvents.filter(e => e.id !== context.tempEvent?.id);
          }
        );
      }
      
      // Show error toast
      toast({
        title: "Failed to Create Event",
        description: error.message || "An error occurred while creating the event.",
        variant: "destructive"
      });
      
      // Refetch to ensure data consistency
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }, 1000);
    }
  });

  // Define response type for update operation
  type UpdateEventResponse = {
    success: boolean;
    event: Event;
    hasAttendees: boolean;
  };

  type UpdateMutationContext = {
    previousEvents?: Event[];
    eventToUpdate?: Event;
    updatedEvent?: Partial<Event> & { id: number };
    allQueryKeys?: QueryKey[];
  };

  const updateEventMutation = useMutation<
    UpdateEventResponse, 
    Error, 
    { id: number, data: Partial<Event> }, 
    UpdateMutationContext
  >({
    mutationFn: async ({ id, data }) => {
      // Short delay to ensure UI updates finish before server request
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Handle the rawData object that might contain attendees and other information from the advanced form
      // Make sure rawData is properly serialized if it's present
      if (data.rawData && typeof data.rawData === 'object') {
        data = {
          ...data,
          rawData: typeof data.rawData === 'string' ? data.rawData : JSON.stringify(data.rawData)
        };
      }
      
      // Make sure attendees are properly serialized if they're present
      if (data.attendees && typeof data.attendees === 'object' && !Array.isArray(data.attendees)) {
        data = {
          ...data,
          attendees: JSON.stringify(data.attendees)
        };
      } else if (data.attendees && Array.isArray(data.attendees)) {
        data = {
          ...data,
          attendees: JSON.stringify(data.attendees)
        };
      }
      
      // Make sure recurrenceRule is properly serialized if it's present
      if (data.recurrenceRule && typeof data.recurrenceRule === 'object') {
        data = {
          ...data,
          recurrenceRule: JSON.stringify(data.recurrenceRule)
        };
      }
      
      // Make sure resources are properly serialized if they're present
      if (data.resources && typeof data.resources === 'object' && !Array.isArray(data.resources)) {
        data = {
          ...data,
          resources: JSON.stringify(data.resources)
        };
      } else if (data.resources && Array.isArray(data.resources)) {
        data = {
          ...data,
          resources: JSON.stringify(data.resources)
        };
      }
      
      try {
        const res = await apiRequest('PUT', `/api/events/${id}`, data);
        
        // Check if the response is JSON before parsing
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const textContent = await res.text();
          console.error('Non-JSON response from server:', textContent);
          throw new Error('Server returned an invalid response format. Please try again.');
        }
        
        return await res.json();
      } catch (error) {
        console.error('Error in event update request:', error);
        throw error;
      }
    },
    onMutate: async ({ id, data }) => {
      console.log(`Starting optimistic update for event ${id}`);
      
      // Mark the event as syncing in the UI before server response
      const updatedDataWithSyncStatus = {
        ...data,
        syncStatus: 'syncing'
      };
      
      // Fetch the event directly if it's not in the cache
      const fetchEventIfNeeded = async () => {
        try {
          const res = await fetch(`/api/events/${id}`, { credentials: 'include' });
          if (res.ok) {
            return await res.json();
          }
        } catch (error) {
          console.error(`Error fetching event ${id}:`, error);
        }
        return null;
      };
      
      // Cancel all outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries();
      
      // Store the current state for possible rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']) || [];
      const allQueryKeys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
      
      // Find the event in the cache
      let eventToUpdate = previousEvents.find(e => e.id === id);
      
      // If not in the cache, try to fetch it directly
      if (!eventToUpdate) {
        console.warn(`Event with id ${id} not found in cache for update, fetching directly...`);
        const fetchedEvent = await fetchEventIfNeeded();
        
        if (fetchedEvent) {
          eventToUpdate = fetchedEvent;
          // Add to the cache
          queryClient.setQueryData<Event[]>(['/api/events'], 
            (oldEvents = []) => [...oldEvents, fetchedEvent]
          );
        } else {
          console.error(`Could not find or fetch event with id ${id} for update`);
          // Return context without attempting optimistic update
          return { previousEvents, allQueryKeys };
        }
      }
      
      // Make sure eventToUpdate is not undefined
      if (!eventToUpdate) {
        console.error(`Event with id ${id} still not found after fetching. Cannot update.`);
        return { previousEvents, allQueryKeys };
      }

      // Create an updated version of the event with proper typing
      const updatedEvent: Event = { 
        // First spread the original event to get all fields
        ...eventToUpdate, 
        // Then apply the partial updates
        ...data,
        // Finally ensure critical fields are always present
        id: id,
        uid: eventToUpdate.uid,
        calendarId: eventToUpdate.calendarId,
        title: data.title || eventToUpdate.title,
        startDate: data.startDate || eventToUpdate.startDate,
        endDate: data.endDate || eventToUpdate.endDate,
        // Set sync status to 'syncing' when updating to show immediate feedback
        syncStatus: data.syncStatus || 'syncing',
        syncError: data.syncError || null,
        lastSyncAttempt: data.lastSyncAttempt || new Date()
      };
      
      console.log(`Optimistically updating event ${id} in UI`, updatedEvent);
      
      // 1. Update the main events cache immediately
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        // If the event doesn't exist in the cache, add it
        if (!oldEvents.some(e => e.id === id)) {
          return [...oldEvents, updatedEvent];
        }
        // Otherwise update it
        return oldEvents.map(e => e.id === id ? updatedEvent : e);
      });
      
      // 2. Update any date-filtered event caches
      allQueryKeys.forEach((key: QueryKey) => {
        if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
          queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
            // If the event doesn't exist in this date-filtered cache, we shouldn't add it
            // as it might not belong in this date range
            const hasEvent = oldEvents.some(e => e.id === id);
            if (!hasEvent) return oldEvents;
            
            return oldEvents.map(e => e.id === id ? updatedEvent : e);
          });
        }
      });
      
      // 3. Also update the calendar-specific cache
      if (eventToUpdate.calendarId) {
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', eventToUpdate.calendarId, 'events'], 
          (oldEvents = []) => {
            // If the event doesn't exist in this calendar cache, add it
            if (!oldEvents.some(e => e.id === id)) {
              return [...oldEvents, updatedEvent];
            }
            return oldEvents.map(e => e.id === id ? updatedEvent : e);
          }
        );
      }
      
      return { previousEvents, eventToUpdate, updatedEvent, allQueryKeys };
    },
    onSuccess: (response, variables, context) => {
      // In our updated PUT endpoint, the response includes event and hasAttendees properties
      const serverEvent = response.event || response;
      const hasAttendees = response.hasAttendees || false;
      
      console.log(`Event updated successfully on server:`, serverEvent, 'Has attendees:', hasAttendees);
      
      // Show success toast
      toast({
        title: "Event Updated",
        description: hasAttendees 
          ? "Event updated. You may now preview and send invitation emails." 
          : "Event has been updated successfully."
      });
      
      // Extract the ID that was used in the update request
      const requestId = variables.id;
      
      // Create a function to update all caches consistently that can be called multiple times
      const updateAllEventCaches = () => {
        console.log(`Updating all caches for event ${serverEvent.title} (ID: ${serverEvent.id})`);
        
        // Handle main events cache first
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          if (!oldEvents) return [serverEvent];
          
          // First remove any exact duplicates with same UID and different ID
          // This is critical for preventing duplicates after sync
          const eventsWithoutDuplicates = oldEvents.filter(e => 
            // Keep this event if:
            e.id === requestId || // It's the one we're updating
            e.id === serverEvent.id || // It has the same ID as our server response
            !e.uid || // It doesn't have a UID (keep it)
            e.uid !== serverEvent.uid // It has a different UID (not a duplicate)
          );
          
          // Then update the event that matches our request ID
          return eventsWithoutDuplicates.map(e => 
            (e.id === requestId || e.id === serverEvent.id) ? serverEvent : e
          );
        });
        
        // Update the calendar-specific cache too
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', serverEvent.calendarId, 'events'], 
          (oldEvents = []) => {
            if (!oldEvents) return [serverEvent];
            
            // Apply the same deduplication logic
            const eventsWithoutDuplicates = oldEvents.filter(e => 
              e.id === requestId || 
              e.id === serverEvent.id || 
              !e.uid || 
              e.uid !== serverEvent.uid
            );
            
            return eventsWithoutDuplicates.map(e => 
              (e.id === requestId || e.id === serverEvent.id) ? serverEvent : e
            );
          }
        );
        
        // Update any date-filtered caches or other event caches
        if (context?.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
                if (!oldEvents) return [serverEvent];
                
                // Apply the same deduplication logic
                const eventsWithoutDuplicates = oldEvents.filter(e => 
                  e.id === requestId || 
                  e.id === serverEvent.id || 
                  !e.uid || 
                  e.uid !== serverEvent.uid
                );
                
                return eventsWithoutDuplicates.map(e => 
                  (e.id === requestId || e.id === serverEvent.id) ? serverEvent : e
                );
              });
            }
          });
        }
      };
      
      // Update all caches immediately for instant UI refresh
      updateAllEventCaches();
      
      // If the event has a temporary ID (negative), we need to invalidate the queries to refresh
      if (requestId < 0) {
        console.log(`Invalidating queries due to temporary ID conversion: ${requestId} -> ${serverEvent.id}`);
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }
      
      // Trigger an immediate sync with the server and schedule a final refresh
      // We do this in a timeout to ensure the UI updates first
      setTimeout(() => {
        // Sync the event with the CalDAV server
        const syncEvent = async () => {
          try {
            // Update caches again right before sync to ensure consistency
            updateAllEventCaches();
            
            // Trigger an immediate sync with the CalDAV server
            console.log('Triggering immediate sync for updated event');
            const syncResponse = await apiRequest('POST', '/api/sync/now', {
              forceRefresh: true,
              calendarId: serverEvent.calendarId,
              preserveLocalEvents: true // Add parameter to prevent event deletion during sync
            });
            
            // Check if the response is JSON before parsing
            const contentType = syncResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              const textContent = await syncResponse.text();
              console.error('Non-JSON response from sync endpoint:', textContent);
              throw new Error('Sync server returned an invalid response format.');
            }
            
            const syncResult = await syncResponse.json();
            
            // Check if sync was successful based on the response format
            if (syncResponse.ok && syncResult.synced === true) {
              console.log('Immediate sync completed successfully after update:', syncResult);
              
              // Update all caches again after successful sync
              updateAllEventCaches();
              
              // Then do a final full refresh to ensure consistency with server
              // But delay it slightly to avoid UI flicker
              setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['/api/events'] });
              }, 500);
            } else {
              // Not a critical error - we handle 202 status codes here which mean
              // the event was updated locally but not synced to the server
              console.log('Sync status after update:', syncResult);
              
              // We provide a more specific message based on the response type
              if (syncResult.requiresAuth) {
                toast({
                  title: "Event Updated Locally",
                  description: "Event updated in your local calendar. Sign in to sync with server.",
                  variant: "default"
                });
              } else if (syncResult.requiresConnection) {
                toast({
                  title: "Event Updated Locally",
                  description: "Event updated in your local calendar. Configure a server connection to sync.",
                  variant: "default"
                });
              } else {
                toast({
                  title: "Event Updated Locally",
                  description: "Event updated in your local calendar, but sync with server failed. Will retry automatically.",
                  variant: "default"
                });
              }
            }
          } catch (error) {
            console.error('Error during immediate sync after update:', error);
            // Still show the event locally even if sync failed
            toast({
              title: "Event Updated",
              description: "Event updated locally, but sync with server failed. Will retry automatically.",
              variant: "default"
            });
          }
        };
        
        // Execute the sync operation
        syncEvent();
      }, 50);
    },
    onError: (error: Error, variables: { id: number, data: Partial<Event> }, context: UpdateMutationContext | undefined) => {
      console.error(`Error updating event ${variables.id}:`, error);
      
      // Roll back to the previous state if we have it
      if (context?.previousEvents) {
        // Restore the main cache
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
        
        // Also restore any filtered query caches
        if (context.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData(key, context.previousEvents);
            }
          });
        }
        
        // Restore the calendar-specific cache if we know which calendar
        if (context.eventToUpdate) {
          const calendarEvents = context.previousEvents?.filter(
            (e: Event) => e.calendarId === context.eventToUpdate?.calendarId
          );
          if (calendarEvents) {
            queryClient.setQueryData(
              ['/api/calendars', context.eventToUpdate.calendarId, 'events'],
              calendarEvents
            );
          }
        }
      }
      
      // Show error toast
      toast({
        title: "Failed to Update Event",
        description: error.message || "An error occurred while updating the event.",
        variant: "destructive"
      });
      
      // Forcefully refetch immediately to ensure data consistency and fix any duplicates
      queryClient.invalidateQueries({ 
        queryKey: ['/api/events'],
        refetchType: 'all' // Force immediate refetch
      });
      
      // Also invalidate calendar-specific cache if we know which calendar
      if (context?.eventToUpdate) {
        queryClient.invalidateQueries({
          queryKey: ['/api/calendars', context.eventToUpdate.calendarId, 'events'],
          refetchType: 'all'
        });
      }
    }
  });

  type DeleteMutationContext = {
    previousEvents?: Event[];
    eventToDelete?: Event;
    event?: Event;  // Added for the cancel event mutation
    allQueryKeys?: QueryKey[];
  };

  type DeleteResponse = {
    success: boolean, 
    id: number, 
    message?: string,
    sync?: {
      attempted: boolean,
      succeeded: boolean,
      noConnection: boolean,
      error: string | null
    }
  };
  
  // Get our deleted events tracker
  const { trackDeletedEvent, cleanAllEventCaches } = useDeletedEventsTracker();
  
  // Simplified delete mutation that uses the CalDAV server as the source of truth
  const deleteEventMutation = useMutation<DeleteResponse, Error, number, DeleteMutationContext>({
    mutationFn: async (id: number) => {
      console.log(`Deleting event with ID ${id}`);
      try {
        const res = await apiRequest('DELETE', `/api/events/${id}`);
        
        // Check for 200 status with our new enhanced response format
        if (res.status === 200) {
          // Parse the JSON response to get the sync status details
          try {
            const data = await res.json();
            console.log(`Successfully deleted event with ID ${id}, response:`, data);
            return data; // This will include the sync metadata and status
          } catch (e) {
            console.warn("Could not parse JSON response from successful delete:", e);
            return { success: true, id };
          }
        }
        
        // Continue to handle legacy 204/404 status codes
        else if (res.status === 204 || res.status === 404) {
          console.log(`Successfully deleted event with ID ${id} (legacy status: ${res.status})`);
          return { success: true, id };
        }
        
        // For other status codes, try to get the error message
        let errorMessage = `Server returned unexpected status: ${res.status}`;
        try {
          const data = await res.json();
          if (data && data.message) {
            errorMessage = data.message;
          }
        } catch (e) {
          // If we can't parse JSON, use the default error message
          console.warn("Could not parse error response as JSON");
        }
        
        // Throw an error with the message so it's caught by the onError handler
        throw new Error(errorMessage);
      } catch (error) {
        console.error("Error in delete mutation:", error);
        // Re-throw for the onError handler
        throw error;
      }
    },
    // This happens BEFORE the server request, giving immediate UI feedback
    onMutate: async (id) => {
      console.log(`Starting simplified deletion for event ${id}`);
      
      // Prevent any background refetches from overwriting our UI update
      await queryClient.cancelQueries({ queryKey: ['/api/events'] });
      
      // Store the current state for possible rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const allQueryKeys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
      
      // Find the event in the cache to get its details before deleting
      const eventToDelete = previousEvents?.find(e => e.id === id);
      
      if (eventToDelete) {
        console.log(`Found event to delete: ${eventToDelete.title || 'Untitled'} (ID: ${id})`);
        
        // Track this event as deleted
        if (trackDeletedEvent) {
          trackDeletedEvent(eventToDelete);
        }
        
        // Simple optimistic update - just remove the event by ID
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => 
          oldEvents.filter(e => e.id !== id)
        );
        
        // AGGRESSIVE APPROACH: Direct DOM manipulation to remove event elements
        try {
          // Try to immediately remove this event element from the DOM by data attributes
          const eventEls = document.querySelectorAll(`[data-event-id="${id}"]`);
          if (eventEls.length > 0) {
            console.log(`👉 Hiding ${eventEls.length} DOM elements for event ${id}`);
            eventEls.forEach(el => {
              // Use CSS to hide immediately instead of removing from DOM
              (el as HTMLElement).style.display = 'none';
              (el as HTMLElement).style.opacity = '0';
              (el as HTMLElement).style.pointerEvents = 'none';
              el.setAttribute('data-deleted', 'true');
            });
          }
          
          // Also try by UID if available
          if (eventToDelete.uid) {
            const uidEls = document.querySelectorAll(`[data-event-uid="${eventToDelete.uid}"]`);
            if (uidEls.length > 0) {
              console.log(`👉 Hiding ${uidEls.length} DOM elements for event UID ${eventToDelete.uid}`);
              uidEls.forEach(el => {
                // Use CSS to hide immediately instead of removing from DOM
                (el as HTMLElement).style.display = 'none';
                (el as HTMLElement).style.opacity = '0';
                (el as HTMLElement).style.pointerEvents = 'none';
                el.setAttribute('data-deleted', 'true');
              });
            }
          }
          
          // Also try by signature (title + start time)
          if (eventToDelete.title && eventToDelete.startDate) {
            const signature = `${eventToDelete.title}-${new Date(eventToDelete.startDate).getTime()}`;
            const signatureEls = document.querySelectorAll(`[data-event-signature="${signature}"]`);
            if (signatureEls.length > 0) {
              console.log(`👉 Hiding ${signatureEls.length} DOM elements with event signature ${signature}`);
              signatureEls.forEach(el => {
                // Use CSS to hide immediately instead of removing from DOM
                (el as HTMLElement).style.display = 'none';
                (el as HTMLElement).style.opacity = '0';
                (el as HTMLElement).style.pointerEvents = 'none';
                el.setAttribute('data-deleted', 'true');
              });
            }
          }
        } catch (domError) {
          console.error('Error eagerly removing event from DOM:', domError);
        }
        
        // Store deleted event info in session storage immediately for better cross-component awareness
        try {
          const deletedEventsKey = 'recently_deleted_events';
          const sessionDeletedEvents = JSON.parse(sessionStorage.getItem(deletedEventsKey) || '[]');
          
          // Create a comprehensive deletion record with multiple signatures
          const eventInfo = {
            id: eventToDelete.id,
            uid: eventToDelete.uid,
            calendarId: eventToDelete.calendarId,
            title: eventToDelete.title,
            timestamp: new Date().toISOString(),
            signature: eventToDelete.title && eventToDelete.startDate ? 
              `${eventToDelete.title}_${new Date(eventToDelete.startDate).toISOString()}` : null,
            crossCalendarSignature: eventToDelete.title && eventToDelete.startDate ?
              `${eventToDelete.title}-${new Date(eventToDelete.startDate).getTime()}` : null
          };
          
          // Add to recently deleted events
          sessionDeletedEvents.push(eventInfo);
          
          // Keep last 20 deleted events
          if (sessionDeletedEvents.length > 20) {
            sessionDeletedEvents.shift();
          }
          
          // Save back to session storage
          sessionStorage.setItem(deletedEventsKey, JSON.stringify(sessionDeletedEvents));
          console.log(`Added event ID ${eventToDelete.id} to session storage deletion tracking`);
        } catch (e) {
          console.error('Error saving deleted event to session storage:', e);
        }
        
        // Find all duplicate events with same properties but different IDs
        // This handles the case where the same event appears twice with different IDs
        // We'll use multiple detection strategies to find all possible duplicates
        
        // Strategy 1: Find duplicates based on exact match of key properties
        const exactDuplicates = previousEvents?.filter(event => 
          event.id !== eventToDelete.id && // Not the same ID
          event.title === eventToDelete.title && // Same title
          event.calendarId === eventToDelete.calendarId && // Same calendar
          new Date(event.startDate).getTime() === new Date(eventToDelete.startDate).getTime() // Same start time
        ) || [];
        
        // Strategy 2: Find duplicates based on UID (which should be unique across calendars)
        const uidDuplicates = eventToDelete.uid ? 
          (previousEvents?.filter(event => 
            event.id !== eventToDelete.id && // Not the same ID
            event.uid === eventToDelete.uid // Same UID
          ) || []) : [];
        
        // Strategy 3: Find duplicates based on title and start time only (cross-calendar)
        const crossCalendarDuplicates = previousEvents?.filter(event => 
          event.id !== eventToDelete.id && // Not the same ID
          event.title === eventToDelete.title && // Same title
          event.calendarId !== eventToDelete.calendarId && // Different calendar
          new Date(event.startDate).getTime() === new Date(eventToDelete.startDate).getTime() // Same start time
        ) || [];
        
        // Strategy 4: Find duplicates with similar attributes but potentially different formatting
        const similarDuplicates = previousEvents?.filter(event => {
          // Skip if already identified as duplicate by other strategies
          if (event.id === eventToDelete.id) return false;
          if (exactDuplicates.some(e => e.id === event.id)) return false;
          if (uidDuplicates.some(e => e.id === event.id)) return false;
          if (crossCalendarDuplicates.some(e => e.id === event.id)) return false;
          
          // Check for similar titles (ignoring case and extra spaces)
          const titleMatch = event.title && eventToDelete.title && 
            event.title.trim().toLowerCase() === eventToDelete.title.trim().toLowerCase();
          
          // Check for similar start times (within 1 minute)
          const startDate1 = new Date(event.startDate).getTime();
          const startDate2 = new Date(eventToDelete.startDate).getTime();
          const timeMatch = Math.abs(startDate1 - startDate2) < 60000; // Within 1 minute
          
          return titleMatch && timeMatch;
        }) || [];
        
        // Combine all duplicate detection strategies
        const allDuplicates = [
          ...exactDuplicates,
          ...uidDuplicates,
          ...crossCalendarDuplicates,
          ...similarDuplicates
        ];
        
        // Remove duplicates from our combined array (in case an event was caught by multiple strategies)
        const uniqueDuplicates = allDuplicates.filter((event, index, self) =>
          index === self.findIndex((e) => e.id === event.id)
        );
        
        // Track all duplicates for deletion as well
        if (uniqueDuplicates.length > 0) {
          console.log(`Found ${uniqueDuplicates.length} duplicate events to remove as well`);
          uniqueDuplicates.forEach(dupEvent => {
            console.log(`Tracking duplicate event with ID ${dupEvent.id} for deletion`);
            trackDeletedEvent(dupEvent);
          });
        }
        
        // Create a comprehensive filter function to remove main event and all duplicates
        const shouldKeepEvent = (e: Event) => {
          // Filter by ID (exact match)
          if (e.id === id) return false;
          
          // Filter by UID if available (cross-calendar duplicates)
          if (eventToDelete.uid && e.uid === eventToDelete.uid) return false;
          
          // Check if this is one of the duplicates we found through our detection strategies
          if (uniqueDuplicates.some(dupEvent => dupEvent.id === e.id)) return false;
          
          // Check for exact signature match (same calendar, title, start time)
          if (e.title === eventToDelete.title && 
              e.calendarId === eventToDelete.calendarId &&
              new Date(e.startDate).getTime() === new Date(eventToDelete.startDate).getTime()) {
            return false;
          }
          
          // Check for cross-calendar signature match (same title, start time, different calendar)
          if (e.title === eventToDelete.title && 
              e.calendarId !== eventToDelete.calendarId &&
              new Date(e.startDate).getTime() === new Date(eventToDelete.startDate).getTime()) {
            return false;
          }
          
          // Check for similar but not exact matches (case insensitive title, time within 1 minute)
          if (e.title && eventToDelete.title && 
              e.title.trim().toLowerCase() === eventToDelete.title.trim().toLowerCase()) {
            
            const eStartTime = new Date(e.startDate).getTime();
            const deleteStartTime = new Date(eventToDelete.startDate).getTime();
            
            // If start times are within 1 minute, consider it a duplicate
            if (Math.abs(eStartTime - deleteStartTime) < 60000) {
              return false;
            }
          }
          
          return true;
        };
        
        // 1. Update the main events cache immediately with a new array instance
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          // Always create a new array to ensure React detects changes
          const filteredEvents = [...oldEvents.filter(shouldKeepEvent)];
          console.log(`Main cache update: Removed event(s), old length: ${oldEvents.length}, new length: ${filteredEvents.length}`);
          return filteredEvents;
        });
        
        // 2. Update any date-filtered event caches with new array instances
        allQueryKeys.forEach((key: QueryKey) => {
          if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
            queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
              // Always create a new array to ensure React detects changes
              const filteredEvents = [...oldEvents.filter(shouldKeepEvent)];
              console.log(`Cache update for key ${JSON.stringify(key)}: Removed event(s), old length: ${oldEvents.length}, new length: ${filteredEvents.length}`);
              return filteredEvents;
            });
          }
        });
        
        // 3. Also update the calendar-specific cache if it exists with a new array instance
        const calendarId = eventToDelete.calendarId;
        if (calendarId) {
          queryClient.setQueryData<Event[]>(['/api/calendars', calendarId, 'events'], 
            (oldEvents = []) => {
              // Always create a new array to ensure React detects changes
              const filteredEvents = [...oldEvents.filter(shouldKeepEvent)];
              console.log(`Calendar-specific cache update (ID: ${calendarId}): Removed event(s), old length: ${oldEvents.length}, new length: ${filteredEvents.length}`);
              return filteredEvents;
            }
          );
        }
        
        // 4. Check for and update any cross-calendar caches that might contain the event
        // This helps with events that appear in multiple calendars
        if (uniqueDuplicates.length > 0) {
          // Get unique calendar IDs from the duplicates
          const otherCalendarIds = uniqueDuplicates
            .map(e => e.calendarId)
            .filter(cId => cId !== calendarId) // Exclude the main calendar
            .filter((cId, index, self) => self.indexOf(cId) === index); // Make unique
            
          // Update each of these calendar caches
          otherCalendarIds.forEach(otherCalendarId => {
            console.log(`Updating cache for related calendar ${otherCalendarId}`);
            queryClient.setQueryData<Event[]>(['/api/calendars', otherCalendarId, 'events'], 
              (oldEvents = []) => oldEvents ? oldEvents.filter(shouldKeepEvent) : []
            );
          });
        }
      }
      
      // Store the previous state and deleted event info for potential rollback
      return { previousEvents, eventToDelete, allQueryKeys };
    },
    // This happens after successful mutation
    onSuccess: (result, id, context) => {
      console.log(`Delete mutation succeeded with result:`, result);
      
      // Broadcast deletion via WebSocket if available
      try {
        const socket = (window as any).calendarSocket;
        if (socket && socket.readyState === WebSocket.OPEN) {
          console.log(`Broadcasting event deletion via WebSocket: ${id}`);
          socket.send(JSON.stringify({
            type: 'event_deleted',
            eventId: id,
            uid: context?.eventToDelete?.uid || null,
            timestamp: Date.now(),
            calendarId: context?.eventToDelete?.calendarId || null,
            title: context?.eventToDelete?.title || 'Untitled event'
          }));
        }
      } catch (error) {
        console.warn('WebSocket broadcast error:', error);
      }
      
      // Show appropriate toast notification based on sync status
      if (result.sync) {
        if (result.sync.attempted && !result.sync.succeeded && result.sync.noConnection) {
          toast({
            title: "Event Deleted Locally",
            description: "The event was deleted from your local calendar but couldn't be removed from the server because no connection is configured.",
            variant: "default"
          });
        }
        else if (result.sync.attempted && !result.sync.succeeded && result.sync.error) {
          toast({
            title: "Event Deleted Locally",
            description: `Event deleted locally, server sync failed: ${result.sync.error}`,
            variant: "default"
          });
        }
        else if (result.sync.attempted && result.sync.succeeded) {
          toast({
            title: "Event Deleted",
            description: "The event was successfully deleted from both your local calendar and the server.",
            variant: "default"
          });
        }
      } else {
        toast({
          title: "Event Deleted",
          description: "The event has been deleted successfully.",
          variant: "default"
        });
      }
      
      // Simple approach: Invalidate all queries to ensure fresh data from server
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Also invalidate calendar-specific query if we know which calendar
      if (context?.eventToDelete?.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', context.eventToDelete.calendarId, 'events']
        });
      }
      
      // If we have the event that was deleted, add it to our tracking system to ensure it doesn't reappear
      if (context?.eventToDelete) {
        console.log(`Adding deleted event to tracking system:`, context.eventToDelete);
        trackDeletedEvent(context.eventToDelete);
      }
      
      // Force a strong update of all event-related caches
      // 1. Immediately remove from main events cache with improved filtering
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        if (!oldEvents) return [];
        
        // Filter by ID first
        const afterIdFilter = oldEvents.filter((e: Event) => e.id !== id);
        
        // If we have the detailed event object, also filter by UID and signature for improved duplicate detection
        if (context?.eventToDelete) {
          const eventToDelete = context.eventToDelete;
          
          // Filter by UID if available
          const afterUidFilter = eventToDelete.uid 
            ? afterIdFilter.filter(e => e.uid !== eventToDelete.uid)
            : afterIdFilter;
          
          // Also filter by signature if we have enough data
          if (eventToDelete.title && eventToDelete.startDate) {
            const startTime = new Date(eventToDelete.startDate).getTime();
            const signature = `${eventToDelete.calendarId}-${eventToDelete.title}-${startTime}`;
            const crossCalSignature = `${eventToDelete.title}-${startTime}`;
            
            return afterUidFilter.filter(e => {
              if (!e.title || !e.startDate) return true; // Keep if no title/startDate
              
              const eStartTime = new Date(e.startDate).getTime();
              const eSignature = `${e.calendarId}-${e.title}-${eStartTime}`;
              const eCrossCalSignature = `${e.title}-${eStartTime}`;
              
              // Filter out if it matches any of our signatures
              return eSignature !== signature && eCrossCalSignature !== crossCalSignature;
            });
          }
          
          return afterUidFilter;
        }
        
        return afterIdFilter;
      });
      
      // 2. Remove from date-range filtered caches with the same enhanced logic
      if (context?.allQueryKeys) {
        context.allQueryKeys.forEach((key: QueryKey) => {
          if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
            queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
              if (!oldEvents) return [];
              
              // Apply the same filtering logic from above
              const afterIdFilter = oldEvents.filter((e: Event) => e.id !== id);
              
              if (context?.eventToDelete) {
                const eventToDelete = context.eventToDelete;
                
                // Filter by UID if available
                const afterUidFilter = eventToDelete.uid 
                  ? afterIdFilter.filter(e => e.uid !== eventToDelete.uid)
                  : afterIdFilter;
                
                // Also filter by signature if we have enough data
                if (eventToDelete.title && eventToDelete.startDate) {
                  const startTime = new Date(eventToDelete.startDate).getTime();
                  const signature = `${eventToDelete.calendarId}-${eventToDelete.title}-${startTime}`;
                  const crossCalSignature = `${eventToDelete.title}-${startTime}`;
                  
                  return afterUidFilter.filter(e => {
                    if (!e.title || !e.startDate) return true; // Keep if no title/startDate
                    
                    const eStartTime = new Date(e.startDate).getTime();
                    const eSignature = `${e.calendarId}-${e.title}-${eStartTime}`;
                    const eCrossCalSignature = `${e.title}-${eStartTime}`;
                    
                    // Filter out if it matches any of our signatures
                    return eSignature !== signature && eCrossCalSignature !== crossCalSignature;
                  });
                }
                
                return afterUidFilter;
              }
              
              return afterIdFilter;
            });
          }
        });
      }
      
      // 3. Update calendar-specific cache with the same enhanced logic
      if (context?.eventToDelete?.calendarId) {
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', context.eventToDelete.calendarId, 'events'], 
          (oldEvents = []) => {
            if (!oldEvents) return [];
            
            // Apply the same filtering logic from above
            const afterIdFilter = oldEvents.filter((e: Event) => e.id !== id);
            
            if (context?.eventToDelete) {
              const eventToDelete = context.eventToDelete;
              
              // Filter by UID if available
              const afterUidFilter = eventToDelete.uid 
                ? afterIdFilter.filter(e => e.uid !== eventToDelete.uid)
                : afterIdFilter;
              
              // Also filter by signature if we have enough data
              if (eventToDelete.title && eventToDelete.startDate) {
                const startTime = new Date(eventToDelete.startDate).getTime();
                const signature = `${eventToDelete.calendarId}-${eventToDelete.title}-${startTime}`;
                const crossCalSignature = `${eventToDelete.title}-${startTime}`;
                
                return afterUidFilter.filter(e => {
                  if (!e.title || !e.startDate) return true; // Keep if no title/startDate
                  
                  const eStartTime = new Date(e.startDate).getTime();
                  const eSignature = `${e.calendarId}-${e.title}-${eStartTime}`;
                  const eCrossCalSignature = `${e.title}-${eStartTime}`;
                  
                  // Filter out if it matches any of our signatures
                  return eSignature !== signature && eCrossCalSignature !== crossCalSignature;
                });
              }
              
              return afterUidFilter;
            }
            
            return afterIdFilter;
          }
        );
      }
      
      // IMPORTANT: Instead of invalidating queries (which could bring back deleted events),
      // we'll use a more controlled approach to prevent re-fetching deleted events.
      
      // 1. Mark this as a deletion in a special flag in localStorage
      try {
        const deletionFlag = {
          eventId: id,
          timestamp: Date.now(),
          type: 'permanent_deletion'
        };
        localStorage.setItem('last_event_deletion', JSON.stringify(deletionFlag));
      } catch (e) {
        console.error('Could not store deletion flag:', e);
      }
      
      // 2. Prevent immediate query invalidation which might restore the deleted event
      // Instead, we'll force a controlled update with our filters already applied
      const controlledRefresh = () => {
        // Get current data first
        const currentEvents = queryClient.getQueryData<Event[]>(['/api/events']) || [];
        
        // Create a filter function that excludes the deleted event and its duplicates
        const filterDeleted = (events: Event[]) => {
          return events.filter(e => {
            // Filter by ID
            if (e.id === id) return false;
            
            // Filter by UID if available from context
            if (context?.eventToDelete?.uid && e.uid === context.eventToDelete.uid) return false;
            
            // Filter by signature if we have enough data
            if (context?.eventToDelete?.title && context.eventToDelete.startDate) {
              const eventToDelete = context.eventToDelete;
              const startTime = new Date(eventToDelete.startDate).getTime();
              const signature = `${eventToDelete.calendarId}-${eventToDelete.title}-${startTime}`;
              const crossCalSignature = `${eventToDelete.title}-${startTime}`;
              
              if (e.title && e.startDate) {
                const eStartTime = new Date(e.startDate).getTime();
                const eSignature = `${e.calendarId}-${e.title}-${eStartTime}`;
                const eCrossCalSignature = `${e.title}-${eStartTime}`;
                
                if (eSignature === signature || eCrossCalSignature === crossCalSignature) {
                  return false;
                }
              }
            }
            
            return true;
          });
        };
        
        // Apply our filter to the current data
        const filteredEvents = filterDeleted(currentEvents);
        
        // Update the cache with our filtered version instead of refetching
        queryClient.setQueryData(['/api/events'], filteredEvents);
        
        // Update any filtered queries with the same approach
        if (context?.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              const keyEvents = queryClient.getQueryData<Event[]>(key) || [];
              queryClient.setQueryData(key, filterDeleted(keyEvents));
            }
          });
        }
        
        // Also update the specific calendar's events if necessary
        if (context?.eventToDelete?.calendarId) {
          const calendarId = context.eventToDelete.calendarId;
          const calendarEvents = queryClient.getQueryData<Event[]>(['/api/calendars', calendarId, 'events']) || [];
          queryClient.setQueryData(['/api/calendars', calendarId, 'events'], filterDeleted(calendarEvents));
        }
      };
      
      // Run our controlled refresh after a short delay
      setTimeout(controlledRefresh, 50);
      
      // Show customized toast based on sync status
      if (result.sync) {
        // Sync was attempted but failed due to connection issues
        if (result.sync.attempted && !result.sync.succeeded && result.sync.noConnection) {
          toast({
            title: "Event Deleted Locally",
            description: "The event was deleted from your local calendar but couldn't be removed from the server because no connection is configured. The change will sync when you set up server connectivity.",
            variant: "default"
          });
        }
        // Sync was attempted but failed due to other errors
        else if (result.sync.attempted && !result.sync.succeeded && result.sync.error) {
          toast({
            title: "Event Deleted Locally",
            description: `The event was deleted from your local calendar but couldn't be removed from the server: ${result.sync.error}`,
            variant: "default"
          });
        }
        // Sync was attempted and succeeded
        else if (result.sync.attempted && result.sync.succeeded) {
          toast({
            title: "Event Deleted",
            description: "The event was successfully deleted from both your local calendar and the server."
          });
        }
        // Sync was not attempted (likely because it's a local-only event)
        else if (!result.sync.attempted) {
          toast({
            title: "Event Deleted",
            description: "The event was successfully deleted."
          });
        }
      } else {
        // Default success message if sync info isn't available
        toast({
          title: "Event Deleted",
          description: "Event has been deleted successfully."
        });
      }
      
      // Instead of simple invalidation, use a more controlled approach
      // This ensures the UI is in sync with the server while preventing deleted events from reappearing
      console.log("Implementing controlled data refresh after delete");
      
      // First apply our filters to ensure current view is correct
      controlledRefresh();
      
      // Connect to WebSocket if available to broadcast deletion
      try {
        // Try to get a WebSocket connection if available
        const socket = (window as any).calendarSocket;
        if (socket && socket.readyState === WebSocket.OPEN) {
          console.log(`Broadcasting event deletion via WebSocket: ${id}`);
          // Send deletion notification to all connected clients
          socket.send(JSON.stringify({
            type: 'event_deleted',
            eventId: id,
            uid: context?.eventToDelete?.uid || null,
            timestamp: Date.now(),
            calendarId: context?.eventToDelete?.calendarId || null
          }));
        }
      } catch (wsError) {
        console.warn('Could not broadcast deletion via WebSocket:', wsError);
      }
      
      // Then set up a series of carefully timed operations to keep the UI in sync
      setTimeout(() => {
        // 1. Apply filters again before fetch to ensure consistent view
        controlledRefresh();
        
        // 2. Get current filtered state to compare after fetch
        const beforeEvents = queryClient.getQueryData<Event[]>(['/api/events']) || [];
        const filteredIds = new Set(beforeEvents.map(e => e.id));
        
        // 3. Perform a controlled invalidation
        console.log("Performing controlled query invalidation");
        queryClient.invalidateQueries({ 
          queryKey: ['/api/events'],
          refetchType: 'all' // Force an immediate refetch
        }).then(() => {
          console.log("Successfully refreshed events data");
          // Apply our filters again after fetch completes
          controlledRefresh();
          
          // Check if any deleted events reappeared and remove them
          setTimeout(() => {
            const afterEvents = queryClient.getQueryData<Event[]>(['/api/events']) || [];
            const reappearedEvents = afterEvents.filter(e => 
              // Event wasn't in our filtered set and matches our deleted event
              !filteredIds.has(e.id) && 
              (e.id === id || (context?.eventToDelete?.uid && e.uid === context.eventToDelete.uid))
            );
            
            if (reappearedEvents.length > 0) {
              console.log(`Found ${reappearedEvents.length} reappeared events, removing them`);
              queryClient.setQueryData<Event[]>(['/api/events'], 
                afterEvents.filter(e => !reappearedEvents.some(re => re.id === e.id))
              );
              
              // Re-apply custom DOM filtering for any reappeared elements
              try {
                reappearedEvents.forEach(e => {
                  const eventEls = document.querySelectorAll(`[data-event-id="${e.id}"]`);
                  if (eventEls.length > 0) {
                    console.log(`👉 Re-hiding ${eventEls.length} reappeared DOM elements for event ${e.id}`);
                    eventEls.forEach(el => {
                      (el as HTMLElement).style.display = 'none';
                      (el as HTMLElement).style.opacity = '0';
                      (el as HTMLElement).style.pointerEvents = 'none';
                      el.setAttribute('data-deleted', 'true');
                    });
                  }
                });
              } catch (domError) {
                console.error('Error hiding reappeared events in DOM:', domError);
              }
            }
            
            // Final filter application to ensure consistency
            controlledRefresh();
          }, 100);
        });
        
        // Also handle calendar-specific queries with the same careful approach
        if (context?.eventToDelete?.calendarId) {
          const calendarId = context.eventToDelete.calendarId;
          const calQueryKey = ['/api/calendars', calendarId, 'events'];
          
          // Get current calendar-specific filtered state
          const beforeCalEvents = queryClient.getQueryData<Event[]>(calQueryKey) || [];
          const filteredCalIds = new Set(beforeCalEvents.map(e => e.id));
          
          queryClient.invalidateQueries({ 
            queryKey: calQueryKey,
            refetchType: 'all' // Force an immediate refetch
          }).then(() => {
            // Apply our filters again after fetch completes
            controlledRefresh();
            
            // Check for and remove any reappeared events
            const afterCalEvents = queryClient.getQueryData<Event[]>(calQueryKey) || [];
            const reappearedCalEvents = afterCalEvents.filter(e => 
              !filteredCalIds.has(e.id) && 
              (e.id === id || (context?.eventToDelete?.uid && e.uid === context.eventToDelete.uid))
            );
            
            if (reappearedCalEvents.length > 0) {
              console.log(`Found ${reappearedCalEvents.length} reappeared events in calendar cache, removing them`);
              queryClient.setQueryData<Event[]>(calQueryKey, 
                afterCalEvents.filter(e => !reappearedCalEvents.some(re => re.id === e.id))
              );
            }
            
            // Final calendar-specific filter application
            controlledRefresh();
          });
        }
        
        // Trigger an immediate sync with the server to ensure the event deletion is pushed to the CalDAV server
        console.log('Triggering immediate sync for deleted event');
        
        const syncEvent = async () => {
          try {
            // Make sure our controlled refreshes are finished before syncing
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Then trigger an immediate sync with the CalDAV server
            const syncResponse = await apiRequest('POST', '/api/sync/now', {
              forceRefresh: true,
              // If we have the calendar ID from the deleted event, use it for targeted sync
              calendarId: context?.eventToDelete?.calendarId,
              preserveLocalEvents: true // Add parameter to prevent event deletion during sync
            });
            
            // Check if the response is JSON before parsing
            const contentType = syncResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              const textContent = await syncResponse.text();
              console.error('Non-JSON response from sync endpoint during delete:', textContent);
              throw new Error('Sync server returned an invalid response format after deletion.');
            }
            
            const syncResult = await syncResponse.json();
            
            // Check if sync was successful based on the new response format
            if (syncResponse.ok && syncResult.synced === true) {
              console.log('Immediate sync completed successfully after deletion:', syncResult);
              
              // After successful sync, refresh the events list
              queryClient.invalidateQueries({ queryKey: ['/api/events'] });
            } else {
              // Not a critical error - we handle 202 status codes here which mean
              // the event was deleted locally but not synced to the server
              console.log('Sync status after deletion:', syncResult);
              
              // Check if we have the enhanced response format from our API
              if (result && result.sync) {
                console.log('Enhanced sync response details:', result.sync);
                
                // We already showed a toast message based on the delete API response
              // so we don't need to show another one here based on the sync results
              console.log('Using sync information from original delete response', result.sync);
              } 
              // Fall back to the sync API response format if we don't have the enhanced format
              else if (syncResult.requiresAuth) {
                toast({
                  title: "Event Deleted Locally",
                  description: "Event deleted from your local calendar. Sign in to sync with server.",
                  variant: "default"
                });
              } else if (syncResult.requiresConnection) {
                toast({
                  title: "Event Deleted Locally",
                  description: "Event deleted from your local calendar. Configure a server connection to sync.",
                  variant: "default"
                });
              } else {
                toast({
                  title: "Event Deleted Locally",
                  description: "Event deleted from your local calendar, but sync with server failed. Will retry automatically.",
                  variant: "default"
                });
              }
            }
          } catch (error) {
            console.error('Error during immediate sync after deletion:', error);
            toast({
              title: "Event Deleted",
              description: "Event deleted from your local calendar, but sync with server failed. Will retry automatically.",
              variant: "default"
            });
          }
        };
        
        syncEvent();
      }, 50); // Very short delay to allow UI updates
    },
    // This happens if the server request fails
    onError: (error: Error, id: number, context: DeleteMutationContext | undefined) => {
      console.error(`Error deleting event with ID ${id}:`, error);
      
      // Simplified error handling: just restore the previous state
      if (context?.previousEvents) {
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
      }
      
      // Show error toast
      toast({
        title: "Failed to Delete Event",
        description: error.message || "An error occurred while deleting the event.",
        variant: "destructive"
      });
      
      // Force a complete refresh to ensure consistency with server
      queryClient.invalidateQueries({ 
        queryKey: ['/api/events'],
        refetchType: 'all'
      });
      
      // Also refresh calendar-specific data if we know which calendar
      if (context?.eventToDelete?.calendarId) {
        queryClient.invalidateQueries({
          queryKey: ['/api/calendars', context.eventToDelete.calendarId, 'events']
        });
      }
    }
  });

  // Add cancelEvent mutation for events with attendees
  const cancelEventMutation = useMutation<DeleteResponse, Error, number, DeleteMutationContext>({
    mutationFn: async (id: number) => {
      console.log(`Canceling event with ID ${id}`);
      try {
        const res = await apiRequest('POST', `/api/cancel-event/${id}`);
        
        // Check for 200 status with our enhanced response format
        if (res.status === 200) {
          try {
            const data = await res.json();
            console.log(`Successfully canceled event with ID ${id}, response:`, data);
            return data;
          } catch (e) {
            console.warn("Could not parse JSON response from successful cancellation:", e);
            return { success: true, id };
          }
        }
        
        // For other status codes, try to get the error message
        let errorMessage = `Server returned unexpected status: ${res.status}`;
        try {
          const data = await res.json();
          if (data && data.message) {
            errorMessage = data.message;
          }
        } catch (e) {
          // If we can't parse JSON, use the default error message
          console.warn("Could not parse error response as JSON");
        }
        
        // Throw an error with the message so it's caught by the onError handler
        throw new Error(errorMessage);
      } catch (error) {
        console.error("Error in cancel mutation:", error);
        throw error;
      }
    },
    onMutate: async (eventId) => {
      // Prevent any background refetches during optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/events'] });
      
      // Keep track of the previous state for potential rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const event = previousEvents?.find(e => e.id === eventId);
      
      if (event && previousEvents) {
        // Simple optimistic update - mark the event as cancelled in UI
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => 
          oldEvents.map(e => e.id === eventId ? { ...e, status: 'CANCELLED' } : e)
        );
        
        // Also update calendar-specific data if applicable
        if (event.calendarId) {
          queryClient.setQueryData<Event[]>(
            ['/api/calendars', event.calendarId, 'events'],
            (oldEvents = []) => oldEvents.map(e => e.id === eventId ? { ...e, status: 'CANCELLED' } : e)
          );
        }
      }
      
      return { previousEvents, event };
    },
    onSuccess: (data, eventId, context) => {
      if (data.success) {
        // Simplified approach - just invalidate all relevant queries
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        // Also invalidate calendar-specific query if we know which calendar
        if (context?.event?.calendarId) {
          queryClient.invalidateQueries({ 
            queryKey: ['/api/calendars', context.event.calendarId, 'events']
          });
        }
        
        toast({
          title: "Event Canceled",
          description: "The event has been canceled and attendees have been notified.",
          variant: "default"
        });
      } else {
        toast({
          title: "Error Canceling Event",
          description: data.message || "Failed to cancel the event. Please try again.",
          variant: "destructive"
        });
      }
    },
    onError: (error, eventId, context) => {
      console.error("Error in cancelEvent:", error);
      
      // Restore previous state if available
      if (context?.previousEvents) {
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
      }
      
      // Also restore calendar-specific data if we have the calendar info
      if (context?.event?.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', context.event.calendarId, 'events']
        });
      }
      
      toast({
        title: "Error Canceling Event",
        description: error.message || "Failed to cancel the event. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Delete events in bulk with filtering options
  const bulkDeleteMutation = useMutation({
    mutationFn: async ({
      calendarIds,
      deleteFrom,
      year,
      month,
      day,
      deleteScope
    }: {
      calendarIds: number[];
      deleteFrom: 'local' | 'server' | 'both';
      year?: number;
      month?: number;
      day?: number;
      deleteScope: 'all' | 'filtered';
    }) => {
      const res = await apiRequest('POST', '/api/events/bulk/delete', {
        calendarIds,
        deleteFrom,
        year,
        month,
        day,
        deleteScope
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to delete events');
      }
      
      return await res.json();
    },
    onSuccess: (data) => {
      console.log("Bulk delete completed successfully:", data);
      
      // Invalidate queries to reflect the changes
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Also invalidate calendar-specific queries
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          query.queryKey[0] === '/api/calendars' && 
          query.queryKey[2] === 'events'
      });
      
      // Show success toast
      toast({
        title: "Events Deleted",
        description: `${data.stats?.locallyDeleted || 0} events were successfully deleted locally, ${data.stats?.serverDeleted || 0} deleted from server.`,
        variant: "default"
      });
    },
    onError: (error) => {
      // Show error toast
      toast({
        title: "Failed to Delete Events",
        description: error.message || "An error occurred while deleting events",
        variant: "destructive"
      });
    }
  });

  return {
    events: filteredEvents,
    isLoading: eventsQueries.isLoading,
    error: eventsQueries.error,
    refetch: eventsQueries.refetch,
    createEvent: createEventMutation.mutate,
    updateEvent: updateEventMutation.mutate,
    deleteEvent: deleteEventMutation.mutate,
    cancelEvent: cancelEventMutation.mutate,
    bulkDeleteEvents: bulkDeleteMutation.mutate
  };
};
