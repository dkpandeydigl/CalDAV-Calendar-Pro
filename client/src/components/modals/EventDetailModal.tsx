import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { 
  MailCheck, AlertTriangle, User as UserIcon, UserRound, 
  VideoIcon, DoorClosed, Laptop, Wrench, Settings, MapPin, 
  Info, Clock, MapPinned, AlertCircle, Trash2, Calendar, History 
} from 'lucide-react';

/**
 * Helper function to sanitize and process description content for display
 */
function sanitizeDescriptionForDisplay(description: string | any): string {
  if (!description) return '';
  
  const desc = String(description);
  
  // Handle various formats
  if (desc.includes('"ALTREP"') || desc.includes('"params"')) {
    try {
      const valMatch = desc.match(/"val"\s*:\s*"([^"]+)"/);
      if (valMatch && valMatch[1]) {
        return valMatch[1].replace(/\\n/g, '<br>').replace(/\\/g, '');
      }
      
      const altrepMatch = desc.match(/"ALTREP"\s*:\s*"data:text\/html[^"]*,([^"]+)"/);
      if (altrepMatch && altrepMatch[1]) {
        try {
          return decodeURIComponent(altrepMatch[1]);
        } catch (e) {
          return altrepMatch[1];
        }
      }
      
      return desc.replace(/["[\]{}]/g, '')
                .replace(/params:|ALTREP:|val:/g, '')
                .replace(/data:text\/html[^,]*,/g, '')
                .trim();
    } catch (e) {
      console.error('Error parsing special format:', e);
      return desc;
    }
  }
  
  if (desc.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
    return desc;
  }
  
  if (desc.includes('&lt;') && desc.includes('&gt;')) {
    const unescaped = desc
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    if (unescaped.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
      return unescaped;
    }
  }
  
  return desc.replace(/\\n/g, '<br>').replace(/\n/g, '<br>');
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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: calendars } = useCalendars();
  const { deleteEvent } = useCalendarEvents();
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [resourcesDialogOpen, setResourcesDialogOpen] = useState(false);
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);
  
  // Get calendar info - must call hooks before any conditional returns
  const calendar = event && calendars?.find(cal => cal.id === event.calendarId);
  const calendarName = calendar?.name;
  const calendarColor = calendar?.color;
  
  // Check permissions - always call this hook even if event is null
  const { data: userPermissions, isLoading: isUserLoading, isError: isAuthError } = 
    useCalendarPermissions(event?.calendarId || 0);
    
  // If event is null, don't render after hooks are called
  if (!event) return null;
  
  const isUsersOwnCalendar = event.calendarId && user?.id ? 
    calendar?.userId === user.id : false;
  
  const effectiveCanEdit = userPermissions?.canEdit || false;
  const canEdit = isUsersOwnCalendar || effectiveCanEdit;
  
  // Extract timestamps
  const startDate = new Date(event.startAt);
  const endDate = new Date(event.endAt);
  
  // Handle attendees 
  const hasAttendees = (event.rawData && typeof event.rawData === 'object' && 
    event.rawData.attendee && Array.isArray(event.rawData.attendee) && 
    event.rawData.attendee.length > 0);
    
  const processedAttendees = hasAttendees && event.rawData ? 
    (event.rawData.attendee || []) : [];
  
  // Extract resources from rawData
  const extractResourcesFromRawData = () => {
    if (!event.rawData) return [];
    
    try {
      const resources = [];
      
      // Handle different formats
      if (event.rawData.resources && Array.isArray(event.rawData.resources)) {
        resources.push(...event.rawData.resources);
      }
      
      if (event.rawData.resource && Array.isArray(event.rawData.resource)) {
        resources.push(...event.rawData.resource);
      }
      
      // Handle mixed formats (strings, objects, etc.)
      return resources.filter(r => r !== null && typeof r === 'object');
    } catch (error) {
      console.error("Error parsing resources:", error);
      return [];
    }
  };
  
  // Handle deletion
  const handleDeleteEvent = async () => {
    if (!event) return;
    
    try {
      await deleteEvent.mutateAsync(event.id);
      setDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error("Error deleting event:", error);
    }
  };
  
  // Handle cancellation (for attendees)
  const handleCancelEvent = async () => {
    if (!event) return;
    
    try {
      // Implementation of cancel functionality would go here
      setCancelDialogOpen(false);
      onClose();
    } catch (error) {
      console.error("Error canceling event:", error);
    }
  };

  // Function to format date display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-[95vw] md:max-w-4xl max-h-[85vh] flex flex-col p-0">
          {/* Header area */}
          <DialogHeader className="p-6 pb-2">
            <div className="flex justify-between items-center">
              <DialogTitle>
                Event Details
                {isUserLoading && (
                  <span className="ml-2 inline-block w-4 h-4 rounded-full border-2 border-t-transparent border-primary animate-spin" />
                )}
              </DialogTitle>
              {isUserLoading ? (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  Loading...
                </div>
              ) : !(isUsersOwnCalendar || effectiveCanEdit) ? (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  View only
                </div>
              ) : null}
            </div>
          </DialogHeader>
          
          {/* Main content container with scrollable area */}
          <div className="flex-1 overflow-y-auto p-6 pt-0">
            <div className="space-y-4">
              {/* Top heading with title and calendar info */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <h1 className="text-xl font-semibold mb-2 sm:mb-0" title={event.title}>
                    {event.title.length > 50 ? `${event.title.substring(0, 50)}...` : event.title}
                  </h1>
                </div>
                    
                {/* Show calendar info if available */}
                {calendar && (
                  <div className="text-sm text-neutral-500 flex items-center mt-1">
                    <span 
                      className="w-3 h-3 rounded-full mr-2" 
                      style={{ backgroundColor: calendarColor || calendar.color }}
                    ></span>
                    {calendarName || calendar.name} {!calendarName && "Calendar"}
                  </div>
                )}
              </div>

              {/* Responsive layout that works on all screen sizes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left column */}
                <div className="space-y-4">
                  {/* Date and time card with improved visual design */}
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 shadow-sm">
                    <div className="flex flex-col space-y-3">
                      <div className="flex items-center">
                        <Clock className="text-blue-600 mr-3 h-5 w-5 flex-shrink-0" />
                        <div>
                          <div className="font-medium">
                            {formatDayOfWeekDate(startDate)}
                          </div>
                          <div className="text-sm text-blue-700">
                            {event.allDay 
                              ? 'All Day' 
                              : formatEventTimeRange(startDate, endDate)}
                            {event.timezone && <span className="text-blue-600/70 text-xs ml-1">({event.timezone})</span>}
                          </div>
                        </div>
                      </div>
                        
                      {/* Location section - only show if there's a location */}
                      {event.location && (
                        <div className="flex items-start pt-2 border-t border-blue-200">
                          <MapPinned className="text-blue-600 mr-3 h-5 w-5 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium">Location</div>
                            <div className="text-sm text-blue-700">{event.location}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                    
                  {/* Description section - only show if there's a description */}
                  {event.description && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="font-medium mb-2 flex items-center">
                        <Info className="text-gray-600 mr-2 h-4 w-4" />
                        Description
                      </h3>
                      <div 
                        className="text-sm prose prose-sm max-w-none overflow-auto max-h-[150px] bg-white p-3 rounded border border-gray-100"
                        dangerouslySetInnerHTML={{ 
                          __html: sanitizeDescriptionForDisplay(event.description)
                        }}
                      />
                    </div>
                  )}
                </div>
                
                {/* Right column - Attendees */}
                <div className="space-y-4">
                  {/* Attendees section - only shown when event has attendees */}
                  {hasAttendees && processedAttendees.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="font-medium mb-2 flex items-center">
                        <UserIcon className="text-gray-600 mr-2 h-4 w-4" />
                        Attendees ({processedAttendees.length})
                      </h3>
                      
                      <div className="space-y-2">
                        {processedAttendees.slice(0, 3).map((attendee: any, index: number) => (
                          <div key={index} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-100">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                              {attendee.cn ? attendee.cn[0].toUpperCase() : "A"}
                            </div>
                            <div>
                              <div className="font-medium">{attendee.cn || attendee.email || 'Unknown Attendee'}</div>
                              <div className="text-xs text-muted-foreground">{attendee.email || ''}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Show all attendees button */}
                      {processedAttendees.length > 3 && (
                        <button 
                          onClick={() => setAttendeesDialogOpen(true)}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                        >
                          Show all {processedAttendees.length} attendees
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Fixed footer at the bottom */}
          <div className="sticky bottom-0 bg-background border-t p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {!isUserLoading && (
                  <>
                    {/* Action buttons */}
                    {canEdit && (
                      <>
                        <Button
                          variant="outline"
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteDialogOpen(true)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                        <Button
                          variant="outline"
                          className="border-blue-200 text-blue-600 hover:bg-blue-50"
                          onClick={onEdit}
                        >
                          Edit Event
                        </Button>
                      </>
                    )}
                  </>
                )}
                {isUserLoading && (
                  <div className="text-sm text-muted-foreground py-2">
                    Loading permission information...
                  </div>
                )}
                {isAuthError && (
                  <div className="text-sm text-muted-foreground py-2 flex items-center">
                    <Info className="text-amber-500 mr-1 h-4 w-4" />
                    <span>This event is part of a shared calendar</span>
                  </div>
                )}
              </div>
              <Button onClick={onClose} className="w-full sm:w-auto mt-2 sm:mt-0">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Delete Event Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete Event
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-muted-foreground">
              Are you sure you want to delete this event? This action cannot be undone.
            </p>
            <div className="mt-4 p-4 bg-gray-50 rounded-md border">
              <h4 className="font-medium">{event.title}</h4>
              <div className="text-sm text-muted-foreground mt-1">
                {formatDayOfWeekDate(startDate)}
                {!event.allDay && (
                  <span className="ml-1">
                    {formatEventTimeRange(startDate, endDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteEvent}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Cancel Event Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-600 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Cancel Event
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-muted-foreground">
              Would you like to cancel this event and notify all attendees?
            </p>
            <div className="mt-4 p-4 bg-gray-50 rounded-md border">
              <h4 className="font-medium">{event.title}</h4>
              <div className="text-sm text-muted-foreground mt-1">
                {formatDayOfWeekDate(startDate)}
                {!event.allDay && (
                  <span className="ml-1">
                    {formatEventTimeRange(startDate, endDate)}
                  </span>
                )}
              </div>
              {hasAttendees && (
                <div className="mt-3 text-sm">
                  <div className="font-medium text-amber-600">
                    <MailCheck className="inline-block mr-1 h-4 w-4" />
                    {processedAttendees.length} attendees will be notified
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
            >
              Back
            </Button>
            <Button
              variant="warning"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCancelEvent}
            >
              Cancel Event & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Resources Dialog */}
      <Dialog open={resourcesDialogOpen} onOpenChange={setResourcesDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-amber-600" />
              Event Resources
            </DialogTitle>
            <DialogDescription>
              Resources assigned to this event
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-1 gap-3">
              {extractResourcesFromRawData().map((resource: any, index: number) => {
                // Get resource info from various formats
                const name = resource.name || resource.adminName || 'Resource';
                const email = resource.email || resource.adminEmail || '';
                const type = resource.type || resource.subType || '';
                const capacity = resource.capacity || '';
                
                return (
                  <div key={index} className="bg-amber-50 p-3 rounded-md border border-amber-100">
                    <div className="flex items-start">
                      {type.toLowerCase().includes('proj') ? (
                        <VideoIcon className="text-amber-500 mr-3 h-5 w-5 mt-0.5" />
                      ) : type.toLowerCase().includes('room') ? (
                        <DoorClosed className="text-blue-500 mr-3 h-5 w-5 mt-0.5" />
                      ) : type.toLowerCase().includes('laptop') || type.toLowerCase().includes('computer') ? (
                        <Laptop className="text-green-500 mr-3 h-5 w-5 mt-0.5" />
                      ) : (
                        <Wrench className="text-neutral-500 mr-3 h-5 w-5 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="font-medium">{name}</div>
                        <div className="text-sm text-amber-700 mt-1">
                          {type || 'General Resource'}
                          {capacity && ` • Capacity: ${capacity}`}
                        </div>
                      </div>
                    </div>
                    {email && (
                      <div className="mt-2 text-xs text-muted-foreground border-t border-amber-100 pt-2">
                        Admin contact: {email}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setResourcesDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}