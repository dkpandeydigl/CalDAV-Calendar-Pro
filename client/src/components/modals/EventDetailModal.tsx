import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatTime, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  if (!event) return null;
  
  // Get calendar metadata either from the rawData or find it from calendars
  const calendarMetadata = event.rawData as any;
  const calendarName = calendarMetadata?.calendarName;
  const calendarColor = calendarMetadata?.calendarColor;
  
  // Fallback to looking up calendar if no metadata
  const calendar = calendars.find(cal => cal.id === event.calendarId);
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
      
      // Simple mutation call without callbacks
      deleteEvent(event.id);
      
      // Use a timeout to allow time for the UI to update 
      // and for the delete request to be sent
      setTimeout(() => {
        // Close modals after a short delay
        setIsDeleting(false);
        setDeleteDialogOpen(false);
        onClose();
      }, 500);
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
            </div>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{event.title}</h1>
              
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
          </div>
          
          <DialogFooter>
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
