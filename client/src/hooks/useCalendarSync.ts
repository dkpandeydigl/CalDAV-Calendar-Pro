import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook for real-time calendar synchronization
 * 
 * This hook manages WebSocket connections for real-time updates
 * and provides functions for manual sync operations.
 */
export function useCalendarSync() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Sync tokens are stored in localStorage for persistence
  const getSyncToken = useCallback((calendarId: number) => {
    return localStorage.getItem(`calendar_sync_${calendarId}`);
  }, []);

  const saveSyncToken = useCallback((calendarId: number, token: string) => {
    localStorage.setItem(`calendar_sync_${calendarId}`, token);
  }, []);

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    if (!user) return;
    
    // Close any existing connection
    if (socket) {
      socket.close();
    }
    
    // Create new WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected for calendar sync');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        
        if (data.type === 'calendar_changed') {
          console.log('Calendar changed notification received:', data);
          
          // Show notification
          const changeCount = 
            (data.changes?.added || 0) + 
            (data.changes?.modified || 0) + 
            (data.changes?.deleted || 0);
          
          if (changeCount > 0) {
            toast({
              title: 'Calendar Updated',
              description: `${changeCount} change${changeCount !== 1 ? 's' : ''} detected`,
            });
            
            // Invalidate queries to refresh UI
            queryClient.invalidateQueries({ queryKey: ['/api/events'] });
            queryClient.invalidateQueries({ 
              queryKey: ['/api/calendars', data.calendarId, 'events'] 
            });
            
            // Update sync token if provided
            if (data.syncToken) {
              saveSyncToken(data.calendarId, data.syncToken);
            }
          }
        } 
        else if (data.type === 'event_changed') {
          console.log('Event changed notification received:', data);
          
          toast({
            title: 'Event Updated',
            description: `Event was ${data.changeType} in calendar`,
          });
          
          // Invalidate queries to refresh UI
          queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          
          // If we have the specific event ID, also invalidate that query
          if (data.eventId) {
            queryClient.invalidateQueries({ 
              queryKey: ['/api/events', data.eventId] 
            });
          }
        }
        else if (data.type === 'new_notification') {
          console.log('New notification received:', data);
          
          // The notification context will handle this
          // We just make sure events are refreshed if it's event-related
          if (data.notification && 
              (data.notification.type === 'event_update' || 
               data.notification.type === 'event_invitation' ||
               data.notification.type === 'event_cancellation')) {
            
            queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          }
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };
    
    setSocket(ws);
    
    // Clean up connection on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [user, queryClient, toast, saveSyncToken]);

  /**
   * Trigger an immediate sync for a specific calendar
   */
  const syncCalendar = useCallback(async (calendarId: number) => {
    if (syncing) return;
    
    try {
      setSyncing(true);
      
      const syncToken = getSyncToken(calendarId);
      
      const response = await apiRequest('/api/sync', {
        method: 'POST',
        body: JSON.stringify({
          calendarId,
          syncToken,
          forceRefresh: true
        })
      });
      
      if (response.syncToken) {
        saveSyncToken(calendarId, response.syncToken);
      }
      
      setLastSyncTime(new Date());
      
      // Show changes if any
      const changeCount = 
        (response.changes?.added?.length || 0) + 
        (response.changes?.modified?.length || 0) + 
        (response.changes?.deleted?.length || 0);
      
      if (changeCount > 0) {
        toast({
          title: 'Calendar Synchronized',
          description: `${changeCount} change${changeCount !== 1 ? 's' : ''} applied`,
        });
        
        // Refresh queries
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', calendarId, 'events'] 
        });
      } else {
        toast({
          title: 'Calendar Synchronized',
          description: 'No changes detected',
        });
      }
      
      return response;
    } catch (error) {
      console.error('Error syncing calendar:', error);
      toast({
        title: 'Sync Failed',
        description: error instanceof Error ? error.message : 'Failed to sync calendar',
        variant: 'destructive'
      });
    } finally {
      setSyncing(false);
    }
  }, [syncing, getSyncToken, saveSyncToken, queryClient, toast]);

  /**
   * Sync all calendars
   */
  const syncAllCalendars = useCallback(async (calendarIds: number[]) => {
    if (syncing) return;
    
    try {
      setSyncing(true);
      
      const results = await Promise.allSettled(
        calendarIds.map(id => syncCalendar(id))
      );
      
      // Count successful syncs
      const successCount = results.filter(
        result => result.status === 'fulfilled'
      ).length;
      
      setLastSyncTime(new Date());
      
      // Show summary toast
      if (successCount === calendarIds.length) {
        toast({
          title: 'All Calendars Synchronized',
          description: `Successfully synced ${successCount} calendar${successCount !== 1 ? 's' : ''}`,
        });
      } else {
        toast({
          title: 'Calendar Sync Incomplete',
          description: `Synced ${successCount}/${calendarIds.length} calendars`,
          variant: 'default'
        });
      }
      
      // Refresh all events
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      return results;
    } catch (error) {
      console.error('Error syncing all calendars:', error);
      toast({
        title: 'Sync Failed',
        description: error instanceof Error ? error.message : 'Failed to sync calendars',
        variant: 'destructive'
      });
    } finally {
      setSyncing(false);
    }
  }, [syncing, syncCalendar, toast, queryClient]);

  /**
   * Push local pending events to server
   */
  const pushLocalEvents = useCallback(async () => {
    if (syncing) return;
    
    try {
      setSyncing(true);
      
      const response = await apiRequest('/api/sync/push-local', {
        method: 'POST'
      });
      
      // Show result
      if (response.pushed > 0) {
        toast({
          title: 'Local Events Pushed',
          description: `${response.pushed} event${response.pushed !== 1 ? 's' : ''} sent to server`,
        });
        
        // Refresh queries
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }
      
      return response;
    } catch (error) {
      console.error('Error pushing local events:', error);
      toast({
        title: 'Push Failed',
        description: error instanceof Error ? error.message : 'Failed to push local events',
        variant: 'destructive'
      });
    } finally {
      setSyncing(false);
    }
  }, [syncing, queryClient, toast]);

  return {
    syncing,
    lastSyncTime,
    syncCalendar,
    syncAllCalendars,
    pushLocalEvents
  };
}