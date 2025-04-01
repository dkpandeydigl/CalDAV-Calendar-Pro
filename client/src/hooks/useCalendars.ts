import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Calendar } from '@shared/schema';

export const useCalendars = () => {
  const { toast } = useToast();

  const calendarsQuery = useQuery<Calendar[]>({
    queryKey: ['/api/calendars'],
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
    onError: (error) => {
      toast({
        title: "Failed to Create Calendar",
        description: error.message || "An error occurred while creating the calendar.",
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
    mutationFn: (id: number) => {
      return apiRequest('DELETE', `/api/calendars/${id}`)
        .then(res => {
          if (res.status === 204) return true;
          return res.json();
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      toast({
        title: "Calendar Deleted",
        description: "Calendar has been deleted successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Calendar",
        description: error.message || "An error occurred while deleting the calendar.",
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
