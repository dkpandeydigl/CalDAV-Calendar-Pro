/**
 * useCalendarEvents hook for fetching and managing calendar events
 * This is a simplified version
 */

import { useMemo, useCallback, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Define basic event type
export interface Event {
  id: number;
  title: string;
  uid: string;
  calendarId: number;
  description: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date;
  allDay: boolean | null;
  timezone: string | null;
  recurrenceRule: string | null;
  attendees: any[] | null;
  resources: any[] | null;
  isRecurring: boolean;
  sequence: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  syncStatus: 'synced' | 'syncing' | 'failed' | 'pending' | null;
  lastModifiedAt: Date | null;
}

// Type for query keys
type QueryKey = unknown;

// Type for event filter function
type EventFilter = (e: Event) => boolean;

// Cache version data
interface CacheVersionData {
  version: number;
  lastUpdated: number;
  source: string;
}

const globalCacheVersion: CacheVersionData = {
  version: 1,
  lastUpdated: Date.now(),
  source: 'initial'
};

// Main hook for calendar events
export const useCalendarEvents = (startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();
  const [deletedEventIds, setDeletedEventIds] = useState<Set<number>>(new Set());
  
  // Calculate date range for filtering
  const { start, end } = useMemo(() => {
    // Simple date range calculation
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(today.getDate() - 7); // 1 week before
    
    const defaultEnd = new Date(today);
    defaultEnd.setDate(today.getDate() + 30); // 1 month ahead
    
    return {
      start: startDate || defaultStart,
      end: endDate || defaultEnd
    };
  }, [startDate, endDate]);
  
  // Function to track deleted events in memory
  const trackDeletedInMemory = useCallback((event: Event) => {
    setDeletedEventIds(prev => {
      const newSet = new Set(prev);
      newSet.add(event.id);
      return newSet;
    });
  }, []);
  
  // Fetch events query
  const eventsQuery = useQuery({
    queryKey: ['/api/events'],
    staleTime: 15000, // 15 seconds
    refetchInterval: 30000, // 30 seconds 
    retry: 3
  });

  // Filter and deduplicate events
  const events = useMemo(() => {
    if (!eventsQuery.data || !Array.isArray(eventsQuery.data)) return [];
    
    // Filter out deleted events
    return eventsQuery.data.filter((event: any) => 
      event && typeof event.id === 'number' && !deletedEventIds.has(event.id)
    );
  }, [eventsQuery.data, deletedEventIds]);
  
  // Create event mutation
  const createMutation = useMutation({
    mutationFn: async (eventData: Partial<Event>) => {
      try {
        // Use fetch directly instead of apiRequest to avoid the type issue
        const response = await fetch('/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventData),
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to create event: ${response.status} ${response.statusText}`);
        }

        // Check content type to catch HTML responses instead of JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          console.warn('Received HTML response instead of JSON. Session may be expired.');
          // Return a safe result with helpful message
          return {
            success: false,
            event: eventData,
            message: 'Authentication expired. Please refresh the page and try again.'
          };
        }
        
        return await response.json();
      } catch (error) {
        console.error('Error in event creation request:', error);
        throw error;
      }
    }
  });

  // Update event mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Event> }) => {
      try {
        // Use fetch directly 
        const response = await fetch(`/api/events/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data),
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to update event: ${response.status} ${response.statusText}`);
        }
        
        // Check content type to catch HTML responses instead of JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          console.warn('Received HTML response instead of JSON. Session may be expired.');
          // Return a safe result with helpful message
          return {
            success: false,
            event: { id },
            hasAttendees: false,
            message: 'Authentication expired. Please refresh the page and try again.'
          };
        }
        
        return await response.json();
      } catch (error) {
        console.error('Error in event update request:', error);
        throw error;
      }
    }
  });

  // Delete event mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        // Use fetch directly
        const response = await fetch(`/api/events/${id}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to delete event: ${response.status} ${response.statusText}`);
        }
        
        // Check content type to catch HTML responses instead of JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          console.warn('Received HTML response instead of JSON. Session may be expired.');
          // Return a safe result with helpful message
          return {
            success: false,
            message: 'Authentication expired. Please refresh the page and try again.'
          };
        }
        
        return await response.json();
      } catch (error) {
        console.error('Error in event deletion request:', error);
        throw error;
      }
    },
    onSuccess: (data, id) => {
      // Add the deleted ID to our in-memory tracking
      trackDeletedInMemory({ id } as Event);
      
      // Update the cache
      queryClient.setQueryData<Event[]>('/api/events', (oldEvents = []) => {
        return oldEvents.filter(e => e.id !== id);
      });
      
      // Show success toast
      toast({
        title: "Event Deleted",
        description: "The event has been successfully deleted."
      });
    }
  });

  return {
    events,
    isLoading: eventsQuery.isLoading,
    isError: eventsQuery.isError,
    error: eventsQuery.error,
    refetch: eventsQuery.refetch,
    createEvent: createMutation.mutate,
    updateEvent: updateMutation.mutate,
    deleteEvent: deleteMutation.mutate,
    createEventAsync: createMutation.mutateAsync,
    updateEventAsync: updateMutation.mutateAsync,
    deleteEventAsync: deleteMutation.mutateAsync
  };
};

// Function to filter events by date range
export const isEventInRange = (event: Event, start: Date, end: Date): boolean => {
  const eventStart = new Date(event.startDate);
  const eventEnd = new Date(event.endDate);
  
  // Event starts in range
  if (eventStart >= start && eventStart <= end) return true;
  
  // Event ends in range
  if (eventEnd >= start && eventEnd <= end) return true;
  
  // Event spans range
  if (eventStart <= start && eventEnd >= end) return true;
  
  return false;
};

// Export a reference to the global cache version for external use
export const getCacheVersion = () => ({ ...globalCacheVersion });