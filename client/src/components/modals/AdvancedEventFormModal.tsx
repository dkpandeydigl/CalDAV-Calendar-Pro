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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Calendar, 
  CalendarDays, 
  Clock, 
  Plus, 
  X, 
  Users, 
  Repeat, 
  MapPin, 
  FileText 
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import type { Event } from '@shared/schema';

interface EventFormModalProps {
  open: boolean;
  event: Event | null;
  selectedDate?: Date;
  onClose: () => void;
}

// Attendee role types
type AttendeeRole = 'Chairman' | 'Secretary' | 'Member';

// Attendee interface
interface Attendee {
  id: string;
  email: string;
  name?: string;
  role: AttendeeRole;
}

// Recurrence pattern types
type RecurrencePattern = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

// Recurrence end types
type RecurrenceEndType = 'Never' | 'After' | 'On';

// Recurrence configuration
interface RecurrenceConfig {
  pattern: RecurrencePattern;
  interval: number;
  weekdays?: string[]; // For weekly: ['Monday', 'Wednesday', etc.]
  dayOfMonth?: number; // For monthly/yearly
  monthOfYear?: number; // For yearly
  endType: RecurrenceEndType;
  occurrences?: number; // For 'After'
  endDate?: Date; // For 'On'
}

const AdvancedEventFormModal: React.FC<EventFormModalProps> = ({ open, event, selectedDate, onClose }) => {
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
  const [isBusy, setIsBusy] = useState(true);
  
  // Advanced form state
  const [activeTab, setActiveTab] = useState('basic');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  
  // Recurrence state
  const [recurrence, setRecurrence] = useState<RecurrenceConfig>({
    pattern: 'None',
    interval: 1,
    weekdays: [],
    endType: 'Never',
    occurrences: 10
  });
  
  // Template state
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const templates = [
    { id: 'meeting', name: 'Meeting Agenda', content: '1. Welcome\n2. Updates\n3. Discussion\n4. Action Items\n5. Next Steps' },
    { id: 'review', name: 'Project Review', content: '1. Project Overview\n2. Accomplishments\n3. Challenges\n4. Timeline Review\n5. Next Milestones' },
    { id: 'planning', name: 'Planning Session', content: '1. Goals and Objectives\n2. Resource Planning\n3. Timeline Creation\n4. Risk Assessment\n5. Assignments' }
  ];

  // Week days for recurrence
  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
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
        
        // Reset advanced properties
        setAttendees([]);
        setRecurrence({
          pattern: 'None',
          interval: 1,
          weekdays: [],
          endType: 'Never',
          occurrences: 10
        });
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
        setActiveTab('basic');
        setAttendees([]);
        setIsBusy(true);
        setRecurrence({
          pattern: 'None',
          interval: 1,
          weekdays: [],
          endType: 'Never',
          occurrences: 10
        });
      }
    }
  }, [open, event, calendars, editableSharedCalendars, selectedTimezone, selectedDate]);

  // Handle form submission
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

    // Prepare recurrence rule (as an iCalendar RRULE string)
    let recurrenceRule = null;
    if (recurrence.pattern !== 'None') {
      const rruleParts = [];
      
      // Frequency
      switch (recurrence.pattern) {
        case 'Daily':
          rruleParts.push('FREQ=DAILY');
          break;
        case 'Weekly':
          rruleParts.push('FREQ=WEEKLY');
          break;
        case 'Monthly':
          rruleParts.push('FREQ=MONTHLY');
          break;
        case 'Yearly':
          rruleParts.push('FREQ=YEARLY');
          break;
      }
      
      // Interval
      if (recurrence.interval > 1) {
        rruleParts.push(`INTERVAL=${recurrence.interval}`);
      }
      
      // For weekly recurrence, specify days of week
      if (recurrence.pattern === 'Weekly' && recurrence.weekdays && recurrence.weekdays.length > 0) {
        const dayMap: Record<string, string> = {
          'Monday': 'MO', 'Tuesday': 'TU', 'Wednesday': 'WE', 'Thursday': 'TH',
          'Friday': 'FR', 'Saturday': 'SA', 'Sunday': 'SU'
        };
        
        const byDayValue = recurrence.weekdays
          .map(day => dayMap[day])
          .filter(Boolean)
          .join(',');
          
        if (byDayValue) {
          rruleParts.push(`BYDAY=${byDayValue}`);
        }
      }
      
      // For monthly recurrence, specify day of month
      if (recurrence.pattern === 'Monthly' && recurrence.dayOfMonth) {
        rruleParts.push(`BYMONTHDAY=${recurrence.dayOfMonth}`);
      }
      
      // For yearly recurrence, specify month and day
      if (recurrence.pattern === 'Yearly' && recurrence.monthOfYear && recurrence.dayOfMonth) {
        rruleParts.push(`BYMONTH=${recurrence.monthOfYear}`);
        rruleParts.push(`BYMONTHDAY=${recurrence.dayOfMonth}`);
      }
      
      // End recurrence rule
      if (recurrence.endType === 'After' && recurrence.occurrences) {
        rruleParts.push(`COUNT=${recurrence.occurrences}`);
      } else if (recurrence.endType === 'On' && recurrence.endDate) {
        const until = recurrence.endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        rruleParts.push(`UNTIL=${until}`);
      }
      
      recurrenceRule = `RRULE:${rruleParts.join(';')}`;
    }
    
    // Convert attendees to a string format for storage
    const attendeesString = attendees.length 
      ? JSON.stringify(attendees) 
      : null;
    
    // Build the event data
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
      // Add missing properties required by the schema
      url: null,
      attendees: null,
      resources: null,
      busyStatus: isBusy ? 'busy' : 'free',
      etag: null,
      syncStatus: 'pending',
      syncError: null,
      lastSyncAttempt: new Date(),
      rawData: {
        attendees: attendeesString,
        isBusy
      }
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

  // Handle event deletion
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

  // Handle adding an attendee
  const handleAddAttendee = () => {
    if (!attendeeInput.trim()) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(attendeeInput)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }
    
    // Check for duplicate
    if (attendees.some(a => a.email === attendeeInput)) {
      toast({
        title: "Duplicate attendee",
        description: "This person is already added to the attendees list",
        variant: "destructive"
      });
      return;
    }
    
    // Add new attendee
    const newAttendee: Attendee = {
      id: `attendee-${Date.now()}`,
      email: attendeeInput,
      role: 'Member' // Default role
    };
    
    setAttendees([...attendees, newAttendee]);
    setAttendeeInput('');
  };

  // Handle removing an attendee
  const handleRemoveAttendee = (id: string) => {
    setAttendees(attendees.filter(a => a.id !== id));
  };

  // Handle changing attendee role
  const handleChangeAttendeeRole = (id: string, role: AttendeeRole) => {
    setAttendees(attendees.map(a => 
      a.id === id ? { ...a, role } : a
    ));
  };
  
  // Handle template selection
  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setDescription(prev => prev + (prev ? '\n\n' : '') + template.content);
    }
  };
  
  // Handle week day selection for weekly recurrence
  const handleWeekdayToggle = (day: string) => {
    setRecurrence(prev => {
      const weekdays = prev.weekdays || [];
      if (weekdays.includes(day)) {
        return { ...prev, weekdays: weekdays.filter(d => d !== day) };
      } else {
        return { ...prev, weekdays: [...weekdays, day] };
      }
    });
  };

  // Format date for display
  const formatDateForDisplay = (date: Date) => {
    return format(date, 'MMM dd, yyyy');
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {event ? 'Edit Event' : 'Create New Event'}
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="basic" className="w-full" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="basic" className="flex items-center gap-1">
              <CalendarDays className="h-4 w-4" /> Basic Details
            </TabsTrigger>
            <TabsTrigger value="attendees" className="flex items-center gap-1">
              <Users className="h-4 w-4" /> Attendees
            </TabsTrigger>
            <TabsTrigger value="recurrence" className="flex items-center gap-1">
              <Repeat className="h-4 w-4" /> Recurrence
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex items-center gap-1">
              <FileText className="h-4 w-4" /> Notes & Description
            </TabsTrigger>
          </TabsList>
          
          <ScrollArea className="h-[60vh] pr-4">
            {/* Basic Tab */}
            <TabsContent value="basic" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Subject *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Event title"
                  required
                  className="text-lg"
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
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: calendar.color }} />
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
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: calendar.color }} />
                              {calendar.name}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <div className="flex items-center space-x-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="location"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="Add location"
                  />
                  <Button variant="outline" type="button" size="sm" className="shrink-0">
                    Add Venue
                  </Button>
                </div>
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
                <div className="space-y-1">
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
                  <div className="space-y-1">
                    <Label htmlFor="start-time">Start Time *</Label>
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Input
                        id="start-time"
                        type="time"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
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
                  <div className="space-y-1">
                    <Label htmlFor="end-time">End Time *</Label>
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Input
                        id="end-time"
                        type="time"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {getTimezones().map(tz => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Label htmlFor="status">Status:</Label>
                    <Select 
                      value={isBusy ? "busy" : "free"} 
                      onValueChange={(v) => setIsBusy(v === "busy")}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="busy">Busy</SelectItem>
                        <SelectItem value="free">Free</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <Button variant="outline" size="sm">
                    Check Schedule
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            {/* Attendees Tab */}
            <TabsContent value="attendees" className="space-y-6">
              <div className="space-y-2">
                <Label>Add Attendees</Label>
                <div className="flex space-x-2">
                  <Input
                    placeholder="Enter email address"
                    value={attendeeInput}
                    onChange={e => setAttendeeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddAttendee()}
                  />
                  <Button type="button" onClick={handleAddAttendee} className="shrink-0">
                    Add
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter email addresses of attendees and press Enter or click Add
                </p>
              </div>
              
              {attendees.length > 0 && (
                <div className="space-y-4">
                  <Label>Attendees ({attendees.length})</Label>
                  <div className="space-y-3">
                    {attendees.map(attendee => (
                      <div key={attendee.id} className="flex items-center justify-between p-3 border rounded-md">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 bg-primary/10 rounded-full flex items-center justify-center text-primary font-medium">
                            {attendee.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium">{attendee.email}</p>
                            <Badge 
                              variant={
                                attendee.role === 'Chairman' 
                                  ? "default" 
                                  : attendee.role === 'Secretary' 
                                    ? "secondary" 
                                    : "outline"
                              }
                            >
                              {attendee.role}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm">Change Role</Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-2">
                              <RadioGroup
                                value={attendee.role}
                                onValueChange={(value: string) => handleChangeAttendeeRole(attendee.id, value as AttendeeRole)}
                              >
                                <div className="flex items-center space-x-2 p-2 hover:bg-muted rounded">
                                  <RadioGroupItem value="Chairman" id={`chairman-${attendee.id}`} />
                                  <Label htmlFor={`chairman-${attendee.id}`}>Chairman</Label>
                                </div>
                                <div className="flex items-center space-x-2 p-2 hover:bg-muted rounded">
                                  <RadioGroupItem value="Secretary" id={`secretary-${attendee.id}`} />
                                  <Label htmlFor={`secretary-${attendee.id}`}>Secretary</Label>
                                </div>
                                <div className="flex items-center space-x-2 p-2 hover:bg-muted rounded">
                                  <RadioGroupItem value="Member" id={`member-${attendee.id}`} />
                                  <Label htmlFor={`member-${attendee.id}`}>Member</Label>
                                </div>
                              </RadioGroup>
                            </PopoverContent>
                          </Popover>
                          
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveAttendee(attendee.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {attendees.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 border border-dashed rounded-md p-6">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No attendees added yet</p>
                  <p className="text-sm text-muted-foreground">Add attendees by entering their email addresses above</p>
                </div>
              )}
            </TabsContent>
            
            {/* Recurrence Tab */}
            <TabsContent value="recurrence" className="space-y-6">
              <div className="space-y-2">
                <Label>Repeat Event</Label>
                <RadioGroup 
                  value={recurrence.pattern}
                  onValueChange={(value) => setRecurrence({
                    ...recurrence,
                    pattern: value as RecurrencePattern
                  })}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="None" id="recurrence-none" />
                    <Label htmlFor="recurrence-none">Do not repeat</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Daily" id="recurrence-daily" />
                    <Label htmlFor="recurrence-daily">Daily</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Weekly" id="recurrence-weekly" />
                    <Label htmlFor="recurrence-weekly">Weekly</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Monthly" id="recurrence-monthly" />
                    <Label htmlFor="recurrence-monthly">Monthly</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Yearly" id="recurrence-yearly" />
                    <Label htmlFor="recurrence-yearly">Yearly</Label>
                  </div>
                </RadioGroup>
              </div>
              
              {recurrence.pattern !== 'None' && (
                <>
                  <Separator />
                  
                  {/* Interval settings */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="interval">Repeat every:</Label>
                      <Input
                        id="interval"
                        type="number"
                        min="1"
                        max="99"
                        className="w-16"
                        value={recurrence.interval}
                        onChange={(e) => setRecurrence({
                          ...recurrence,
                          interval: parseInt(e.target.value) || 1
                        })}
                      />
                      <span>{recurrence.pattern.toLowerCase()}{recurrence.interval > 1 ? 's' : ''}</span>
                    </div>
                    
                    {/* Weekly options */}
                    {recurrence.pattern === 'Weekly' && (
                      <div className="space-y-2">
                        <Label>Repeat on:</Label>
                        <div className="flex flex-wrap gap-2">
                          {weekDays.map(day => (
                            <div 
                              key={day}
                              className={`
                                px-3 py-1 rounded-full text-sm border
                                ${(recurrence.weekdays || []).includes(day) 
                                  ? 'bg-primary text-primary-foreground border-primary' 
                                  : 'bg-background border-border hover:bg-muted'}
                              `}
                              onClick={() => handleWeekdayToggle(day)}
                            >
                              {day.substring(0, 3)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Monthly options */}
                    {recurrence.pattern === 'Monthly' && (
                      <div className="space-y-2">
                        <Label htmlFor="day-of-month">Day of month:</Label>
                        <Select 
                          value={String(recurrence.dayOfMonth || new Date().getDate())} 
                          onValueChange={(value) => setRecurrence({
                            ...recurrence,
                            dayOfMonth: parseInt(value)
                          })}
                        >
                          <SelectTrigger id="day-of-month" className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 31 }, (_, i) => (
                              <SelectItem key={i + 1} value={(i + 1).toString()}>
                                {i + 1}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    
                    {/* Yearly options */}
                    {recurrence.pattern === 'Yearly' && (
                      <div className="space-y-4">
                        <div className="flex gap-4">
                          <div>
                            <Label htmlFor="month-of-year">Month:</Label>
                            <Select 
                              value={String(recurrence.monthOfYear || new Date().getMonth() + 1)} 
                              onValueChange={(value) => setRecurrence({
                                ...recurrence,
                                monthOfYear: parseInt(value)
                              })}
                            >
                              <SelectTrigger id="month-of-year" className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">January</SelectItem>
                                <SelectItem value="2">February</SelectItem>
                                <SelectItem value="3">March</SelectItem>
                                <SelectItem value="4">April</SelectItem>
                                <SelectItem value="5">May</SelectItem>
                                <SelectItem value="6">June</SelectItem>
                                <SelectItem value="7">July</SelectItem>
                                <SelectItem value="8">August</SelectItem>
                                <SelectItem value="9">September</SelectItem>
                                <SelectItem value="10">October</SelectItem>
                                <SelectItem value="11">November</SelectItem>
                                <SelectItem value="12">December</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor="day-of-month-yearly">Day:</Label>
                            <Select 
                              value={String(recurrence.dayOfMonth || new Date().getDate())} 
                              onValueChange={(value) => setRecurrence({
                                ...recurrence,
                                dayOfMonth: parseInt(value)
                              })}
                            >
                              <SelectTrigger id="day-of-month-yearly" className="w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 31 }, (_, i) => (
                                  <SelectItem key={i + 1} value={(i + 1).toString()}>
                                    {i + 1}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <Separator />
                  
                  {/* End settings */}
                  <div className="space-y-4">
                    <Label>Ends:</Label>
                    <RadioGroup 
                      value={recurrence.endType}
                      onValueChange={(value) => setRecurrence({
                        ...recurrence,
                        endType: value as RecurrenceEndType
                      })}
                      className="space-y-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Never" id="end-never" />
                        <Label htmlFor="end-never">Never</Label>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="After" id="end-after" />
                        <Label htmlFor="end-after">After</Label>
                        <Input
                          type="number"
                          min="1"
                          max="999"
                          className="w-16 ml-2"
                          value={recurrence.occurrences || 10}
                          onChange={(e) => setRecurrence({
                            ...recurrence,
                            occurrences: parseInt(e.target.value) || 10
                          })}
                          disabled={recurrence.endType !== 'After'}
                        />
                        <span>occurrences</span>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="On" id="end-on" />
                        <Label htmlFor="end-on">On</Label>
                        <div className="ml-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={`w-[240px] justify-start text-left font-normal ${
                                  recurrence.endType !== 'On' ? 'opacity-50' : ''
                                }`}
                                disabled={recurrence.endType !== 'On'}
                              >
                                <CalendarDays className="mr-2 h-4 w-4" />
                                {recurrence.endDate ? (
                                  formatDateForDisplay(recurrence.endDate)
                                ) : (
                                  "Pick a date"
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <CalendarComponent
                                mode="single"
                                selected={recurrence.endDate}
                                onSelect={(date) => setRecurrence({
                                  ...recurrence,
                                  endDate: date || undefined
                                })}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>
                </>
              )}
            </TabsContent>
            
            {/* Notes & Description Tab */}
            <TabsContent value="notes" className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description">Description</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <FileText className="mr-2 h-4 w-4" /> 
                        Add from Template
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-medium">Select Template</h4>
                        <div className="space-y-2">
                          {templates.map(template => (
                            <div
                              key={template.id}
                              className={`p-2 rounded border ${
                                selectedTemplate === template.id 
                                  ? 'border-primary bg-primary/10' 
                                  : 'border-border hover:bg-muted'
                              }`}
                              onClick={() => handleSelectTemplate(template.id)}
                            >
                              <div className="font-medium">{template.name}</div>
                              <div className="text-sm text-muted-foreground truncate">
                                {template.content.split('\n')[0]}...
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <Textarea
                  id="description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add notes, agenda, or details about this event..."
                  rows={12}
                  className="min-h-[200px]"
                />
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        
        <DialogFooter className="flex items-center justify-between pt-2 border-t border-border">
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
              className="min-w-24"
            >
              {isSubmitting
                ? (event ? 'Updating...' : 'Creating...')
                : (event ? 'Update' : 'Save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdvancedEventFormModal;