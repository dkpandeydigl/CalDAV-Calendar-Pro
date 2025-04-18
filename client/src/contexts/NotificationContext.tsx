import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
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
      const response = await apiRequest<Notification[]>('/api/notifications');
      setNotifications(response);
      
      // Also update unread count
      const countResponse = await apiRequest<{ count: number }>('/api/notifications/count');
      setUnreadCount(countResponse.count);
      
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
      const response = await apiRequest<{ success: boolean; unreadCount: number }>(`/api/notifications/${id}/read`, {
        method: 'PATCH'
      });
      
      if (response.success) {
        // Update notifications list
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === id 
              ? { ...notification, isRead: true } 
              : notification
          )
        );
        
        // Update unread count
        setUnreadCount(response.unreadCount);
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
      const response = await apiRequest<{ success: boolean }>('/api/notifications/mark-all-read', {
        method: 'POST'
      });
      
      if (response.success) {
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
      const response = await apiRequest<{ success: boolean; unreadCount: number }>(`/api/notifications/${id}/dismiss`, {
        method: 'PATCH'
      });
      
      if (response.success) {
        // Update notifications list by removing the dismissed notification
        setNotifications(prev => 
          prev.filter(notification => notification.id !== id)
        );
        
        // Update unread count
        setUnreadCount(response.unreadCount);
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
      const response = await apiRequest<{ success: boolean; unreadCount: number }>(`/api/notifications/${id}/action-taken`, {
        method: 'PATCH'
      });
      
      if (response.success) {
        // Update notifications list
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === id 
              ? { ...notification, actionTaken: true, requiresAction: false } 
              : notification
          )
        );
        
        // Update unread count
        setUnreadCount(response.unreadCount);
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
      const response = await apiRequest<Notification>('/api/notifications/test', {
        method: 'POST'
      });
      
      // Add the new notification to the list
      setNotifications(prev => [response, ...prev]);
      
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
        const currentHost = window.location.host;
        const wsPath = useFallbackPath ? '/ws' : '/api/ws';
        
        // Handle different environments appropriately
        let wsUrl;
        
        // Add userId parameter for authentication
        const userIdParam = user?.id ? `?userId=${user.id}` : '';
        
        // For Replit environment
        if (window.location.hostname.includes('replit') || window.location.hostname.includes('replit.dev')) {
          // Use relative URL format for Replit (no protocol/host/port)
          wsUrl = `${wsPath}${userIdParam}`;
          console.log(`Creating relative WebSocket URL for Replit: ${wsUrl}`);
        } 
        // For localhost development
        else if (window.location.hostname === 'localhost') {
          const port = window.location.port || '5000';
          wsUrl = `ws://localhost:${port}${wsPath}${userIdParam}`;
          console.log(`Creating explicit localhost WebSocket URL: ${wsUrl}`);
        } 
        // Standard case for other deployments
        else {
          // Use current protocol and host
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${currentHost}${wsPath}${userIdParam}`;
          console.log(`Creating standard WebSocket URL: ${wsUrl}`);
        }
        
        const connectionAttempt = reconnectAttempts + 1;
        console.log(`🔄 NotificationContext: Connection attempt ${connectionAttempt}: Connecting to WebSocket server at ${wsUrl}${useFallbackPath ? ' (fallback path)' : ''}`);
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('✅ WebSocket connected for notifications');
          reconnectAttempts = 0; // Reset reconnect attempts counter
          
          // Request initial notifications list if the socket is ready
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'get_notifications',
              userId: user.id
            }));
            console.log('Sent get_notifications request');
            
            // Also send authentication
            ws.send(JSON.stringify({ 
              type: 'auth', 
              userId: user.id, 
              timestamp: new Date().toISOString() 
            }));
          }
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
            
            if (data.type === 'new_notification') {
              // Add new notification to the list
              setNotifications(prev => [data.notification, ...prev]);
              setUnreadCount(data.unreadCount);
              
              // Show toast notification
              toast({
                title: data.notification.title,
                description: data.notification.message,
              });
            } 
            else if (data.type === 'notifications') {
              // Update notifications list
              setNotifications(data.notifications);
            }
            else if (data.type === 'notification_count') {
              // Update unread count
              setUnreadCount(data.count);
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
  // Removed webSocket from dependency array to prevent infinite re-renders
  }, [isAuthenticated, user, toast]);

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