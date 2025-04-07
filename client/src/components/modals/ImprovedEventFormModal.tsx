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
  FileText,
  AlertCircle,
  Save,
  Trash2,
  Loader2,
  Mail,
  RefreshCw
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import EmailPreview from '@/components/email/EmailPreview';
import { useEmailPreview } from '@/hooks/useEmailPreview';
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

const ImprovedEventFormModal: React.FC<EventFormModalProps> = ({ open, event, selectedDate, onClose }) => {
  const { calendars } = useCalendars();
  const { sharedCalendars } = useSharedCalendars();
  const { createEvent, updateEvent, deleteEvent } = useCalendarEvents();
  const { selectedTimezone } = useCalendarContext();
  const { toast } = useToast();
  
  // Filter shared calendars to only include those with edit permissions
  const editableSharedCalendars = sharedCalendars.filter(cal => cal.permission === 'edit');
  
  // Form refs to handle focus
  const titleInputRef = useRef<HTMLInputElement>(null);
  
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Advanced form state
  const [activeTab, setActiveTab] = useState('basic');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendeeRole, setAttendeeRole] = useState<AttendeeRole>('Member');
  
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
  
  // Email preview state
  const { 
    previewData, 
    previewError, 
    lastSendResult,
    isLoading: isEmailPreviewLoading,
    isSending: isEmailSending, 
    generatePreview, 
    clearPreview,
    sendEmail
  } = useEmailPreview();
  
  // Reset form when modal opens/closes or event changes
  useEffect(() => {
    if (open) {
      // Focus on title input after modal opens
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      
      if (event) {
        // Editing existing event
        setTitle(event.title);
        setDescription(event.description || '');
        setLocation(event.location || '');
        setCalendarId(event.calendarId.toString());
        setIsBusy(event.busyStatus === 'busy'); // Default to busy based on busyStatus
        
        // Try to parse attendees from event if available
        try {
          if (event.attendees) {
            // If attendees is a string, parse it; if it's already an object, use it directly
            const parsedAttendees = typeof event.attendees === 'string' 
              ? JSON.parse(event.attendees)
              : event.attendees;
              
            if (Array.isArray(parsedAttendees)) {
              setAttendees(parsedAttendees);
            }
          }
        } catch (error) {
          console.error('Failed to parse attendees', error);
        }
        
        // Try to parse recurrence from event if available
        try {
          // First check if we have recurrenceRule (from schema) and use that
          if (event.recurrenceRule) {
            try {
              // Attempt to parse recurrence rule if it's in our expected format
              const parsedRecurrence = JSON.parse(event.recurrenceRule);
              if (parsedRecurrence && typeof parsedRecurrence === 'object') {
                // Default values for any missing fields
                setRecurrence({
                  pattern: parsedRecurrence.pattern || 'None',
                  interval: parsedRecurrence.interval || 1,
                  weekdays: parsedRecurrence.weekdays || [],
                  dayOfMonth: parsedRecurrence.dayOfMonth,
                  monthOfYear: parsedRecurrence.monthOfYear,
                  endType: parsedRecurrence.endType || 'Never',
                  occurrences: parsedRecurrence.occurrences || 10,
                  endDate: parsedRecurrence.endDate ? new Date(parsedRecurrence.endDate) : undefined
                });
              }
            } catch (innerError) {
              console.error('Failed to parse recurrence rule JSON', innerError);
              // If the recurrence rule is in a different format (like iCalendar), 
              // we'd need additional parsing logic here
            }
          }
        } catch (error) {
          console.error('Failed to process recurrence', error);
        }
        
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
        
        setAllDay(event.allDay || false);
        setTimezone(event.timezone || selectedTimezone);
      } else {
        // Creating new event
        resetForm();
        
        // If a date was selected in the calendar, use it for start/end
        if (selectedDate) {
          const date = new Date(selectedDate);
          if (!isNaN(date.getTime())) {
            // Use local date format to avoid timezone offset issues
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            
            console.log(`Selected date from calendar: ${date.toString()}`);
            console.log(`Formatted as local date: ${formattedDate}`);
            
            setStartDate(formattedDate);
            setEndDate(formattedDate);
            
            // Create default time for new event (current hour + 1)
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            setStartTime(`${hours}:${minutes}`);
            
            // End time is 1 hour later
            const endHour = (now.getHours() + 1) % 24;
            setEndTime(`${endHour.toString().padStart(2, '0')}:${minutes}`);
          }
        }
        
        // Default to first available calendar
        if (calendars.length > 0) {
          setCalendarId(calendars[0].id.toString());
        }
      }
      
      // Clear any previous errors
      setErrors({});
    }
  }, [open, event, selectedDate, calendars, selectedTimezone]);
  
  const resetForm = () => {
    setTitle('');
    setDescription('');
    setLocation('');
    setStartDate('');
    setStartTime('');
    setEndDate('');
    setEndTime('');
    setTimezone(selectedTimezone);
    setAllDay(false);
    setCalendarId('');
    setAttendees([]);
    setAttendeeInput('');
    setAttendeeRole('Member');
    setRecurrence({
      pattern: 'None',
      interval: 1,
      weekdays: [],
      endType: 'Never',
      occurrences: 10
    });
    setSelectedTemplate(null);
    setIsBusy(true);
    setErrors({});
  };
  
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    // Required fields
    if (!title.trim()) newErrors.title = 'Title is required';
    if (!startDate) newErrors.startDate = 'Start date is required';
    if (!endDate) newErrors.endDate = 'End date is required';
    if (!allDay) {
      if (!startTime) newErrors.startTime = 'Start time is required';
      if (!endTime) newErrors.endTime = 'End time is required';
    }
    if (!calendarId) newErrors.calendarId = 'Calendar is required';
    
    // Date validation
    if (startDate && endDate) {
      const start = new Date(`${startDate}T${startTime || '00:00'}`);
      const end = new Date(`${endDate}T${endTime || '23:59'}`);
      
      if (end < start) {
        newErrors.endDate = 'End date/time must be after start date/time';
      }
    }
    
    // Attendee validation
    if (attendees.length > 0) {
      const chairmen = attendees.filter(a => a.role === 'Chairman').length;
      const secretaries = attendees.filter(a => a.role === 'Secretary').length;
      
      if (chairmen > 1) {
        newErrors.attendees = 'Only one Chairman allowed';
      }
      
      if (secretaries > 1) {
        newErrors.attendees = 'Only one Secretary allowed';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleAddAttendee = () => {
    if (!attendeeInput.trim()) return;
    
    // Basic email validation
    if (!attendeeInput.includes('@')) {
      setErrors({ ...errors, attendeeInput: 'Invalid email format' });
      return;
    }
    
    // Check for duplicates
    if (attendees.some(a => a.email.toLowerCase() === attendeeInput.toLowerCase())) {
      setErrors({ ...errors, attendeeInput: 'Attendee already added' });
      return;
    }
    
    const newAttendee: Attendee = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      email: attendeeInput,
      role: attendeeRole
    };
    
    // Add the new attendee to the list
    const updatedAttendees = [...attendees, newAttendee];
    setAttendees(updatedAttendees);
    setAttendeeInput('');
    
    // Remove error if it exists
    if (errors.attendeeInput) {
      const { attendeeInput, ...rest } = errors;
      setErrors(rest);
    }
    
    // If we have the required fields and an attendee was just added, automatically switch to the email preview tab
    if (title && startDate && endDate) {
      // Navigate to the email preview tab
      setActiveTab('emails');
      
      // Generate the email preview
      const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
      const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
      
      generatePreview({
        title,
        description,
        location,
        startDate: startDateTime,
        endDate: endDateTime,
        attendees: updatedAttendees
      });
    }
  };
  
  const handleRemoveAttendee = (id: string) => {
    setAttendees(attendees.filter(a => a.id !== id));
  };
  
  const handleUpdateAttendeeRole = (id: string, role: AttendeeRole) => {
    setAttendees(attendees.map(a => 
      a.id === id ? { ...a, role } : a
    ));
  };
  
  const handleWeekdayToggle = (day: string) => {
    const currentWeekdays = recurrence.weekdays || [];
    
    if (currentWeekdays.includes(day)) {
      setRecurrence({
        ...recurrence,
        weekdays: currentWeekdays.filter(d => d !== day)
      });
    } else {
      setRecurrence({
        ...recurrence,
        weekdays: [...currentWeekdays, day]
      });
    }
  };
  
  const handleRecurrenceEndDateChange = (date: Date | undefined) => {
    setRecurrence({
      ...recurrence,
      endDate: date
    });
  };
  
  const handleApplyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setDescription(template.content);
      setSelectedTemplate(templateId);
    }
  };
  
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    
    try {
      // Create start and end date objects
      const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
      const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
      
      // Handle timezone adjustments if needed
      // (could add timezone conversion logic here if needed)
      
      // Prepare attendees and recurrence data for storage
      const attendeesJson = attendees.length > 0 ? JSON.stringify(attendees) : null;
      const recurrenceRule = recurrence.pattern !== 'None' ? JSON.stringify(recurrence) : null;
            
      // Map form data to schema fields
      const eventData = {
        title,
        description,
        location,
        startDate: startDateTime,
        endDate: endDateTime,
        allDay,
        timezone,
        calendarId: parseInt(calendarId),
        busyStatus: isBusy ? 'busy' : 'free',
        attendees: attendeesJson,
        recurrenceRule,
        syncStatus: 'local',
      };
      
      if (event) {
        // Update existing event - need to use the { id, data } format required by updateEvent
        await updateEvent({ 
          id: event.id, 
          data: eventData 
        });
        
        // Toast is displayed by the mutation's onSuccess handler
      } else {
        // For new events, we need to generate a unique ID and include all required fields
        const newEventData = {
          ...eventData,
          uid: `event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          // Include mandatory fields with null/default values to match schema requirements
          resources: null,
          etag: null,
          url: null,
          rawData: null,
          syncError: null,
          lastSyncAttempt: null,
          emailSent: null,
          emailError: null
        };
        
        // Create new event
        await createEvent(newEventData);
        
        // Toast is displayed by the mutation's onSuccess handler
      }
      
      // Refresh the events list
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Close the modal
      onClose();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleDelete = async () => {
    if (!event) return;
    
    setIsDeleting(true);
    
    try {
      await deleteEvent(event.id);
      toast({
        title: 'Event deleted',
        description: 'Your event has been deleted successfully'
      });
      
      // Refresh the events list
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Close the modal
      onClose();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsDeleting(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={open => {
      if (!open) onClose();
    }}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-background to-background/95 border-[0.5px] border-primary/10 shadow-xl">
        <DialogHeader className="pb-4 border-b">
          <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/80">
            {event ? 'Edit Event' : 'Create Event'}
          </DialogTitle>
          <p className="text-muted-foreground text-sm mt-1">Fill in the details to schedule your event</p>
        </DialogHeader>
        
        <Tabs defaultValue="basic" value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="mb-6 grid grid-cols-5 gap-2 bg-transparent p-0">
            <TabsTrigger 
              value="basic" 
              className="event-form-tab-trigger flex items-center gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md px-4 py-2">
              <Calendar className="h-4 w-4" />
              <span>Basic</span>
            </TabsTrigger>
            <TabsTrigger 
              value="attendees" 
              className="event-form-tab-trigger flex items-center gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md px-4 py-2">
              <Users className="h-4 w-4" />
              <span>Attendees</span>
              {attendees.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-primary/20 text-primary">{attendees.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="recurrence" 
              className="event-form-tab-trigger flex items-center gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md px-4 py-2">
              <Repeat className="h-4 w-4" />
              <span>Recurrence</span>
              {recurrence.pattern !== 'None' && (
                <Badge variant="secondary" className="ml-1 bg-primary/20 text-primary">!</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="emails" 
              className="event-form-tab-trigger flex items-center gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md px-4 py-2"
              onClick={() => {
                if (attendees.length > 0 && title && startDate && endDate) {
                  const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                  const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                  
                  generatePreview({
                    title,
                    description,
                    location,
                    startDate: startDateTime,
                    endDate: endDateTime,
                    attendees
                  });
                }
              }}
            >
              <Mail className="h-4 w-4" />
              <span>Emails</span>
              {attendees.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-primary/20 text-primary">{attendees.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="more" 
              className="event-form-tab-trigger flex items-center gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-md rounded-md px-4 py-2">
              <FileText className="h-4 w-4" />
              <span>More</span>
            </TabsTrigger>
          </TabsList>
          
          <ScrollArea className="flex-1 overflow-auto pr-3">
            <div className="event-form-tabs-content">
              <TabsContent value="basic" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label htmlFor="title" className="sr-only">Title *</Label>
                    <Input
                      id="title"
                      ref={titleInputRef}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Event Title"
                      className={`text-lg font-medium ${errors.title ? 'border-red-500' : ''}`}
                    />
                  </div>
                  {errors.title && (
                    <p className="text-red-500 text-xs mt-1">{errors.title}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="calendar">Calendar *</Label>
                  <Select value={calendarId} onValueChange={setCalendarId}>
                    <SelectTrigger type="button" className={errors.calendarId ? 'border-red-500' : ''}>
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
                {errors.calendarId && (
                  <p className="text-red-500 text-xs mt-1">{errors.calendarId}</p>
                )}
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
                    className={errors.startDate ? 'border-red-500' : ''}
                  />
                  {errors.startDate && (
                    <p className="text-red-500 text-xs mt-1">{errors.startDate}</p>
                  )}
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
                      className={errors.startTime ? 'border-red-500' : ''}
                    />
                    {errors.startTime && (
                      <p className="text-red-500 text-xs mt-1">{errors.startTime}</p>
                    )}
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
                    className={errors.endDate ? 'border-red-500' : ''}
                  />
                  {errors.endDate && (
                    <p className="text-red-500 text-xs mt-1">{errors.endDate}</p>
                  )}
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
                      className={errors.endTime ? 'border-red-500' : ''}
                    />
                    {errors.endTime && (
                      <p className="text-red-500 text-xs mt-1">{errors.endTime}</p>
                    )}
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger type="button">
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
                <Label htmlFor="location" className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>Location</span>
                </Label>
                <Input
                  id="location"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="Event location"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description" className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  <span>Description</span>
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Event description"
                  rows={4}
                />
              </div>
            </TabsContent>
            
            <TabsContent value="attendees" className="mt-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="attendees">Attendees</Label>
                
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <Input
                      id="attendee-input"
                      value={attendeeInput}
                      onChange={e => setAttendeeInput(e.target.value)}
                      placeholder="Email address"
                      className={errors.attendeeInput ? 'border-red-500' : ''}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAttendee();
                        }
                      }}
                    />
                    {errors.attendeeInput && (
                      <p className="text-red-500 text-xs mt-1">{errors.attendeeInput}</p>
                    )}
                  </div>
                  
                  <Select value={attendeeRole} onValueChange={(value) => setAttendeeRole(value as AttendeeRole)}>
                    <SelectTrigger type="button" className="w-36">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Chairman">Chairman</SelectItem>
                      <SelectItem value="Secretary">Secretary</SelectItem>
                      <SelectItem value="Member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button onClick={handleAddAttendee} size="sm" className="gap-1">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>
              
              {errors.attendees && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.attendees}</AlertDescription>
                </Alert>
              )}
              
              {attendees.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    {attendees.length} {attendees.length === 1 ? 'attendee' : 'attendees'}
                  </div>
                  
                  <div className="space-y-2">
                    {attendees.map(attendee => (
                      <div key={attendee.id} className="flex items-center justify-between p-2 bg-muted rounded-md">
                        <div className="flex-1">
                          <div className="font-medium">{attendee.email}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Badge variant={
                              attendee.role === 'Chairman' ? 'destructive' :
                              attendee.role === 'Secretary' ? 'default' : 'outline'
                            } className="text-xs">
                              {attendee.role}
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Select 
                            value={attendee.role} 
                            onValueChange={(value) => handleUpdateAttendeeRole(attendee.id, value as AttendeeRole)}
                          >
                            <SelectTrigger type="button" className="h-8 w-28">
                              <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Chairman">Chairman</SelectItem>
                              <SelectItem value="Secretary">Secretary</SelectItem>
                              <SelectItem value="Member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleRemoveAttendee(attendee.id)}
                            className="h-8 w-8 text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto opacity-20 mb-2" />
                  <p>No attendees added yet</p>
                  <p className="text-sm">Add attendees for meeting participants</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="recurrence" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div>
                  <Label className="text-base">Repeat Pattern</Label>
                  <RadioGroup 
                    value={recurrence.pattern} 
                    onValueChange={(value) => setRecurrence({
                      ...recurrence,
                      pattern: value as RecurrencePattern
                    })}
                    className="mt-2 space-y-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="None" id="none" />
                      <Label htmlFor="none">Does not repeat</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Daily" id="daily" />
                      <Label htmlFor="daily">Daily</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Weekly" id="weekly" />
                      <Label htmlFor="weekly">Weekly</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Monthly" id="monthly" />
                      <Label htmlFor="monthly">Monthly</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Yearly" id="yearly" />
                      <Label htmlFor="yearly">Yearly</Label>
                    </div>
                  </RadioGroup>
                </div>
                
                {recurrence.pattern !== 'None' && (
                  <>
                    <Separator />
                    
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 items-center">
                        <Label htmlFor="interval">Repeat every</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="interval"
                            type="number"
                            min="1"
                            max="999"
                            value={recurrence.interval}
                            onChange={e => setRecurrence({
                              ...recurrence,
                              interval: parseInt(e.target.value) || 1
                            })}
                            className="w-20"
                          />
                          <span className="text-sm">
                            {recurrence.pattern === 'Daily' ? 'days' :
                             recurrence.pattern === 'Weekly' ? 'weeks' :
                             recurrence.pattern === 'Monthly' ? 'months' : 'years'}
                          </span>
                        </div>
                      </div>
                      
                      {recurrence.pattern === 'Weekly' && (
                        <div className="space-y-2">
                          <Label>Repeat on</Label>
                          <div className="flex flex-wrap gap-2">
                            {weekDays.map(day => (
                              <Button
                                key={day}
                                type="button"
                                variant={recurrence.weekdays?.includes(day) ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleWeekdayToggle(day)}
                                className="w-20"
                              >
                                {day.slice(0, 3)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {(recurrence.pattern === 'Monthly' || recurrence.pattern === 'Yearly') && (
                        <div className="grid grid-cols-2 gap-4 items-center">
                          <Label htmlFor="dayOfMonth">Day of {recurrence.pattern === 'Yearly' ? 'month' : 'month'}</Label>
                          <Input
                            id="dayOfMonth"
                            type="number"
                            min="1"
                            max={recurrence.pattern === 'Yearly' ? '31' : '31'}
                            value={recurrence.dayOfMonth || ''}
                            onChange={e => setRecurrence({
                              ...recurrence,
                              dayOfMonth: parseInt(e.target.value) || undefined
                            })}
                            placeholder={recurrence.pattern === 'Yearly' ? 'e.g., 15' : 'e.g., 15'}
                          />
                        </div>
                      )}
                      
                      {recurrence.pattern === 'Yearly' && (
                        <div className="grid grid-cols-2 gap-4 items-center">
                          <Label htmlFor="monthOfYear">Month</Label>
                          <Select 
                            value={recurrence.monthOfYear?.toString() || ''} 
                            onValueChange={(value) => setRecurrence({
                              ...recurrence,
                              monthOfYear: parseInt(value) || undefined
                            })}
                          >
                            <SelectTrigger type="button">
                              <SelectValue placeholder="Select month" />
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
                      )}
                      
                      <Separator />
                      
                      <div className="space-y-4">
                        <Label>Ends</Label>
                        <RadioGroup 
                          value={recurrence.endType} 
                          onValueChange={(value) => setRecurrence({
                            ...recurrence,
                            endType: value as RecurrenceEndType
                          })}
                          className="space-y-4"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Never" id="never" />
                            <Label htmlFor="never">Never</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="After" id="after" />
                            <Label htmlFor="after" className="mr-2">After</Label>
                            <Input
                              type="number"
                              min="1"
                              max="999"
                              value={recurrence.occurrences || 10}
                              onChange={e => setRecurrence({
                                ...recurrence,
                                occurrences: parseInt(e.target.value) || 10
                              })}
                              disabled={recurrence.endType !== 'After'}
                              className="w-20"
                            />
                            <Label>occurrences</Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="On" id="on" />
                            <Label htmlFor="on" className="mr-2">On</Label>
                            <Popover>
                              <PopoverTrigger type="button" asChild>
                                <Button
                                  variant="outline"
                                  disabled={recurrence.endType !== 'On'}
                                  className={recurrence.endType === 'On' ? 'w-[180px] justify-start text-left font-normal' : 'w-[180px] justify-start text-left font-normal text-muted-foreground'}
                                >
                                  <CalendarDays className="mr-2 h-4 w-4" />
                                  {recurrence.endDate ? format(recurrence.endDate, 'PPP') : 'Pick a date'}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <CalendarComponent
                                  mode="single"
                                  selected={recurrence.endDate}
                                  onSelect={handleRecurrenceEndDateChange}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        </RadioGroup>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="emails" className="mt-0 space-y-4">
              <div className="space-y-4">
                {attendees.length === 0 ? (
                  <Alert>
                    <AlertDescription>
                      Add attendees in the "Attendees" tab to enable email invitations. Email invitations will be sent to all attendees when the event is created.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-medium">Invitation Emails</h3>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            if (title && startDate && endDate) {
                              const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                              const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                              
                              generatePreview({
                                title,
                                description,
                                location,
                                startDate: startDateTime,
                                endDate: endDateTime,
                                attendees
                              });
                            } else {
                              toast({
                                title: "Required fields missing",
                                description: "Please fill in at least title, start date, and end date to preview emails",
                                variant: "destructive"
                              });
                            }
                          }}
                          className="flex items-center gap-1"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Refresh Preview
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Preview the email that will be sent to attendees when this event is created. 
                        Each attendee will receive a personalized invitation with an iCalendar (.ics) attachment.
                      </p>
                    </div>
                    
                    <EmailPreview 
                      isLoading={isEmailPreviewLoading}
                      isSending={isEmailSending}
                      error={previewError}
                      html={previewData?.html || null}
                      showSendButton={attendees.length > 0}
                      lastSendResult={lastSendResult}
                      onSend={async () => {
                        if (!title || !startDate || !endDate || !attendees.length) {
                          toast({
                            title: "Missing information",
                            description: "Please fill in all required event details and add attendees before sending invitations.",
                            variant: "destructive"
                          });
                          return;
                        }

                        try {
                          const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                          const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                          
                          // For existing event, we pass the event ID
                          const eventId = event ? event.id : undefined;
                          
                          // Send the email
                          const result = await sendEmail({
                            eventId,
                            title,
                            description,
                            location,
                            startDate: startDateTime,
                            endDate: endDateTime,
                            attendees
                          });
                          
                          if (result.success) {
                            toast({
                              title: "Invitations sent!",
                              description: `Successfully sent email invitations to ${attendees.length} attendee${attendees.length > 1 ? 's' : ''}.`,
                              variant: "default"
                            });
                          } else {
                            throw new Error(result.message || "Failed to send invitations");
                          }
                        } catch (error) {
                          console.error("Failed to send invitations:", error);
                          toast({
                            title: "Failed to send invitations",
                            description: error instanceof Error ? error.message : "An error occurred while sending invitations",
                            variant: "destructive"
                          });
                        }
                      }}
                      onRefresh={() => {
                        if (title && startDate && endDate) {
                          const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                          const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                          
                          generatePreview({
                            title,
                            description,
                            location,
                            startDate: startDateTime,
                            endDate: endDateTime,
                            attendees
                          });
                        }
                      }}
                    />
                  </>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="more" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="busy"
                    checked={isBusy}
                    onCheckedChange={setIsBusy}
                  />
                  <Label htmlFor="busy">Show as busy</Label>
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <Label>Description Templates</Label>
                  <p className="text-sm text-muted-foreground">Apply a template to quickly fill your description</p>
                  
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    {templates.map(template => (
                      <Button
                        key={template.id}
                        variant={selectedTemplate === template.id ? 'default' : 'outline'}
                        className="justify-start h-auto py-2"
                        onClick={() => handleApplyTemplate(template.id)}
                      >
                        <div className="text-left">
                          <div className="font-medium">{template.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {template.content.split('\n').slice(0, 2).join(' · ')}
                            {template.content.split('\n').length > 2 ? ' ...' : ''}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
        
        <DialogFooter className="flex items-center justify-between border-t pt-4 mt-4">
          <div>
            {event && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting || isSubmitting}
                type="button"
                className="flex items-center gap-2 shadow-sm transition-all hover:shadow-md hover:bg-destructive/90"
              >
                {isDeleting ? 
                  <Loader2 className="h-4 w-4 animate-spin mr-1" /> : 
                  <Trash2 className="h-4 w-4 mr-1" />
                }
                {isDeleting ? 'Deleting...' : 'Delete Event'}
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting || isDeleting || isEmailSending}
              type="button"
              className="border border-primary/20 hover:bg-primary/5 transition-all"
            >
              Cancel
            </Button>
            
            {/* Only show Send Mail and Create button when: 
                1. It's a new event (not editing)
                2. There are attendees */}
            {!event && attendees.length > 0 && (
              <Button
                onClick={async () => {
                  if (!validateForm()) return;
                  
                  // First, make sure we're on the email tab to see the preview
                  setActiveTab('emails');
                  
                  // Refresh preview
                  const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                  const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                  
                  // Generate the preview first
                  await generatePreview({
                    title,
                    description,
                    location,
                    startDate: startDateTime,
                    endDate: endDateTime,
                    attendees
                  });
                  
                  // Send the email
                  try {
                    await sendEmail({
                      title,
                      description,
                      location,
                      startDate: startDateTime,
                      endDate: endDateTime,
                      attendees
                    });
                    
                    // If email was sent successfully, create the event
                    await handleSubmit();
                  } catch (error) {
                    // Email sending failed, show an error toast but don't create the event
                    toast({
                      title: 'Email sending failed',
                      description: 'The email could not be sent. Please check your SMTP settings.',
                      variant: 'destructive'
                    });
                  }
                }}
                disabled={isSubmitting || isDeleting || isEmailSending}
                type="button"
                className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-sm hover:shadow-md transition-all min-w-[180px] justify-center text-white"
              >
                {isSubmitting || isEmailSending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Mail className="h-4 w-4 mr-1" />
                )}
                {isSubmitting || isEmailSending 
                  ? 'Processing...' 
                  : 'Send Mail and Create'}
              </Button>
            )}
            
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || isDeleting || isEmailSending}
              type="button"
              className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-sm hover:shadow-md transition-all min-w-[120px] justify-center"
            >
              {isSubmitting ? 
                <Loader2 className="h-4 w-4 animate-spin mr-1" /> : 
                <Save className="h-4 w-4 mr-1" />
              }
              {isSubmitting
                ? (event ? 'Updating...' : 'Creating...')
                : (event ? 'Update Event' : 'Create Event')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImprovedEventFormModal;