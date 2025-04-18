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
      console.log(`Updating calendar ID ${id} with data:`, data);
      return apiRequest('PUT', `/api/calendars/${id}`, data)
        .then(async (res) => {
          const responseData = await res.json();
          console.log(`Calendar update response:`, responseData);
          return responseData;
        });
    },
    onSuccess: (updatedCalendar) => {
      console.log(`Calendar updated successfully:`, updatedCalendar);
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      toast({
        title: "Calendar Updated",
        description: "Calendar has been updated successfully."
      });
    },
    onError: (error) => {
      console.error(`Calendar update failed:`, error);
      toast({
        title: "Failed to Update Calendar",
        description: error.message || "An error occurred while updating the calendar.",
        variant: "destructive"
      });
    }
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log(`Starting calendar deletion for calendar ID: ${id}`);
      
      try {
        console.log(`Making DELETE request to /api/calendars/${id}`);
        const res = await apiRequest('DELETE', `/api/calendars/${id}?debug=true`);
        console.log(`Received response status: ${res.status}`);
        
        if (res.status === 204) {
          console.log("Successful deletion with 204 status code");
          return true;
        }
        
        // If it's not a 204 response, try to parse the JSON for detailed error message
        let data;
        try {
          data = await res.json();
          console.log("Response body:", data);
        } catch (jsonError) {
          console.error("Error parsing response JSON:", jsonError);
          console.log("Raw response:", res);
          throw new Error("Failed to parse server response");
        }
        
        // If the response is not successful, throw an error with the message
        if (!res.ok) {
          console.error("Server returned error status:", res.status, data);
          throw new Error(data?.message || "Unknown error");
        }
        
        return data;
      } catch (error) {
        console.error("Calendar deletion error:", error);
        // Log more detailed information about the error
        if (error instanceof Error) {
          console.error("Error name:", error.name);
          console.error("Error message:", error.message);
          console.error("Error stack:", error.stack);
          
          if ('cause' in error) {
            console.error("Error cause:", error.cause);
          }
        } else {
          console.error("Non-Error object thrown:", error);
        }
        
        throw error;
      }
    },
    onSuccess: () => {
      console.log("Calendar deletion successful, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      // Also invalidate events as they would be deleted with the calendar
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      toast({
        title: "Calendar Deleted",
        description: "Calendar has been deleted successfully."
      });
    },
    onError: async (error) => {
      console.log("Calendar deletion onError handler triggered");
      // Try to extract the error message from the response
      let errorMessage = "An error occurred while deleting the calendar.";
      let errorDetails = "";
      
      try {
        console.log("Attempting to extract detailed error information");
        // If it's a response from our API, try to extract the error message
        if (error instanceof Error && 'cause' in error) {
          const response = error.cause as Response;
          console.log("Error has 'cause' property with status:", response?.status);
          
          if (response && response.json) {
            try {
              const data = await response.json();
              console.log("Parsed error response:", data);
              errorMessage = data.message || errorMessage;
              
              // Extract any additional error details
              if (data.errorDetails) {
                errorDetails = JSON.stringify(data.errorDetails);
              }
              if (data.serverDeletion) {
                errorDetails += ` Server: ${data.serverDeletion.errorMessage || 'Unknown server error'}`;
              }
              if (data.databaseDeletion && data.databaseDeletion.success === false) {
                errorDetails += ` Database: Failed to delete from database.`;
              }
            } catch (jsonError) {
              console.error("Failed to parse error response JSON:", jsonError);
              errorMessage = `${errorMessage} (Failed to parse error details)`;
            }
          } else {
            console.log("Using error.message as errorMessage");
            errorMessage = error.message || errorMessage;
          }
        } else {
          console.log("Error is not an Error with cause, using error.message");
          errorMessage = error.message || errorMessage;
        }
      } catch (e) {
        console.error("Exception in error handling:", e);
        // If we can't parse the response, just use the original error message
        errorMessage = `${errorMessage} (Error parsing details: ${e})`;
      }
      
      // If we have error details, add them to the toast
      const finalMessage = errorDetails 
        ? `${errorMessage}\n\nDetails: ${errorDetails}` 
        : errorMessage;
      
      console.log("Showing error toast with message:", finalMessage);
      
      toast({
        title: "Failed to Delete Calendar",
        description: finalMessage,
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
