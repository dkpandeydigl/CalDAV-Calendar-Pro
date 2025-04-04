import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Calendar } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Extended calendar type with permission information
export interface SharedCalendar extends Calendar {
  permission: 'view' | 'edit';
  isShared: boolean;
  ownerEmail?: string; // Email address of the user who shared the calendar
}

export const useSharedCalendars = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const sharedCalendarsQuery = useQuery<SharedCalendar[]>({
    queryKey: ['/api/shared-calendars'],
    // Tanstack Query v5 doesn't support these callbacks directly in the options
    // so we'll use the result object's callbacks instead
  });
  
  // Use the data from the query for debugging using effects
  useEffect(() => {
    const data = sharedCalendarsQuery.data;
    if (data) {
      console.log("Shared calendars loaded:", data.length || 0, "calendars");
      if (data.length > 0) {
        console.log("First shared calendar permissions:", {
          name: data[0].name,
          id: data[0].id,
          permission: data[0].permission,
          isShared: data[0].isShared,
          canEdit: data[0].permission === 'edit'
        });
      }
    }
  }, [sharedCalendarsQuery.data]);
  
  // Log errors using effects
  useEffect(() => {
    if (sharedCalendarsQuery.error) {
      console.error("Error loading shared calendars:", sharedCalendarsQuery.error);
    }
  }, [sharedCalendarsQuery.error]);

  // Toggle the visibility (enabled status) of a shared calendar locally
  // without making a server API call
  const toggleCalendarVisibility = (calendarId: number, enabled: boolean) => {
    const currentData = queryClient.getQueryData<SharedCalendar[]>(['/api/shared-calendars']);
    
    if (!currentData) return;
    
    const updatedData = currentData.map(calendar => 
      calendar.id === calendarId ? { ...calendar, enabled } : calendar
    );
    
    // Update the shared calendars data in cache
    queryClient.setQueryData(['/api/shared-calendars'], updatedData);
    
    // Since the enabled status affects which events are displayed,
    // we need to invalidate the events query to trigger a re-fetch
    // with the updated enabled calendar IDs
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
  };
  
  // Unshare a single calendar - removes it from the UI immediately
  const unshareCalendarMutation = useMutation({
    mutationFn: async (calendarId: number) => {
      // Build URL with the calendar ID parameter - the server will find the sharing record
      const apiUrl = `/api/calendars/unshare/${calendarId}`;
      await apiRequest('DELETE', apiUrl);
      return calendarId;
    },
    onMutate: async (calendarId) => {
      // Cancel any outgoing refetches 
      await queryClient.cancelQueries({ queryKey: ['/api/shared-calendars'] });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(['/api/shared-calendars']);
      
      // Remove the calendar from the cache immediately
      if (previousSharedCalendars) {
        const removedCalendar = previousSharedCalendars.find(cal => cal.id === calendarId);
        const updatedCalendars = previousSharedCalendars.filter(cal => cal.id !== calendarId);
        
        queryClient.setQueryData(['/api/shared-calendars'], updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, removedCalendar };
      }
      
      return { previousSharedCalendars };
    },
    onSuccess: (calendarId, _, context) => {
      const removedCalendar = context?.removedCalendar;
      toast({
        title: "Calendar unshared",
        description: removedCalendar ? `You no longer have access to "${removedCalendar.name}"` : "Calendar removed from your view",
      });
    },
    onError: (error, calendarId, context) => {
      // If the mutation fails, use the context we saved to roll back
      if (context?.previousSharedCalendars) {
        queryClient.setQueryData(['/api/shared-calendars'], context.previousSharedCalendars);
      }
      
      console.error('Error unsharing calendar:', error);
      toast({
        title: "Error",
        description: "Failed to unshare calendar. Please try again.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
    }
  });
  
  // Bulk unshare all calendars from a specific owner
  const bulkUnshareCalendarsMutation = useMutation({
    mutationFn: async (calendars: SharedCalendar[]) => {
      // Execute all unshare operations in parallel
      const unsharePromises = calendars.map(calendar => {
        const apiUrl = `/api/calendars/unshare/${calendar.id}`;
        return apiRequest('DELETE', apiUrl);
      });
      
      await Promise.all(unsharePromises);
      return calendars;
    },
    onMutate: async (calendarsToRemove) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/shared-calendars'] });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(['/api/shared-calendars']);
      
      // Get the owner email from the first calendar (they all have the same owner)
      const ownerEmail = calendarsToRemove[0]?.ownerEmail;
      
      // Remove all the calendars from the cache immediately
      if (previousSharedCalendars) {
        const calendarIdsToRemove = new Set(calendarsToRemove.map(cal => cal.id));
        const updatedCalendars = previousSharedCalendars.filter(cal => !calendarIdsToRemove.has(cal.id));
        
        queryClient.setQueryData(['/api/shared-calendars'], updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, ownerEmail };
      }
      
      return { previousSharedCalendars };
    },
    onSuccess: (calendars, _, context) => {
      toast({
        title: "Calendars unshared",
        description: context?.ownerEmail 
          ? `You no longer have access to calendars shared by ${context.ownerEmail}` 
          : "Calendars removed from your view",
      });
    },
    onError: (error, _, context) => {
      // If the mutation fails, use the context we saved to roll back
      if (context?.previousSharedCalendars) {
        queryClient.setQueryData(['/api/shared-calendars'], context.previousSharedCalendars);
      }
      
      console.error('Error unsharing calendars:', error);
      toast({
        title: "Error",
        description: "Failed to unshare all calendars. Please try again.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
    }
  });

  return {
    sharedCalendars: sharedCalendarsQuery.data || [],
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error,
    toggleCalendarVisibility,
    unshareCalendar: unshareCalendarMutation.mutate,
    isUnsharing: unshareCalendarMutation.isPending,
    bulkUnshareCalendars: bulkUnshareCalendarsMutation.mutate,
    isBulkUnsharing: bulkUnshareCalendarsMutation.isPending
  };
};