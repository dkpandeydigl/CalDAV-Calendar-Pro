import React, { useEffect, useState, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { format } from 'date-fns';
import { Calendar, Check, Plus, Trash2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Event } from '@shared/schema';
import { useAuth } from '@/hooks/use-auth';

interface EventFormModalProps {
  open: boolean;
  event: Event | null;
  selectedDate?: Date; // Optional date to pre-fill when creating a new event
  onClose: () => void;
}

// Recurring event options
type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type MonthlyRecurrenceType = 'day' | 'on';
type RecurrenceEndType = 'never' | 'after' | 'on';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const EventFormModal: React.FC<EventFormModalProps> = ({ open, event, selectedDate, onClose }) => {
  const { calendars } = useCalendars();
  const { createEvent, updateEvent } = useCalendarEvents();
  const { selectedTimezone } = useCalendarContext();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Tab state
  const [activeTab, setActiveTab] = useState('description');
  
  // Basic form state
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
  
  // Attendees state
  const [attendees, setAttendees] = useState<string[]>([]);
  const [newAttendee, setNewAttendee] = useState('');
  
  // Recurrence state
  const [recurrenceCollapsed, setRecurrenceCollapsed] = useState(true);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [dailyInterval, setDailyInterval] = useState(1);
  const [weeklyInterval, setWeeklyInterval] = useState(1);
  const [monthlyDay, setMonthlyDay] = useState(1);
  const [monthlyInterval, setMonthlyInterval] = useState(1);
  const [monthlyRecurrenceType, setMonthlyRecurrenceType] = useState<MonthlyRecurrenceType>('day');
  const [monthlyDayOfWeek, setMonthlyDayOfWeek] = useState('Monday');
  const [yearlyInterval, setYearlyInterval] = useState(1);
  const [recurrenceEndType, setRecurrenceEndType] = useState<RecurrenceEndType>('never');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceEndAfter, setRecurrenceEndAfter] = useState(1);
  
  // Meeting resources state
  const [resources, setResources] = useState<string[]>([]);
  const [newResource, setNewResource] = useState('');
  
  // Schedule status
  const [busyStatus, setBusyStatus] = useState('busy');
  
  // References
  const attendeeInputRef = useRef<HTMLInputElement>(null);
  const resourceInputRef = useRef<HTMLInputElement>(null);
  
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
        
        // Set recurrence rule if present
        if (event.recurrenceRule) {
          parseRecurrenceRule(event.recurrenceRule);
        } else {
          resetRecurrenceState();
        }
        
        // Set attendees and resources using the database fields
        if (event.attendees && Array.isArray(event.attendees)) {
          setAttendees(event.attendees as string[]);
        } else {
          setAttendees([]);
        }
        
        if (event.resources && Array.isArray(event.resources)) {
          setResources(event.resources as string[]);
        } else {
          setResources([]);
        }
        
        // Set busy status
        if (event.busyStatus) {
          setBusyStatus(event.busyStatus as string);
        } else {
          setBusyStatus('busy');
        }
      } else {
        // Creating new event
        // Use selected date if provided, otherwise default to current date
        const now = selectedDate || new Date();
        const nowPlus1Hour = new Date(now.getTime() + 60 * 60 * 1000);
        
        // Format the date properly preserving the local date
        // Format YYYY-MM-DD with padding to ensure consistent format
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Get current time (not midnight) for better usability
        const hours = String(new Date().getHours()).padStart(2, '0');
        const minutes = String(new Date().getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;
        
        // End time is 1 hour after current time
        const endHours = String((new Date().getHours() + 1) % 24).padStart(2, '0');
        const endTimeStr = `${endHours}:${minutes}`;
        
        console.log(`Creating new event with date: ${dateStr}, time: ${timeStr}`);
        
        setTitle('');
        setDescription('');
        setLocation('');
        setStartDate(dateStr);
        setEndDate(dateStr);
        setStartTime(timeStr);
        setEndTime(endTimeStr);
        setCalendarId(calendars.length > 0 ? calendars[0].id.toString() : '');
        setTimezone(selectedTimezone);  // Always use current user timezone preference
        setAllDay(false);
        resetRecurrenceState();
        setAttendees([]);  // Don't add current user by default
        setResources([]);
        setBusyStatus('busy');
      }
    }
  }, [open, event, calendars, selectedTimezone, selectedDate]);
  
  // Helper function to parse recurrence rule
  const parseRecurrenceRule = (rule: string) => {
    // Basic parsing of RRULE format
    // A real implementation would use a proper RRULE parser
    if (!rule.startsWith('RRULE:')) {
      resetRecurrenceState();
      return;
    }
    
    try {
      const parts = rule.substring(6).split(';');
      const ruleObj: Record<string, string> = {};
      
      parts.forEach(part => {
        const [key, value] = part.split('=');
        ruleObj[key] = value;
      });
      
      // Frequency
      if (ruleObj.FREQ === 'DAILY') {
        setRecurrenceType('daily');
        setDailyInterval(parseInt(ruleObj.INTERVAL || '1'));
      } else if (ruleObj.FREQ === 'WEEKLY') {
        setRecurrenceType('weekly');
        setWeeklyInterval(parseInt(ruleObj.INTERVAL || '1'));
      } else if (ruleObj.FREQ === 'MONTHLY') {
        setRecurrenceType('monthly');
        setMonthlyInterval(parseInt(ruleObj.INTERVAL || '1'));
        
        // For simplicity, default to 'day' type of recurrence
        setMonthlyRecurrenceType('day');
        setMonthlyDay(parseInt(ruleObj.BYMONTHDAY || '1'));
      } else if (ruleObj.FREQ === 'YEARLY') {
        setRecurrenceType('yearly');
        setYearlyInterval(parseInt(ruleObj.INTERVAL || '1'));
      } else {
        setRecurrenceType('none');
      }
      
      // End rule
      if (ruleObj.COUNT) {
        setRecurrenceEndType('after');
        setRecurrenceEndAfter(parseInt(ruleObj.COUNT));
      } else if (ruleObj.UNTIL) {
        setRecurrenceEndType('on');
        // Convert YYYYMMDD to YYYY-MM-DD
        const until = ruleObj.UNTIL.substring(0, 8);
        const formattedDate = `${until.substring(0, 4)}-${until.substring(4, 6)}-${until.substring(6, 8)}`;
        setRecurrenceEndDate(formattedDate);
      } else {
        setRecurrenceEndType('never');
      }
      
      setRecurrenceCollapsed(false);
    } catch (error) {
      console.error('Error parsing recurrence rule:', error);
      resetRecurrenceState();
    }
  };
  
  // Helper to reset recurrence state
  const resetRecurrenceState = () => {
    setRecurrenceType('none');
    setDailyInterval(1);
    setWeeklyInterval(1);
    setMonthlyInterval(1);
    setMonthlyRecurrenceType('day');
    setMonthlyDay(1);
    setMonthlyDayOfWeek('Monday');
    setYearlyInterval(1);
    setRecurrenceEndType('never');
    setRecurrenceEndDate('');
    setRecurrenceEndAfter(1);
    setRecurrenceCollapsed(true);
  };
  
  // Function removed as we now use dedicated fields for attendees and resources
  
  // Generate recurrence rule in iCalendar RRULE format
  const generateRecurrenceRule = (): string | null => {
    if (recurrenceType === 'none') {
      return null;
    }
    
    let rule = 'RRULE:';
    
    // Frequency and interval
    if (recurrenceType === 'daily') {
      rule += `FREQ=DAILY;INTERVAL=${dailyInterval}`;
    } else if (recurrenceType === 'weekly') {
      rule += `FREQ=WEEKLY;INTERVAL=${weeklyInterval}`;
    } else if (recurrenceType === 'monthly') {
      rule += `FREQ=MONTHLY;INTERVAL=${monthlyInterval}`;
      if (monthlyRecurrenceType === 'day') {
        rule += `;BYMONTHDAY=${monthlyDay}`;
      } else {
        // This is a simplified implementation - real CalDAV implementation would use proper BYDAY rules
        rule += `;BYDAY=1${monthlyDayOfWeek.substring(0, 2).toUpperCase()}`;
      }
    } else if (recurrenceType === 'yearly') {
      rule += `FREQ=YEARLY;INTERVAL=${yearlyInterval}`;
    }
    
    // End rule
    if (recurrenceEndType === 'after') {
      rule += `;COUNT=${recurrenceEndAfter}`;
    } else if (recurrenceEndType === 'on' && recurrenceEndDate) {
      // Convert YYYY-MM-DD to YYYYMMDD format for UNTIL
      const formattedDate = recurrenceEndDate.replace(/-/g, '') + 'T235959Z';
      rule += `;UNTIL=${formattedDate}`;
    }
    
    return rule;
  };
  
  // Add attendee
  const addAttendee = () => {
    if (newAttendee.trim() && !attendees.includes(newAttendee.trim())) {
      setAttendees([...attendees, newAttendee.trim()]);
      setNewAttendee('');
      if (attendeeInputRef.current) {
        attendeeInputRef.current.focus();
      }
    }
  };
  
  // Remove attendee
  const removeAttendee = (attendee: string) => {
    setAttendees(attendees.filter(a => a !== attendee));
  };
  
  // Add resource
  const addResource = () => {
    if (newResource.trim() && !resources.includes(newResource.trim())) {
      setResources([...resources, newResource.trim()]);
      setNewResource('');
      if (resourceInputRef.current) {
        resourceInputRef.current.focus();
      }
    }
  };
  
  // Remove resource
  const removeResource = (resource: string) => {
    setResources(resources.filter(r => r !== resource));
  };
  
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
    
    // Keep description as is, without adding attendees and resources to it
    // Generate recurrence rule
    const recurrenceRule = generateRecurrenceRule();
    
    const eventData = {
      title,
      description: description || null,
      location: location || null,
      startDate: startDateTime,
      endDate: endDateTime,
      calendarId: parseInt(calendarId),
      timezone,
      allDay,
      recurrenceRule,
      // Add attendees, resources, and status as separate properties
      attendees: attendees,
      resources: resources,
      busyStatus: busyStatus
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
            uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@caldavclient.local`,
            etag: null,
            url: null,
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
          uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@caldavclient.local`,
          etag: null,
          url: null,
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
    <Dialog open={open} onOpenChange={open => !open && onClose()} modal>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="border-b pb-2">
          <DialogTitle className="flex items-center text-lg font-semibold">
            <Calendar className="mr-2 h-5 w-5" />
            {event ? 'Edit Meeting' : 'Create Meeting'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <div className="w-1/4 border-r pr-4 py-2">
            <Tabs defaultValue="attendees" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="attendees" className="flex-1">Attendees</TabsTrigger>
                <TabsTrigger value="resources" className="flex-1">Resources</TabsTrigger>
              </TabsList>
              
              <TabsContent value="attendees" className="mt-2">
                <div className="flex mb-2">
                  <Input
                    placeholder="Add attendee"
                    value={newAttendee}
                    onChange={e => setNewAttendee(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addAttendee()}
                    ref={attendeeInputRef}
                    className="flex-1 mr-1"
                  />
                  <Button size="sm" onClick={addAttendee} className="px-2">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <ScrollArea className="h-[calc(100vh-350px)]">
                  <div className="space-y-2">
                    {attendees.map(attendee => (
                      <div key={attendee} className="flex items-center justify-between rounded-md border p-2">
                        <span className="text-sm truncate">{attendee}</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => removeAttendee(attendee)}
                          className="h-6 w-6 p-0 rounded-full"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="resources" className="mt-2">
                <div className="flex mb-2">
                  <Input
                    placeholder="Add resource"
                    value={newResource}
                    onChange={e => setNewResource(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addResource()}
                    ref={resourceInputRef}
                    className="flex-1 mr-1"
                  />
                  <Button size="sm" onClick={addResource} className="px-2">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <ScrollArea className="h-[calc(100vh-350px)]">
                  <div className="space-y-2">
                    {resources.map(resource => (
                      <div key={resource} className="flex items-center justify-between rounded-md border p-2">
                        <span className="text-sm truncate">{resource}</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => removeResource(resource)}
                          className="h-6 w-6 p-0 rounded-full"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
          
          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Description tab */}
              <div>
                <Label htmlFor="title">Subject</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Add title"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add description"
                  rows={5}
                  className="mt-1"
                />
              </div>
              
              <div className="flex items-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setActiveTab('agenda')}
                  className="text-xs text-muted-foreground flex items-center"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Agenda from Template
                </Button>
              </div>
              
              {/* Repeat event section */}
              <Collapsible 
                open={!recurrenceCollapsed} 
                onOpenChange={open => setRecurrenceCollapsed(!open)}
                className="border rounded-md"
              >
                <CollapsibleTrigger asChild>
                  <div className="flex justify-between items-center p-3 cursor-pointer hover:bg-muted/50">
                    <h3 className="text-sm font-medium">Repeat event</h3>
                    <Button variant="ghost" size="sm">
                      {recurrenceCollapsed ? '+' : '–'}
                    </Button>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="p-3 pt-0 border-t">
                  <div className="space-y-4">
                    {/* Recurrence options */}
                    <RadioGroup 
                      value={recurrenceType} 
                      onValueChange={(value) => setRecurrenceType(value as RecurrenceType)}
                      className="space-y-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="none" id="none" />
                        <Label htmlFor="none">No end date</Label>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="daily" id="daily" />
                        <Label htmlFor="daily">Daily</Label>
                        {recurrenceType === 'daily' && (
                          <div className="flex items-center ml-2">
                            <Label htmlFor="daily-interval" className="mr-2">Repeat every</Label>
                            <Input
                              id="daily-interval"
                              type="number"
                              min="1"
                              value={dailyInterval}
                              onChange={e => setDailyInterval(parseInt(e.target.value) || 1)}
                              className="w-16 h-8"
                            />
                            <span className="ml-2">day(s)</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="weekly" id="weekly" />
                        <Label htmlFor="weekly">Weekly</Label>
                        {recurrenceType === 'weekly' && (
                          <div className="flex items-center ml-2">
                            <Label htmlFor="weekly-interval" className="mr-2">Repeat every</Label>
                            <Input
                              id="weekly-interval"
                              type="number"
                              min="1"
                              value={weeklyInterval}
                              onChange={e => setWeeklyInterval(parseInt(e.target.value) || 1)}
                              className="w-16 h-8"
                            />
                            <span className="ml-2">week(s)</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="monthly" id="monthly" />
                        <Label htmlFor="monthly">Monthly</Label>
                      </div>
                      
                      {recurrenceType === 'monthly' && (
                        <div className="ml-6 space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem 
                              value="on" 
                              id="on"
                              checked={monthlyRecurrenceType === 'on'}
                              onClick={() => setMonthlyRecurrenceType('on')}
                            />
                            <div className="flex items-center">
                              <span className="mr-2">On</span>
                              <Input
                                type="number"
                                min="1"
                                max="31"
                                value={monthlyDay}
                                onChange={e => setMonthlyDay(parseInt(e.target.value) || 1)}
                                className="w-16 h-8 mr-2"
                                disabled={monthlyRecurrenceType !== 'on'}
                              />
                              <span className="mr-2">every</span>
                              <Input
                                type="number"
                                min="1"
                                value={monthlyInterval}
                                onChange={e => setMonthlyInterval(parseInt(e.target.value) || 1)}
                                className="w-16 h-8 mr-2"
                                disabled={monthlyRecurrenceType !== 'on'}
                              />
                              <span>month(s)</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem 
                              value="day" 
                              id="day"
                              checked={monthlyRecurrenceType === 'day'}
                              onClick={() => setMonthlyRecurrenceType('day')}
                            />
                            <div className="flex items-center">
                              <span className="mr-2">Every</span>
                              <Select 
                                value={monthlyDayOfWeek} 
                                onValueChange={setMonthlyDayOfWeek}
                                disabled={monthlyRecurrenceType !== 'day'}
                              >
                                <SelectTrigger className="w-28 h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {weekdays.map(day => (
                                    <SelectItem key={day} value={day}>{day}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className="mx-2">every</span>
                              <Input
                                type="number"
                                min="1"
                                value={monthlyInterval}
                                onChange={e => setMonthlyInterval(parseInt(e.target.value) || 1)}
                                className="w-16 h-8 mr-2"
                                disabled={monthlyRecurrenceType !== 'day'}
                              />
                              <span>month(s)</span>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yearly" id="yearly" />
                        <Label htmlFor="yearly">Yearly</Label>
                        {recurrenceType === 'yearly' && (
                          <div className="flex items-center ml-2">
                            <Label htmlFor="yearly-interval" className="mr-2">Repeat every</Label>
                            <Input
                              id="yearly-interval"
                              type="number"
                              min="1"
                              value={yearlyInterval}
                              onChange={e => setYearlyInterval(parseInt(e.target.value) || 1)}
                              className="w-16 h-8"
                            />
                            <span className="ml-2">year(s)</span>
                          </div>
                        )}
                      </div>
                    </RadioGroup>
                    
                    {/* End recurrence options */}
                    {recurrenceType !== 'none' && (
                      <div className="mt-4 border-t pt-4">
                        <h4 className="text-sm font-medium mb-2">End Repeat</h4>
                        <RadioGroup 
                          value={recurrenceEndType} 
                          onValueChange={(value) => setRecurrenceEndType(value as RecurrenceEndType)}
                          className="space-y-2"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="never" id="end-never" />
                            <Label htmlFor="end-never">Never</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="after" id="end-after" />
                            <div className="flex items-center">
                              <Label htmlFor="end-after-occurrences" className="mr-2">After</Label>
                              <Input
                                id="end-after-occurrences"
                                type="number"
                                min="1"
                                value={recurrenceEndAfter}
                                onChange={e => setRecurrenceEndAfter(parseInt(e.target.value) || 1)}
                                className="w-16 h-8"
                                disabled={recurrenceEndType !== 'after'}
                              />
                              <span className="ml-2">occurrences</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="on" id="end-on" />
                            <div className="flex items-center">
                              <Label htmlFor="end-date" className="mr-2">End by</Label>
                              <Input
                                id="end-date"
                                type="date"
                                value={recurrenceEndDate}
                                onChange={e => setRecurrenceEndDate(e.target.value)}
                                className="w-40 h-8"
                                disabled={recurrenceEndType !== 'on'}
                              />
                            </div>
                          </div>
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              
              {/* Meeting Time section */}
              <div className="border rounded-md p-3">
                <h3 className="text-sm font-medium mb-2">Meeting Time</h3>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <Label htmlFor="start-date">Start Date</Label>
                    <div className="flex mt-1">
                      <Input
                        id="start-date"
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="mr-2"
                      />
                      <Input
                        id="start-time"
                        type="time"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="end-date">End Date</Label>
                    <div className="flex mt-1">
                      <Input
                        id="end-date"
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="mr-2"
                      />
                      <Input
                        id="end-time"
                        type="time"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="mt-1">
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
              </div>
              
              {/* Location section */}
              <div>
                <Label htmlFor="location">Venue</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="Add location"
                  className="mt-1"
                />
              </div>
              
              {/* Calendar section */}
              <div>
                <Label htmlFor="calendar">Calendar</Label>
                <Select value={calendarId} onValueChange={setCalendarId}>
                  <SelectTrigger className="mt-1">
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
            </div>
          </div>
        </div>
        
        <DialogFooter className="border-t pt-3 mt-3 flex justify-between">
          <div>
            <Select value={busyStatus} onValueChange={setBusyStatus}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="tentative">Tentative</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventFormModal;