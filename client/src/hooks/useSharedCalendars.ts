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
  enabled: boolean; // Must be explicitly defined, don't rely on inheritance
}

export const useSharedCalendars = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Get the current user
  const currentUser = queryClient.getQueryData<any>(['/api/user']);
  const currentUserId = currentUser?.id;
  
  const sharedCalendarsQuery = useQuery<SharedCalendar[]>({
    queryKey: ['/api/shared-calendars', currentUserId], // Include user ID in query key for proper cache management
    // ONLY enable query when we have a user ID to prevent cache from showing wrong data on login/logout
    enabled: !!currentUserId,
    // Add explicit debug logging for request and response
    queryFn: async ({ queryKey }) => {
      const url = queryKey[0] as string;
      
      try {
        // Make the API request
        const response = await fetch(url);
        
        // Handle non-200 responses
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} ${errorText}`);
        }
        
        // Parse the response
        const data = await response.json();
        return data;
      } catch (error) {
        throw error;
      }
    },
    // Tanstack Query v5 doesn't support these callbacks directly in the options
    // so we'll use the result object's callbacks instead
  });
  
  // Log errors using effects
  useEffect(() => {
    if (sharedCalendarsQuery.error) {
      console.error("Error loading shared calendars:", sharedCalendarsQuery.error);
    }
  }, [sharedCalendarsQuery.error]);

  // Toggle the visibility (enabled status) of a shared calendar locally
  // without making a server API call
  const toggleCalendarVisibility = (calendarId: number, enabled: boolean) => {
    // Use the queryKey that includes user ID to ensure we're updating the right cache entry
    const queryKey = ['/api/shared-calendars', currentUserId];
    const currentData = queryClient.getQueryData<SharedCalendar[]>(queryKey);
    
    if (!currentData) return;
    
    const updatedData = currentData.map(calendar => 
      calendar.id === calendarId ? { ...calendar, enabled } : calendar
    );
    
    // Update the shared calendars data in cache with proper query key
    queryClient.setQueryData(queryKey, updatedData);
    
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
      // Use proper query key with user ID
      const queryKey = ['/api/shared-calendars', currentUserId];
      
      // Cancel any outgoing refetches 
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(queryKey);
      
      // Remove the calendar from the cache immediately
      if (previousSharedCalendars) {
        const removedCalendar = previousSharedCalendars.find(cal => cal.id === calendarId);
        const updatedCalendars = previousSharedCalendars.filter(cal => cal.id !== calendarId);
        
        queryClient.setQueryData(queryKey, updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, removedCalendar, queryKey };
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
      if (context?.previousSharedCalendars && context?.queryKey) {
        // Use the saved query key for rollback to ensure we're updating the correct cache entry
        queryClient.setQueryData(context.queryKey, context.previousSharedCalendars);
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
      // Use proper query key pattern with user ID
      queryClient.invalidateQueries({ 
        queryKey: ['/api/shared-calendars', currentUserId] 
      });
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
      // Use proper query key with user ID
      const queryKey = ['/api/shared-calendars', currentUserId];
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(queryKey);
      
      // Get the owner email from the first calendar (they all have the same owner)
      const ownerEmail = calendarsToRemove[0]?.ownerEmail;
      
      // Remove all the calendars from the cache immediately
      if (previousSharedCalendars) {
        const calendarIdsToRemove = new Set(calendarsToRemove.map(cal => cal.id));
        const updatedCalendars = previousSharedCalendars.filter(cal => !calendarIdsToRemove.has(cal.id));
        
        queryClient.setQueryData(queryKey, updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, ownerEmail, queryKey };
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
      if (context?.previousSharedCalendars && context?.queryKey) {
        // Use the saved query key for rollback to ensure we're updating the correct cache entry
        queryClient.setQueryData(context.queryKey, context.previousSharedCalendars);
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
      // Use proper query key pattern with user ID
      queryClient.invalidateQueries({ 
        queryKey: ['/api/shared-calendars', currentUserId] 
      });
    }
  });

  // Thanks to our strict server-side security filtering, we can now trust the shared calendars directly from the server
  // The server will never send calendars owned by the current user in the shared calendars API
  // This simplifies our client-side logic and prevents bugs
  const filteredSharedCalendars = sharedCalendarsQuery.data || [];
  
  // No debug logging in production version

  return {
    sharedCalendars: filteredSharedCalendars,
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error,
    toggleCalendarVisibility,
    unshareCalendar: unshareCalendarMutation.mutate,
    isUnsharing: unshareCalendarMutation.isPending,
    bulkUnshareCalendars: bulkUnshareCalendarsMutation.mutate,
    isBulkUnsharing: bulkUnshareCalendarsMutation.isPending
  };
};