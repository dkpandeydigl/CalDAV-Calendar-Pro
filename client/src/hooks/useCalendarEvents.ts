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
        recurrenceRule: null
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
    updatedEvent?: Event;
    allQueryKeys?: QueryKey[];
  };

  const updateEventMutation = useMutation<Event, Error, { id: number, data: Partial<Event> }, UpdateMutationContext>({
    mutationFn: async ({ id, data }) => {
      // Short delay to ensure UI updates finish before server request
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const res = await apiRequest('PUT', `/api/events/${id}`, data);
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      console.log(`Starting optimistic update for event ${id}`);
      
      // Cancel all outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries();
      
      // Store the current state for possible rollback
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      const allQueryKeys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
      
      // Find the event in the cache
      const eventToUpdate = previousEvents?.find(e => e.id === id);
      if (!eventToUpdate) {
        console.warn(`Event with id ${id} not found in cache for update`);
        return { previousEvents, allQueryKeys };
      }
      
      // Create an updated version of the event
      const updatedEvent = { 
        ...eventToUpdate, 
        ...data,
        updatedAt: new Date() // Update the timestamp to show recent changes
      };
      
      console.log(`Optimistically updating event ${id} in UI`, updatedEvent);
      
      // 1. Update the main events cache immediately
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
        return oldEvents.map(e => e.id === id ? updatedEvent : e);
      });
      
      // 2. Update any date-filtered event caches
      allQueryKeys.forEach((key: QueryKey) => {
        if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
          queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
            return oldEvents.map(e => e.id === id ? updatedEvent : e);
          });
        }
      });
      
      // 3. Also update the calendar-specific cache
      queryClient.setQueryData<Event[]>(
        ['/api/calendars', eventToUpdate.calendarId, 'events'], 
        (oldEvents = []) => oldEvents.map(e => e.id === id ? updatedEvent : e)
      );
      
      return { previousEvents, eventToUpdate, updatedEvent, allQueryKeys };
    },
    onSuccess: (serverEvent, variables, context) => {
      console.log(`Event updated successfully on server:`, serverEvent);
      
      // Show success toast
      toast({
        title: "Event Updated",
        description: "Event has been updated successfully."
      });
      
      // Give a bit of delay to make sure users see their changes before any refetch
      setTimeout(() => {
        // Make sure all caches have the latest server data
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents = []) => {
          return oldEvents.map(e => e.id === variables.id ? serverEvent : e);
        });
        
        // Update any date-filtered caches
        if (context?.allQueryKeys) {
          context.allQueryKeys.forEach((key: QueryKey) => {
            if (Array.isArray(key) && key[0] === '/api/events' && key.length > 1) {
              queryClient.setQueryData<Event[]>(key, (oldEvents = []) => {
                return oldEvents.map(e => e.id === variables.id ? serverEvent : e);
              });
            }
          });
        }
        
        // Delayed refetch to ensure data consistency after user has seen their changes
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          queryClient.invalidateQueries({ 
            queryKey: ['/api/calendars', serverEvent.calendarId, 'events'] 
          });
        }, 500); // Half-second delay before refetching
      }, 100);
    },
    onError: (error, variables, context) => {
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
            e => e.calendarId === context.eventToUpdate?.calendarId
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
      
      // Refetch after a delay to ensure data consistency
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }, 1000);
    }
  });

  type DeleteMutationContext = {
    previousEvents?: Event[];
    eventToDelete?: Event;
    allQueryKeys?: QueryKey[];
  };

  const deleteEventMutation = useMutation<{success: boolean, id: number, message?: string}, Error, number, DeleteMutationContext>({
    mutationFn: async (id: number) => {
      // Add a short delay to ensure UI updates finish before server request starts
      await new Promise(resolve => setTimeout(resolve, 10));
      
      console.log(`Deleting event with ID ${id}`);
      try {
        const res = await apiRequest('DELETE', `/api/events/${id}`);
        
        if (res.status === 204) {
          console.log(`Successfully deleted event with ID ${id}`);
          return { success: true, id };
        }
        
        if (res.status === 404) {
          // Handle a 404 as a success for client UX - the event is gone either way
          console.log(`Event ${id} not found, considering delete successful anyway`);
          return { success: true, id, message: "Event was already deleted" };
        }
        
        // For other status codes, try to get the error message from the response
        try {
          const data = await res.json();
          return { 
            success: false, 
            id, 
            message: data.message || `Server returned ${res.status}` 
          };
        } catch (e) {
          // If we can't parse the JSON, return the status code
          return { 
            success: false, 
            id, 
            message: `Server returned ${res.status}` 
          };
        }
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
      
      // Show success toast
      toast({
        title: "Event Deleted",
        description: "Event has been deleted successfully."
      });
      
      // Disable auto-refetching temporarily to prevent flicker
      const refetchAfterDelay = () => {
        setTimeout(() => {
          // Refetch data to ensure our cache is up to date
          queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          
          // Also invalidate the specific calendar's events if we have that info
          if (context?.eventToDelete) {
            queryClient.invalidateQueries({ 
              queryKey: ['/api/calendars', context.eventToDelete.calendarId, 'events'] 
            });
          }
        }, 500); // Half-second delay before refetching
      };
      
      refetchAfterDelay();
    },
    // This happens if the server request fails
    onError: (error, id, context) => {
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
            e => e.calendarId === context.eventToDelete?.calendarId
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
      
      // Refetch after a delay to ensure data consistency
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }, 1000);
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
