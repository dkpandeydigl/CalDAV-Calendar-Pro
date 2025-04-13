import React, { useState } from 'react';
import { 
  Bell, 
  Check, 
  Filter, 
  X,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NotificationIcon } from '@/components/notification/NotificationCenter';
import { useNotifications, NotificationType } from '@/contexts/NotificationContext';
import { useLocation } from 'wouter';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export function NotificationsPage() {
  const { 
    notifications, 
    unreadCount, 
    loading, 
    fetchNotifications,
    markAsRead, 
    markAllAsRead, 
    dismissNotification, 
    markActionTaken,
    createTestNotification 
  } = useNotifications();
  const [_, setLocation] = useLocation();
  
  const [filterType, setFilterType] = useState<string>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showActionableOnly, setShowActionableOnly] = useState(false);
  
  // Apply filters
  const filteredNotifications = notifications.filter(notification => {
    // Filter by tab (notification type)
    if (filterType !== 'all' && notification.type !== filterType) {
      return false;
    }
    
    // Filter by read status
    if (showUnreadOnly && notification.isRead) {
      return false;
    }
    
    // Filter by actionable
    if (showActionableOnly && !notification.requiresAction) {
      return false;
    }
    
    return true;
  });
  
  // Group notifications by date for better organization
  const groupedNotifications = filteredNotifications.reduce<Record<string, typeof filteredNotifications>>(
    (groups, notification) => {
      const date = new Date(notification.createdAt).toDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(notification);
      return groups;
    },
    {}
  );
  
  // Convert grouped object to array for rendering
  const groupedArray = Object.entries(groupedNotifications).map(([date, items]) => ({
    date,
    items,
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  // Handle navigation to event page
  const handleEventClick = (eventId?: number) => {
    if (eventId) {
      setLocation(`/event/${eventId}`);
    }
  };
  
  return (
    <div className="container py-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <div className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-medium">
              {unreadCount} unread
            </div>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNotifications()}
            className="flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsRead()}
              className="flex items-center gap-1"
            >
              <Check className="h-4 w-4" />
              Mark all as read
            </Button>
          )}
          
          <Button
            variant="secondary"
            size="sm"
            onClick={() => createTestNotification()}
          >
            Test Notification
          </Button>
        </div>
      </div>
      
      {/* Filters */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="unread-only" className="cursor-pointer">Show unread only</Label>
              <Switch 
                id="unread-only" 
                checked={showUnreadOnly} 
                onCheckedChange={setShowUnreadOnly} 
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Label htmlFor="actionable-only" className="cursor-pointer">Show actionable only</Label>
              <Switch 
                id="actionable-only" 
                checked={showActionableOnly} 
                onCheckedChange={setShowActionableOnly} 
              />
            </div>
            
            <div className="ml-auto">
              <Select
                value={filterType}
                onValueChange={(value) => setFilterType(value)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All notifications</SelectItem>
                  <SelectItem value="event_invitation">Event invitations</SelectItem>
                  <SelectItem value="event_update">Event updates</SelectItem>
                  <SelectItem value="event_cancellation">Event cancellations</SelectItem>
                  <SelectItem value="attendee_response">Attendee responses</SelectItem>
                  <SelectItem value="event_reminder">Event reminders</SelectItem>
                  <SelectItem value="invitation_accepted">Accepted invitations</SelectItem>
                  <SelectItem value="invitation_declined">Declined invitations</SelectItem>
                  <SelectItem value="invitation_tentative">Tentative responses</SelectItem>
                  <SelectItem value="resource_confirmed">Resource confirmations</SelectItem>
                  <SelectItem value="resource_denied">Resource denials</SelectItem>
                  <SelectItem value="system_message">System messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Main content */}
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <div className="animate-pulse text-lg">Loading notifications...</div>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium mb-2">No notifications</h3>
            <p className="text-gray-500 text-center max-w-md mb-4">
              {notifications.length > 0 
                ? "No notifications match your current filters" 
                : "You don't have any notifications yet"}
            </p>
            {notifications.length > 0 && (
              <Button 
                variant="outline" 
                onClick={() => {
                  setFilterType('all');
                  setShowUnreadOnly(false);
                  setShowActionableOnly(false);
                }}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedArray.map((group) => (
            <div key={group.date} className="space-y-2">
              <h2 className="text-lg font-semibold">
                {new Date(group.date).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </h2>
              
              <Card>
                {group.items.map((notification) => (
                  <div 
                    key={notification.id}
                    className={`flex items-start p-4 hover:bg-slate-50 border-b last:border-b-0 cursor-pointer ${
                      notification.isRead ? '' : 'bg-blue-50'
                    }`}
                    onClick={() => {
                      if (!notification.isRead) {
                        markAsRead(notification.id);
                      }
                      if (notification.relatedEventId) {
                        handleEventClick(notification.relatedEventId);
                      }
                    }}
                  >
                    <div className="flex-shrink-0 mr-4">
                      <NotificationIcon notificationType={notification.type} />
                    </div>
                    
                    <div className="flex-grow">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium">{notification.title}</h3>
                          <p className="text-gray-700">{notification.message}</p>
                          
                          {notification.relatedUserName && (
                            <p className="text-sm text-gray-500 mt-1">
                              From: {notification.relatedUserName}
                            </p>
                          )}
                          
                          {/* Parse and display additional data if present */}
                          {notification.additionalData && (
                            <div className="mt-1 text-sm bg-gray-50 p-2 rounded">
                              {(() => {
                                try {
                                  const data = JSON.parse(notification.additionalData);
                                  return (
                                    <div className="space-y-1">
                                      {data.changesSummary && (
                                        <p>Changes: {data.changesSummary}</p>
                                      )}
                                      {data.reason && <p>Reason: {data.reason}</p>}
                                    </div>
                                  );
                                } catch (e) {
                                  return <p>{notification.additionalData}</p>;
                                }
                              })()}
                            </div>
                          )}
                        </div>
                        
                        <div className="text-sm text-gray-500">
                          {format(new Date(notification.createdAt), 'h:mm a')}
                        </div>
                      </div>
                      
                      <div className="flex mt-3 gap-2">
                        {notification.requiresAction && !notification.actionTaken && (
                          <Button 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              markActionTaken(notification.id);
                            }}
                          >
                            Take Action
                          </Button>
                        )}
                        
                        {!notification.isRead && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(notification.id);
                            }}
                          >
                            Mark as read
                          </Button>
                        )}
                        
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(notification.id);
                          }}
                        >
                          Dismiss
                        </Button>
                        
                        {notification.relatedEventId && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEventClick(notification.relatedEventId);
                            }}
                          >
                            View event
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}