import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Event } from '@shared/schema';
import { useCalendars } from './useCalendars';

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

  const createEventMutation = useMutation({
    mutationFn: (newEvent: Omit<Event, 'id' | 'uid'>) => {
      return apiRequest('POST', '/api/events', newEvent)
        .then(res => res.json());
    },
    onMutate: async (newEvent) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/events'] });
      
      // Create a temporary ID for optimistic UI
      const tempEvent = {
        ...newEvent,
        id: -Math.floor(Math.random() * 1000000), // Temporary negative ID to avoid conflicts
        uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@optimistic`
      } as Event;
      
      // Optimistically update the events cache with the new event
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
        return oldEvents ? [...oldEvents, tempEvent] : [tempEvent];
      });
      
      return { tempEvent };
    },
    onSuccess: (newEvent, variables, context) => {
      // Show success toast
      toast({
        title: "Event Created",
        description: "New event has been created successfully."
      });
      
      // Update the cache with the actual event from the server
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
        if (!oldEvents) return [newEvent];
        
        // Replace the temporary event with the real one
        return oldEvents.map(event => 
          (context?.tempEvent && event.id === context.tempEvent.id) ? newEvent : event
        );
      });
      
      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendars', variables.calendarId, 'events'] });
    },
    onError: (error, variables, context) => {
      // Remove the optimistic event on error
      if (context?.tempEvent) {
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
          return oldEvents ? oldEvents.filter(e => e.id !== context.tempEvent.id) : [];
        });
      }
      
      // Show error toast
      toast({
        title: "Failed to Create Event",
        description: error.message || "An error occurred while creating the event.",
        variant: "destructive"
      });
      
      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    }
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: Partial<Event> }) => {
      return apiRequest('PUT', `/api/events/${id}`, data)
        .then(res => res.json());
    },
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/events'] });
      
      // Get the current events from the cache
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      
      // Find the event in the cache
      const eventToUpdate = previousEvents?.find(e => e.id === id);
      if (!eventToUpdate) return { previousEvents };
      
      // Make a copy of the event with the updated data
      const updatedEvent = { ...eventToUpdate, ...data };
      
      // Optimistically update the cache with the updated event
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
        if (!oldEvents) return [];
        return oldEvents.map(e => e.id === id ? updatedEvent : e);
      });
      
      return { previousEvents, eventToUpdate };
    },
    onSuccess: (updatedEvent, variables) => {
      // Show success toast
      toast({
        title: "Event Updated",
        description: "Event has been updated successfully."
      });
      
      // Ensure the cache has the latest data from the server
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
        if (!oldEvents) return [updatedEvent];
        return oldEvents.map(e => e.id === variables.id ? updatedEvent : e);
      });
      
      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendars', updatedEvent.calendarId, 'events'] });
    },
    onError: (error, variables, context) => {
      // Roll back to the previous state if we have it
      if (context?.previousEvents) {
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
      }
      
      // Show error toast
      toast({
        title: "Failed to Update Event",
        description: error.message || "An error occurred while updating the event.",
        variant: "destructive"
      });
      
      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    }
  });

  const deleteEventMutation = useMutation<{success: boolean, id: number, message?: string}, Error, number>({
    mutationFn: async (id: number) => {
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
    // Use onMutate for optimistic updates - happens immediately before the mutation
    onMutate: async (id) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/events'] });
      
      // Get the current events from the cache
      const previousEvents = queryClient.getQueryData<Event[]>(['/api/events']);
      
      // Find the event to be deleted (for calendar ID and reversion)
      const eventToDelete = previousEvents?.find(e => e.id === id);
      
      if (eventToDelete) {
        // Optimistically remove the event from the cache
        queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
          if (!oldEvents) return [];
          return oldEvents.filter(e => e.id !== id);
        });
      }
      
      // Return context with previous state to revert if needed
      return { previousEvents, eventToDelete };
    },
    // This happens after successful mutation
    onSuccess: (result, id, context) => {
      console.log(`Delete mutation succeeded with result:`, result);
      
      // Show success toast
      toast({
        title: "Event Deleted",
        description: "Event has been deleted successfully."
      });
      
      // Refetch data to ensure our cache is up to date
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Also invalidate the specific calendar's events if we have that info
      if (context?.eventToDelete) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', context.eventToDelete.calendarId, 'events'] 
        });
      }
    },
    // This happens if the mutation fails
    onError: (error, id, context) => {
      console.error(`Error deleting event with ID ${id}:`, error);
      
      // Revert to the previous state
      if (context?.previousEvents) {
        queryClient.setQueryData<Event[]>(['/api/events'], context.previousEvents);
      }
      
      // Show error toast
      toast({
        title: "Failed to Delete Event",
        description: error.message || "An error occurred while deleting the event.",
        variant: "destructive"
      });
      
      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
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
