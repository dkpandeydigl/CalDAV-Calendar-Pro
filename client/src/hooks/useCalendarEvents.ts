import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Event } from '@shared/schema';
import { useCalendars } from './useCalendars';

// Type declarations to help with TanStack Query types
type QueryKey = unknown;
type EventFilter = (e: Event) => boolean;

export const useCalendarEvents = (startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();
  const { calendars } = useCalendars();
  
  // Get calendar IDs that are enabled
  const enabledCalendarIds = calendars
    .filter(calendar => calendar.enabled)
    .map(calendar => calendar.id);
  
  // Load events for all calendars with date range filtering in a single API call
  const eventsQueries = useQuery<Event[]>({
    queryKey: ['/api/events', enabledCalendarIds, startDate?.toISOString(), endDate?.toISOString()],
    enabled: enabledCalendarIds.length > 0,
    queryFn: async () => {
      // Build query parameters
      const params = new URLSearchParams();
      
      if (startDate) {
        params.append('start', startDate.toISOString());
      }
      
      if (endDate) {
        params.append('end', endDate.toISOString());
      }
      
      // Make a single API call to get all events from all enabled calendars
      const queryString = params.toString() ? `?${params.toString()}` : '';
      const endpoint = `/api/events${queryString}`;
      
      console.log(`Fetching events with: ${endpoint}`);
      if (startDate) console.log(`Start date: ${startDate.toISOString()}`);
      if (endDate) console.log(`End date: ${endDate.toISOString()}`);
      
      const response = await fetch(endpoint, { 
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }
      
      const events = await response.json();
      console.log(`Received ${events.length} events`);
      
      // Log events for debugging with timezone info
      if (events.length > 0) {
        console.log('Events received from server:');
        events.forEach((event: any) => {
          const startDate = new Date(event.startDate);
          const endDate = new Date(event.endDate);
          
          // Format date in a way that preserves the original date components
          const formatDateForDisplay = (date: Date) => {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          };
          
          // Get user's timezone
          const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          console.log(`Event ${event.title}: Original date - ${startDate.toISOString()}, Display date key - ${formatDateForDisplay(startDate)}, User timezone: ${userTimezone}`);
        });
      }
      
      return events;
    }
  });
  
  // No need to filter events as the API already does that
  const filteredEvents = eventsQueries.data || [];

  type CreateMutationContext = {
    tempEvent?: Event;
    previousEvents?: Event[];
    allQueryKeys?: QueryKey[];
  };

  const createEventMutation = useMutation<Event, Error, Omit<Event, 'id' | 'uid'>, CreateMutationContext>({
    mutationFn: async (newEvent) => {
      // Short delay to ensure UI updates finish before server request
      await new Promise(resolve => setTimeout(resolve, 10));
      
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
      
      // Keep optimistic UI updates for a short time to avoid flicker
      setTimeout(() => {
        // Replace all instances of the temp event with the real one
        if (context?.tempEvent) {
          // 1. Update main events cache
          queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
            return oldEvents.map(e => 
              e.id === context.tempEvent?.id ? serverEvent : e
            );
          });
          
          // 2. Update any date-filtered caches
          if (context.allQueryKeys) {
            context.allQueryKeys.forEach((key: QueryKey) => {
              if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
                queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
                  return oldEvents.map(e => 
                    e.id === context.tempEvent?.id ? serverEvent : e
                  );
                });
              }
            });
          }
          
          // 3. Update calendar-specific cache
          queryClient.setQueryData<Event[]>(
            ['/api/calendars', serverEvent.calendarId, 'events'], 
            (oldEvents = []) => {
              return oldEvents.map(e => 
                e.id === context.tempEvent?.id ? serverEvent : e
              );
            }
          );
        }
        
        // Show success toast
        toast({
          title: "Event Created",
          description: "New event has been created successfully."
        });
        
        // Refetch after a slight delay to avoid UI flicker
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          queryClient.invalidateQueries({ 
            queryKey: ['/api/calendars', serverEvent.calendarId, 'events'] 
          });
          
          // Trigger a manual sync with the server to ensure the event is pushed to the CalDAV server
          fetch('/api/sync', { method: 'POST', credentials: 'include' })
            .then(response => {
              if (response.ok) {
                console.log('Manual sync triggered successfully after event creation');
              } else {
                console.warn('Failed to trigger manual sync after event creation');
              }
            })
            .catch(error => {
              console.error('Error triggering manual sync:', error);
            });
        }, 500);
      }, 10); // tiny delay to ensure UI stays smooth
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

  type UpdateMutationContext = {
    previousEvents?: Event[];
    eventToUpdate?: Event;
    updatedEvent?: Partial<Event> & { id: number };
    allQueryKeys?: QueryKey[];
  };

  const updateEventMutation = useMutation<
    Event, 
    Error, 
    { id: number, data: Partial<Event> }, 
    UpdateMutationContext
  >({
    mutationFn: async ({ id, data }) => {
      // Short delay to ensure UI updates finish before server request
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const res = await apiRequest('PUT', `/api/events/${id}`, data);
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      console.log(`Starting optimistic update for event ${id}`);
      
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
    onSuccess: (serverEvent, variables, context) => {
      console.log(`Event updated successfully on server:`, serverEvent);
      
      // Show success toast
      toast({
        title: "Event Updated",
        description: "Event has been updated successfully."
      });
      
      // Extract the ID that was used in the update request
      const requestId = variables.id;
      
      // Immediately update caches with the server response
      // This is critical to prevent duplicate events from appearing
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        if (!oldEvents) return [serverEvent];
        
        // First remove any potential duplicates (same UID but different ID)
        const filteredEvents = oldEvents.filter(e => 
          e.id === requestId || (e.uid !== serverEvent.uid || e.id === serverEvent.id)
        );
        
        // Then update the event that matches our request ID
        return filteredEvents.map(e => e.id === requestId ? serverEvent : e);
      });
      
      // Update any date-filtered caches
      if (context?.allQueryKeys) {
        context.allQueryKeys.forEach((key: QueryKey) => {
          if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
            queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
              if (!oldEvents) return [serverEvent];
              
              // First remove any potential duplicates
              const filteredEvents = oldEvents.filter(e => 
                e.id === requestId || (e.uid !== serverEvent.uid || e.id === serverEvent.id)
              );
              
              // Then update the matching event
              return filteredEvents.map(e => e.id === requestId ? serverEvent : e);
            });
          }
        });
      }
      
      // If the event has a temporary ID (negative), we need to invalidate the queries to refresh
      if (requestId < 0) {
        console.log(`Invalidating queries due to temporary ID conversion: ${requestId} -> ${serverEvent.id}`);
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }
      
      // Final refresh after a short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', serverEvent.calendarId, 'events'] 
        });
        
        // Trigger a manual sync with the server to ensure updates are pushed to CalDAV
        fetch('/api/sync', { method: 'POST', credentials: 'include' })
          .then(response => {
            if (response.ok) {
              console.log('Manual sync triggered successfully after event update');
            } else {
              console.warn('Failed to trigger manual sync after event update');
            }
          })
          .catch(error => {
            console.error('Error triggering manual sync:', error);
          });
      }, 500);
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
    allQueryKeys?: QueryKey[];
  };

  const deleteEventMutation = useMutation<{success: boolean, id: number, message?: string}, Error, number, DeleteMutationContext>({
    mutationFn: async (id: number) => {
      console.log(`Deleting event with ID ${id}`);
      try {
        const res = await apiRequest('DELETE', `/api/events/${id}`);
        
        // Consider both 204 and 404 as success cases for deletion
        // - 204: Standard success for deletion
        // - 404: Event already gone, which achieves the same end goal
        if (res.status === 204 || res.status === 404) {
          console.log(`Successfully deleted event with ID ${id} (status: ${res.status})`);
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
      
      // Show success toast
      toast({
        title: "Event Deleted",
        description: "Event has been deleted successfully."
      });
      
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
        
        // Trigger a manual sync with CalDAV server to ensure deletion is propagated
        fetch('/api/sync', { method: 'POST', credentials: 'include' })
          .then(response => {
            if (response.ok) {
              console.log('Manual sync triggered successfully after event deletion');
            } else {
              console.warn('Failed to trigger manual sync after event deletion');
            }
          })
          .catch(error => {
            console.error('Error triggering manual sync:', error);
          });
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

  return {
    events: filteredEvents,
    isLoading: eventsQueries.isLoading,
    error: eventsQueries.error,
    refetch: eventsQueries.refetch,
    createEvent: createEventMutation.mutate,
    updateEvent: updateEventMutation.mutate,
    deleteEvent: deleteEventMutation.mutate
  };
};
