import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Event } from '@shared/schema';

interface DeletedEventInfo {
  id: number;
  uid?: string | null;
  calendarId?: number | null;
  title?: string | null;
  startDateISO?: string | null;
  timestamp: number;
}

/**
 * This hook provides persistent tracking of deleted events to prevent them 
 * from reappearing after sync operations or cache refreshes.
 * 
 * It uses multiple storage mechanisms (localStorage, sessionStorage, and memory)
 * to ensure deleted events remain deleted across page reloads and tab syncs.
 */
export function useDeletedEventsTracker() {
  const LOCAL_STORAGE_KEY = 'permanently_deleted_events';
  const SESSION_STORAGE_KEY = 'recently_deleted_events';
  
  // In-memory cache for fastest access
  const [deletedEvents, setDeletedEvents] = useState<Map<number, DeletedEventInfo>>(new Map());
  
  // Query client for cache manipulation
  const queryClient = useQueryClient();
  
  // Initialize from storage on first load
  useEffect(() => {
    try {
      // Load from localStorage (permanent storage)
      const storedEvents = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedEvents) {
        const parsedEvents = JSON.parse(storedEvents) as DeletedEventInfo[];
        const eventsMap = new Map();
        
        // Load events into map
        parsedEvents.forEach(event => {
          if (event.id) {
            eventsMap.set(event.id, event);
          }
        });
        
        setDeletedEvents(eventsMap);
      }
      
      // Also check session storage for any additional recently deleted events
      const sessionEvents = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionEvents) {
        const parsedSessionEvents = JSON.parse(sessionEvents) as DeletedEventInfo[];
        
        // Add any events from session storage that aren't already in the map
        setDeletedEvents(prevMap => {
          const newMap = new Map(prevMap);
          parsedSessionEvents.forEach(event => {
            if (event.id && !newMap.has(event.id)) {
              newMap.set(event.id, event);
            }
          });
          return newMap;
        });
      }
    } catch (error) {
      console.error('Error loading deleted events from storage:', error);
    }
  }, []);
  
  // Track a newly deleted event
  const trackDeletedEvent = useCallback((event: Event | Partial<Event> & { id: number }) => {
    const eventInfo: DeletedEventInfo = {
      id: event.id,
      uid: event.uid || null,
      calendarId: event.calendarId || null,
      title: event.title || null,
      startDateISO: event.startDate ? new Date(event.startDate).toISOString() : null,
      timestamp: Date.now()
    };
    
    // Update in-memory state
    setDeletedEvents(prevMap => {
      const newMap = new Map(prevMap);
      newMap.set(event.id, eventInfo);
      return newMap;
    });
    
    // Update localStorage
    try {
      // Get existing array
      const storedEvents = localStorage.getItem(LOCAL_STORAGE_KEY);
      const parsedEvents = storedEvents ? JSON.parse(storedEvents) as DeletedEventInfo[] : [];
      
      // Filter out any existing record for this event to avoid duplicates
      const filteredEvents = parsedEvents.filter(e => e.id !== event.id);
      
      // Add the new info
      filteredEvents.push(eventInfo);
      
      // Trim to keep only most recent 100 events
      const trimmedEvents = filteredEvents.slice(-100);
      
      // Save back to storage
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trimmedEvents));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
    
    // Update sessionStorage
    try {
      // Get existing array
      const sessionEvents = sessionStorage.getItem(SESSION_STORAGE_KEY);
      const parsedSessionEvents = sessionEvents ? JSON.parse(sessionEvents) as DeletedEventInfo[] : [];
      
      // Filter out any existing record for this event
      const filteredSessionEvents = parsedSessionEvents.filter(e => e.id !== event.id);
      
      // Add the new info
      filteredSessionEvents.push(eventInfo);
      
      // Trim to keep only most recent 50 events
      const trimmedSessionEvents = filteredSessionEvents.slice(-50);
      
      // Save back to session storage
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(trimmedSessionEvents));
    } catch (error) {
      console.error('Error saving to sessionStorage:', error);
    }
    
    // Also immediately fix query caches - this is critical
    try {
      // Create filter function for consistent application
      const filterOutEvent = (events: Event[] | undefined) => {
        if (!events) return [];
        
        return events.filter(e => {
          // Obvious case - matching ID
          if (e.id === event.id) return false;
          
          // Check UID match - this catches duplicated events with different IDs
          if (event.uid && e.uid === event.uid) return false;
          
          // Check signature match - this catches recreated events with new IDs and UIDs
          // but same fundamental data
          if (event.title && event.startDate && e.title && e.startDate) {
            const eventStart = new Date(event.startDate).getTime();
            const eStart = new Date(e.startDate).getTime();
            
            // Match by title and start time - very likely the same event
            if (e.title === event.title && Math.abs(eStart - eventStart) < 60000) {
              return false;
            }
          }
          
          return true;
        });
      };
      
      // Apply to global events cache
      queryClient.setQueryData<Event[]>(['/api/events'], events => filterOutEvent(events));
      
      // Apply to calendar-specific cache
      if (event.calendarId) {
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', event.calendarId, 'events'], 
          events => filterOutEvent(events)
        );
      }
      
      // Handle any date-range specific queries
      const allQueries = queryClient.getQueryCache().getAll();
      allQueries.forEach(query => {
        if (Array.isArray(query.queryKey) && 
            query.queryKey[0] === '/api/events' && 
            query.queryKey.length > 1) {
          queryClient.setQueryData<Event[]>(query.queryKey, events => filterOutEvent(events));
        }
      });
    } catch (cacheError) {
      console.error('Error updating query cache for deleted event:', cacheError);
    }
    
    return true;
  }, [queryClient]);
  
  // Check if an event was deleted
  const isEventDeleted = useCallback((eventId: number, eventUid?: string): boolean => {
    // First check in-memory cache (fastest)
    if (deletedEvents.has(eventId)) {
      return true;
    }
    
    // If UID provided, also check by UID
    if (eventUid) {
      for (const eventInfo of deletedEvents.values()) {
        if (eventInfo.uid === eventUid) {
          return true;
        }
      }
    }
    
    // Additional check - look in storage in case in-memory state isn't synced
    try {
      // Check localStorage
      const storedEvents = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedEvents) {
        const parsedEvents = JSON.parse(storedEvents) as DeletedEventInfo[];
        if (parsedEvents.some(e => e.id === eventId || (eventUid && e.uid === eventUid))) {
          return true;
        }
      }
      
      // Check sessionStorage
      const sessionEvents = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionEvents) {
        const parsedSessionEvents = JSON.parse(sessionEvents) as DeletedEventInfo[];
        if (parsedSessionEvents.some(e => e.id === eventId || (eventUid && e.uid === eventUid))) {
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking storage for deleted event:', error);
    }
    
    return false;
  }, [deletedEvents]);
  
  // Filter an array of events to remove any that have been deleted
  const filterDeletedEvents = useCallback((events: Event[] | undefined): Event[] => {
    if (!events) return [];
    
    return events.filter(event => {
      // Skip if explicitly deleted
      if (isEventDeleted(event.id, event.uid)) {
        console.log(`Filtering out deleted event: ${event.title} (ID: ${event.id})`);
        return false;
      }
      
      // Also check for signature matches across all deleted events
      for (const deletedEvent of deletedEvents.values()) {
        if (deletedEvent.title && 
            deletedEvent.startDateISO && 
            event.title && 
            event.startDate &&
            event.title === deletedEvent.title) {
          
          // Compare start times - allow 1 minute of variance
          const deletedStart = new Date(deletedEvent.startDateISO).getTime();
          const eventStart = new Date(event.startDate).getTime();
          
          if (Math.abs(deletedStart - eventStart) < 60000) {
            console.log(`Filtering out event with matching signature: ${event.title} (ID: ${event.id})`);
            return false;
          }
        }
      }
      
      return true;
    });
  }, [deletedEvents, isEventDeleted]);
  
  // Apply the filter to all event queries
  const cleanAllEventCaches = useCallback(() => {
    // Get all event-related queries
    const allQueries = queryClient.getQueryCache().getAll();
    
    allQueries.forEach(query => {
      const queryKey = query.queryKey;
      
      // Handle global events
      if (Array.isArray(queryKey) && queryKey[0] === '/api/events') {
        queryClient.setQueryData<Event[]>(queryKey, events => filterDeletedEvents(events));
      }
      
      // Handle calendar-specific events
      if (Array.isArray(queryKey) && 
          queryKey[0] === '/api/calendars' && 
          queryKey.length > 2 && 
          queryKey[2] === 'events') {
        queryClient.setQueryData<Event[]>(queryKey, events => filterDeletedEvents(events));
      }
    });
  }, [queryClient, filterDeletedEvents]);
  
  // Set up periodic cleaner to catch any deleted events that reappear
  useEffect(() => {
    // Clean immediately on mount
    cleanAllEventCaches();
    
    // Then clean every 5 seconds
    const interval = setInterval(() => {
      cleanAllEventCaches();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [cleanAllEventCaches]);
  
  // Listen for storage events from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_KEY || e.key === SESSION_STORAGE_KEY) {
        // Reload deleted events from storage
        try {
          const updatedEvents = new Map<number, DeletedEventInfo>();
          
          // Load from localStorage
          const storedEvents = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (storedEvents) {
            const parsedEvents = JSON.parse(storedEvents) as DeletedEventInfo[];
            parsedEvents.forEach(event => {
              if (event.id) {
                updatedEvents.set(event.id, event);
              }
            });
          }
          
          // Also check session storage
          const sessionEvents = sessionStorage.getItem(SESSION_STORAGE_KEY);
          if (sessionEvents) {
            const parsedSessionEvents = JSON.parse(sessionEvents) as DeletedEventInfo[];
            parsedSessionEvents.forEach(event => {
              if (event.id && !updatedEvents.has(event.id)) {
                updatedEvents.set(event.id, event);
              }
            });
          }
          
          // Update state
          setDeletedEvents(updatedEvents);
          
          // Clean caches right away
          cleanAllEventCaches();
        } catch (error) {
          console.error('Error handling storage event:', error);
        }
      }
    };
    
    // Add listener
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [cleanAllEventCaches]);
  
  // Return public API
  return {
    trackDeletedEvent,
    isEventDeleted,
    filterDeletedEvents,
    cleanAllEventCaches,
    deletedEventCount: deletedEvents.size
  };
}