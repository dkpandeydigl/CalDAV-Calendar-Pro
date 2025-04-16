/**
 * Enhanced Sync Hook
 * 
 * This hook provides enhanced synchronization capabilities for the calendar application
 * by leveraging the enhanced-sync-service for better UID preservation and immediate
 * CalDAV server synchronization.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './use-auth';
import { useWebSocketClient } from './useWebSocketClient';
import { useToast } from './use-toast';
import { apiRequest } from '@/lib/queryClient';

interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  error: string | null;
}

interface EventOperation {
  isProcessing: boolean;
  success: boolean | null;
  error: string | null;
}

// Enhanced sync hook to provide synchronization capabilities
export function useEnhancedSync() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    lastSyncTime: null,
    error: null
  });

  const [createOperation, setCreateOperation] = useState<EventOperation>({
    isProcessing: false,
    success: null,
    error: null
  });

  const [updateOperation, setUpdateOperation] = useState<EventOperation>({
    isProcessing: false,
    success: null,
    error: null
  });

  const [deleteOperation, setDeleteOperation] = useState<EventOperation>({
    isProcessing: false,
    success: null,
    error: null
  });

  const { 
    connected: wsConnected, 
    addMessageListener, 
    sendMessage 
  } = useWebSocketClient();

  // Force a bidirectional sync with the server
  const forceBidirectionalSync = useCallback(async (calendarId?: number) => {
    if (!user?.id) {
      setSyncStatus({
        isSyncing: false,
        lastSyncTime: null,
        error: 'User not authenticated'
      });
      return false;
    }

    setSyncStatus(prev => ({
      ...prev,
      isSyncing: true,
      error: null
    }));

    try {
      const response = await apiRequest(
        'POST',
        '/api/sync/force-bidirectional',
        {
          userId: user.id,
          calendarId: calendarId || null
        }
      );
      
      const result = await response.json();

      if (result.success) {
        setSyncStatus({
          isSyncing: false,
          lastSyncTime: new Date(),
          error: null
        });
        
        toast({
          title: "Synchronization Complete",
          description: `Synchronized ${result.calendarsSynced || 0} calendars and ${result.eventsSynced || 0} events`,
          variant: "default"
        });
        
        return true;
      } else {
        setSyncStatus({
          isSyncing: false,
          lastSyncTime: null,
          error: result.message || 'Sync failed without specific error'
        });
        
        toast({
          title: "Synchronization Failed",
          description: result.message || 'Unknown error occurred',
          variant: "destructive"
        });
        
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setSyncStatus({
        isSyncing: false,
        lastSyncTime: null,
        error: errorMessage
      });
      
      toast({
        title: "Synchronization Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      return false;
    }
  }, [user, toast]);

  // Create a new event with immediate server synchronization
  const createEventWithSync = useCallback(async (eventData: any) => {
    if (!user?.id) {
      setCreateOperation({
        isProcessing: false,
        success: false,
        error: 'User not authenticated'
      });
      return null;
    }

    setCreateOperation({
      isProcessing: true,
      success: null,
      error: null
    });

    try {
      const response = await apiRequest(
        'POST',
        '/api/events/create-with-sync',
        eventData
      );
      
      const result = await response.json();

      if (result.success) {
        setCreateOperation({
          isProcessing: false,
          success: true,
          error: null
        });
        
        toast({
          title: "Event Created",
          description: "Event was successfully created and synchronized with the server",
          variant: "default"
        });
        
        return result.event;
      } else {
        setCreateOperation({
          isProcessing: false,
          success: false,
          error: result.message || 'Creation failed without specific error'
        });
        
        toast({
          title: "Event Creation Failed",
          description: result.message || 'Unknown error occurred',
          variant: "destructive"
        });
        
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setCreateOperation({
        isProcessing: false,
        success: false,
        error: errorMessage
      });
      
      toast({
        title: "Event Creation Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      return null;
    }
  }, [user, toast]);

  // Update an existing event with immediate server synchronization
  const updateEventWithSync = useCallback(async (eventId: number, eventData: any) => {
    if (!user?.id) {
      setUpdateOperation({
        isProcessing: false,
        success: false,
        error: 'User not authenticated'
      });
      return null;
    }

    setUpdateOperation({
      isProcessing: true,
      success: null,
      error: null
    });

    try {
      const response = await apiRequest(
        'POST',
        `/api/events/${eventId}/update-with-sync`,
        eventData
      );
      
      const result = await response.json();

      if (result.success) {
        setUpdateOperation({
          isProcessing: false,
          success: true,
          error: null
        });
        
        toast({
          title: "Event Updated",
          description: "Event was successfully updated and synchronized with the server",
          variant: "default"
        });
        
        return result.event;
      } else {
        setUpdateOperation({
          isProcessing: false,
          success: false,
          error: result.message || 'Update failed without specific error'
        });
        
        toast({
          title: "Event Update Failed",
          description: result.message || 'Unknown error occurred',
          variant: "destructive"
        });
        
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setUpdateOperation({
        isProcessing: false,
        success: false,
        error: errorMessage
      });
      
      toast({
        title: "Event Update Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      return null;
    }
  }, [user, toast]);

  // Cancel/delete an event with immediate server synchronization
  const cancelEventWithSync = useCallback(async (eventId: number) => {
    if (!user?.id) {
      setDeleteOperation({
        isProcessing: false,
        success: false,
        error: 'User not authenticated'
      });
      return false;
    }

    setDeleteOperation({
      isProcessing: true,
      success: null,
      error: null
    });

    try {
      const response = await apiRequest(
        'POST',
        `/api/events/${eventId}/cancel-with-sync`
      );
      
      const result = await response.json();

      if (result.success) {
        setDeleteOperation({
          isProcessing: false,
          success: true,
          error: null
        });
        
        toast({
          title: "Event Cancelled",
          description: "Event was successfully cancelled and synchronized with the server",
          variant: "default"
        });
        
        return true;
      } else {
        setDeleteOperation({
          isProcessing: false,
          success: false,
          error: result.message || 'Cancellation failed without specific error'
        });
        
        toast({
          title: "Event Cancellation Failed",
          description: result.message || 'Unknown error occurred',
          variant: "destructive"
        });
        
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setDeleteOperation({
        isProcessing: false,
        success: false,
        error: errorMessage
      });
      
      toast({
        title: "Event Cancellation Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      return false;
    }
  }, [user, toast]);

  // Request immediate sync via WebSocket
  const requestSyncViaWebSocket = useCallback((options = {}) => {
    if (!wsConnected || !user?.id) {
      toast({
        title: "Sync Request Failed",
        description: "WebSocket not connected. Try again later.",
        variant: "destructive"
      });
      return false;
    }

    return sendMessage({
      type: 'sync_request',
      userId: user.id,
      timestamp: Date.now(),
      options
    });
  }, [wsConnected, user, sendMessage, toast]);

  // Set up listener for WebSocket sync events
  useEffect(() => {
    if (!user?.id) return;

    // Handle sync requested confirmation
    const syncRequestedHandler = (data: any) => {
      if (data.success) {
        toast({
          title: "Sync Request Sent",
          description: "Server is processing your synchronization request",
          variant: "default"
        });
      }
    };

    // Handle sync error
    const syncErrorHandler = (data: any) => {
      toast({
        title: "Sync Request Failed",
        description: data.message || "An error occurred while syncing",
        variant: "destructive"
      });
    };

    // Register WebSocket listeners
    const removeRequestedListener = addMessageListener('sync_requested', syncRequestedHandler);
    const removeErrorListener = addMessageListener('sync_request_error', syncErrorHandler);

    // Cleanup listeners on unmount
    return () => {
      removeRequestedListener();
      removeErrorListener();
    };
  }, [user, addMessageListener, toast]);

  return {
    syncStatus,
    wsConnected,
    operations: {
      create: createOperation,
      update: updateOperation,
      delete: deleteOperation
    },
    actions: {
      forceBidirectionalSync,
      createEventWithSync,
      updateEventWithSync,
      cancelEventWithSync,
      requestSyncViaWebSocket
    }
  };
}