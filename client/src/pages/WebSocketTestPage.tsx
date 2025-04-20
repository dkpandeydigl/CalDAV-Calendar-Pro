import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { AlertCircle, ArrowLeft, Send } from 'lucide-react';
import { useLocation } from 'wouter';
import WebSocketStatusIndicator from '@/components/WebSocketStatusIndicator';
import useWebSocket from '@/hooks/useWebSocket';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { WebSocketNotification } from '@/services/websocketService';

const WebSocketTestPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [messages, setMessages] = useState<WebSocketNotification[]>([]);
  const [messageText, setMessageText] = useState('');
  const [selectedType, setSelectedType] = useState<'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email' | 'uid'>('system');
  const [selectedAction, setSelectedAction] = useState<'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info' | 'add' | 'update' | 'delete'>('info');
  const [includeAttendeeFlag, setIncludeAttendeeFlag] = useState(false);
  const [includeResourceFlag, setIncludeResourceFlag] = useState(false);
  const [includeRecurrenceFlag, setIncludeRecurrenceFlag] = useState(false);
  
  // Use the WebSocket hook
  const { 
    connectionStatus, 
    sendMessage,
    lastNotification
  } = useWebSocket({
    userId: user?.id || null,
    autoConnect: true,
    onMessage: (notification) => {
      console.log('Received notification:', notification);
      setMessages(prev => [...prev, notification]);
    }
  });

  // Add last notification to messages when it changes
  useEffect(() => {
    if (lastNotification) {
      setMessages(prev => [...prev, lastNotification]);
    }
  }, [lastNotification]);

  const handleBack = () => {
    setLocation('/');
  };

  const handleSendMessage = () => {
    if (!messageText.trim()) {
      toast({
        title: 'Message Required',
        description: 'Please enter a message to send',
        variant: 'destructive'
      });
      return;
    }

    // Create a test notification message
    let notificationData: any = {
      message: messageText,
      userId: user?.id,
      username: user?.username
    };
    
    // Add flags for event updates if applicable
    if (selectedType === 'event' && selectedAction === 'updated') {
      if (includeAttendeeFlag) {
        notificationData.wasAttendeeUpdate = true;
        notificationData.hasAttendees = true;
      }
      
      if (includeResourceFlag) {
        notificationData.wasResourceUpdate = true;
        notificationData.hasResources = true;
      }
      
      if (includeRecurrenceFlag) {
        notificationData.wasRecurrenceStateChange = true;
        notificationData.isRecurring = true;
        notificationData.recurrenceRule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO";
      }
      
      // Add mock event data for better testing
      notificationData.title = "Test Event";
      notificationData.eventId = 12345;
      notificationData.calendarId = 1;
      notificationData.calendarName = "Test Calendar";
    }
    
    // For event_changed we need to use a specific format
    // that matches what the event_changed WebSocket handler expects
    let notification: WebSocketNotification;
    
    if (selectedType === 'event') {
      notification = {
        type: 'event_changed',
        action: selectedAction,
        timestamp: Date.now(),
        eventId: 12345,
        changeType: selectedAction as 'created' | 'updated' | 'deleted',
        data: notificationData,
        sourceUserId: user?.id
      };
    } else {
      notification = {
        type: selectedType,
        action: selectedAction,
        timestamp: Date.now(),
        data: notificationData,
        sourceUserId: user?.id
      };
    }

    // Send the notification
    const sent = sendMessage(notification);
    
    if (sent) {
      toast({
        title: 'Message Sent',
        description: 'Your test message was sent successfully'
      });
      setMessageText('');
    } else {
      toast({
        title: 'Send Failed',
        description: 'Failed to send message. Check your connection status.',
        variant: 'destructive'
      });
    }
  };

  // Get color based on notification type
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'event': return 'bg-blue-100 text-blue-800';
      case 'calendar': return 'bg-green-100 text-green-800';
      case 'system': return 'bg-purple-100 text-purple-800';
      case 'resource': return 'bg-orange-100 text-orange-800';
      case 'attendee': return 'bg-cyan-100 text-cyan-800';
      case 'email': return 'bg-pink-100 text-pink-800';
      case 'uid': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Get color based on action
  const getActionColor = (action: string) => {
    switch (action) {
      case 'created': return 'bg-green-100 text-green-800';
      case 'updated': return 'bg-blue-100 text-blue-800';
      case 'deleted': return 'bg-red-100 text-red-800';
      case 'status-change': return 'bg-yellow-100 text-yellow-800';
      case 'error': return 'bg-red-100 text-red-800';
      case 'info': return 'bg-gray-100 text-gray-800';
      case 'add': return 'bg-green-100 text-green-800';
      case 'update': return 'bg-blue-100 text-blue-800';
      case 'delete': return 'bg-red-100 text-red-800';
      case 'uid-sync': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleBack}
          className="flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Calendar
        </Button>
        <WebSocketStatusIndicator userId={user?.id || null} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WebSocket Test Console</CardTitle>
          <CardDescription>
            Test real-time notifications and WebSocket connectivity
          </CardDescription>
          <div className="mt-2 flex items-center gap-2">
            <span>Status:</span>
            <Badge variant={connectionStatus === 'connected' ? 'default' : 
                           connectionStatus === 'connecting' ? 'outline' : 'destructive'}>
              {connectionStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Message Type:</h3>
              <RadioGroup 
                value={selectedType} 
                onValueChange={(value) => setSelectedType(value as any)}
                className="flex flex-wrap gap-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="event" id="type-event" />
                  <Label htmlFor="type-event">Event</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="calendar" id="type-calendar" />
                  <Label htmlFor="type-calendar">Calendar</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="system" id="type-system" />
                  <Label htmlFor="type-system">System</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="resource" id="type-resource" />
                  <Label htmlFor="type-resource">Resource</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="attendee" id="type-attendee" />
                  <Label htmlFor="type-attendee">Attendee</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="email" id="type-email" />
                  <Label htmlFor="type-email">Email</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="uid" id="type-uid" />
                  <Label htmlFor="type-uid">Event UID</Label>
                </div>
              </RadioGroup>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">Action:</h3>
              <RadioGroup 
                value={selectedAction} 
                onValueChange={(value) => setSelectedAction(value as any)}
                className="flex flex-wrap gap-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="created" id="action-created" />
                  <Label htmlFor="action-created">Created</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="updated" id="action-updated" />
                  <Label htmlFor="action-updated">Updated</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="deleted" id="action-deleted" />
                  <Label htmlFor="action-deleted">Deleted</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="status-change" id="action-status" />
                  <Label htmlFor="action-status">Status Change</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="error" id="action-error" />
                  <Label htmlFor="action-error">Error</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="info" id="action-info" />
                  <Label htmlFor="action-info">Info</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="add" id="action-add" />
                  <Label htmlFor="action-add">Add</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="update" id="action-update" />
                  <Label htmlFor="action-update">Update</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="delete" id="action-delete" />
                  <Label htmlFor="action-delete">Delete</Label>
                </div>
              </RadioGroup>
            </div>

            {selectedType === 'event' && selectedAction === 'updated' && (
              <div className="space-y-2 p-3 bg-gray-50 rounded-md">
                <h3 className="text-sm font-medium">Event Update Flags:</h3>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="attendee-flag"
                      checked={includeAttendeeFlag}
                      onChange={(e) => setIncludeAttendeeFlag(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="attendee-flag">Include wasAttendeeUpdate</Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="resource-flag"
                      checked={includeResourceFlag}
                      onChange={(e) => setIncludeResourceFlag(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="resource-flag">Include wasResourceUpdate</Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="recurrence-flag"
                      checked={includeRecurrenceFlag}
                      onChange={(e) => setIncludeRecurrenceFlag(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="recurrence-flag">Include wasRecurrenceStateChange</Label>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center space-x-2">
              <Input
                placeholder="Enter message text..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={handleSendMessage}
                disabled={!messageText.trim() || connectionStatus !== 'connected'}
              >
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
            </div>

            {connectionStatus !== 'connected' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md flex items-center text-amber-800">
                <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                <span className="text-sm">
                  {connectionStatus === 'connecting' 
                    ? 'Establishing connection to server...' 
                    : 'Not connected to WebSocket server. Messages cannot be sent.'}
                </span>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium mb-2">Received Messages:</h3>
              <Card className="border border-gray-200">
                <ScrollArea className="h-[300px] w-full p-2">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 text-center">
                      No messages received yet
                    </p>
                  ) : (
                    <div className="space-y-4 p-2">
                      {messages.map((msg, index) => (
                        <div key={index} className="space-y-2 pb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={getTypeColor(msg.type)}>
                              {msg.type}
                            </Badge>
                            <Badge className={getActionColor(msg.action)}>
                              {msg.action}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-sm bg-gray-50 p-2 rounded">
                            {typeof msg.data === 'object' 
                              ? JSON.stringify(msg.data, null, 2) 
                              : msg.data}
                          </div>
                          {index < messages.length - 1 && <Separator />}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </Card>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <div className="text-xs text-gray-500">
            User ID: {user?.id || 'Not logged in'}
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setMessages([])}
          >
            Clear Messages
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default WebSocketTestPage;