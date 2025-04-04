import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
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
  // Hook calls - all must be at the top level
  const { calendars } = useCalendars();
  const { deleteEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoadingFromAuth } = useAuth();
  const queryClient = useQueryClient();
  
  // State hooks
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUserLoading, setIsUserLoading] = useState(isUserLoadingFromAuth);
  
  // Add a timeout to prevent infinite loading state
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    if (isUserLoadingFromAuth) {
      setIsUserLoading(true);
      timeoutId = setTimeout(() => {
        // Force loading to end after 2 seconds to prevent UI getting stuck
        setIsUserLoading(false);
        console.log("Auth loading timeout - forcing UI to proceed with available permissions");
      }, 2000);
    } else {
      setIsUserLoading(isUserLoadingFromAuth);
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isUserLoadingFromAuth]);
  
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
  
  // Get permissions in a safe way
  const permissions = event.calendarId ? getCalendarPermission(event.calendarId) : { canEdit: false, isOwner: false };
  const canEdit = permissions.canEdit;
  const isOwner = permissions.isOwner;
  
  // For events in user's own calendars, always allow edit
  const isUsersOwnCalendar = calendar ? calendar.userId === user?.id : false;
  
  // Check if this event is from a shared calendar with edit permissions
  const isFromSharedCalendarWithEditPermission = 
    calendarMetadata?.isShared === true && 
    event.calendarId && 
    queryClient.getQueryData<any[]>(['/api/shared-calendars'])?.some?.(
      cal => cal.id === event.calendarId && cal.permission === 'edit'
    );
  
  console.log(`Event ${event.id} permission check:`, {
    isUsersOwnCalendar,
    canEdit,
    isOwner,
    isFromSharedCalendarWithEditPermission,
    calendarMetadata
  });
  
  const effectiveCanEdit = isUsersOwnCalendar || canEdit || isOwner || isFromSharedCalendarWithEditPermission;
  
  // Only show auth error if we don't have user info AND don't have calendar data
  // If we have calendar data, assume server session is valid even if client-side auth state is missing
  const isAuthError = !isUserLoading && !user && !calendar;
  
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
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
              ) : (isUsersOwnCalendar || effectiveCanEdit) ? (
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
              
              {/* Show calendar info if available */}
              {calendar && (
                <div className="text-sm text-neutral-500 flex items-center">
                  <span 
                    className="w-3 h-3 rounded-full mr-2" 
                    style={{ backgroundColor: calendarColor || calendar.color }}
                  ></span>
                  {calendarName || calendar.name} {!calendarName && "Calendar"}
                </div>
              )}
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
            
            {/* Attendees section */}
            {event.attendees && Array.isArray(event.attendees) && (event.attendees as string[]).length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Attendees</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  <ul className="space-y-1">
                    {(event.attendees as string[])
                      .filter(Boolean)
                      .map((attendee, index) => (
                        <li key={index} className="flex items-center">
                          <span className="material-icons text-neutral-500 mr-2 text-sm">person</span>
                          {String(attendee)}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}
            
            {/* Resources section */}
            {event.resources && Array.isArray(event.resources) && (event.resources as string[]).length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Resources</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  <ul className="space-y-1">
                    {(event.resources as string[])
                      .filter(Boolean)
                      .map((resource, index) => (
                        <li key={index} className="flex items-center">
                          <span className="material-icons text-neutral-500 mr-2 text-sm">room</span>
                          {String(resource)}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {!isUserLoading && effectiveCanEdit && (
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
              {isUserLoading && (
                <div className="text-sm text-muted-foreground py-2">
                  Loading permission information...
                </div>
              )}
              {isAuthError && (
                <div className="text-sm text-muted-foreground py-2 flex items-center">
                  <span className="material-icons text-amber-500 mr-1 text-sm">info</span>
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-primary hover:text-primary/80 font-normal"
                    onClick={() => {
                      onClose();
                      window.location.href = '/auth';
                    }}
                  >
                    Log in to edit events
                  </Button>
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
