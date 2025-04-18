import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Define notification types
export type NotificationType = 
  | 'event_invitation'
  | 'event_update'
  | 'event_cancellation'
  | 'attendee_response'
  | 'event_reminder'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'invitation_tentative'
  | 'comment_added'
  | 'resource_confirmed'
  | 'resource_denied'
  | 'system_message';

export type NotificationPriority = 'low' | 'medium' | 'high';

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  relatedEventId?: number;
  relatedEventUid?: string;
  relatedUserId?: number;
  relatedUserName?: string;
  relatedUserEmail?: string;
  additionalData?: string; // JSON string for any extra data
  isRead: boolean;
  isDismissed: boolean;
  requiresAction: boolean;
  actionTaken: boolean;
  createdAt: string;
  expiresAt?: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: Error | null;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismissNotification: (id: number) => Promise<void>;
  markActionTaken: (id: number) => Promise<void>;
  createTestNotification: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { toast } = useToast();
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);

  // Fetch notifications from the server
  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    
    try {
      setLoading(true);
      const response = await apiRequest('/api/notifications');
      setNotifications(response as Notification[]);
      
      // Also update unread count
      const countResponse = await apiRequest('/api/notifications/count');
      setUnreadCount((countResponse as any).count || 0);
      
      setError(null);
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch notifications'));
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Mark a notification as read
  const markAsRead = useCallback(async (id: number) => {
    try {
      const response = await apiRequest(`/api/notifications/${id}/read`, {
        method: 'PATCH'
      });
      
      if ((response as any).success) {
        // Update notifications list
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === id 
              ? { ...notification, isRead: true } 
              : notification
          )
        );
        
        // Update unread count
        setUnreadCount((response as any).unreadCount || 0);
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
      toast({
        title: 'Error',
        description: 'Failed to mark notification as read',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    try {
      const response = await apiRequest('/api/notifications/mark-all-read', {
        method: 'POST'
      });
      
      if ((response as any).success) {
        // Update notifications list
        setNotifications(prev => 
          prev.map(notification => ({ ...notification, isRead: true }))
        );
        
        // Update unread count
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
      toast({
        title: 'Error',
        description: 'Failed to mark all notifications as read',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Dismiss a notification
  const dismissNotification = useCallback(async (id: number) => {
    try {
      const response = await apiRequest(`/api/notifications/${id}/dismiss`, {
        method: 'PATCH'
      });
      
      if ((response as any).success) {
        // Update notifications list by removing the dismissed notification
        setNotifications(prev => 
          prev.filter(notification => notification.id !== id)
        );
        
        // Update unread count
        setUnreadCount((response as any).unreadCount || 0);
      }
    } catch (err) {
      console.error('Error dismissing notification:', err);
      toast({
        title: 'Error',
        description: 'Failed to dismiss notification',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Mark action taken on a notification
  const markActionTaken = useCallback(async (id: number) => {
    try {
      const response = await apiRequest(`/api/notifications/${id}/action-taken`, {
        method: 'PATCH'
      });
      
      if ((response as any).success) {
        // Update notifications list
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === id 
              ? { ...notification, actionTaken: true, requiresAction: false } 
              : notification
          )
        );
        
        // Update unread count
        setUnreadCount((response as any).unreadCount || 0);
      }
    } catch (err) {
      console.error('Error marking action taken:', err);
      toast({
        title: 'Error',
        description: 'Failed to mark action as taken',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Create a test notification (for development purposes)
  const createTestNotification = useCallback(async () => {
    try {
      const response = await apiRequest('/api/notifications/test', {
        method: 'POST'
      });
      
      // Add the new notification to the list
      setNotifications(prev => [(response as Notification), ...prev]);
      
      // Update unread count
      setUnreadCount(prev => prev + 1);
      
      toast({
        title: 'Test Notification',
        description: 'Created a test notification successfully',
      });
    } catch (err) {
      console.error('Error creating test notification:', err);
      toast({
        title: 'Error',
        description: 'Failed to create test notification',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Setup WebSocket connection for real-time notifications
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const baseReconnectDelay = 2000; // Start with 2 seconds
    
    // Function to establish WebSocket connection with fallback path option
    const connectWebSocket = (useFallbackPath = false) => {
      try {
        // Close any existing connection
        if (webSocket) {
          webSocket.close();
        }
        
        // Determine the WebSocket protocol based on current HTTP protocol
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsPath = useFallbackPath ? '/ws' : '/api/ws';
        
        // Add userId parameter for authentication
        const userIdParam = user?.id ? `?userId=${user.id}` : '';
        
        let wsUrl = '';
        const connectionAttempt = reconnectAttempts + 1;
        
        // Ultra simplified WebSocket URL creation with error protection
        try {
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsHost = window.location.host; // Includes port if non-standard
          wsUrl = `${wsProtocol}//${wsHost}${wsPath}${userIdParam}`;
            
          console.log(`Creating WebSocket URL: ${wsUrl}${useFallbackPath ? ' (fallback path)' : ' (primary path)'}`);
          console.log(`🔄 NotificationContext: Connection attempt ${connectionAttempt}: Connecting to WebSocket server at ${wsUrl}`);
          
          // Create WebSocket with the simplified URL
          ws = new WebSocket(wsUrl);
        } catch (err) {
          console.error('❌ Critical error creating WebSocket URL:', err);
          // If we fail even with the fallback URL, try direct absolute URL as last resort
          if (useFallbackPath) {
            try {
              const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const fallbackUrl = `${protocol}//${window.location.hostname}:5000/ws${userIdParam}`;
              console.log('🆘 Last resort WebSocket URL:', fallbackUrl);
              ws = new WebSocket(fallbackUrl);
            } catch (lastError) {
              console.error('💥 All WebSocket connection attempts failed:', lastError);
              return; // Exit to prevent further errors
            }
          }
        }
        
        // Only continue if we have a valid WebSocket
        if (!ws) return;
        
        // Add event handlers
        ws.onopen = () => {
          const socketUrl = ws?.url || 'unknown';
          console.log(`✅ WebSocket connected for notifications: ${socketUrl}`);
          reconnectAttempts = 0; // Reset reconnect attempts counter
          
          // Since we now have a good connection, store this path preference for future reconnects
          const usingFallbackPath = socketUrl.includes('/ws') && !socketUrl.includes('/api/ws');
          localStorage.setItem('websocket_preferred_path', usingFallbackPath ? '/ws' : '/api/ws');
          localStorage.setItem('websocket_last_success_time', Date.now().toString());
          localStorage.setItem('websocket_last_success_url', socketUrl);
          
          try {
            // Request initial notifications list if the socket is ready
            if (ws && ws.readyState === WebSocket.OPEN) {
              // First send authentication
              ws.send(JSON.stringify({
                type: 'auth',
                userId: user.id,
                timestamp: Date.now()
              }));
              
              // Then request notifications after a short delay
              setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'get_notifications',
                    userId: user.id
                  }));
                  console.log('✉️ Sent get_notifications request');
                }
              }, 500);
            }
          } catch (err) {
            console.error('⚠️ Error sending initial WebSocket messages:', err);
          }
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
            
            if (data.type === 'new_notification') {
              // Add new notification to the list
              setNotifications(prev => [data.notification, ...prev]);
              setUnreadCount(data.unreadCount || 0);
              
              // Show toast notification
              toast({
                title: data.notification.title,
                description: data.notification.message,
              });
            } 
            else if (data.type === 'notifications') {
              // Update notifications list
              setNotifications(data.notifications || []);
            }
            else if (data.type === 'notification_count') {
              // Update unread count
              setUnreadCount(data.count || 0);
            }
          } catch (err) {
            console.error('Error processing WebSocket message:', err);
          }
        };
        
        ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
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
          console.log(`⚠️ WebSocket connection closed with code ${event.code}`);
          const usingFallbackPath = ws?.url?.includes('/ws') && !ws?.url?.includes('/api/ws');
          
          // For initial connection failures, try the fallback path if we weren't already using it
          if (connectionAttempt <= 2 && !usingFallbackPath && event.code !== 1000) {
            console.log('Primary WebSocket connection failed, attempting fallback path');
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
            console.log('Maximum WebSocket reconnection attempts reached for notifications');
          }
        };
        
        setWebSocket(ws);
      } catch (error) {
        console.error('❌ Error creating WebSocket connection:', error);
      }
    };
    
    // Initialize connection
    connectWebSocket();
    
    // Clean up WebSocket connection when component unmounts
    return () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Component unmounting');
      }
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [isAuthenticated, user, toast, webSocket]);

  // Fetch notifications when user logs in
  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
    } else {
      // Clear notifications when user logs out
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [isAuthenticated, fetchNotifications]);

  const value = {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    markActionTaken,
    createTestNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};