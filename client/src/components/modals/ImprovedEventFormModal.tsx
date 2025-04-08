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
import { useEmailPreview } from '@/hooks/useEmailPreview';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Package,
  Eye
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
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [tempEventData, setTempEventData] = useState<{
    title: string;
    description?: string;
    location?: string;
    startDate: Date;
    endDate: Date;
    attendees: Attendee[];
    resources: Resource[];
  } | null>(null);
  
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
    isSending, 
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
        
        // Try to parse resources from event if available
        try {
          const parsedResources = parseResourcesFromEvent(event);
          if (parsedResources.length > 0) {
            setResources(parsedResources);
          }
        } catch (error) {
          console.error('Failed to parse resources', error);
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
        attendees: updatedAttendees,
        resources
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
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-background to-background/95 border-[0.5px] border-primary/10 shadow-xl">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/80">
              {event ? 'Edit Event' : 'Create Event'}
            </DialogTitle>
            <p className="text-muted-foreground text-sm mt-1">Fill in the details to schedule your event</p>
          </DialogHeader>
          
          <Tabs defaultValue="basic" value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="mb-6 grid grid-cols-4 max-w-[450px] mt-3">
              <TabsTrigger value="basic" className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                <span>Basic</span>
              </TabsTrigger>
              <TabsTrigger value="attendees" className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                <span>Attendees</span>
              </TabsTrigger>
              <TabsTrigger value="resources" className="flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                <span>Resources</span>
              </TabsTrigger>
              <TabsTrigger 
                value="emails" 
                className="flex items-center gap-1.5"
                disabled={attendees.length === 0}
              >
                <Mail className="h-4 w-4" />
                <span>Emails</span>
              </TabsTrigger>
            </TabsList>
            
            <ScrollArea className="flex-1 overflow-y-auto pr-4">
              {/* Basic Information Tab */}
              <TabsContent value="basic" className="space-y-6 mt-0">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Event Title <span className="text-destructive">*</span></Label>
                    <Input 
                      id="title"
                      ref={titleInputRef}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter event title"
                      className={errors.title ? 'border-destructive' : ''}
                    />
                    {errors.title && (
                      <p className="text-destructive text-xs">{errors.title}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <div className="relative">
                      <Textarea 
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Event details"
                        className="min-h-[100px]"
                      />
                      
                      {/* Template selector */}
                      <div className="mt-2">
                        <Label className="text-xs text-muted-foreground">Templates</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {templates.map(template => (
                            <Button
                              key={template.id}
                              type="button"
                              size="sm"
                              variant={selectedTemplate === template.id ? "default" : "outline"}
                              className="text-xs"
                              onClick={() => handleApplyTemplate(template.id)}
                            >
                              {template.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <div className="relative">
                      <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input 
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Add location"
                        className="pl-8"
                      />
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Start Date <span className="text-destructive">*</span></Label>
                      <Input 
                        id="startDate"
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
                      <div className="space-y-2">
                        <Label htmlFor="startTime">Start Time <span className="text-destructive">*</span></Label>
                        <div className="relative">
                          <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input 
                            id="startTime"
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className={`pl-8 ${errors.startTime ? 'border-destructive' : ''}`}
                          />
                        </div>
                        {errors.startTime && (
                          <p className="text-destructive text-xs">{errors.startTime}</p>
                        )}
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label htmlFor="endDate">End Date <span className="text-destructive">*</span></Label>
                      <Input 
                        id="endDate"
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
                      <div className="space-y-2">
                        <Label htmlFor="endTime">End Time <span className="text-destructive">*</span></Label>
                        <div className="relative">
                          <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input 
                            id="endTime"
                            type="time"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            className={`pl-8 ${errors.endTime ? 'border-destructive' : ''}`}
                          />
                        </div>
                        {errors.endTime && (
                          <p className="text-destructive text-xs">{errors.endTime}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="allDay"
                      checked={allDay}
                      onCheckedChange={setAllDay}
                    />
                    <Label htmlFor="allDay">All-day event</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="busyStatus"
                      checked={isBusy}
                      onCheckedChange={setIsBusy}
                    />
                    <Label htmlFor="busyStatus">Show as busy</Label>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger id="timezone">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {getTimezones().map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
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
                      <SelectTrigger 
                        id="calendar"
                        className={errors.calendarId ? 'border-destructive' : ''}
                      >
                        <SelectValue placeholder="Select calendar" />
                      </SelectTrigger>
                      <SelectContent>
                        {calendars.map(calendar => (
                          <SelectItem key={calendar.id} value={calendar.id.toString()}>
                            {calendar.name}
                          </SelectItem>
                        ))}
                        {editableSharedCalendars.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Shared with edit permission
                            </div>
                            {editableSharedCalendars.map(calendar => (
                              <SelectItem key={`shared-${calendar.id}`} value={calendar.id.toString()}>
                                {calendar.name} (Shared)
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
                    <div className="flex items-center">
                      <Label htmlFor="repeat" className="flex-grow">Repeat</Label>
                      <Badge 
                        variant={recurrence.pattern === 'None' ? 'outline' : 'default'}
                        className={recurrence.pattern === 'None' ? 'text-muted-foreground' : 'bg-primary/90'}
                      >
                        <Repeat className="h-3 w-3 mr-1" />
                        {recurrence.pattern}
                        {recurrence.pattern !== 'None' && recurrence.interval > 1 ? ` (${recurrence.interval})` : ''}
                      </Badge>
                    </div>
                    
                    <Select 
                      value={recurrence.pattern} 
                      onValueChange={(value) => setRecurrence({ 
                        ...recurrence, 
                        pattern: value as RecurrencePattern
                      })}
                    >
                      <SelectTrigger id="repeat">
                        <SelectValue placeholder="Select recurrence pattern" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="None">Does not repeat</SelectItem>
                        <SelectItem value="Daily">Daily</SelectItem>
                        <SelectItem value="Weekly">Weekly</SelectItem>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                        <SelectItem value="Yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {recurrence.pattern !== 'None' && (
                      <div className="space-y-4 mt-3 p-3 border rounded-md bg-muted/30">
                        <div className="space-y-2">
                          <Label htmlFor="interval">Repeat every</Label>
                          <div className="flex items-center gap-2">
                            <Input 
                              id="interval"
                              type="number"
                              min="1"
                              max="99"
                              value={recurrence.interval}
                              onChange={(e) => setRecurrence({
                                ...recurrence,
                                interval: Math.max(1, parseInt(e.target.value) || 1)
                              })}
                              className="max-w-[80px]"
                            />
                            <span className="text-sm">
                              {recurrence.pattern === 'Daily' && 'day(s)'}
                              {recurrence.pattern === 'Weekly' && 'week(s)'}
                              {recurrence.pattern === 'Monthly' && 'month(s)'}
                              {recurrence.pattern === 'Yearly' && 'year(s)'}
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
                                  size="sm"
                                  variant={recurrence.weekdays?.includes(day) ? "default" : "outline"}
                                  className="h-8 w-8 p-0 rounded-full"
                                  onClick={() => handleWeekdayToggle(day)}
                                >
                                  {day.charAt(0)}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {recurrence.pattern === 'Monthly' && (
                          <div className="space-y-2">
                            <Label htmlFor="dayOfMonth">Day of month</Label>
                            <Input 
                              id="dayOfMonth"
                              type="number"
                              min="1"
                              max="31"
                              value={recurrence.dayOfMonth || ''}
                              onChange={(e) => setRecurrence({
                                ...recurrence,
                                dayOfMonth: parseInt(e.target.value) || undefined
                              })}
                              className="max-w-[80px]"
                              placeholder="Day"
                            />
                          </div>
                        )}
                        
                        <div className="space-y-2">
                          <Label>Ends</Label>
                          <RadioGroup 
                            value={recurrence.endType} 
                            onValueChange={(value) => setRecurrence({
                              ...recurrence,
                              endType: value as RecurrenceEndType
                            })}
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
                                value={recurrence.occurrences}
                                onChange={(e) => setRecurrence({
                                  ...recurrence,
                                  occurrences: parseInt(e.target.value) || 10
                                })}
                                className="max-w-[80px] ml-2"
                                disabled={recurrence.endType !== 'After'}
                              />
                              <span className="text-sm">occurrence(s)</span>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="On" id="end-on" />
                              <Label htmlFor="end-on">On date</Label>
                              <div className="ml-2">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className={`w-[240px] pl-3 text-left font-normal ${recurrence.endType !== 'On' ? 'opacity-50' : ''}`}
                                      disabled={recurrence.endType !== 'On'}
                                    >
                                      {recurrence.endDate ? (
                                        format(recurrence.endDate, "PPP")
                                      ) : (
                                        <span>Pick a date</span>
                                      )}
                                      <Calendar className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start">
                                    <CalendarComponent
                                      mode="single"
                                      selected={recurrence.endDate}
                                      onSelect={handleRecurrenceEndDateChange}
                                      disabled={(date) => date < new Date()}
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </div>
                          </RadioGroup>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              
              {/* Attendees Tab */}
              <TabsContent value="attendees" className="space-y-6 mt-0">
                <div className="space-y-6">
                  <div className="flex items-end gap-3">
                    <div className="flex-grow space-y-2">
                      <Label htmlFor="attendeeEmail">Attendee Email</Label>
                      <Input 
                        id="attendeeEmail"
                        value={attendeeInput}
                        onChange={(e) => setAttendeeInput(e.target.value)}
                        placeholder="Enter email address"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddAttendee();
                          }
                        }}
                        className={errors.attendeeInput ? 'border-destructive' : ''}
                      />
                      {errors.attendeeInput && (
                        <p className="text-destructive text-xs">{errors.attendeeInput}</p>
                      )}
                    </div>
                    
                    <div className="space-y-2 min-w-[120px]">
                      <Label htmlFor="attendeeRole">Role</Label>
                      <Select 
                        value={attendeeRole} 
                        onValueChange={(value) => setAttendeeRole(value as AttendeeRole)}
                      >
                        <SelectTrigger id="attendeeRole">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Chairman">Chairman</SelectItem>
                          <SelectItem value="Secretary">Secretary</SelectItem>
                          <SelectItem value="Member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <Button 
                      type="button"
                      size="icon"
                      onClick={handleAddAttendee}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {errors.attendees && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {errors.attendees}
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>Attendees ({attendees.length})</Label>
                      {attendees.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-xs"
                          onClick={() => setAttendees([])}
                        >
                          Clear all
                        </Button>
                      )}
                    </div>
                    
                    {attendees.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p>No attendees added yet</p>
                        <p className="text-xs mt-1">Add attendees by entering their email above</p>
                      </div>
                    ) : (
                      <div className="border rounded-md divide-y">
                        {attendees.map((attendee) => (
                          <div key={attendee.id} className="p-3 flex items-center justify-between">
                            <div>
                              <p className="font-medium">{attendee.email}</p>
                              <div className="flex items-center mt-1">
                                <Select 
                                  value={attendee.role} 
                                  onValueChange={(value) => handleUpdateAttendeeRole(attendee.id, value as AttendeeRole)}
                                >
                                  <SelectTrigger className="h-7 text-xs w-[110px]">
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Chairman">Chairman</SelectItem>
                                    <SelectItem value="Secretary">Secretary</SelectItem>
                                    <SelectItem value="Member">Member</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => handleRemoveAttendee(attendee.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              
              {/* Resources Tab */}
              <TabsContent value="resources" className="space-y-6 mt-0">
                <ResourceManager
                  resources={resources}
                  onResourcesChange={setResources}
                />
              </TabsContent>
              
              {/* Email Preview Tab */}
              <TabsContent value="emails" className="space-y-6 mt-0">
                {attendees.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No attendees added yet</p>
                    <p className="text-xs mt-1">Add attendees in the Attendees tab to enable email previews</p>
                  </div>
                ) : !title || !startDate || !endDate ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>Required information missing</p>
                    <p className="text-xs mt-1">Complete the basic event details to generate email preview</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>Email Preview</Label>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="text-xs flex items-center gap-1"
                        onClick={() => {
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
                      >
                        <RefreshCw className="h-3 w-3" />
                        Refresh Preview
                      </Button>
                    </div>
                    
                    {previewError ? (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {previewError}
                        </AlertDescription>
                      </Alert>
                    ) : isEmailPreviewLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : previewData ? (
                      <div className="border rounded-md">
                        <EmailPreview 
                          isLoading={false}
                          error={null}
                          html={previewData?.html || null}
                          onRefresh={() => {
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
                        
                        {lastSendResult && (
                          <Alert 
                            variant={lastSendResult.success ? "default" : "destructive"}
                            className="mt-4"
                          >
                            <AlertDescription>
                              {lastSendResult.message}
                            </AlertDescription>
                          </Alert>
                        )}
                        
                        <div className="p-4 bg-muted/30 border-t flex justify-end">
                          <Button
                            onClick={async () => {
                              try {
                                await sendEmail({
                                  title,
                                  description,
                                  location,
                                  startDate: new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`),
                                  endDate: new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`),
                                  attendees,
                                  resources
                                });
                                
                                // If email was sent successfully, create the event
                                if (lastSendResult?.success) {
                                  await handleSubmit();
                                }
                              } catch (error) {
                                console.error('Failed to send email:', error);
                              }
                            }}
                            disabled={isSending || isSubmitting}
                            className="bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
                          >
                            {isSending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Mail className="h-4 w-4 mr-1" />
                            )}
                            {isSending ? 'Sending...' : 'Send Email & Save Event'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="border rounded-md p-8 text-center text-muted-foreground">
                        <FileText className="h-10 w-10 mx-auto mb-4 opacity-20" />
                        <p>No preview generated yet</p>
                        <p className="text-xs mt-1">Click "Refresh Preview" to generate</p>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
          
          <DialogFooter className="px-6 py-4 border-t mt-4">
            <div className="flex flex-wrap gap-2 justify-end">
              {/* Show delete button only when editing an existing event */}
              {event && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isSubmitting || isDeleting || isSending}
                  className="flex items-center gap-2"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  {isDeleting ? 'Deleting...' : 'Delete Event'}
                </Button>
              )}
              
              {/* Show email option only if:
                  1. It's a new event (not editing)
                  2. There are attendees */}
              {!event && attendees.length > 0 && (
                <Button
                  onClick={() => {
                    if (!validateForm()) return;
                    
                    // Prepare event data for the confirmation dialog
                    const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                    const endDateTime = new Date(`${endDate}T${allDay ? '23:59:59' : endTime}:00`);
                    
                    // Store event data to be used by the confirmation dialog
                    setTempEventData({
                      title,
                      description,
                      location,
                      startDate: startDateTime,
                      endDate: endDateTime,
                      attendees,
                      resources
                    });
                    
                    // Show the confirmation dialog
                    setShowPreviewDialog(true);
                  }}
                  disabled={isSubmitting || isDeleting || isSending}
                  type="button"
                  className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-sm hover:shadow-md transition-all min-w-[180px] justify-center text-white"
                >
                  {isSubmitting || isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Mail className="h-4 w-4 mr-1" />
                  )}
                  {isSubmitting || isSending 
                    ? 'Processing...' 
                    : 'Send Mail and Create'}
                </Button>
              )}
              
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || isDeleting || isSending}
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

      {/* Email Preview Confirmation Dialog */}
      <AlertDialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Email Preview</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to preview the email before sending it to attendees?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={async () => {
                if (!tempEventData) return;
                
                try {
                  // Send the email without preview
                  await sendEmail(tempEventData);
                  
                  // If email was sent successfully, create the event
                  await handleSubmit();
                  
                  // Success notification
                  toast({
                    title: 'Success',
                    description: 'Email sent and event created successfully.',
                    variant: 'default'
                  });
                } catch (error) {
                  // Email sending failed
                  toast({
                    title: 'Email sending failed',
                    description: 'The email could not be sent. Please check your SMTP settings.',
                    variant: 'destructive'
                  });
                } finally {
                  setShowPreviewDialog(false);
                }
              }}
            >
              No, Send Now
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!tempEventData) return;
                
                // Close dialog and switch to email tab to show preview
                setActiveTab('emails');
                
                // Generate preview
                generatePreview(tempEventData);
                
                // Close the confirmation dialog
                setShowPreviewDialog(false);
              }}
              className="bg-primary text-white hover:bg-primary/90"
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview First
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ImprovedEventFormModal;