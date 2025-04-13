import React, { useState } from 'react';
import { 
  Bell, 
  Check, 
  ChevronRight, 
  Info, 
  MoreHorizontal, 
  X,
  CalendarClock,
  UserRound,
  MessageCircle,
  CheckCircle,
  UserCog,
  Calendar
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useNotifications, Notification, NotificationType } from '@/contexts/NotificationContext';
import { useLocation } from 'wouter';

export const NotificationIcon: React.FC<{ notificationType: NotificationType }> = ({ notificationType }) => {
  switch (notificationType) {
    case 'event_invitation':
      return <CalendarClock className="h-5 w-5 text-blue-500" />;
    case 'event_update':
      return <Calendar className="h-5 w-5 text-amber-500" />;
    case 'event_cancellation':
      return <Calendar className="h-5 w-5 text-red-500" />;
    case 'attendee_response':
      return <UserRound className="h-5 w-5 text-indigo-500" />;
    case 'event_reminder':
      return <CalendarClock className="h-5 w-5 text-purple-500" />;
    case 'invitation_accepted':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'invitation_declined':
      return <X className="h-5 w-5 text-red-500" />;
    case 'invitation_tentative':
      return <UserCog className="h-5 w-5 text-amber-500" />;
    case 'comment_added':
      return <Info className="h-5 w-5 text-blue-500" />;
    case 'resource_confirmed':
      return <Check className="h-5 w-5 text-green-500" />;
    case 'resource_denied':
      return <X className="h-5 w-5 text-red-500" />;
    case 'system_message':
    default:
      return <Info className="h-5 w-5 text-gray-500" />;
  }
};

const NotificationItem: React.FC<{ 
  notification: Notification;
  onRead: (id: number) => void;
  onDismiss: (id: number) => void;
  onActionTaken: (id: number) => void;
}> = ({ notification, onRead, onDismiss, onActionTaken }) => {
  const [_, setLocation] = useLocation();
  
  const handleClick = () => {
    // Mark as read when clicked
    if (!notification.isRead) {
      onRead(notification.id);
    }
    
    // If this notification relates to an event, navigate to that event
    if (notification.relatedEventId) {
      setLocation(`/event/${notification.relatedEventId}`);
    }
  };
  
  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'border-l-4 border-red-500';
      case 'medium':
        return 'border-l-4 border-amber-500';
      case 'low':
      default:
        return 'border-l-4 border-blue-400';
    }
  };
  
  // Parse additional data if present
  const additionalData = notification.additionalData 
    ? JSON.parse(notification.additionalData) 
    : null;
  
  return (
    <div 
      className={`p-3 border-b hover:bg-slate-50 cursor-pointer transition-colors ${
        notification.isRead ? 'bg-white' : 'bg-blue-50'
      } ${getPriorityClass(notification.priority)}`}
      onClick={handleClick}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <NotificationIcon notificationType={notification.type} />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{notification.title}</div>
            <div className="text-sm text-gray-700">{notification.message}</div>
            
            {/* Show additional content based on notification type */}
            {additionalData && additionalData.changesSummary && (
              <div className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">
                Changes: {additionalData.changesSummary}
              </div>
            )}
            
            {additionalData && additionalData.reason && (
              <div className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">
                Reason: {additionalData.reason}
              </div>
            )}
            
            {notification.relatedUserName && (
              <div className="text-xs text-gray-600 mt-1">
                From: {notification.relatedUserName}
              </div>
            )}
            
            <div className="text-xs text-gray-500 mt-1">
              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
            </div>
            
            {/* Action button for notifications that require action */}
            {notification.requiresAction && !notification.actionTaken && (
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering parent onClick
                  onActionTaken(notification.id);
                }}
              >
                Acknowledge
              </Button>
            )}
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()} // Prevent triggering parent onClick
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">More options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!notification.isRead && (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation(); 
                onRead(notification.id);
              }}>
                Mark as read
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation(); 
              onDismiss(notification.id);
            }}>
              Dismiss
            </DropdownMenuItem>
            {notification.relatedEventId && (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                setLocation(`/event/${notification.relatedEventId}`);
              }}>
                View event
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export const NotificationCenter: React.FC = () => {
  const { 
    notifications, 
    unreadCount, 
    loading, 
    markAsRead, 
    markAllAsRead, 
    dismissNotification, 
    markActionTaken,
    createTestNotification 
  } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  
  // Handle popover state
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };
  
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 px-1.5 h-5 min-w-5 flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Notifications</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <PopoverContent className="w-80 md:w-96 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => markAllAsRead()}
            >
              Mark all as read
            </Button>
          )}
        </div>
        
        {/* Notifications list */}
        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="flex justify-center items-center h-20">
              <div className="animate-pulse">Loading notifications...</div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col justify-center items-center h-40 text-gray-500">
              <Bell className="h-10 w-10 mb-2 opacity-30" />
              <p>No notifications</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => createTestNotification()}
              >
                Create Test Notification
              </Button>
            </div>
          ) : (
            notifications.map((notification) => (
              <NotificationItem 
                key={notification.id} 
                notification={notification}
                onRead={markAsRead}
                onDismiss={dismissNotification}
                onActionTaken={markActionTaken}
              />
            ))
          )}
        </ScrollArea>
        
        {/* Footer */}
        <div className="p-2 border-t text-xs text-gray-500 flex justify-between items-center">
          <span>Real-time notifications</span>
          
          {/* Debug button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => createTestNotification()}
            className="text-xs h-7"
          >
            Test
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};