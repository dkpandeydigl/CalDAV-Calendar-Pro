import React, { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
  RefreshCw,
  Package
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
import ResourceManager, { Resource } from '@/components/resources/ResourceManager';
import { parseResourcesFromEvent } from '@/utils/resourceUtils';
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
  const [resources, setResources] = useState<Resource[]>([]);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [previewEventData, setPreviewEventData] = useState<any>(null);
  
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
    // Always reset the form when the modal closes to clear stale data
    if (!open) {
      resetForm();
      return;
    }
    
    // When modal opens
    if (open) {
      // First, reset the form to ensure we start with a clean state
      resetForm();
      
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
          // Ensure attendees is reset to empty array on error
          setAttendees([]);
        }
        
        // Try to parse resources from event if available
        try {
          const parsedResources = parseResourcesFromEvent(event);
          if (parsedResources.length > 0) {
            setResources(parsedResources);
          }
        } catch (error) {
          console.error('Failed to parse resources', error);
          // Ensure resources is reset to empty array on error
          setResources([]);
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
      } else if (selectedDate) {
        // If a date was selected in the calendar, use it for start/end
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
    setResources([]);
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
    
    // Don't automatically switch to email preview tab - let user control this
    // Just show a toast notification that attendee was added
    toast({
      title: 'Attendee added',
      description: `${attendeeInput} has been added as a ${attendeeRole}`,
      duration: 3000,
    });
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
    if (templateId === "none") {
      // Clear the description when "None" is selected
      setDescription("");
      setSelectedTemplate(null);
      return;
    }
    
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
        resources: resources.length > 0 ? JSON.stringify(resources) : null,
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
    <>
      <Dialog open={open} onOpenChange={open => {
        if (!open) onClose();
      }}>
        <DialogContent className="sm:max-w-[750px] max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-background to-background/95 border-[0.5px] border-primary/10 shadow-xl">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="flex items-center gap-2 text-lg">
              {event ? (
                <>
                  <span className="text-primary">{title || 'Event Details'}</span>
                </>
              ) : (
                <>
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <span>Create New Event</span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <Tabs
            defaultValue="basic"
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 overflow-hidden flex flex-col"
          >
            <TabsList className="w-full justify-start border-b p-0 rounded-none">
              <TabsTrigger value="basic" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none py-2">
                <Calendar className="h-4 w-4 mr-2" />
                Basic Details
              </TabsTrigger>
              
              <TabsTrigger value="attendees" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none py-2">
                <Users className="h-4 w-4 mr-2" />
                Attendees
                {attendees.length > 0 && (
                  <Badge variant="outline" className="ml-2 h-5 min-w-5 px-1 flex items-center justify-center">
                    {attendees.length}
                  </Badge>
                )}
              </TabsTrigger>
              
              <TabsTrigger value="resources" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none py-2">
                <Package className="h-4 w-4 mr-2" />
                Resources
                {resources.length > 0 && (
                  <Badge variant="outline" className="ml-2 h-5 min-w-5 px-1 flex items-center justify-center">
                    {resources.length}
                  </Badge>
                )}
              </TabsTrigger>
              
              <TabsTrigger value="recurrence" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none py-2">
                <Repeat className="h-4 w-4 mr-2" />
                Recurrence
                {recurrence.pattern !== 'None' && (
                  <Badge variant="outline" className="ml-2 px-2 py-0">
                    {recurrence.pattern}
                  </Badge>
                )}
              </TabsTrigger>
              
              {!event && attendees.length > 0 && (
                <TabsTrigger value="emails" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none py-2">
                  <Mail className="h-4 w-4 mr-2" />
                  Email Preview
                </TabsTrigger>
              )}
            </TabsList>
            
            <ScrollArea className="flex-1 p-4 overflow-y-auto">
              <TabsContent value="basic" className="mt-0 p-0 min-h-[500px]">
                {/* Basic Details Form */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
                    <Input
                      id="title"
                      ref={titleInputRef}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Event Title"
                      className={errors.title ? 'border-destructive' : ''}
                    />
                    {errors.title && (
                      <p className="text-destructive text-xs">{errors.title}</p>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="start-date">Start Date <span className="text-destructive">*</span></Label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Input
                            id="start-date"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className={errors.startDate ? 'border-destructive' : ''}
                          />
                          {errors.startDate && (
                            <p className="text-destructive text-xs">{errors.startDate}</p>
                          )}
                        </div>
                        
                        {!allDay && (
                          <div className="flex-1">
                            <Input
                              id="start-time"
                              type="time"
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              className={errors.startTime ? 'border-destructive' : ''}
                            />
                            {errors.startTime && (
                              <p className="text-destructive text-xs">{errors.startTime}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="end-date">End Date <span className="text-destructive">*</span></Label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Input
                            id="end-date"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className={errors.endDate ? 'border-destructive' : ''}
                          />
                          {errors.endDate && (
                            <p className="text-destructive text-xs">{errors.endDate}</p>
                          )}
                        </div>
                        
                        {!allDay && (
                          <div className="flex-1">
                            <Input
                              id="end-time"
                              type="time"
                              value={endTime}
                              onChange={(e) => setEndTime(e.target.value)}
                              className={errors.endTime ? 'border-destructive' : ''}
                            />
                            {errors.endTime && (
                              <p className="text-destructive text-xs">{errors.endTime}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="all-day"
                      checked={allDay}
                      onCheckedChange={(checked) => setAllDay(checked === true)}
                    />
                    <Label htmlFor="all-day" className="cursor-pointer">All Day Event</Label>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select
                      value={timezone}
                      onValueChange={setTimezone}
                    >
                      <SelectTrigger id="timezone">
                        <SelectValue placeholder="Select Timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {getTimezones().map((tz) => (
                          <SelectItem
                            key={tz.value}
                            value={tz.value}
                          >
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="calendar">Calendar <span className="text-destructive">*</span></Label>
                    <Select
                      value={calendarId}
                      onValueChange={setCalendarId}
                    >
                      <SelectTrigger id="calendar" className={errors.calendarId ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Select Calendar" />
                      </SelectTrigger>
                      <SelectContent>
                        {calendars.map((calendar) => (
                          <SelectItem
                            key={calendar.id}
                            value={calendar.id.toString()}
                          >
                            {calendar.name}
                          </SelectItem>
                        ))}
                        
                        {editableSharedCalendars.length > 0 && (
                          <>
                            <Separator className="my-1" />
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">Shared with me (editable)</p>
                            {editableSharedCalendars.map((calendar) => (
                              <SelectItem
                                key={calendar.id}
                                value={calendar.id.toString()}
                              >
                                {calendar.name} (shared)
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    {errors.calendarId && (
                      <p className="text-destructive text-xs">{errors.calendarId}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <div className="relative">
                      <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Event Location"
                        className="pl-8"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="description">Description</Label>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-muted-foreground">Template:</span>
                        <Select
                          value={selectedTemplate || ''}
                          onValueChange={handleApplyTemplate}
                        >
                          <SelectTrigger id="template" className="h-7 w-[130px] text-xs">
                            <SelectValue placeholder="Select Template" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {templates.map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Event Description"
                      className="min-h-[120px]"
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="busy-status"
                      checked={isBusy}
                      onCheckedChange={(checked) => setIsBusy(checked === true)}
                    />
                    <Label htmlFor="busy-status" className="cursor-pointer">Show as busy during this event</Label>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="attendees" className="mt-0 p-0 min-h-[500px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Add Attendees</h3>
                    
                    <div className="flex space-x-3 items-end">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="attendee-email">Email</Label>
                        <Input
                          id="attendee-email"
                          type="email"
                          value={attendeeInput}
                          onChange={(e) => setAttendeeInput(e.target.value)}
                          placeholder="attendee@example.com"
                          className={errors.attendeeInput ? 'border-destructive' : ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddAttendee();
                            }
                          }}
                        />
                        {errors.attendeeInput && (
                          <p className="text-destructive text-xs">{errors.attendeeInput}</p>
                        )}
                      </div>
                      
                      <div className="w-[150px] space-y-2">
                        <Label htmlFor="attendee-role">Role</Label>
                        <Select
                          value={attendeeRole}
                          onValueChange={(value) => setAttendeeRole(value as AttendeeRole)}
                        >
                          <SelectTrigger id="attendee-role">
                            <SelectValue placeholder="Select Role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Chairman">Chairman</SelectItem>
                            <SelectItem value="Secretary">Secretary</SelectItem>
                            <SelectItem value="Member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <Button 
                        onClick={handleAddAttendee}
                        size="icon"
                        className="mb-[1px]"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Error display for attendees */}
                  {errors.attendees && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{errors.attendees}</AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center">
                      Attendees
                      {attendees.length > 0 && (
                        <Badge variant="outline" className="ml-2">
                          {attendees.length}
                        </Badge>
                      )}
                    </h3>
                    
                    {attendees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No attendees added yet</p>
                    ) : (
                      <div className="space-y-2">
                        {attendees.map((attendee) => (
                          <div 
                            key={attendee.id}
                            className="flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-secondary/30 border border-border/40"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{attendee.email}</p>
                            </div>
                            
                            <Select
                              value={attendee.role}
                              onValueChange={(value) => handleUpdateAttendeeRole(attendee.id, value as AttendeeRole)}
                            >
                              <SelectTrigger className="h-7 w-[110px] text-xs">
                                <SelectValue />
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
                              className="h-7 w-7"
                              onClick={() => handleRemoveAttendee(attendee.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {attendees.length > 0 && (
                    <div className="pt-4 mt-2 border-t">
                      <Button 
                        onClick={() => {
                          // Validate required fields
                          if (!title || !startDate || !endDate) {
                            toast({
                              title: 'Missing information',
                              description: 'Please fill in all required fields',
                              variant: 'destructive'
                            });
                            setActiveTab('basic');
                            return;
                          }
                          
                          // Navigate to email tab and generate preview
                          setActiveTab('emails');
                          
                          // Generate email preview
                          const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                          const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                          
                          generatePreview({
                            title,
                            description,
                            location,
                            startDate: startDateTime,
                            endDate: endDateTime,
                            attendees,
                            resources
                          });
                        }}
                        type="button"
                        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
                      >
                        <Mail className="h-4 w-4 mr-1" />
                        Preview Email
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="resources" className="mt-0 p-0 min-h-[500px]">
                <ResourceManager 
                  resources={resources}
                  onResourcesChange={setResources}
                />
              </TabsContent>
              
              <TabsContent value="recurrence" className="mt-0 p-0 min-h-[500px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Recurrence Pattern</Label>
                    <RadioGroup
                      value={recurrence.pattern}
                      onValueChange={(value) => setRecurrence({
                        ...recurrence,
                        pattern: value as RecurrencePattern
                      })}
                      className="grid grid-cols-3 gap-3"
                    >
                      <div>
                        <RadioGroupItem 
                          value="None" 
                          id="r-none" 
                          className="peer sr-only" 
                        />
                        <Label
                          htmlFor="r-none"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <span>None</span>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem 
                          value="Daily" 
                          id="r-daily" 
                          className="peer sr-only" 
                        />
                        <Label
                          htmlFor="r-daily"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <span>Daily</span>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem 
                          value="Weekly" 
                          id="r-weekly" 
                          className="peer sr-only" 
                        />
                        <Label
                          htmlFor="r-weekly"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <span>Weekly</span>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem 
                          value="Monthly" 
                          id="r-monthly" 
                          className="peer sr-only" 
                        />
                        <Label
                          htmlFor="r-monthly"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <span>Monthly</span>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem 
                          value="Yearly" 
                          id="r-yearly" 
                          className="peer sr-only" 
                        />
                        <Label
                          htmlFor="r-yearly"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <span>Yearly</span>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  {recurrence.pattern !== 'None' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="interval">Repeat every</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="interval"
                            type="number"
                            min="1"
                            max="99"
                            value={recurrence.interval.toString()}
                            onChange={(e) => setRecurrence({
                              ...recurrence,
                              interval: parseInt(e.target.value) || 1
                            })}
                            className="w-20"
                          />
                          <span className="text-sm">
                            {recurrence.pattern.toLowerCase()}
                            {recurrence.interval !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      
                      {recurrence.pattern === 'Weekly' && (
                        <div className="space-y-2">
                          <Label>On these days</Label>
                          <div className="flex flex-wrap gap-2">
                            {weekDays.map((day) => (
                              <div 
                                key={day}
                                onClick={() => handleWeekdayToggle(day)}
                                className={`
                                  cursor-pointer rounded-md px-2.5 py-1 text-sm border 
                                  ${(recurrence.weekdays || []).includes(day) 
                                    ? 'bg-primary text-primary-foreground border-primary' 
                                    : 'bg-secondary text-secondary-foreground border-border'}
                                `}
                              >
                                {day.slice(0, 3)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <Separator />
                      
                      <div className="space-y-3">
                        <Label>End</Label>
                        <RadioGroup
                          value={recurrence.endType}
                          onValueChange={(value) => setRecurrence({
                            ...recurrence,
                            endType: value as RecurrenceEndType
                          })}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Never" id="r-end-never" />
                            <Label htmlFor="r-end-never">Never</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="After" id="r-end-after" />
                            <Label htmlFor="r-end-after">After</Label>
                            <Input
                              type="number"
                              min="1"
                              max="999"
                              value={recurrence.occurrences?.toString() || "10"}
                              onChange={(e) => setRecurrence({
                                ...recurrence,
                                occurrences: parseInt(e.target.value) || 10
                              })}
                              className="w-20 ml-2"
                              disabled={recurrence.endType !== 'After'}
                            />
                            <span className="text-sm">occurrences</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="On" id="r-end-on" />
                            <Label htmlFor="r-end-on">On</Label>
                            <div className="ml-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className={`w-[200px] justify-start text-left font-normal ${recurrence.endType !== 'On' ? 'opacity-50' : ''}`}
                                    disabled={recurrence.endType !== 'On'}
                                  >
                                    <CalendarDays className="mr-2 h-4 w-4" />
                                    {recurrence.endDate ? (
                                      format(recurrence.endDate, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                  <CalendarComponent
                                    mode="single"
                                    selected={recurrence.endDate}
                                    onSelect={handleRecurrenceEndDateChange}
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
                </div>
              </TabsContent>
              
              <TabsContent value="emails" className="mt-0 p-0 min-h-[500px]">
                <div className="space-y-4">
                  <div className="flex-1 min-h-[500px]">
                    <EmailPreview 
                      isLoading={isEmailPreviewLoading}
                      html={previewData?.html || null}
                      error={previewError}
                      lastSendResult={lastSendResult}
                      isSending={isEmailSending}
                      showSendButton={true}
                      onSend={() => {
                        // Prepare the data for sending
                        if (!title || !startDate || !endDate) {
                          toast({
                            title: 'Missing information',
                            description: 'Please fill in all required fields',
                            variant: 'destructive'
                          });
                          setActiveTab('basic');
                          return;
                        }
                        
                        const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                        const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                        
                        sendEmail({
                          title,
                          description,
                          location,
                          startDate: startDateTime,
                          endDate: endDateTime,
                          attendees,
                          resources
                        }).then(() => {
                          // If email was sent successfully, also create the event
                          handleSubmit();
                        }).catch(error => {
                          toast({
                            title: 'Email sending failed',
                            description: 'The email could not be sent. Please check your SMTP settings.',
                            variant: 'destructive'
                          });
                        });
                      }}
                      onRefresh={() => {
                        // Regenerate the preview
                        const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                        const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                        
                        generatePreview({
                          title,
                          description,
                          location,
                          startDate: startDateTime,
                          endDate: endDateTime,
                          attendees,
                          resources
                        });
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
          
          <DialogFooter className="border-t p-4 gap-y-3">
            <div className="flex-1 flex justify-start">
              {event && (
                <Button 
                  variant="destructive" 
                  onClick={handleDelete}
                  disabled={isSubmitting || isDeleting || isEmailSending}
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
                    
                    // Prepare date objects
                    const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                    const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                    
                    // Store the event data for use in the alert dialog
                    const eventData = {
                      title,
                      description,
                      location,
                      startDate: startDateTime,
                      endDate: endDateTime,
                      attendees,
                      resources
                    };
                    
                    // Set the event data for later use
                    setPreviewEventData(eventData);
                    
                    // If already on the email preview tab, don't show the confirmation dialog
                    if (activeTab === 'emails') {
                      // User is already viewing the preview, send directly
                      sendEmail(eventData).then(() => {
                        handleSubmit();
                      }).catch(error => {
                        toast({
                          title: 'Email sending failed',
                          description: 'The email could not be sent. Please check your SMTP settings.',
                          variant: 'destructive'
                        });
                      });
                    } else {
                      // Show confirmation dialog only if not on email preview tab
                      setAlertDialogOpen(true);
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
      
      {/* Alert Dialog for email preview confirmation */}
      <AlertDialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Email Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to preview the email before sending it to {attendees.length} attendee{attendees.length !== 1 ? 's' : ''}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              // User chose not to preview, proceed with sending directly
              if (previewEventData) {
                sendEmail(previewEventData).then(() => {
                  handleSubmit();
                }).catch(error => {
                  toast({
                    title: 'Email sending failed',
                    description: 'The email could not be sent. Please check your SMTP settings.',
                    variant: 'destructive'
                  });
                });
              }
            }}>
              Send Without Preview
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              // Navigate to email tab and show preview
              setActiveTab('emails');
              if (previewEventData) {
                generatePreview(previewEventData);
              }
            }}>
              Preview First
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ImprovedEventFormModal;