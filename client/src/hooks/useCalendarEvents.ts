import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Event } from '@shared/schema';
import { useCalendars } from './useCalendars';
import { useSharedCalendars } from './useSharedCalendars';
import { useState, useEffect, useRef, useCallback } from 'react';

// Type declarations to help with TanStack Query types
type QueryKey = unknown;
type EventFilter = (e: Event) => boolean;

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
  
  // Advanced restoration function that handles multiple cache scenarios
  const restoreEventsIfNeeded = useCallback(() => {
    try {
      const currentEvents = localQueryClient.getQueryData<Event[]>(['/api/events']);
      
      // Scenario 1: Events disappeared completely
      if (!currentEvents || currentEvents.length === 0) {
        if (eventsCache.current && eventsCache.current.length > 0) {
          console.log(`Restoring ${eventsCache.current.length} events from main cache (complete disappearance)`);
          // Make a deep copy to avoid reference issues
          const cacheSnapshot = JSON.parse(JSON.stringify(eventsCache.current));
          localQueryClient.setQueryData(['/api/events'], cacheSnapshot);
          return; // Restoration complete
        }
      } 
      // Scenario 2: Significant event loss (more than just a new event being processed)
      else if (currentEvents.length < lastEventCount.current - 1) {
        console.log(`Detected significant event loss: ${currentEvents.length} vs ${lastEventCount.current} previously`);
        if (eventsCache.current && eventsCache.current.length > lastEventCount.current - 1) {
          console.log(`Restoring ${eventsCache.current.length} events from main cache (significant loss)`);
          const cacheSnapshot = JSON.parse(JSON.stringify(eventsCache.current));
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
  
  // Load events for all calendars with date range filtering in a single API call
  const eventsQueries = useQuery<Event[]>({
    queryKey: ['/api/events', enabledCalendarIds, startDate?.toISOString(), endDate?.toISOString()],
    enabled: enabledCalendarIds.length > 0,
    queryFn: getQueryFn({ on401: "continueWithEmpty" }), // Use continueWithEmpty to handle user session expiry gracefully
    // Critical: Use stale time to prevent immediate refetching
    staleTime: 1000, // Short stale time to reduce refetches during sync operations
    // Don't trash data if query fails
    retry: 3,
    retryDelay: 500,
    // Use placeholder data function to prevent flickering during load
    placeholderData: (previousData) => previousData || eventsCache.current,
    // In TanStack Query v5, use gcTime instead of keepPreviousData
    gcTime: 5 * 60 * 1000, // Keep data in cache for 5 minutes
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
    
  const filteredEvents = eventsData.filter((event: Event) => 
    enabledCalendarIds.includes(event.calendarId)
  );

  type CreateMutationContext = {
    tempEvent?: Event;
    previousEvents?: Event[];
    allQueryKeys?: QueryKey[];
  };

  const createEventMutation = useMutation<Event, Error, Omit<Event, 'id' | 'uid'>, CreateMutationContext>({
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
      console.log(`Starting optimistic delete for event ${id}`);
      
      // Prevent any background refetches from overwriting our UI update
      await queryClient.cancelQueries();
      
      // Store the current state for possible rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const allQueryKeys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
      
      // Find the event in the cache to get its calendar ID before deleting
      const eventToDelete = previousEvents?.find(e => e.id === id);
      
      if (eventToDelete) {
        console.log(`Optimistically removing event ${id} from UI`);
        
        // 1. Update the main events cache immediately
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          return oldEvents.filter(e => e.id !== id);
        });
        
        // 2. Update any date-filtered event caches
        allQueryKeys.forEach((key: QueryKey) => {
          if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
            queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
              return oldEvents.filter((e: Event) => e.id !== id);
            });
          }
        });
        
        // 3. Also update the calendar-specific cache if it exists
        const calendarId = eventToDelete.calendarId;
        if (calendarId) {
          queryClient.setQueryData<Event[]>(['/api/calendars', calendarId, 'events'], 
            (oldEvents = []) => oldEvents.filter(e => e.id !== id)
          );
        }
      }
      
      // Store the previous state and deleted event info for potential rollback
      return { previousEvents, eventToDelete, allQueryKeys };
    },
    // This happens after successful mutation
    onSuccess: (result, id, context) => {
      console.log(`Delete mutation succeeded with result:`, result);
      
      // Force a strong update of all event-related caches
      // 1. Immediately remove from main events cache
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        return oldEvents.filter((e: Event) => e.id !== id);
      });
      
      // 2. Remove from date-range filtered caches
      if (context?.allQueryKeys) {
        context.allQueryKeys.forEach((key: QueryKey) => {
          if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
            queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
              return oldEvents.filter((e: Event) => e.id !== id);
            });
          }
        });
      }
      
      // 3. Update calendar-specific cache
      if (context?.eventToDelete?.calendarId) {
        queryClient.setQueryData<Event[]>(
          ['/api/calendars', context.eventToDelete.calendarId, 'events'], 
          (oldEvents = []) => {
            return oldEvents.filter((e: Event) => e.id !== id);
          }
        );
      }
      
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
      
      // Force an immediate invalidation to trigger a fresh fetch from the server
      // This ensures the UI is in sync with the server
      console.log("Forcing immediate data refresh after delete");
      
      // A short timeout to allow the UI to update first
      setTimeout(() => {
        // Invalidate everything related to events
        queryClient.invalidateQueries({ 
          queryKey: ['/api/events'],
          refetchType: 'all' // Force an immediate refetch
        });
        
        if (context?.eventToDelete) {
          queryClient.invalidateQueries({ 
            queryKey: ['/api/calendars', context.eventToDelete.calendarId, 'events'],
            refetchType: 'all' // Force an immediate refetch
          });
        }
        
        // Trigger an immediate sync with the server to ensure the event deletion is pushed to the CalDAV server
        console.log('Triggering immediate sync for deleted event');
        
        const syncEvent = async () => {
          try {
            // First, make sure the event is properly removed from our local database
            await queryClient.invalidateQueries({ queryKey: ['/api/events'] });
            
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
      
      // Revert the UI to the previous state
      if (context?.previousEvents) {
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
        
        // Also revert any filtered query caches
        if (context.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData(key, context.previousEvents);
            }
          });
        }
        
        // Revert the calendar-specific cache
        if (context.eventToDelete) {
          const calendarEvents = context.previousEvents?.filter(
            (e: Event) => e.calendarId === context.eventToDelete?.calendarId
          );
          if (calendarEvents) {
            queryClient.setQueryData(
              ['/api/calendars', context.eventToDelete.calendarId, 'events'],
              calendarEvents
            );
          }
        }
      }
      
      // Show error toast
      toast({
        title: "Failed to Delete Event",
        description: error.message || "An error occurred while deleting the event.",
        variant: "destructive"
      });
      
      // Force immediate refetch to ensure consistency
      queryClient.invalidateQueries({ 
        queryKey: ['/api/events'],
        refetchType: 'all'
      });
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
    onMutate: (eventId) => {
      // Similar optimization as delete - keep track of the previous state
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const event = previousEvents?.find(e => e.id === eventId);
      
      // Get all potentially affected query keys
      const allQueryKeys = queryClient.getQueryCache().getAll().map(q => q.queryKey);
      
      return { previousEvents, event, allQueryKeys };
    },
    onSuccess: (data, eventId, context) => {
      if (data.success) {
        // Update the cache to remove the canceled event
        queryClient.setQueryData<Event[]>(
          ['/api/events'],
          (oldEvents = []) => oldEvents.filter(e => e.id !== eventId)
        );
        
        // If we have the event, update calendar-specific cache
        if (context?.event?.calendarId) {
          queryClient.setQueryData<Event[]>(
            ['/api/calendars', context.event.calendarId, 'events'],
            (oldEvents = []) => oldEvents.filter(e => e.id !== eventId)
          );
        }
        
        // Invalidate queries to ensure data is fresh
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        toast({
          title: "Event Canceled",
          description: "The event has been canceled and attendees have been notified.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error Canceling Event",
          description: data.message || "Failed to cancel the event. Please try again."
        });
      }
    },
    onError: (error) => {
      console.error("Error in cancelEvent:", error);
      toast({
        variant: "destructive",
        title: "Error Canceling Event",
        description: error.message || "Failed to cancel the event. Please try again."
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
