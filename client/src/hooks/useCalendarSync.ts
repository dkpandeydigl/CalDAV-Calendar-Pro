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
    
    // Variables for reconnection
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // Start with 1 second delay
    
    // Function to create and set up a new WebSocket connection
    const connectWebSocket = () => {
      // Close any existing connection
      if (socket) {
        socket.close();
      }
      
      // Create new WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket connected for calendar sync');
        // Reset reconnect attempts when successfully connected
        reconnectAttempts = 0;
        
        // Store last successful connection time in localStorage
        localStorage.setItem('lastWsConnectTime', new Date().toISOString());
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
            
            // Generate a more specific and informative notification message
            let title = 'Calendar Event';
            let description = '';
            
            if (data.changeType === 'added') {
              title = 'New Event Added';
              description = data.data?.title ? 
                `"${data.data.title}" was added to ${data.data.calendarName || 'calendar'}` : 
                'A new event was added';
            } else if (data.changeType === 'updated') {
              title = 'Event Updated';
              description = data.data?.title ? 
                `"${data.data.title}" was updated ${data.data.isExternalChange ? 'in an external client' : ''}` : 
                'An event was updated';
            } else if (data.changeType === 'deleted') {
              title = 'Event Removed';
              description = data.data?.count > 1 ? 
                `${data.data.count} events were removed from ${data.data.calendarName || 'calendar'}` :
                'An event was removed';
            }
            
            toast({
              title,
              description,
            });
            
            // For external changes, immediately force a refresh
            if (data.data?.isExternalChange) {
              console.log('External change detected, forcing immediate refresh');
              
              // Invalidate all calendar queries to ensure latest data
              queryClient.invalidateQueries({ 
                queryKey: ['/api/calendars'] 
              });
              
              // Force refresh of events data
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'active',
              });
            } else {
              // Standard invalidation for normal changes
              queryClient.invalidateQueries({ queryKey: ['/api/events'] });
              
              // If we have the specific event ID, also invalidate that query
              if (data.eventId) {
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/events', data.eventId] 
                });
              }
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
          // Handle pong response to keep connection alive
          else if (data.type === 'pong') {
            console.log('Received pong from server, connection active');
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onclose = (event) => {
        console.log(`WebSocket connection closed with code ${event.code}`);
        
        // Attempt to reconnect unless this was a normal closure or unmounting
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          
          // Exponential backoff for reconnect timing
          const delay = Math.min(
            baseReconnectDelay * Math.pow(1.5, reconnectAttempts),
            30000 // Maximum 30 seconds
          );
          
          console.log(`Attempting to reconnect WebSocket in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
          
          // Clear any existing timer
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }
          
          // Set new timer
          reconnectTimer = setTimeout(connectWebSocket, delay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.log('Maximum WebSocket reconnection attempts reached');
          
          // When max attempts reached, we'll try again when user takes an action
          // or when component re-mounts
        }
      };
      
      // Update the state
      setSocket(ws);
    };
    
    // Initialize connection
    connectWebSocket();
    
    // Set up a keep-alive ping
    const pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Send ping every 30 seconds
    
    // Check for visibilitychange to reconnect when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden && ws && ws.readyState !== WebSocket.OPEN) {
        console.log('Tab became visible again, reconnecting WebSocket');
        connectWebSocket();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Force synchronization when the tab becomes visible again to catch up on missed events
    // during period when browser tab was not active
    const handleSyncOnVisibility = () => {
      if (!document.hidden) {
        console.log('Tab visible - checking for external changes');
        
        // Check if we've been away for a significant time (more than 1 minute)
        const lastConnectTime = localStorage.getItem('lastWsConnectTime');
        if (lastConnectTime) {
          const timeSinceLastConnect = Date.now() - new Date(lastConnectTime).getTime();
          
          if (timeSinceLastConnect > 60000) { // More than 1 minute
            console.log(`Been away for ${Math.round(timeSinceLastConnect/1000)} seconds, fetching updates`);
            
            // Request an immediate sync via WebSocket if connection is open
            if (ws && ws.readyState === WebSocket.OPEN) {
              console.log('Requesting immediate sync via WebSocket');
              ws.send(JSON.stringify({
                type: 'sync_request',
                forceRefresh: true
              }));
            } else {
              // Fallback to query invalidation if WebSocket is not available
              console.log('WebSocket not available, using query invalidation');
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'active',
              });
            }
          }
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleSyncOnVisibility);
    
    // Clean up on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleSyncOnVisibility);
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      
      clearInterval(pingInterval);
      
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Component unmounting');
      }
    };
  }, [user, queryClient, toast, saveSyncToken, socket]);

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

  /**
   * Request a real-time sync via WebSocket
   * This bypasses the REST API and directly requests a sync from the server
   * via the WebSocket connection for faster response
   */
  const requestRealTimeSync = useCallback((options: { forceRefresh?: boolean, calendarId?: number } = {}) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot request real-time sync');
      
      // Fallback to REST API
      if (options.calendarId) {
        return syncCalendar(options.calendarId);
      } else {
        // Just invalidate queries as a fallback
        queryClient.invalidateQueries({ 
          queryKey: ['/api/events'],
          refetchType: 'active',
        });
        return Promise.resolve(false);
      }
    }
    
    return new Promise<boolean>((resolve) => {
      // Set up one-time listener for sync complete
      const handleSyncComplete = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'sync_complete') {
            // Remove listener after receiving response
            socket.removeEventListener('message', handleSyncComplete);
            
            if (data.success) {
              // Force refresh the UI
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'active',
              });
              
              if (options.calendarId) {
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/calendars', options.calendarId, 'events'],
                  refetchType: 'active',
                });
              }
              
              setLastSyncTime(new Date());
              resolve(true);
            } else {
              console.error('Real-time sync failed:', data.message);
              toast({
                title: 'Sync Failed',
                description: data.message || 'Unknown error during sync',
                variant: 'destructive'
              });
              resolve(false);
            }
          }
        } catch (error) {
          // Continue listening, this might be an unrelated message
        }
      };
      
      // Add temporary listener for sync complete response
      socket.addEventListener('message', handleSyncComplete);
      
      // Send sync request
      socket.send(JSON.stringify({
        type: 'sync_request',
        forceRefresh: options.forceRefresh || false,
        calendarId: options.calendarId || null
      }));
      
      // Set a timeout to prevent waiting forever
      setTimeout(() => {
        socket.removeEventListener('message', handleSyncComplete);
        console.warn('Sync request timed out');
        toast({
          title: 'Sync Timeout',
          description: 'The sync request timed out. Try again later.',
          variant: 'destructive'
        });
        resolve(false);
      }, 10000); // 10 second timeout
    });
  }, [socket, syncCalendar, queryClient, toast]);

  return {
    syncing,
    lastSyncTime,
    syncCalendar,
    syncAllCalendars,
    pushLocalEvents,
    requestRealTimeSync
  };
}