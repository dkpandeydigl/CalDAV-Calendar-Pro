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
import { apiRequest } from '@/lib/queryClient';
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
  Package,
  Info
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
  
  // Define interface for event update response
  interface UpdateEventResponse {
    success: boolean;
    event: Event;
    hasAttendees: boolean;
  }
  
  // Store the HTML content for email previews
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null);
  
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
          
          // For all-day events, the end date in CalDAV is typically the day after
          // (exclusive end date). So for display purposes, we need to subtract 1 day
          // from the end date if this is an all-day event.
          if (event.allDay) {
            console.log(`All-day event detected for "${event.title}"`);
            console.log(`Original dates: Start=${start.toISOString()}, End=${end.toISOString()}`);
            
            // If end date is after start date, adjust it back by one day for display
            if (end.getTime() > start.getTime()) {
              const adjustedEnd = new Date(end);
              adjustedEnd.setDate(adjustedEnd.getDate() - 1);
              end = adjustedEnd;
              console.log(`Adjusted end date for form display: ${end.toISOString()}`);
            }
          }
        } catch (error) {
          console.error(`Error parsing dates for event "${event.title}":`, error);
          start = new Date();
          end = new Date();
          end.setHours(end.getHours() + 1);
        }
        
        // Format dates for form - now with correct adjustment for all-day events
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
        // CRITICAL TIMEZONE FIX: For all-day events, we now use a simpler approach
        // where we ALWAYS use UTC time for all-day events to avoid timezone issues completely
        
        console.log(`[DATE DEBUG] ------- Event Form Date Initialization -------`);
        console.log(`[DATE DEBUG] Received selectedDate: ${selectedDate instanceof Date ? selectedDate.toString() : selectedDate}`);
        console.log(`[DATE DEBUG] Using simplified UTC approach for all-day events`);
        
        // First get the date in the format needed for display (YYYY-MM-DD)
        const localDate = new Date(selectedDate);
        
        if (!isNaN(localDate.getTime())) {
          // Extract date components directly from the date 
          const year = localDate.getFullYear();
          const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
          const day = localDate.getDate().toString().padStart(2, '0');
          const formattedDate = `${year}-${month}-${day}`;
          
          console.log(`[DATE DEBUG] Selected date components: year=${year}, month=${month}, day=${day}`);
          console.log(`[DATE DEBUG] Formatted as YYYY-MM-DD: ${formattedDate}`);
          
          // Set the same date for both start and end
          setStartDate(formattedDate);
          setEndDate(formattedDate);
          
          // DEFAULT FOR SIMPLICITY: Always set events created by clicking to all-day
          // This prevents most timezone issues and is the most intuitive behavior
          setAllDay(true);
          
          // Even though these won't be visible for all-day events, set default times
          // in case the user switches to a timed event later
          setStartTime('00:00');
          setEndTime('23:59');
          
          // SIMPLIFIED: For all-day events, we always use UTC timezone
          // This ensures consistent date storage regardless of user's local timezone
          setTimezone('UTC');
          
          console.log(`[DATE DEBUG] Form values set for all-day event:`, {
            startDate: formattedDate,
            endDate: formattedDate,
            allDay: true,
            timezone: 'UTC' // IMPORTANT: Always UTC for all-day events
          });
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
      // CRITICAL FIX: Explicitly log the current form state
      console.log(`[DATE DEBUG] ------- FORM SUBMISSION VALUES -------`);
      console.log(`[DATE DEBUG] startDate (raw string): ${startDate}`);
      console.log(`[DATE DEBUG] endDate (raw string): ${endDate}`);
      console.log(`[DATE DEBUG] allDay: ${allDay}`);
      
      // CRITICAL FIX: Create dates more safely to avoid "invalid time value"
      let startDateTime, endDateTime;

      try {
        // Always include validation to prevent invalid time values
        if (allDay) {
          console.log(`[CRITICAL DATE DEBUG] ************************`);
          console.log(`[CRITICAL DATE DEBUG] All-day event submission`);
          console.log(`[CRITICAL DATE DEBUG] Form date strings:`, { startDate, endDate });
          console.log(`[CRITICAL DATE DEBUG] Current browser timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
          console.log(`[CRITICAL DATE DEBUG] Current timezone offset: ${new Date().getTimezoneOffset() / -60}hrs`);
          
          // For all-day events, we need to be extremely careful with date handling
          // to ensure the dates aren't shifted due to timezone issues
          
          // IMPORTANT FIX: Split the date string and use Date.UTC to create the date at midnight UTC
          // This helps avoid any local timezone offsets that might shift the date
          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
          
          // Create date based on explicit components using UTC to avoid timezone issues
          // This is the key fix - using UTC dates for all-day events
          startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
          
          console.log(`[CRITICAL DATE DEBUG] All-day event start date breakdown:`, {
            date: startDate,
            year: startYear,
            month: startMonth, // Original month (1-indexed)
            monthForJS: startMonth - 1, // Adjusted for JS Date (0-indexed)
            day: startDay,
            createdDateUTC: startDateTime.toUTCString(),
            createdDateISO: startDateTime.toISOString(),
            createdDateLocal: startDateTime.toString()
          });
          
          // Same careful approach for end date
          const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
          
          // Create end date with Date.UTC
          const endDateTemp = new Date(Date.UTC(endYear, endMonth - 1, endDay, 0, 0, 0));
          
          console.log(`[CRITICAL DATE DEBUG] All-day event end date breakdown:`, {
            date: endDate,
            year: endYear,
            month: endMonth, // Original month (1-indexed)
            monthForJS: endMonth - 1, // Adjusted for JS Date (0-indexed)
            day: endDay,
            createdDateUTC: endDateTemp.toUTCString(),
            createdDateISO: endDateTemp.toISOString(),
            createdDateLocal: endDateTemp.toString()
          });
          
          // For all-day events in CalDAV, if start and end date are the same, 
          // we add a day to the end date per the CalDAV spec
          if (startDateTime.getTime() === endDateTemp.getTime()) {
            // Create a proper next day using UTC to avoid timezone issues
            const nextDay = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
            endDateTime = nextDay;
            
            console.log(`[CRITICAL DATE DEBUG] Adjusted end date to next day:`, {
              original: endDateTemp.toISOString(),
              adjusted: nextDay.toISOString()
            });
          } else {
            // If dates are already different, just use the end date as is
            endDateTime = endDateTemp;
          }
          
          console.log(`[CRITICAL DATE DEBUG] Final all-day event date objects:`, {
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString(),
            timezoneOffset: new Date().getTimezoneOffset()
          });
          console.log(`[CRITICAL DATE DEBUG] ************************`);
        } else {
          // For regular events with time, create the date objects from components
          // to avoid timezone issues with string parsing
          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
          const [startHour, startMinute] = startTime.split(':').map(Number);
          
          // Create the date in local timezone for timed events
          startDateTime = new Date(startYear, startMonth - 1, startDay, startHour, startMinute);
          
          // Same for end date
          const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
          const [endHour, endMinute] = endTime.split(':').map(Number);
          
          endDateTime = new Date(endYear, endMonth - 1, endDay, endHour, endMinute);
          
          console.log(`[DATE DEBUG] Regular event date objects:`, {
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString()
          });
        }
        
        // Final validation to ensure we have valid dates
        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
          throw new Error('Invalid date/time values');
        }
      } catch (error) {
        console.error('Error creating date objects:', error);
        toast({
          title: 'Invalid date/time',
          description: 'Please check the date and time values',
          variant: 'destructive'
        });
        setIsSubmitting(false);
        return; // Stop submission if dates are invalid
      }
      
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
      
      // Handle existing event update
      if (event) {
        // Update existing event - need to use the { id, data } format required by updateEvent
        try {
            // Call the regular update function to update the event
            updateEvent({ 
              id: event.id, 
              data: eventData 
            });
            
            // Update successful - simply close the modal and refresh the events
            // We no longer automatically show email preview or send emails on regular update
            queryClient.invalidateQueries({ queryKey: ['/api/events'] });
            onClose();
        } catch (updateError) {
          console.error("Failed to update event:", updateError);
          throw updateError; // Will be caught by the outer catch block
        }
      } 
      // Handle new event creation
      else {
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
        
        // Refresh the events list and close modal
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        onClose();
      }
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
              
              {attendees.length > 0 && (
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
                      onCheckedChange={(checked) => {
                        const isChecked = checked === true;
                        setAllDay(isChecked);
                        
                        // When switching to all-day events, default to 00:00-23:59 in UTC
                        if (isChecked) {
                          setStartTime('00:00');
                          setEndTime('23:59');
                          setTimezone('UTC');
                        } else {
                          // When unchecking all-day, restore user's preferred timezone
                          setTimezone(selectedTimezone);
                        }
                      }}
                    />
                    <Label htmlFor="all-day" className="cursor-pointer">All Day Event</Label>
                  </div>
                  
                  {/* Only show timezone selector for non-all-day events */}
                  {!allDay && (
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
                  )}
                  
                  {/* Show a note about UTC timezone for all-day events */}
                  {allDay && (
                    <div className="space-y-1 bg-muted/40 p-2 rounded-md border border-muted">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        <Info className="h-4 w-4 text-muted-foreground" />
                        Timezone: UTC (fixed for all-day events)
                      </div>
                      <p className="text-xs text-muted-foreground">
                        All-day events use UTC timezone to avoid date shifting problems
                      </p>
                    </div>
                  )}
                  
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
                          
                          // Handle all-day event end dates correctly for CalDAV format
                          let endDateTime;
                          if (allDay) {
                            const nextDay = new Date(`${endDate}T00:00:00`);
                            nextDay.setDate(nextDay.getDate() + 1);
                            endDateTime = nextDay;
                          } else {
                            endDateTime = new Date(`${endDate}T${endTime}:00`);
                          }
                          
                          generatePreview({
                            title,
                            description,
                            location,
                            startDate: startDateTime,
                            endDate: endDateTime,
                            attendees,
                            resources,
                            // Include recurrence rule if it exists
                            recurrenceRule: recurrence.pattern !== 'None' ? {
                              pattern: recurrence.pattern,
                              interval: recurrence.interval,
                              weekdays: recurrence.weekdays,
                              endType: recurrence.endType,
                              occurrences: recurrence.occurrences,
                              untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                            } : undefined
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
                      html={emailPreviewHtml}
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
                        
                        // Handle all-day event end dates correctly for CalDAV format
                        let endDateTime;
                        if (allDay) {
                          const nextDay = new Date(`${endDate}T00:00:00`);
                          nextDay.setDate(nextDay.getDate() + 1);
                          endDateTime = nextDay;
                        } else {
                          endDateTime = new Date(`${endDate}T${endTime}:00`);
                        }
                        
                        // Prepare email data
                        const emailData = {
                          title,
                          description,
                          location,
                          startDate: startDateTime,
                          endDate: endDateTime,
                          attendees,
                          resources,
                          // Include eventId for existing events
                          eventId: event ? event.id : undefined,
                          // Include recurrence rule if it exists
                          recurrenceRule: recurrence.pattern !== 'None' ? {
                            pattern: recurrence.pattern,
                            interval: recurrence.interval,
                            weekdays: recurrence.weekdays,
                            endType: recurrence.endType,
                            occurrences: recurrence.occurrences,
                            untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                          } : undefined
                        };
                        
                        // Send email
                        sendEmail(emailData).then(() => {
                          // Display success toast
                          toast({
                            title: 'Email sent',
                            description: 'Invitation email was sent successfully to all attendees',
                          });
                          
                          // Mark the event as having email sent if it's an existing event
                          if (event) {
                            updateEvent({
                              id: event.id,
                              data: {
                                emailSent: new Date().toISOString(), // Convert date to ISO string for the database
                                emailError: null
                              }
                            });
                          }
                          
                          // Close the modal
                          onClose();
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
                        
                        // Handle all-day event end dates correctly for CalDAV format
                        let endDateTime;
                        if (allDay) {
                          const nextDay = new Date(`${endDate}T00:00:00`);
                          nextDay.setDate(nextDay.getDate() + 1);
                          endDateTime = nextDay;
                        } else {
                          endDateTime = new Date(`${endDate}T${endTime}:00`);
                        }
                        
                        const previewParams = {
                          title,
                          description,
                          location,
                          startDate: startDateTime,
                          endDate: endDateTime,
                          attendees,
                          resources,
                          // Include event ID for existing events
                          eventId: event ? event.id : undefined,
                          // Include recurrence rule if it exists
                          recurrenceRule: recurrence.pattern !== 'None' ? {
                            pattern: recurrence.pattern,
                            interval: recurrence.interval,
                            weekdays: recurrence.weekdays,
                            endType: recurrence.endType,
                            occurrences: recurrence.occurrences,
                            untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                          } : undefined
                        };
                        
                        generatePreview(previewParams)
                          .then(previewResult => {
                            if (previewResult && previewResult.html) {
                              setEmailPreviewHtml(previewResult.html);
                            }
                          })
                          .catch(error => {
                            console.error("Error refreshing email preview:", error);
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
              
              {/* Show Send Mail button for both new and existing events with attendees */}
              {attendees.length > 0 && (
                <Button
                  onClick={async () => {
                    if (!validateForm()) return;
                    
                    // Prepare date objects
                    const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                    
                    // Handle all-day event end dates correctly for CalDAV format
                    let endDateTime;
                    if (allDay) {
                      const nextDay = new Date(`${endDate}T00:00:00`);
                      nextDay.setDate(nextDay.getDate() + 1);
                      endDateTime = nextDay;
                    } else {
                      endDateTime = new Date(`${endDate}T${endTime}:00`);
                    }
                    
                    // Store the event data for use in the alert dialog
                    const eventData = {
                      title,
                      description,
                      location,
                      startDate: startDateTime,
                      endDate: endDateTime,
                      attendees,
                      resources,
                      // Include event ID for existing events
                      eventId: event ? event.id : undefined,
                      // Include recurrence rule if it exists
                      recurrenceRule: recurrence.pattern !== 'None' ? {
                        pattern: recurrence.pattern,
                        interval: recurrence.interval,
                        weekdays: recurrence.weekdays,
                        endType: recurrence.endType,
                        occurrences: recurrence.occurrences,
                        untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                      } : undefined
                    };
                    
                    // Set the event data for later use
                    setPreviewEventData(eventData);
                    
                    // If already on the email preview tab, don't show the confirmation dialog
                    if (activeTab === 'emails') {
                      // User is already viewing the preview, send directly
                      // Note: isEmailSending state is handled by the sendEmail hook internally
                      
                      sendEmail(eventData).then(() => {
                        // On success, create/update the event and close the modal
                        toast({
                          title: 'Email sent',
                          description: 'Invitation email was sent successfully to all attendees',
                        });
                        
                        // Mark the event as having email sent if it's an existing event
                        if (event) {
                          // Prepare full event data (same as handleSubmit)
                          const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                          
                          // Handle all-day event end dates correctly for CalDAV format
                          let endDateTime;
                          if (allDay) {
                            const nextDay = new Date(`${endDate}T00:00:00`);
                            nextDay.setDate(nextDay.getDate() + 1);
                            endDateTime = nextDay;
                          } else {
                            endDateTime = new Date(`${endDate}T${endTime}:00`);
                          }
                          
                          // Prepare recurrence rule if it exists
                          const recurrenceRule = recurrence.pattern !== 'None' ? JSON.stringify({
                            pattern: recurrence.pattern,
                            interval: recurrence.interval,
                            weekdays: recurrence.weekdays,
                            endType: recurrence.endType,
                            occurrences: recurrence.occurrences,
                            untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                          }) : null;
                          
                          // Prepare attendees and resources
                          const attendeesJson = attendees.length > 0 ? JSON.stringify(attendees) : null;
                          const resourcesJson = resources.length > 0 ? JSON.stringify(resources) : null;
                          
                          // Update the entire event with all properties
                          updateEvent({
                            id: event.id,
                            data: {
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
                              resources: resourcesJson,
                              recurrenceRule,
                              syncStatus: 'local',
                              emailSent: new Date().toISOString(), // Convert date to ISO string for the database
                              emailError: null
                            }
                          });
                          
                          // Close the modal
                          onClose();
                        } else {
                          // If it's a new event, create it
                          handleSubmit();
                        }
                      }).catch(error => {
                        console.error('Email sending error:', error);
                        // Show detailed error message from the exception
                        toast({
                          title: 'Email sending failed',
                          description: error.message || 'The email could not be sent. Please check your SMTP settings.',
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
                    : event ? 'Send Mail and Update' : 'Send Mail and Create'}
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
            <AlertDialogTitle>{event ? 'Send Update Notification' : 'Send Email Invitation'}</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to preview the email before sending it to {attendees.length} attendee{attendees.length !== 1 ? 's' : ''}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              // User chose not to preview, proceed with sending directly
              if (previewEventData) {
                // Note: isEmailSending state is handled by the sendEmail hook internally
                
                sendEmail(previewEventData).then(() => {
                  // Display success toast
                  toast({
                    title: 'Email sent',
                    description: event 
                      ? 'Update notification was sent successfully to all attendees' 
                      : 'Invitation email was sent successfully to all attendees',
                  });
                  
                  // If it's an existing event, mark it as having email sent
                  if (event) {
                    // Prepare full event data (same as handleSubmit)
                    const startDateTime = new Date(`${startDate}T${allDay ? '00:00:00' : startTime}:00`);
                    
                    // Handle all-day event end dates correctly for CalDAV format
                    let endDateTime;
                    if (allDay) {
                      const nextDay = new Date(`${endDate}T00:00:00`);
                      nextDay.setDate(nextDay.getDate() + 1);
                      endDateTime = nextDay;
                    } else {
                      endDateTime = new Date(`${endDate}T${endTime}:00`);
                    }
                    
                    // Prepare recurrence rule if it exists
                    const recurrenceRule = recurrence.pattern !== 'None' ? JSON.stringify({
                      pattern: recurrence.pattern,
                      interval: recurrence.interval,
                      weekdays: recurrence.weekdays,
                      endType: recurrence.endType,
                      occurrences: recurrence.occurrences,
                      untilDate: recurrence.endDate ? recurrence.endDate.toISOString() : undefined
                    }) : null;
                    
                    // Prepare attendees and resources
                    const attendeesJson = attendees.length > 0 ? JSON.stringify(attendees) : null;
                    const resourcesJson = resources.length > 0 ? JSON.stringify(resources) : null;
                    
                    // Update the entire event with all properties
                    updateEvent({
                      id: event.id,
                      data: {
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
                        resources: resourcesJson,
                        recurrenceRule,
                        syncStatus: 'local',
                        emailSent: new Date().toISOString(), // Convert date to ISO string for the database
                        emailError: null
                      }
                    });
                    onClose();
                  } else {
                    // If it's a new event, create it
                    handleSubmit();
                  }
                }).catch(error => {
                  console.error('Email sending error:', error);
                  // Show detailed error message from the exception
                  toast({
                    title: 'Email sending failed',
                    description: error.message || 'The email could not be sent. Please check your SMTP settings.',
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