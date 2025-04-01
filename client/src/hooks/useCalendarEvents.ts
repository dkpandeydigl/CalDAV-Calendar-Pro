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
      const response = await fetch(`/api/events${queryString}`, { 
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }
      
      return response.json();
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

  const deleteEventMutation = useMutation({
    mutationFn: (id: number) => {
      return apiRequest('DELETE', `/api/events/${id}`)
        .then(res => {
          if (res.status === 204) return true;
          return res.json();
        });
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      const event = eventsQueries.data?.find(e => e.id === id);
      if (event) {
        queryClient.invalidateQueries({ queryKey: ['/api/calendars', event.calendarId, 'events'] });
      }
      toast({
        title: "Event Deleted",
        description: "Event has been deleted successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Event",
        description: error.message || "An error occurred while deleting the event.",
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
    deleteEvent: deleteEventMutation.mutate
  };
};
