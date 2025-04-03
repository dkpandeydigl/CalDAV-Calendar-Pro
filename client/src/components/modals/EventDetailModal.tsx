import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatTime, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';

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
  const { calendars } = useCalendars();
  const { deleteEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoading } = useAuth();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Use useState to track loading state that we can modify
  const [showLoading, setShowLoading] = useState(isUserLoading);
  
  // Always render the dialog, even when loading
  // This prevents the modal from disappearing during loading states
  
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
  
  // Update state to reflect authentication status
  const [isLoading, setIsLoading] = useState(isUserLoading);
  
  // Get calendar metadata either from the rawData or find it from calendars
  const calendarMetadata = event.rawData as any;
  const calendarName = calendarMetadata?.calendarName;
  const calendarColor = calendarMetadata?.calendarColor;
  
  // Find the calendar in the user's calendars
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Get permission information for this calendar
  const { canEdit, isOwner } = event.calendarId ? 
    getCalendarPermission(event.calendarId) : 
    { canEdit: false, isOwner: false };
    
  // For events in user's own calendars, always allow edit
  // If we don't have a user object, default to the permissions from getCalendarPermission
  
  // For security, we use view-only as the default permission when auth state is incomplete
  let isUsersOwnCalendar = false;
  let effectiveCanEdit = false;
  
  // Authentication status check
  const isAuthError = !isUserLoading && !user; // If not loading and no user, this is an auth error
  
  // If auth state changes, update our loading state
  React.useEffect(() => {
    if (isAuthError) {
      // Auth error - stop showing loading spinner, show view-only mode
      setIsLoading(false);
    } else {
      // Normal loading state tracks the user loading state
      setIsLoading(isUserLoading);
    }
  }, [isUserLoading, isAuthError]);
  
  // Determine permissions based on auth state
  React.useEffect(() => {
    // If we have an authentication error, we'll just show the event as view-only
    if (isAuthError) {
      console.log(`Authentication required for full permission check on event "${event.title}"`);
    } 
    // If user data is still loading, remain in loading state
    else if (isUserLoading || !user || !user.id) {
      console.log(`Still loading user data for event ${event.title}, user:`, user);
    }
    // User is authenticated, determine actual permissions  
    else if (user && user.id) {
      if (calendar) {
        console.log(`Ownership check: Calendar ${calendar.id} (${calendar.name}) - Calendar userId: ${calendar.userId}, Current userId: ${user.id}, Match: ${calendar.userId === user.id}`);
      }
    }
  }, [isAuthError, isUserLoading, user, calendar, event.title]);
  
  // Determine permissions based on auth state
  if (isAuthError) {
    // Auth error - show view-only mode
    effectiveCanEdit = false;
    isUsersOwnCalendar = false;
  } else if (isUserLoading || !user || !user.id) {
    // Still loading - default to view-only until we know more
    effectiveCanEdit = false;
    isUsersOwnCalendar = false;
  } else {
    // User is authenticated, determine actual permissions
    isUsersOwnCalendar = calendar ? calendar.userId === user.id : false;
    effectiveCanEdit = isUsersOwnCalendar || canEdit || isOwner;
  }
  
  // Debug log authentication and permissions status
  console.log(`Event ${event.title} - Auth status: ${isAuthError ? 'AUTH_ERROR' : isLoading ? 'LOADING' : 'AUTHENTICATED'}, Calendar ID: ${event.calendarId}, canEdit: ${canEdit}, isOwner: ${isOwner}, isUsersOwnCalendar: ${isUsersOwnCalendar}, User ID: ${user?.id}, Calendar UserID: ${calendar?.userId}, effectiveCanEdit: ${effectiveCanEdit}`);
  // Safely create date objects with validation
  let startDate: Date;
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error(`Invalid event dates for "${event.title}"`);
      // Fallback to current date if invalid
      startDate = new Date();
      endDate = new Date();
      endDate.setHours(endDate.getHours() + 1);
    }
  } catch (error) {
    console.error(`Error parsing dates for event "${event.title}":`, error);
    // Fallback to current date if error
    startDate = new Date();
    endDate = new Date();
    endDate.setHours(endDate.getHours() + 1);
  }
  
  const handleDelete = async () => {
    if (!event) return;
    
    try {
      console.log(`Attempting to delete event with ID: ${event.id}`);
      setIsDeleting(true);
      
      // Delete the event first
      deleteEvent(event.id);
      
      // Force immediate invalidation of all event queries to refresh the UI
      queryClient.invalidateQueries({
        queryKey: ['/api/events'],
        refetchType: 'all' // Force immediate refetch
      });
      
      // Force invalidation of calendar-specific events if we know which calendar
      if (event.calendarId) {
        queryClient.invalidateQueries({
          queryKey: ['/api/calendars', event.calendarId, 'events'],
          refetchType: 'all'
        });
      }
      
      // Close modals immediately to show the updated UI
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error(`Unexpected error during delete: ${(error as Error).message}`);
      // Still close dialogs on error
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    }
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex justify-between items-center">
              <DialogTitle>
                Event Details
                {isLoading && (
                  <span className="ml-2 inline-block w-4 h-4 rounded-full border-2 border-t-transparent border-primary animate-spin" />
                )}
              </DialogTitle>
              {isLoading ? (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  Loading...
                </div>
              ) : isOwner || effectiveCanEdit ? (
                <div className="flex">
                  <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
                    <span className="material-icons">edit</span>
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteDialogOpen(true)}
                    title="Delete"
                  >
                    <span className="material-icons">delete</span>
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  View only
                </div>
              )}
            </div>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">{event.title}</h1>
                
                {/* Sync status indicator */}
                {event.syncStatus && (
                  <div 
                    className={`text-xs px-2 py-1 rounded-full ${
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
              
              {/* Show calendar info from rawData metadata if available */}
              {(calendarName && calendarColor) ? (
                <div className="text-sm text-neutral-500 flex items-center">
                  <span 
                    className="w-3 h-3 rounded-full mr-2" 
                    style={{ backgroundColor: calendarColor }}
                  ></span>
                  {calendarName}
                </div>
              ) : calendar ? (
                <div className="text-sm text-neutral-500 flex items-center">
                  <span 
                    className="w-3 h-3 rounded-full mr-2" 
                    style={{ backgroundColor: calendar.color }}
                  ></span>
                  {calendar.name} Calendar
                </div>
              ) : null}
            </div>
            
            <div className="flex items-start">
              <span className="material-icons text-neutral-500 mr-2">schedule</span>
              <div>
                <div className="text-sm">{formatDayOfWeekDate(startDate)}</div>
                <div className="text-sm">
                  {event.allDay 
                    ? 'All Day' 
                    : formatEventTimeRange(startDate, endDate)}
                  {' '}({event.timezone})
                </div>
              </div>
            </div>
            
            {event.location && (
              <div className="flex items-start">
                <span className="material-icons text-neutral-500 mr-2">location_on</span>
                <div className="text-sm">{event.location}</div>
              </div>
            )}
            
            {event.description && (
              <div>
                <div className="text-sm font-medium mb-1">Description</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  {event.description}
                </div>
              </div>
            )}
            
            {/* Attendees section - safely rendered */}
            {(() => {
              // Handle attendees with safe type checking
              try {
                if (event.attendees && Array.isArray(event.attendees) && event.attendees.length > 0) {
                  // Convert to string array safely
                  const attendeeList = event.attendees
                    .filter(a => a !== null && a !== undefined)
                    .map(a => String(a));
                    
                  if (attendeeList.length > 0) {
                    return (
                      <div>
                        <div className="text-sm font-medium mb-1">Attendees</div>
                        <div className="text-sm p-3 bg-neutral-100 rounded-md">
                          <ul className="space-y-1">
                            {attendeeList.map((attendee, index) => (
                              <li key={index} className="flex items-center">
                                <span className="material-icons text-neutral-500 mr-2 text-sm">person</span>
                                {attendee}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  }
                }
              } catch (error) {
                console.error("Error rendering attendees:", error);
              }
              return null;
            })()}
            
            {/* Resources section - safely rendered */}
            {(() => {
              // Handle resources with safe type checking
              try {
                if (event.resources && Array.isArray(event.resources) && event.resources.length > 0) {
                  // Convert to string array safely
                  const resourceList = event.resources
                    .filter(r => r !== null && r !== undefined)
                    .map(r => String(r));
                    
                  if (resourceList.length > 0) {
                    return (
                      <div>
                        <div className="text-sm font-medium mb-1">Resources</div>
                        <div className="text-sm p-3 bg-neutral-100 rounded-md">
                          <ul className="space-y-1">
                            {resourceList.map((resource, index) => (
                              <li key={index} className="flex items-center">
                                <span className="material-icons text-neutral-500 mr-2 text-sm">room</span>
                                {resource}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  }
                }
              } catch (error) {
                console.error("Error rendering resources:", error);
              }
              return null;
            })()}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {!isLoading && (isOwner || effectiveCanEdit) && (
                <>
                  <Button 
                    variant="outline" 
                    className="border-red-200 text-red-600 hover:bg-red-50" 
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    Delete
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={onEdit}
                  >
                    Edit
                  </Button>
                </>
              )}
              {isLoading && (
                <div className="text-sm text-muted-foreground py-2">
                  Loading permission information...
                </div>
              )}
              {isAuthError && (
                <div className="text-sm text-muted-foreground py-2 flex items-center">
                  <span className="material-icons text-amber-500 mr-1 text-sm">info</span>
                  Log in to edit events
                </div>
              )}
            </div>
            <Button onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
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
