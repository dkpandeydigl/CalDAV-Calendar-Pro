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
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  if (!event) return null;
  
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
              <DialogTitle>Event Details</DialogTitle>
              {isOwner || canEdit ? (
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
            
            {/* Attendees section */}
            {event.attendees && Array.isArray(event.attendees) && event.attendees.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Attendees</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  <ul className="space-y-1">
                    {(event.attendees as unknown as string[]).map((attendee, index) => (
                      <li key={index} className="flex items-center">
                        <span className="material-icons text-neutral-500 mr-2 text-sm">person</span>
                        {attendee}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            
            {/* Resources section */}
            {event.resources && Array.isArray(event.resources) && event.resources.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Resources</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  <ul className="space-y-1">
                    {(event.resources as unknown as string[]).map((resource, index) => (
                      <li key={index} className="flex items-center">
                        <span className="material-icons text-neutral-500 mr-2 text-sm">room</span>
                        {resource}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {(isOwner || canEdit) && (
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
