import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { MailCheck, AlertTriangle, User as UserIcon, VideoIcon, DoorClosed, Laptop, Wrench, Settings, MapPin, Info, Clock, MapPinned, AlertCircle } from 'lucide-react';
import DirectResourceExtractor from './DirectResourceExtractor';
import ResourceManager from '@/components/resources/ResourceManager';
import DirectAttendeeExtractor from './DirectAttendeeExtractor';
import AttendeeResponseForm from '../attendees/AttendeeResponseForm';
import AttendeeStatusDisplay from '../attendees/AttendeeStatusDisplay';

// Skip TypeScript errors for the JSON fields - they're always going to be tricky to handle
function sanitizeDescriptionForDisplay(description: string | any): string {
  if (!description) return '';
  
  // If it's already a string, return it
  if (typeof description === 'string') {
    return description;
  }
  
  // If it's some other type of object, try to stringify it
  try {
    return JSON.stringify(description);
  } catch (e) {
    return String(description);
  }
}

interface UserWithEmail {
  id: number;
  username: string;
  password: string;
  preferredTimezone: string;
  email: string | null;
}

interface EventDetailModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
  onEdit: () => void;
}

export default function EventDetailModal({ open, event, onClose, onEdit }: EventDetailModalProps) {
  const { user } = useAuth();
  const { data: calendars } = useCalendars();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [emailPreviewDialogOpen, setEmailPreviewDialogOpen] = useState(false);
  const [resources, setResources] = useState<any[]>([]);
  const [attendees, setAttendees] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("details");
  const [initialAttendeeEmail, setInitialAttendeeEmail] = useState<string | null>(null);
  const [attendeeListExpanded, setAttendeeListExpanded] = useState(false);
  
  const queryClient = useQueryClient();
  const { deleteEvent } = useCalendarEvents();
  const { hasCreatePermission, hasModifyPermission } = useCalendarPermissions();
  
  useEffect(() => {
    if (event?.description) {
      try {
        // Extract resources from the description if available
        const resourceData = DirectResourceExtractor({ rawData: event.description });
        if (resourceData && resourceData.length > 0) {
          setResources(resourceData);
        } else {
          setResources([]);
        }
        
        // Extract attendees from the description if available
        const attendeeData = DirectAttendeeExtractor({ rawData: event.description });
        if (attendeeData && attendeeData.length > 0) {
          setAttendees(attendeeData);
        } else {
          setAttendees([]);
        }
      } catch (error) {
        console.error("Error parsing event description data:", error);
      }
    } else {
      setResources([]);
      setAttendees([]);
    }
    
    // Reset the expanded state whenever the modal is opened
    setAttendeeListExpanded(false);
    
  }, [event]);
  
  // Determine if the current user is an attendee
  useEffect(() => {
    if (user && user.email && attendees.length > 0) {
      const userAttendee = attendees.find(
        (att) => att.email && att.email.toLowerCase() === user.email?.toLowerCase()
      );
      
      if (userAttendee) {
        setInitialAttendeeEmail(userAttendee.email);
      } else {
        setInitialAttendeeEmail(null);
      }
    } else {
      setInitialAttendeeEmail(null);
    }
  }, [attendees, user]);
  
  if (!open || !event) return null;
  
  const calendarOfEvent = calendars?.find(cal => cal.id === event.calendarId);
  
  const handleDelete = async () => {
    if (event) {
      try {
        await deleteEvent.mutateAsync(event.id);
        setDeleteDialogOpen(false);
        onClose();
        // Invalidate the events query to refresh the list
        queryClient.invalidateQueries({ queryKey: ['/api/calendars', event.calendarId, 'events'] });
      } catch (error) {
        console.error('Error deleting event:', error);
      }
    }
  };
  
  const canModifyEvent = calendarOfEvent ? hasModifyPermission(calendarOfEvent) : false;
  
  // Determine the date/time display for the event
  let startDate: Date;
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
  } catch (error) {
    console.error("Error parsing event dates:", error);
    startDate = new Date();
    endDate = new Date();
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{event.title || "Untitled Event"}</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="details" className="mt-4" onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="attendees">Attendees</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  {/* Time & Date */}
                  <div className="flex items-start space-x-2">
                    <Clock className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div>
                      <h3 className="font-medium">Time & Date</h3>
                      <p className="text-sm text-gray-700">{formatDayOfWeekDate(startDate)}</p>
                      <p className="text-sm text-gray-700">{formatEventTimeRange(startDate, endDate)}</p>
                    </div>
                  </div>
                  
                  {/* Location */}
                  {event.location && (
                    <div className="flex items-start space-x-2">
                      <MapPin className="h-5 w-5 text-gray-500 mt-0.5" />
                      <div>
                        <h3 className="font-medium">Location</h3>
                        <p className="text-sm text-gray-700">{event.location}</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Calendar */}
                  <div className="flex items-start space-x-2">
                    <Info className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div>
                      <h3 className="font-medium">Calendar</h3>
                      <p className="text-sm text-gray-700">{calendarOfEvent?.name || "Unknown Calendar"}</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {/* Description */}
                  <div>
                    <h3 className="font-medium mb-1">Description</h3>
                    <div className="text-sm text-gray-700 p-3 bg-gray-50 rounded-md max-h-48 overflow-y-auto">
                      {event.description ? (
                        <div 
                          dangerouslySetInnerHTML={{ 
                            __html: sanitizeDescriptionForDisplay(event.description)
                          }} 
                        />
                      ) : (
                        <p className="text-gray-500 italic">No description provided</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="attendees" className="pt-4">
              <div className="space-y-4">
                <h3 className="font-medium">Attendees</h3>
                
                {attendees.length > 0 ? (
                  <div>
                    <AttendeeStatusDisplay 
                      attendees={attendees}
                      isExpanded={attendeeListExpanded}
                      onToggleExpand={() => setAttendeeListExpanded(!attendeeListExpanded)}
                    />
                    
                    {initialAttendeeEmail && (
                      <div className="mt-6 pt-4 border-t">
                        <h3 className="font-medium mb-2">Your Response</h3>
                        <AttendeeResponseForm
                          eventId={event.id}
                          attendeeEmail={initialAttendeeEmail}
                          onResponseSubmitted={() => {
                            // Refresh the event data to update the attendee status
                            queryClient.invalidateQueries({ 
                              queryKey: ['/api/calendars', event.calendarId, 'events'] 
                            });
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 italic">No attendees for this event</p>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="resources" className="pt-4">
              <div className="space-y-4">
                <h3 className="font-medium">Resources</h3>
                
                {resources.length > 0 ? (
                  <div className="space-y-3">
                    {resources.map((resource, index) => (
                      <div key={index} className="p-3 bg-gray-50 rounded-md flex items-start">
                        {resource.subType === 'Conference Room' ? (
                          <DoorClosed className="h-5 w-5 text-blue-500 mr-2 mt-0.5" />
                        ) : resource.subType === 'Equipment' ? (
                          <Wrench className="h-5 w-5 text-orange-500 mr-2 mt-0.5" />
                        ) : resource.subType === 'Virtual Meeting' ? (
                          <VideoIcon className="h-5 w-5 text-purple-500 mr-2 mt-0.5" />
                        ) : (
                          <Laptop className="h-5 w-5 text-gray-500 mr-2 mt-0.5" />
                        )}
                        
                        <div>
                          <p className="font-medium">{resource.id}</p>
                          <p className="text-sm text-gray-600">{resource.subType}</p>
                          {resource.capacity && <p className="text-sm text-gray-600">Capacity: {resource.capacity}</p>}
                          {resource.remarks && <p className="text-sm text-gray-600">Notes: {resource.remarks}</p>}
                          {resource.adminName && <p className="text-sm text-gray-600">Managed by: {resource.adminName}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 italic">No resources reserved for this event</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter className="flex justify-between">
            <div>
              {canModifyEvent && (
                <Button variant="outline" onClick={() => setDeleteDialogOpen(true)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {canModifyEvent && (
                <Button onClick={onEdit}>
                  Edit
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}