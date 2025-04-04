import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { getTimezones } from '@/lib/date-utils';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { useSharedCalendars } from '@/hooks/useSharedCalendars';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { Calendar } from 'lucide-react';
import type { Event } from '@shared/schema';

interface EventFormModalProps {
  open: boolean;
  event: Event | null;
  selectedDate?: Date;
  onClose: () => void;
}

const EventFormModal: React.FC<EventFormModalProps> = ({ open, event, selectedDate, onClose }) => {
  const { calendars } = useCalendars();
  const { sharedCalendars } = useSharedCalendars();
  const { createEvent, updateEvent, deleteEvent } = useCalendarEvents();
  const { selectedTimezone } = useCalendarContext();
  const { toast } = useToast();
  
  // Filter shared calendars to only include those with edit permissions
  const editableSharedCalendars = sharedCalendars.filter(cal => cal.permission === 'edit');
  
  // Basic form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [timezone, setTimezone] = useState(selectedTimezone);
  const [allDay, setAllDay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset form when modal opens/closes or event changes
  useEffect(() => {
    if (open) {
      if (event) {
        // Editing existing event
        setTitle(event.title);
        setDescription(event.description || '');
        setLocation(event.location || '');
        
        // Safely create date objects
        let start: Date;
        let end: Date;
        
        try {
          start = new Date(event.startDate);
          end = new Date(event.endDate);
          
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.error(`Invalid event dates for "${event.title}"`);
            start = new Date();
            end = new Date();
            end.setHours(end.getHours() + 1);
          }
        } catch (error) {
          console.error(`Error parsing dates for event "${event.title}":`, error);
          start = new Date();
          end = new Date();
          end.setHours(end.getHours() + 1);
        }
        
        // Format dates for form
        setStartDate(start.toISOString().split('T')[0]);
        setEndDate(end.toISOString().split('T')[0]);
        
        if (!event.allDay) {
          try {
            setStartTime(start.toTimeString().slice(0, 5));
            setEndTime(end.toTimeString().slice(0, 5));
          } catch (error) {
            console.error("Error formatting time:", error);
            setStartTime('09:00');
            setEndTime('10:00');
          }
        } else {
          setStartTime('00:00');
          setEndTime('23:59');
        }
        
        setCalendarId(event.calendarId.toString());
        setTimezone(event.timezone || selectedTimezone);
        setAllDay(event.allDay ?? false);
      } else {
        // Creating new event
        // Use selected date if provided, otherwise default to current date
        const now = selectedDate || new Date();
        
        // Format the date properly
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Get current time
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;
        
        // End time is 1 hour after current time
        const end = new Date(now.getTime() + 60 * 60 * 1000);
        const endHours = String(end.getHours()).padStart(2, '0');
        const endMinutes = String(end.getMinutes()).padStart(2, '0');
        const endTimeStr = `${endHours}:${endMinutes}`;
        
        setTitle('');
        setDescription('');
        setLocation('');
        setStartDate(dateStr);
        setEndDate(dateStr);
        setStartTime(timeStr);
        setEndTime(endTimeStr);
        
        // Set calendar ID - prioritize user's own calendars
        if (calendars.length > 0) {
          setCalendarId(calendars[0].id.toString());
        } else if (editableSharedCalendars.length > 0) {
          setCalendarId(editableSharedCalendars[0].id.toString());
        } else {
          setCalendarId('');
        }
        
        setTimezone(selectedTimezone);
        setAllDay(false);
      }
    }
  }, [open, event, calendars, editableSharedCalendars, selectedTimezone, selectedDate]);

  const handleSubmit = () => {
    if (!title.trim() || !startDate || !endDate || !calendarId) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }
    
    setIsSubmitting(true);
    
    // Create date objects
    let startDateTime = allDay 
      ? new Date(`${startDate}T00:00:00`)
      : new Date(`${startDate}T${startTime}:00`);
    
    let endDateTime = allDay
      ? new Date(`${endDate}T23:59:59`)
      : new Date(`${endDate}T${endTime}:00`);
    
    // Validate dates
    if (isNaN(startDateTime.getTime())) {
      toast({
        title: "Invalid start date/time",
        description: "Please check your start date and time",
        variant: "destructive"
      });
      setIsSubmitting(false);
      return;
    }
    
    if (isNaN(endDateTime.getTime())) {
      toast({
        title: "Invalid end date/time",
        description: "Please check your end date and time",
        variant: "destructive"
      });
      setIsSubmitting(false);
      return;
    }
    
    // End date/time must be after start date/time
    if (endDateTime <= startDateTime) {
      toast({
        title: "Invalid date range",
        description: "End date/time must be after start date/time",
        variant: "destructive"
      });
      setIsSubmitting(false);
      return;
    }
    
    const eventData = {
      title,
      description: description || null,
      location: location || null,
      startDate: startDateTime,
      endDate: endDateTime,
      calendarId: parseInt(calendarId),
      timezone,
      allDay
    };
    
    // Shared success handler
    const onSuccessHandler = () => {
      // Invalidate calendar queries to refresh data
      queryClient.invalidateQueries({
        queryKey: ['/api/events']
      });
      
      setIsSubmitting(false);
      onClose();
    };
    
    // Shared error handler
    const onErrorHandler = (error: Error) => {
      console.error('Error saving event:', error);
      toast({
        title: "Error",
        description: "There was an error saving your event",
        variant: "destructive"
      });
      setIsSubmitting(false);
    };
    
    if (event) {
      // Update existing event - format it to match the expected updateEvent signature
      updateEvent({
        id: event.id,
        data: eventData
      }, {
        onSuccess: () => {
          toast({
            title: "Event updated",
            description: "Your event has been updated successfully"
          });
          onSuccessHandler();
        },
        onError: onErrorHandler
      });
    } else {
      // Create new event - no change needed for createEvent as it accepts the direct object
      createEvent(eventData, {
        onSuccess: () => {
          toast({
            title: "Event created",
            description: "Your event has been created successfully"
          });
          onSuccessHandler();
        },
        onError: onErrorHandler
      });
    }
  };

  const handleDelete = () => {
    if (!event) return;
    
    setIsDeleting(true);
    
    deleteEvent(event.id, {
      onSuccess: () => {
        toast({
          title: "Event deleted",
          description: "Your event has been deleted successfully"
        });
        
        // Invalidate calendar queries to refresh data
        queryClient.invalidateQueries({
          queryKey: ['/api/events']
        });
        
        onClose();
      },
      onError: (error: Error) => {
        console.error('Error deleting event:', error);
        toast({
          title: "Error",
          description: "There was an error deleting your event",
          variant: "destructive"
        });
        setIsDeleting(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {event ? 'Edit Event' : 'Add Event'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Event title"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="calendar">Calendar *</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map(calendar => (
                  <SelectItem key={calendar.id} value={calendar.id.toString()}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: calendar.color }}
                      />
                      {calendar.name}
                      {calendar.isPrimary && (
                        <span className="text-xs bg-muted px-1 py-0.5 rounded">Primary</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
                {editableSharedCalendars.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Shared Calendars (Edit Permission)
                    </div>
                    {editableSharedCalendars.map(calendar => (
                      <SelectItem key={calendar.id} value={calendar.id.toString()}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: calendar.color }}
                          />
                          {calendar.name}
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              id="all-day"
              checked={allDay}
              onCheckedChange={setAllDay}
            />
            <Label htmlFor="all-day">All day event</Label>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date *</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
              />
            </div>
            
            {!allDay && (
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time *</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date *</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                required
              />
            </div>
            
            {!allDay && (
              <div className="space-y-2">
                <Label htmlFor="end-time">End Time *</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {getTimezones().map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Event location"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Event description"
              rows={4}
            />
          </div>
        </div>
        
        <DialogFooter className="flex items-center justify-between">
          <div>
            {event && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting || isSubmitting}
                type="button"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting || isDeleting}
              type="button"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || isDeleting}
              type="button"
            >
              {isSubmitting
                ? (event ? 'Updating...' : 'Creating...')
                : (event ? 'Update' : 'Create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventFormModal;