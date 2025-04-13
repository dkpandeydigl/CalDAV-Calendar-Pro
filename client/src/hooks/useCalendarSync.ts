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
    const baseReconnectDelay = 1000; // Start with 1 second delay
    
    // Function to create and set up a new WebSocket connection
    const connectWebSocket = () => {
      // Close any existing connection
      if (socket) {
        console.log('Closing existing WebSocket connection');
        socket.close();
      }
      
      // First check if user is authenticated properly
      if (!user?.id) {
        console.log('⚠️ Cannot establish WebSocket connection - no authenticated user');
        
        // Set a timer to check for authentication again in a few seconds
        const authCheckTimer = setTimeout(() => {
          console.log('🔄 Rechecking authentication status for WebSocket connection');
          connectWebSocket();
        }, 5000);
        
        return;
      }

      // Create new WebSocket connection with authentication
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Don't append port number, use the same host that served the page
      // Using /api/ws path to avoid conflicts with Vite's WebSocket
      const wsUrl = `${protocol}//${window.location.host}/api/ws?userId=${user.id}`;
      console.log('🔌 Connecting to WebSocket server at:', wsUrl);
      
      try {
        ws = new WebSocket(wsUrl);
        console.log('🔌 WebSocket constructor created, waiting for connection...');
        
        ws.onopen = () => {
          console.log('✅ WebSocket successfully connected for calendar sync');
          // Reset reconnect attempts when successfully connected
          reconnectAttempts = 0;
          
          // Store last successful connection time in localStorage
          localStorage.setItem('lastWsConnectTime', new Date().toISOString());
          
          // Send authentication immediately on connection
          try {
            ws.send(JSON.stringify({ 
              type: 'auth', 
              userId: user.id, 
              timestamp: new Date().toISOString() 
            }));
            console.log('🔑 Sent authentication data to WebSocket server');
          } catch (authError) {
            console.error('❌ Failed to send authentication data:', authError);
          }
          
          // Also send initial ping to verify connection is working both ways
          ws.send(JSON.stringify({ type: 'ping', message: 'Initial connection test' }));
        };
      } catch (error) {
        console.error('❌ Error creating WebSocket connection:', error);
      }
      
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
            
            // For all changes, we now force an immediate refresh
            // Previously we only did this for external changes, but this caused some changes to be invisible
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
        // Provide more details about the error
        console.log('WebSocket error details:', {
          readyState: ws ? ws.readyState : 'no socket',
          url: wsUrl,
          userId: user.id,
          timestamp: new Date().toISOString()
        });
      };
      
      ws.onclose = (event) => {
        console.log(`⚠️ WebSocket connection closed with code ${event.code} - ${getCloseEventReason(event.code)}`);
        
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
              console.log('WebSocket not available, using query invalidation with forced refetch');
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'all', // Change from 'active' to 'all' for complete refresh
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
    return () => {
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
          forceRefresh: true,
          preserveLocalEvents: true // Add parameter to prevent event deletion during sync
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
        // Just invalidate queries as a fallback with forced refresh
        console.log('No WebSocket connection, using direct query invalidation fallback');
        queryClient.invalidateQueries({ 
          queryKey: ['/api/events'],
          refetchType: 'all', // Change from 'active' to 'all' for complete refresh
        });
        
        // Add a slight delay then force refetch again
        setTimeout(() => {
          console.log('Performing delayed refetch to ensure UI is updated...');
          queryClient.refetchQueries({ 
            queryKey: ['/api/events'],
            type: 'all'
          });
        }, 500);
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
              console.log('Sync complete, refreshing UI with new data');
              queryClient.invalidateQueries({ 
                queryKey: ['/api/events'],
                refetchType: 'all', // Change from 'active' to 'all' for complete refresh
              });
              
              if (options.calendarId) {
                queryClient.invalidateQueries({ 
                  queryKey: ['/api/calendars', options.calendarId, 'events'],
                  refetchType: 'all', // Change from 'active' to 'all' for complete refresh
                });
              }
              
              // Add a slight delay then force refetch again to handle race conditions
              setTimeout(() => {
                console.log('Performing delayed refetch after sync to ensure UI is updated...');
                queryClient.refetchQueries({ 
                  queryKey: ['/api/events'],
                  type: 'all'
                });
              }, 500);
              
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
  }, [socket, syncCalendar, queryClient, toast]);

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