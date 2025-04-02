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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import type { Event } from '@shared/schema';

interface EventFormModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
}

const EventFormModal: React.FC<EventFormModalProps> = ({ open, event, onClose }) => {
  const { calendars } = useCalendars();
  const { createEvent, updateEvent } = useCalendarEvents();
  const { selectedTimezone } = useCalendarContext();
  const { toast } = useToast();
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [calendarId, setCalendarId] = useState<string>('');
  const [timezone, setTimezone] = useState(selectedTimezone);
  const [allDay, setAllDay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Reset form when modal opens/closes or event changes
  useEffect(() => {
    if (open) {
      if (event) {
        // Editing existing event
        setTitle(event.title);
        setDescription(event.description || '');
        setLocation(event.location || '');
        
        // Safely create date objects with validation
        let start: Date;
        let end: Date;
        
        try {
          start = new Date(event.startDate);
          end = new Date(event.endDate);
          
          // Validate dates
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.error(`Invalid event dates for "${event.title}"`);
            // Fallback to current date if invalid
            start = new Date();
            end = new Date();
            end.setHours(end.getHours() + 1);
          }
        } catch (error) {
          console.error(`Error parsing dates for event "${event.title}":`, error);
          // Fallback to current date if error
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
        // Default to current date
        const now = new Date();
        const nowPlus1Hour = new Date(now.getTime() + 60 * 60 * 1000);
        
        setTitle('');
        setDescription('');
        setLocation('');
        setStartDate(now.toISOString().split('T')[0]);
        setEndDate(now.toISOString().split('T')[0]);
        setStartTime(now.toTimeString().slice(0, 5));
        setEndTime(nowPlus1Hour.toTimeString().slice(0, 5));
        setCalendarId(calendars.length > 0 ? calendars[0].id.toString() : '');
        setTimezone(selectedTimezone);
        setAllDay(false);
      }
    }
  }, [open, event, calendars, selectedTimezone]);
  
  const handleSubmit = () => {
    if (!title.trim() || !startDate || !endDate || !calendarId) {
      // Basic validation
      return;
    }
    
    setIsSubmitting(true);
    
    // Create date objects from form inputs that respect the user's timezone
    // By using this format without Z, we ensure the date is treated in the user's timezone context
    // This prevents the date from shifting when stored in UTC
    let startDateTime = allDay 
      ? new Date(`${startDate}T00:00:00`)
      : new Date(`${startDate}T${startTime}:00`);
    
    let endDateTime = allDay
      ? new Date(`${endDate}T23:59:59`)
      : new Date(`${endDate}T${endTime}:00`);
      
    console.log(`Creating event: Date entered: ${startDate}, Time: ${startTime}, Resulting date object: ${startDateTime.toISOString()}, Timezone: ${timezone}`);
    
    // Make sure they're valid dates
    if (isNaN(startDateTime.getTime())) {
      console.error('Invalid start date/time:', startDate, startTime);
      startDateTime = new Date();
    }
    
    if (isNaN(endDateTime.getTime())) {
      console.error('Invalid end date/time:', endDate, endTime);
      endDateTime = new Date(startDateTime.getTime() + 3600000); // Add 1 hour
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
    
    if (event) {
      // Update existing event
      try {
        console.log(`Updating existing event with ID: ${event.id}, title: ${event.title}, to new title: ${title}`);
        
        // Ensure we have all required fields for the update
        const updateData = {
          ...eventData,
          uid: event.uid,
          // Preserve these fields from the original event
          etag: event.etag,
          url: event.url,
          recurrenceRule: event.recurrenceRule,
          // Set sync status to indicate the event needs syncing
          syncStatus: 'local',
          syncError: null,
          lastSyncAttempt: null
        };
        
        // Skip direct updates on temporary IDs (negative numbers)
        if (event.id > 0) {
          updateEvent({
            id: event.id,
            data: updateData
          });
        } else {
          console.log(`Event has temporary ID ${event.id}, creating new event instead`);
          // For temporary IDs, create new event with a fresh UID
          const newEventData = {
            ...eventData,
            uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            etag: null,
            url: null,
            recurrenceRule: null,
            rawData: null,
            syncStatus: 'local',
            syncError: null,
            lastSyncAttempt: null
          };
          createEvent(newEventData);
          
          // Force a refetch to ensure UI consistency
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          }, 500);
        }
      } catch (error) {
        console.error("Error during event update:", error);
        toast({
          title: "Error Updating Event",
          description: "There was a problem saving your changes. Please try again.",
          variant: "destructive"
        });
      }
    } else {
      // Create new event
      try {
        console.log(`Creating new event: ${title}`);
        const newEventData = {
          ...eventData,
          uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          etag: null,
          url: null,
          recurrenceRule: null,
          rawData: null,
          syncStatus: 'local',
          syncError: null,
          lastSyncAttempt: null
        };
        
        createEvent(newEventData);
      } catch (error) {
        console.error("Error during event creation:", error);
        toast({
          title: "Error Creating Event",
          description: "There was a problem creating your event. Please try again.",
          variant: "destructive"
        });
      }
    }
    
    setIsSubmitting(false);
    onClose();
  };
  
  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? 'Edit Event' : 'Create Event'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Add title"
            />
          </div>
          
          <div>
            <Label htmlFor="calendar">Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map(calendar => (
                  <SelectItem key={calendar.id} value={calendar.id.toString()}>
                    <div className="flex items-center">
                      <span 
                        className="w-3 h-3 rounded-full mr-2" 
                        style={{ backgroundColor: calendar.color }}
                      ></span>
                      {calendar.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch 
              id="all-day" 
              checked={allDay} 
              onCheckedChange={setAllDay}
            />
            <Label htmlFor="all-day">All day</Label>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <div>
                <Label htmlFor="start-time">Start Time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                />
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <div>
                <Label htmlFor="end-time">End Time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                />
              </div>
            )}
          </div>
          
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {getTimezones().map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Add location"
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add description"
              rows={3}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || !title.trim() || !startDate || !endDate}
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventFormModal;
