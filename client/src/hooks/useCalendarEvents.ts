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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendars', variables.calendarId, 'events'] });
      toast({
        title: "Event Created",
        description: "New event has been created successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Event",
        description: error.message || "An error occurred while creating the event.",
        variant: "destructive"
      });
    }
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: Partial<Event> }) => {
      return apiRequest('PUT', `/api/events/${id}`, data)
        .then(res => res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      const event = eventsQueries.data?.find(e => e.id === variables.id);
      if (event) {
        queryClient.invalidateQueries({ queryKey: ['/api/calendars', event.calendarId, 'events'] });
      }
      toast({
        title: "Event Updated",
        description: "Event has been updated successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Event",
        description: error.message || "An error occurred while updating the event.",
        variant: "destructive"
      });
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
    onSuccess: (result, id) => {
      // Always update the local cache to remove the event
      console.log(`Delete mutation succeeded with result:`, result);
      
      // Immediately remove the event from the cache
      queryClient.setQueryData<Event[]>(['/api/events'], (oldEvents) => {
        if (!oldEvents) return [];
        return oldEvents.filter(e => e.id !== id);
      });
      
      // Then invalidate the queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Find the calendar ID to invalidate calendar-specific data
      const event = eventsQueries.data?.find(e => e.id === id);
      if (event) {
        queryClient.invalidateQueries({ queryKey: ['/api/calendars', event.calendarId, 'events'] });
      }
      
      // Show success toast
      toast({
        title: "Event Deleted",
        description: "Event has been deleted successfully."
      });
    },
    onError: (error, id) => {
      console.error(`Error deleting event with ID ${id}:`, error);
      
      // Show error toast
      toast({
        title: "Failed to Delete Event",
        description: error.message || "An error occurred while deleting the event.",
        variant: "destructive"
      });
      
      // Even on error, refresh the events list as we might be out of sync
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
