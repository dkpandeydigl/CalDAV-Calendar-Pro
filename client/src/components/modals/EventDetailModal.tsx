import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { Clock, MapPinned, Info, UserRound, Trash2, AlertTriangle, Settings } from 'lucide-react';

interface EventDetailModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
  onEdit: () => void;
}

const EventDetailModal: React.FC<EventDetailModalProps> = ({ 
  open, 
  event, 
  onClose,
  onEdit
}) => {
  // Hook calls - all must be at the top level
  const { calendars } = useCalendars();
  const { deleteEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoading } = useAuth();
  const queryClient = useQueryClient();
  
  // State hooks
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // If event is null, show an error state
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Unable to load event details.</p>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Parse the event data
  const calendarMetadata = event.rawData as any || {};
  const calendarName = calendarMetadata?.calendarName;
  const calendarColor = calendarMetadata?.calendarColor;
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Extract attendees and resources from event for type safety
  const attendees: string[] = Array.isArray(event.attendees) ? event.attendees.filter(Boolean).map(String) : [];
  const resources: string[] = Array.isArray(event.resources) ? event.resources.filter(Boolean).map(String) : [];
  
  // Get permissions in a safe way
  const permissions = event.calendarId ? getCalendarPermission(event.calendarId) : { canEdit: false, isOwner: false };
  const canEdit = permissions.canEdit;
  const isOwner = permissions.isOwner;
  
  // For events in user's own calendars, always allow edit
  const isUsersOwnCalendar = calendar ? calendar.userId === user?.id : false;
  const effectiveCanEdit = isUsersOwnCalendar || canEdit || isOwner;
  const isAuthError = !isUserLoading && !user;
  
  // Parse dates safely
  let startDate: Date;
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error(`Invalid event dates for "${event.title}"`);
      startDate = new Date();
      endDate = new Date();
      endDate.setHours(endDate.getHours() + 1);
    }
  } catch (error) {
    console.error(`Error parsing dates for event "${event.title}":`, error);
    startDate = new Date();
    endDate = new Date();
    endDate.setHours(endDate.getHours() + 1);
  }
  
  // Handle delete event
  const handleDelete = async () => {
    if (!event) return;
    
    try {
      setIsDeleting(true);
      deleteEvent(event.id);
      
      // Force UI refresh
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      if (event.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', event.calendarId, 'events'] 
        });
      }
      
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error(`Error during delete: ${(error as Error).message}`);
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    }
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
                  <h1 className="text-xl font-semibold mb-2 sm:mb-0">
                    {event.title}
                  </h1>
                    
                  {/* Sync status indicator */}
                  {event.syncStatus && (
                    <div 
                      className={`text-xs px-2 py-1 rounded-full w-fit ${
                        event.syncStatus === 'synced' 
                          ? 'bg-green-100 text-green-800' 
                          : event.syncStatus === 'syncing' 
                            ? 'bg-blue-100 text-blue-800' 
                            : event.syncStatus === 'sync_failed' 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {event.syncStatus === 'synced' 
                        ? 'Synced' 
                        : event.syncStatus === 'syncing' 
                          ? 'Syncing...' 
                          : event.syncStatus === 'sync_failed' 
                            ? 'Sync Failed' 
                            : 'Local'}
                    </div>
                  )}
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
                      >
                        {String(event.description)}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Right column - Attendees and Resources */}
                <div className="space-y-4">
                  {/* Attendees section - only shown when event has attendees */}
                  {attendees.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="font-medium mb-2 flex items-center">
                        <UserRound className="text-gray-600 mr-2 h-4 w-4" />
                        Attendees ({attendees.length})
                      </h3>
                      
                      <div className="space-y-2">
                        {attendees
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((attendee, index) => (
                            <div key={index} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-100">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                {String(attendee)[0]?.toUpperCase() || "A"}
                              </div>
                              <div>
                                <div className="font-medium">{String(attendee)}</div>
                              </div>
                            </div>
                          ))}
                      </div>
                      
                      {/* Show all attendees button if more than 3 */}
                      {attendees.length > 3 && (
                        <button 
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                        >
                          Show all {attendees.length} attendees
                        </button>
                      )}
                    </div>
                  )}
                  
                  {/* Resources section */}
                  {resources.length > 0 && (
                    <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 shadow-sm">
                      <h3 className="font-medium mb-2 flex items-center">
                        <Settings className="text-amber-600 mr-2 h-4 w-4" />
                        Resources ({resources.length})
                      </h3>
                      
                      <div className="grid grid-cols-1 gap-2">
                        {resources
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((resource, index) => (
                            <div key={index} className="flex items-center gap-2 bg-white p-2 rounded border border-amber-100">
                              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                                <Settings className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="font-medium">{String(resource)}</div>
                              </div>
                            </div>
                          ))}
                      </div>
                      
                      {/* Show all resources button if more than 2 */}
                      {resources.length > 2 && (
                        <button 
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                        >
                          Show all {resources.length} resources
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
                {!isUserLoading && effectiveCanEdit && (
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
                      onClick={onEdit}
                      className="border-blue-200 text-blue-600 hover:bg-blue-50"
                    >
                      Edit Event
                    </Button>
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
                    <span>Log in to edit events</span>
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
      
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default EventDetailModal;