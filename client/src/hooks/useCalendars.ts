import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Calendar } from '@shared/schema';

export const useCalendars = () => {
  const { toast } = useToast();

  const calendarsQuery = useQuery<Calendar[]>({
    queryKey: ['/api/calendars'],
    queryFn: getQueryFn({ on401: "continueWithEmpty" }), // Use continueWithEmpty for graceful auth handling
  });

  const createCalendarMutation = useMutation({
    mutationFn: (newCalendar: Omit<Calendar, 'id' | 'userId'>) => {
      return apiRequest('POST', '/api/calendars', newCalendar)
        .then(res => res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      toast({
        title: "Calendar Created",
        description: "New calendar has been created successfully."
      });
    },
    onError: async (error) => {
      // Try to extract the error message from the response
      let errorMessage = "An error occurred while creating the calendar.";
      
      try {
        // If it's a response from our API, try to extract the error message
        if (error instanceof Error && 'cause' in error) {
          const response = error.cause as Response;
          if (response && response.json) {
            const data = await response.json();
            errorMessage = data.message || errorMessage;
          } else {
            errorMessage = error.message || errorMessage;
          }
        } else {
          errorMessage = error.message || errorMessage;
        }
      } catch (e) {
        // If we can't parse the response, just use the original error message
        errorMessage = error.message || errorMessage;
      }
      
      toast({
        title: "Failed to Create Calendar",
        description: errorMessage,
        variant: "destructive"
      });
    }
  });

  const updateCalendarMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: Partial<Calendar> }) => {
      return apiRequest('PUT', `/api/calendars/${id}`, data)
        .then(res => res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      toast({
        title: "Calendar Updated",
        description: "Calendar has been updated successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Calendar",
        description: error.message || "An error occurred while updating the calendar.",
        variant: "destructive"
      });
    }
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        const res = await apiRequest('DELETE', `/api/calendars/${id}`);
        if (res.status === 204) return true;
        
        // If it's not a 204 response, try to parse the JSON for detailed error message
        const data = await res.json();
        
        // If the response is not successful, throw an error with the message
        if (!res.ok) {
          throw new Error(data.message || "Unknown error");
        }
        
        return data;
      } catch (error) {
        console.error("Calendar deletion error:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      // Also invalidate events as they would be deleted with the calendar
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      toast({
        title: "Calendar Deleted",
        description: "Calendar has been deleted successfully."
      });
    },
    onError: async (error) => {
      // Try to extract the error message from the response
      let errorMessage = "An error occurred while deleting the calendar.";
      
      try {
        // If it's a response from our API, try to extract the error message
        if (error instanceof Error && 'cause' in error) {
          const response = error.cause as Response;
          if (response && response.json) {
            const data = await response.json();
            errorMessage = data.message || errorMessage;
          } else {
            errorMessage = error.message || errorMessage;
          }
        } else {
          errorMessage = error.message || errorMessage;
        }
      } catch (e) {
        // If we can't parse the response, just use the original error message
        errorMessage = error.message || errorMessage;
      }
      
      toast({
        title: "Failed to Delete Calendar",
        description: errorMessage,
        variant: "destructive"
      });
    }
  });

  return {
    calendars: calendarsQuery.data || [],
    isLoading: calendarsQuery.isLoading,
    error: calendarsQuery.error,
    createCalendar: createCalendarMutation.mutate,
    updateCalendar: updateCalendarMutation.mutate,
    deleteCalendar: deleteCalendarMutation.mutate
  };
};
