import React, { useState, useEffect } from 'react';
import { Calendar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCalendars } from '@/hooks/useCalendars';
import { useSharedCalendars, SharedCalendar } from '@/hooks/useSharedCalendars';
import { Event } from '@shared/schema';

// Common timezone list
const timezones = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Stockholm',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'UTC',
];

interface EventFormProps {
  open: boolean;
  event: Event | null;
  selectedDate?: Date;
  onClose: () => void;
}

const SimpleEventForm: React.FC<EventFormProps> = ({ open, event, selectedDate, onClose }) => {
  // Calendar data
  const { calendars = [] } = useCalendars();
  const { sharedCalendars = [] } = useSharedCalendars();
  
  // Filter shared calendars that user can edit
  const editableSharedCalendars = sharedCalendars.filter(calendar => calendar.permission === 'edit');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [timezone, setTimezone] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [busyStatus, setBusyStatus] = useState('busy');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form when event or selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      setStartDate(selectedDate);
      setEndDate(selectedDate);
    }

    if (event) {
      setTitle(event.title || '');
      setDescription(event.description || '');
      setLocation(event.location || '');
      
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      
      setStartDate(start);
      setEndDate(end);
      setStartTime(format(start, 'HH:mm'));
      setEndTime(format(end, 'HH:mm'));
      setTimezone(event.timezone || '');
      setCalendarId(event.calendarId.toString());
      setAllDay(event.allDay || false);
      setBusyStatus(event.busyStatus || 'busy');
    } else {
      // Default timezone to user's preferred timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(userTimezone);
    }
  }, [event, selectedDate]);

  const handleSubmit = async () => {
    if (!title.trim() || !startDate || !startTime) return;
    
    setIsSubmitting(true);
    
    try {
      let start = new Date(startDate);
      let end = new Date(endDate || startDate);
      
      // Set time components
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      const [endHours, endMinutes] = endTime.split(':').map(Number);
      
      start.setHours(startHours, startMinutes, 0, 0);
      end.setHours(endHours, endMinutes, 0, 0);
      
      // All day events should span the full day
      if (allDay) {
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
      }
      
      // Ensure end date is not before start date
      if (end < start) {
        end = new Date(start);
        end.setHours(start.getHours() + 1);
      }
      
      const eventData = {
        id: event?.id,
        title,
        description,
        location,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        timezone,
        calendarId: parseInt(calendarId),
        allDay,
        busyStatus,
      };
      
      const url = event ? `/api/events/${event.id}` : '/api/events';
      const method = event ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save event');
      }
      
      onClose();
    } catch (error) {
      console.error('Error saving event:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center">
            <Calendar className="mr-2 h-5 w-5" />
            <h2 className="text-lg font-semibold">{event ? 'Edit Event' : 'Create Event'}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              className="mt-1"
              autoFocus={false}
            />
          </div>
          
          {/* Start and End Date/Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Start</Label>
              <div className="flex flex-col md:flex-row gap-2 mt-1">
                <div className="flex-1">
                  {startDate && (
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      onClick={() => document.getElementById('start-date-picker')?.click()}
                    >
                      {format(startDate, 'PPP')}
                    </Button>
                  )}
                  <div className="sr-only">
                    <CalendarComponent
                      id="start-date-picker"
                      mode="single"
                      selected={startDate || undefined}
                      onSelect={(date: Date | undefined) => {
                        if (date) setStartDate(date);
                      }}
                      disabled={(date) => date < new Date('1900-01-01')}
                      initialFocus
                    />
                  </div>
                </div>
                {!allDay && (
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full md:w-24"
                  />
                )}
              </div>
            </div>
            
            <div>
              <Label>End</Label>
              <div className="flex flex-col md:flex-row gap-2 mt-1">
                <div className="flex-1">
                  {endDate && (
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      onClick={() => document.getElementById('end-date-picker')?.click()}
                    >
                      {format(endDate, 'PPP')}
                    </Button>
                  )}
                  <div className="sr-only">
                    <CalendarComponent
                      id="end-date-picker"
                      mode="single"
                      selected={endDate || undefined}
                      onSelect={(date: Date | undefined) => {
                        if (date) setEndDate(date);
                      }}
                      disabled={(date) => date < new Date('1900-01-01')}
                      initialFocus
                    />
                  </div>
                </div>
                {!allDay && (
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full md:w-24"
                  />
                )}
              </div>
            </div>
          </div>
          
          {/* All Day Toggle */}
          <div className="flex items-center">
            <Label className="mr-2">All Day</Label>
            <ToggleGroup type="single" value={allDay ? "true" : "false"} onValueChange={(value) => setAllDay(value === "true")}>
              <ToggleGroupItem value="true">Yes</ToggleGroupItem>
              <ToggleGroupItem value="false">No</ToggleGroupItem>
            </ToggleGroup>
          </div>
          
          {/* Timezone Selector */}
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px] overflow-y-auto">
                {timezones.map((tz: string) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Calendar Selector */}
          <div>
            <Label htmlFor="calendar">Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a calendar" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px] overflow-y-auto">
                {/* User's own calendars */}
                {calendars.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs text-muted-foreground">My Calendars</div>
                    {calendars.map((calendar: any) => (
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
                  </>
                )}
                
                {/* Shared calendars with edit permissions */}
                {editableSharedCalendars.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs text-muted-foreground mt-1">Shared With Me (Edit Permission)</div>
                    {editableSharedCalendars.map((calendar: SharedCalendar) => (
                      <SelectItem key={`shared-${calendar.id}`} value={calendar.id.toString()}>
                        <div className="flex items-center">
                          <span 
                            className="w-3 h-3 rounded-full mr-2" 
                            style={{ backgroundColor: calendar.color }}
                          ></span>
                          {calendar.name}
                          {calendar.ownerEmail && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({calendar.ownerEmail})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          
          {/* Location */}
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add location"
              className="mt-1"
              autoFocus={false}
            />
          </div>
          
          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description"
              rows={3}
              className="mt-1"
              autoFocus={false}
            />
          </div>
          
          {/* Busy Status */}
          <div>
            <Label htmlFor="busy-status">Show as</Label>
            <Select value={busyStatus} onValueChange={setBusyStatus}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="tentative">Tentative</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Footer */}
        <div className="border-t p-4 flex justify-end space-x-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || !title.trim() || !startDate || !startTime}
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SimpleEventForm;