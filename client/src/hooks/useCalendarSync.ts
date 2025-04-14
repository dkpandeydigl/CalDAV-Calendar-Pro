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

/**
 * Get a human-readable reason for WebSocket close event codes
 */
function getCloseEventReason(code: number): string {
  switch (code) {
    case 1000: return 'Normal closure';
    case 1001: return 'Going away';
    case 1002: return 'Protocol error';
    case 1003: return 'Unsupported data';
    case 1004: return 'Reserved';
    case 1005: return 'No status received';
    case 1006: return 'Abnormal closure';
    case 1007: return 'Invalid frame payload data';
    case 1008: return 'Policy violation';
    case 1009: return 'Message too big';
    case 1010: return 'Mandatory extension';
    case 1011: return 'Internal server error';
    case 1012: return 'Service restart';
    case 1013: return 'Try again later';
    case 1014: return 'Bad gateway';
    case 1015: return 'TLS handshake';
    default: return `Unknown (${code})`;
  }
}

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
    if (!user) {
      console.log('No user authenticated, skipping WebSocket connection');
      return;
    }

    console.log('Setting up WebSocket connection for calendar sync with user ID:', user.id);
    
    // Variables for reconnection
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // 1 second initial delay
    
    // Connection attempt tracker to try different paths
    let connectionAttempt = 0;
    const maxConnectionAttempts = 3;
    
    // Function to establish WebSocket connection
    const connectWebSocket = (useFallbackPath = false) => {
      try {
        connectionAttempt++;
        // Get hostname and port from current location
        const hostname = window.location.hostname;
        const port = window.location.port || 
                    (window.location.protocol === 'https:' ? '443' : '80');
        
        // Use secure protocol if page is loaded over HTTPS
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // For localhost or Replit preview, always use ws (not wss) to avoid SSL validation issues
        const isLocalDev = hostname === 'localhost' || hostname.includes('replit.dev');
        const finalProtocol = isLocalDev ? 'ws:' : protocol;
        
        // Use primary or fallback path based on parameter
        const wsPath = useFallbackPath ? '/ws' : '/api/ws';
        
        // Construct the WebSocket URL using the current page's location
        // We use window.location.host which includes both hostname and port if specified
        // This ensures compatibility across various deployment environments
        let wsUrl;
        try {
          // Handle localhost specially to avoid WebSocket construction errors
          if (hostname === 'localhost') {
            wsUrl = `ws://localhost:${port}${wsPath}?userId=${user.id}`;
          } else {
            // For all other environments, use the host and appropriate protocol
            wsUrl = `${finalProtocol}//${window.location.host}${wsPath}?userId=${user.id}`;
            
            // Make WebSocket connection globally available for other components
            (window as any).calendarSocket = ws;
          }
          console.log(`Constructed WebSocket URL: ${wsUrl}`);
        } catch (urlError) {
          // Fallback to a simpler URL construction if there's an error
          console.error('Error constructing WebSocket URL:', urlError);
          wsUrl = `//${window.location.host}${wsPath}?userId=${user.id}`;
        }
        
        console.log(`🔄 Connection attempt ${connectionAttempt}: Connecting to WebSocket server at ${wsUrl}${useFallbackPath ? ' (fallback path)' : ''}`);
        ws = new WebSocket(wsUrl);
        
        // Make WebSocket connection globally available for other components
        (window as any).calendarSocket = ws;
        
        ws.onopen = () => {
          console.log('✅ WebSocket connection established');
          reconnectAttempts = 0; // Reset reconnect attempts counter
          
          // Store last successful connection time in localStorage
          localStorage.setItem('lastWsConnectTime', new Date().toISOString());
          
          // Send authentication immediately on connection
          try {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ 
                type: 'auth', 
                userId: user.id, 
                timestamp: new Date().toISOString() 
              }));
              console.log('🔑 Sent authentication data to WebSocket server');
              
              // Also send initial ping to verify connection is working both ways
              ws.send(JSON.stringify({ type: 'ping', message: 'Initial connection test' }));
            }
          } catch (authError) {
            console.error('❌ Failed to send authentication data:', authError);
          }
        };
      } catch (error) {
        console.error('❌ Error creating WebSocket connection:', error);
      }
      
      // Only set handlers if we have a valid socket
      if (ws) {
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
                  data.data?.title ? 
                    `"${data.data.title}" was removed from ${data.data.calendarName || 'calendar'}` :
                    'An event was removed';
                
                // For deleted events, we need to cleanup any local references to prevent 
                // stuck "syncing" indicators in the UI
                if (data.eventId) {
                  console.log(`⚠️ Event deleted, cleaning up event ID: ${data.eventId} from all caches`);
                  
                  // Clean up all queries that might have the deleted event cached
                  const removeDeletedEvent = (events: any[] | undefined): any[] => {
                    if (!events) return [];
                    return events.filter(event => {
                      // Remove the specific event by ID
                      if (event.id === data.eventId) {
                        console.log(`🗑️ Removing deleted event from cache by ID: ${event.id} (${event.title || 'Untitled'})`);
                        return false;
                      }
                      
                      // Also remove by UID if available
                      if (data.data?.uid && event.uid === data.data.uid) {
                        console.log(`🗑️ Removing deleted event from cache by UID: ${event.uid} (${event.title || 'Untitled'})`);
                        return false;
                      }
                      
                      // Also remove by signature of start/end date if available
                      if (data.data?.startDate && data.data?.endDate && 
                          event.startDate === data.data.startDate && 
                          event.endDate === data.data.endDate && 
                          event.title === data.data.title) {
                        console.log(`🗑️ Removing deleted event from cache by signature match: ${event.title || 'Untitled'}`);
                        return false;
                      }
                      
                      return true;
                    });
                  };
                  
                  // Update all event caches immediately to remove this event
                  const allEventsQueries = queryClient.getQueriesData<any[]>({ queryKey: ['/api/events'] });
                  for (const [queryKey, events] of allEventsQueries) {
                    if (Array.isArray(events)) {
                      queryClient.setQueryData(queryKey, removeDeletedEvent(events));
                    }
                  }
                  
                  // Also remove from specific calendar event queries
                  if (data.data?.calendarId) {
                    const calendarId = data.data.calendarId;
                    console.log(`Looking for calendar-specific event caches for calendar ID: ${calendarId}`);
                    
                    // Handle calendar-specific event queries
                    const calendarEventsQueries = queryClient.getQueriesData<any[]>({ 
                      queryKey: ['/api/calendars', calendarId, 'events'] 
                    });
                    
                    for (const [queryKey, events] of calendarEventsQueries) {
                      if (Array.isArray(events)) {
                        console.log(`Cleaning calendar-specific cache for calendar ID: ${calendarId}`);
                        queryClient.setQueryData(queryKey, removeDeletedEvent(events));
                      }
                    }
                  }
                }
              }
              
              toast({
                title,
                description,
              });
              
              // For all changes, we now force an immediate refresh
              console.log(`Event change detected (${data.changeType}), forcing immediate refresh`);
              
              // Invalidate all calendar queries to ensure latest data
              queryClient.invalidateQueries({ 
                queryKey: ['/api/calendars'] 
              });
              
              // Force refresh of events data with a complete refetch
              console.log('Invalidating all events queries to refresh UI...');
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'all', // Change from 'active' to 'all' to ensure a full refresh
              });
              
              // If we have the specific event ID, also invalidate that query
              if (data.eventId) {
                console.log(`Invalidating specific event query: ${data.eventId}`);
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/events', data.eventId],
                  refetchType: 'all'
                });
              }
              
              // Add a slight delay then force refetch again to handle race conditions
              setTimeout(() => {
                console.log('Performing delayed refetch of events to ensure UI is updated...');
                queryClient.refetchQueries({ 
                  queryKey: ['/api/events'],
                  type: 'all'
                });
                
                // For deleted events, perform one more delayed check to ensure they stay deleted
                if (data.changeType === 'deleted' && data.eventId) {
                  // Store the deleted event info in sessionStorage for additional verification
                  const deletedEventsKey = 'recently_deleted_events';
                  const deletedEvents = JSON.parse(sessionStorage.getItem(deletedEventsKey) || '[]');
                  
                  // Add this event to recently deleted list with timestamp
                  const eventInfo = {
                    id: data.eventId,
                    uid: data.data?.uid || null,
                    calendarId: data.data?.calendarId,
                    title: data.data?.title,
                    timestamp: new Date().toISOString(),
                    signature: data.data?.startDate && data.data?.title ? 
                      `${data.data.title}_${data.data.startDate}` : null
                  };
                  
                  // Keep last 20 deleted events
                  deletedEvents.push(eventInfo);
                  if (deletedEvents.length > 20) {
                    deletedEvents.shift();
                  }
                  
                  sessionStorage.setItem(deletedEventsKey, JSON.stringify(deletedEvents));
                  
                  // Do one final cleanup pass after 2 seconds to catch any race conditions
                  setTimeout(() => {
                    console.log(`Final cleanup pass for deleted event ID: ${data.eventId}`);
                    
                    // Create a local reference to the remove function defined earlier
                    const finalRemoveFunction = (events: any[] | undefined): any[] => {
                      if (!events) return [];
                      return events.filter(event => {
                        // Use the same logic as in the removeDeletedEvent function above
                        if (event.id === data.eventId) {
                          console.log(`🧹 Final cleanup - removing deleted event by ID: ${event.id} (${event.title || 'Untitled'})`);
                          return false;
                        }
                        
                        // Also remove by UID if available
                        if (data.data?.uid && event.uid === data.data.uid) {
                          console.log(`🧹 Final cleanup - removing deleted event by UID: ${event.uid}`);
                          return false;
                        }
                        
                        return true;
                      });
                    };
                    
                    // Get all event queries and clean them once more
                    const allEventsQueries = queryClient.getQueriesData<any[]>({ queryKey: ['/api/events'] });
                    for (const [queryKey, events] of allEventsQueries) {
                      if (Array.isArray(events)) {
                        queryClient.setQueryData(queryKey, finalRemoveFunction(events));
                      }
                    }
                    
                    // Also clean calendar-specific queries once more
                    if (data.data?.calendarId) {
                      const calendarEventsQueries = queryClient.getQueriesData<any[]>({ 
                        queryKey: ['/api/calendars', data.data.calendarId, 'events'] 
                      });
                      
                      for (const [queryKey, events] of calendarEventsQueries) {
                        if (Array.isArray(events)) {
                          queryClient.setQueryData(queryKey, finalRemoveFunction(events));
                        }
                      }
                    }
                  }, 2000);
                }
              }, 500);
            }
            else if (data.type === 'new_notification') {
              console.log('New notification received:', data);
              
              // The notification context will handle this
              // We just make sure events are refreshed if it's event-related
              if (data.notification && 
                  (data.notification.type === 'event_update' || 
                   data.notification.type === 'event_invitation' ||
                   data.notification.type === 'event_cancellation')) {
                
                console.log('Event-related notification received, refreshing events');
                // Force refresh of events data to ensure UI updates
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/events'],
                  refetchType: 'all'
                });
                
                // Add a slight delay then force refetch again
                setTimeout(() => {
                  console.log('Performing delayed refetch after notification to ensure UI is updated...');
                  queryClient.refetchQueries({ 
                    queryKey: ['/api/events'],
                    type: 'all'
                  });
                }, 500);
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
          console.error('❌ WebSocket error:', error);
          // Store wsUrl in a variable to avoid reference errors
          const socketUrl = ws?.url || 'connection not initialized';
          const usingFallbackPath = socketUrl.includes('/ws') && !socketUrl.includes('/api/ws');
          
          // Provide more details about the error
          console.log('WebSocket error details:', {
            readyState: ws ? ws.readyState : 'no socket',
            url: socketUrl,
            userId: user.id,
            usingFallbackPath,
            timestamp: new Date().toISOString()
          });
          
          // If this is the initial connection attempt with the primary path
          // and we're still below the max connection attempts, try the fallback path immediately
          if (connectionAttempt === 1 && !usingFallbackPath) {
            console.log('Primary WebSocket path failed, attempting fallback path immediately');
            // Close this socket if it's still open
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.close(1000, 'Switching to fallback path');
            }
            // Try fallback path
            setTimeout(() => connectWebSocket(true), 100);
          }
        };
        
        ws.onclose = (event) => {
          console.log(`⚠️ WebSocket connection closed with code ${event.code} - ${getCloseEventReason(event.code)}`);
          const usingFallbackPath = ws?.url?.includes('/ws') && !ws?.url?.includes('/api/ws');
          
          // For initial connection failures, try the fallback path if we weren't already using it
          if (connectionAttempt <= 2 && !usingFallbackPath && event.code !== 1000) {
            console.log('Primary WebSocket connection closed, attempting fallback path');
            setTimeout(() => connectWebSocket(true), 100);
            return;
          }
          
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
            
            // Set new timer - use the path that was most recently successful
            reconnectTimer = setTimeout(() => connectWebSocket(usingFallbackPath), delay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.log('Maximum WebSocket reconnection attempts reached');
            
            // When max attempts reached, show a silent toast that sync is offline
            toast({
              title: 'Real-time sync is offline',
              description: 'Using manual sync mode. Will try to reconnect later.',
              variant: 'destructive',
            });
            
            // We'll try again when user takes an action or when component re-mounts
          }
        };
        
        // Update the state
        setSocket(ws);
      }
    };
    
    // Set up polling as a fallback if WebSocket fails
    const setupPolling = () => {
      console.log('🔄 Setting up polling fallback for sync');
      
      // Poll every 30 seconds
      const pollInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('📊 Polling for updates (WebSocket not available)');
          
          // Use query invalidation to refresh data
          queryClient.invalidateQueries({ 
            queryKey: ['/api/events'],
            refetchType: 'all'
          });
          
          // Add a slight delay then force refetch again
          setTimeout(() => {
            queryClient.refetchQueries({ 
              queryKey: ['/api/events'],
              type: 'all'
            });
          }, 500);
        }
      }, 30000); // Poll every 30 seconds
      
      return pollInterval;
    };
    
    // Try WebSocket first, fall back to polling
    try {
      connectWebSocket();
    } catch (error) {
      console.error('Failed to establish WebSocket connection, using polling fallback:', error);
    }
    
    // Set up polling fallback regardless of WebSocket status
    const pollInterval = setupPolling();
    
    // Set up a keep-alive ping for WebSocket if connected
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
              console.log('WebSocket not available, using query invalidation with forced refetch');
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'all'
              });
              
              // Add a slight delay then force refetch again
              setTimeout(() => {
                console.log('Performing delayed refetch to ensure UI is updated...');
                queryClient.refetchQueries({ 
                  queryKey: ['/api/events'],
                  type: 'all'
                });
              }, 500);
            }
          }
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleSyncOnVisibility);
    
    // Clean up on unmount
    return function cleanup() {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleSyncOnVisibility);
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      
      clearInterval(pingInterval);
      clearInterval(pollInterval); // Clear polling interval on unmount
      
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Component unmounting');
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
      
      const response = await apiRequest('POST', '/api/sync', {
        calendarId,
        syncToken,
        forceRefresh: true,
        preserveLocalEvents: true // Add parameter to prevent event deletion during sync
      });
      
      // Cast response to expected type
      const syncResponse = response as any;
      
      if (syncResponse.syncToken) {
        saveSyncToken(calendarId, syncResponse.syncToken);
      }
      
      setLastSyncTime(new Date());
      
      // Show changes if any
      const changeCount = 
        (syncResponse.changes?.added?.length || 0) + 
        (syncResponse.changes?.modified?.length || 0) + 
        (syncResponse.changes?.deleted?.length || 0);
      
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
      
      const response = await apiRequest('POST', '/api/sync/push-local', {});
      
      // Cast to expected type
      const pushResponse = response as any;
      
      // Show result
      if (pushResponse.pushed > 0) {
        toast({
          title: 'Local Events Pushed',
          description: `${pushResponse.pushed} event${pushResponse.pushed !== 1 ? 's' : ''} sent to server`,
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
        // Use a much more careful approach that prevents flickering
        console.log('No WebSocket connection, using anti-flicker sync strategy');
        
        // First, get a snapshot of current events to preserve
        const currentEvents = queryClient.getQueryData<any[]>(['/api/events']) || [];
        console.log(`Preserving ${currentEvents.length} events during sync`);
        
        // Create a guard function to keep events in cache during sync
        const guardEvents = () => {
          const eventsNow = queryClient.getQueryData<any[]>(['/api/events']);
          
          // Check if events disappeared or reduced significantly
          if (!eventsNow || eventsNow.length < currentEvents.length - 1) {
            console.log(`Detected events loss (${eventsNow?.length || 0} vs ${currentEvents.length}), restoring cache`);
            queryClient.setQueryData(['/api/events'], [...currentEvents]);
          }
        };
        
        // Set up a guard interval to continuously monitor and restore events
        const guardIntervalId = setInterval(guardEvents, 50);
        
        // Execute a background refetch without invalidating
        console.log('Performing guarded background refetch...');
        queryClient.refetchQueries({ 
          queryKey: ['/api/events'],
          type: 'all'
        }).then(() => {
          console.log('Background refetch complete');
          // Run the guard one more time
          guardEvents();
          
          // Delay clearing to make sure UI is stable
          setTimeout(() => {
            clearInterval(guardIntervalId);
            console.log('Anti-flicker guard released');
          }, 500);
        }).catch(error => {
          console.error('Error during refetch:', error);
          // Clear interval and restore data
          clearInterval(guardIntervalId);
          guardEvents();
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
              // Use a much more advanced anti-flicker strategy
              console.log('🔄 Sync complete, updating UI with anti-flicker protection');
              
              // First, take a snapshot of current events to preserve
              const currentEvents = queryClient.getQueryData<any[]>(['/api/events']) || [];
              console.log(`🔒 Preserving ${currentEvents.length} events during sync refresh`);
              
              // Create a powerful guard function that ensures events stay in cache
              const guardEvents = () => {
                const eventsNow = queryClient.getQueryData<any[]>(['/api/events']);
                
                // Only restore if we lost events or they were significantly reduced
                if (!eventsNow || eventsNow.length < currentEvents.length - 1) {
                  console.log(`🚨 Detected events loss (${eventsNow?.length || 0} vs ${currentEvents.length}), restoring cache`);
                  queryClient.setQueryData(['/api/events'], [...currentEvents]);
                }
              };
              
              // Set up a guard interval to continuously monitor and prevent flickering
              const guardIntervalId = setInterval(guardEvents, 50); // Check every 50ms
              
              // Perform a background refetch WITHOUT invalidating first
              console.log('🔄 Performing guarded background refetch for new events data...');
              queryClient.refetchQueries({ 
                queryKey: ['/api/events'],
                type: 'all'
              }).then(() => {
                console.log('✅ Background refetch completed after sync');
                
                // Run the guard one more time to be safe
                guardEvents();
                
                // If we have a specific calendar, update that data too
                if (options.calendarId) {
                  // Take a calendar-specific snapshot
                  const calendarEvents = queryClient.getQueryData<any[]>(['/api/calendars', options.calendarId, 'events']) || [];
                  
                  queryClient.refetchQueries({ 
                    queryKey: ['/api/calendars', options.calendarId, 'events'],
                    type: 'all'
                  }).then(() => {
                    // Restore calendar-specific events if needed
                    const calendarEventsAfterRefetch = queryClient.getQueryData<any[]>(['/api/calendars', options.calendarId, 'events']);
                    if (!calendarEventsAfterRefetch || calendarEventsAfterRefetch.length < calendarEvents.length - 1) {
                      console.log(`🔄 Restoring calendar-specific cache (${calendarEvents.length} events)`);
                      queryClient.setQueryData(['/api/calendars', options.calendarId, 'events'], calendarEvents);
                    }
                  });
                }
                
                // Release the guard after a short delay to ensure UI stability
                setTimeout(() => {
                  clearInterval(guardIntervalId);
                  console.log('🔓 Anti-flicker guard released after successful sync');
                }, 500);
              });
              
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
        calendarId: options.calendarId || null,
        preserveLocalEvents: true // Add parameter to prevent event deletion during sync
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
  }, [socket, syncCalendar, queryClient, toast, setLastSyncTime]);

  return {
    syncing,
    lastSyncTime,
    syncCalendar,
    syncAllCalendars,
    pushLocalEvents,
    requestRealTimeSync,
    socket // Expose the socket object for external connection status checks
  };
}