import { useState, useEffect, useRef, useMemo, Fragment, FC } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO, addDays, addHours, isValid } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

// UI Components
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
// Use Input component instead of specialized TimePicker

// Icons
import { 
  Check, 
  X, 
  CalendarDays, 
  Users, 
  Package, 
  Repeat, 
  Mail, 
  Calendar as CalendarIcon, 
  Clock, 
  CalendarPlus, 
  PlusCircle, 
  Trash,
  Trash2,
  UserPlus,
  UserMinus,
  Edit,
  Save,
  AlertCircle,
  ArrowUpDown,
  BellRing,
  Send,
  Loader2,
  CalendarClock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';

// Hooks
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useEventUID } from '@/hooks/useEventUID';
import { useAuth as useUser } from '@/hooks/use-auth';
import { useMediaQuery } from '@/hooks/use-mobile';
import { parseRRULEFromEvent } from '@/utils/rrule-sanitizer';
import { useEmailTemplateStore } from '@/stores/emailTemplateStore';

// Function to create, update, delete events - extracted from useCalendarEvents
const useCreateEvent = () => {
  const { createEvent } = useCalendarEvents(); 
  return { mutateAsync: createEvent };
};

const useUpdateEvent = () => {
  const { updateEvent } = useCalendarEvents();
  return { mutateAsync: updateEvent };
};

const useDeleteEvent = () => {
  const { deleteEvent } = useCalendarEvents();
  return { mutateAsync: deleteEvent };
};

const useCancelEvent = () => {
  const { cancelEvent } = useCalendarEvents();
  return { mutateAsync: cancelEvent || ((id) => Promise.resolve()) };
};

// Utility helpers
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';

// Types
import { Event } from '@shared/schema';

interface EventFormModalProps {
  open: boolean;
  event: Event | null;
  selectedDate?: Date;
  onClose: () => void;
}

// Predefined templates for description
interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
}

type AttendeeRole = 'Chairman' | 'Secretary' | 'Member';

interface Attendee {
  id: string;
  email: string;
  name?: string;
  role: AttendeeRole;
}

type RecurrencePattern = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

type RecurrenceEndType = 'Never' | 'After' | 'On';

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

export const ImprovedEventFormModal: FC<EventFormModalProps> = ({ 
  open, 
  event, 
  selectedDate,
  onClose 
}) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const { data: calendars } = useCalendars();
  const { mutateAsync: createEvent } = useCreateEvent();
  const { mutateAsync: updateEvent } = useUpdateEvent();
  const { mutateAsync: deleteEvent } = useDeleteEvent();
  const { mutateAsync: cancelEvent } = useCancelEvent();
  const { getOrGenerateUID, storeUID } = useEventUID();
  const descriptionTemplates = useEmailTemplateStore(state => state.templates);
  const isMobile = useMediaQuery("(max-width: 768px)");
  
  // State management for form tabs
  const [activeTab, setActiveTab] = useState('basic');
  
  // Define the form schema
  const formSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    location: z.string().optional(),
    calendarId: z.string().min(1, "Calendar is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    allDay: z.boolean().default(false),
    timezone: z.string().default("UTC"),
    isBusy: z.boolean().default(true)
  });
  
  // Create form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      calendarId: '',
      startDate: '',
      endDate: '',
      startTime: '12:00',
      endTime: '13:00',
      allDay: false,
      timezone: 'UTC',
      isBusy: true
    }
  });
  
  // Form validation errors
  const errors = form.formState.errors;
  
  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  
  // Attendees and resources state
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [newAttendeeEmail, setNewAttendeeEmail] = useState('');
  const [newAttendeeName, setNewAttendeeName] = useState('');
  const [newAttendeeRole, setNewAttendeeRole] = useState<AttendeeRole>('Member');
  const [resources, setResources] = useState<string[]>([]);
  const [newResource, setNewResource] = useState('');
  
  // Recurrence state
  type RecurrenceSettings = RecurrenceConfig;
  
  const [recurrence, setRecurrence] = useState<RecurrenceSettings>({
    pattern: 'None',
    interval: 1,
    endType: 'Never'
  });
  
  // Email settings and confirmation
  const [sendEmails, setSendEmails] = useState(true);
  const [emailConfirmation, setEmailConfirmation] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  
  // Dialog controls for cancellation, deletion, etc.
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
  // RFC 5545 compliant RRULE generator
  const generateRRuleString = (recurrence: RecurrenceSettings): string => {
    if (recurrence.pattern === 'None') {
      return '';
    }
    
    // Start building the RRULE
    let rrule = 'RRULE:FREQ=';
    
    // Add frequency
    switch (recurrence.pattern) {
      case 'Daily':
        rrule += 'DAILY';
        break;
      case 'Weekly':
        rrule += 'WEEKLY';
        break;
      case 'Monthly':
        rrule += 'MONTHLY';
        break;
      case 'Yearly':
        rrule += 'YEARLY';
        break;
    }
    
    // Add interval
    if (recurrence.interval > 1) {
      rrule += `;INTERVAL=${recurrence.interval}`;
    }
    
    // Add specific weekdays for weekly recurrence
    if (recurrence.pattern === 'Weekly' && recurrence.weekdays && recurrence.weekdays.length > 0) {
      const dayMap: Record<string, string> = {
        'Sunday': 'SU',
        'Monday': 'MO',
        'Tuesday': 'TU',
        'Wednesday': 'WE',
        'Thursday': 'TH',
        'Friday': 'FR',
        'Saturday': 'SA'
      };
      
      // Map day names to RFC 5545 format
      const byDay = recurrence.weekdays.map(day => dayMap[day]).join(',');
      if (byDay) {
        rrule += `;BYDAY=${byDay}`;
      }
    }
    
    // Add specific day of month for monthly recurrence
    if (recurrence.pattern === 'Monthly' && recurrence.dayOfMonth) {
      rrule += `;BYMONTHDAY=${recurrence.dayOfMonth}`;
    }
    
    // Add end rules
    if (recurrence.endType === 'After' && recurrence.occurrences) {
      rrule += `;COUNT=${recurrence.occurrences}`;
    } else if (recurrence.endType === 'On' && recurrence.endDate) {
      // RFC 5545 requires end date in YYYYMMDD format with no hyphens
      const until = format(recurrence.endDate, 'yyyyMMdd') + 'T235959Z';
      rrule += `;UNTIL=${until}`;
    }
    
    return rrule;
  };
  
  // Set default times based on user preference and previous selections
  useEffect(() => {
    // If a selectedDate is provided, use it to set the initial dates
    if (selectedDate && !event) {
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      setStartDate(dateString);
      setEndDate(dateString);
      
      // For a new event, also set appropriate default times
      const nowHour = new Date().getHours();
      const defaultStartTime = `${String(nowHour).padStart(2, '0')}:00`;
      const defaultEndTime = `${String(nowHour + 1).padStart(2, '0')}:00`;
      
      setStartTime(defaultStartTime);
      setEndTime(defaultEndTime);
    }
  }, [selectedDate, event]);
  
  // Initialize the modal state when an event is provided
  useEffect(() => {
    if (event) {
      // Basic event details
      form.reset({
        title: event.title || '',
        description: event.description || '',
        location: event.location || '',
        calendarId: event.calendarId?.toString() || '',
        allDay: !!event.allDay,
        timezone: event.timezone || 'UTC',
        isBusy: event.busyStatus === 'busy',
        startDate: '',  // Will be set later
        endDate: '',    // Will be set later
        startTime: '',  // Will be set later
        endTime: ''     // Will be set later
      });
      
      // Parse the attendees if available
      if (event.attendees) {
        try {
          // First try using the utility function
          let parsedAttendees = [];
          
          try {
            // Always validate attendees data as array of attendee objects
            const attendeesData = typeof event.attendees === 'string' 
              ? JSON.parse(event.attendees) 
              : event.attendees;
            
            if (Array.isArray(attendeesData)) {
              parsedAttendees = attendeesData.map(attendee => {
                // Ensure each attendee has minimum required fields
                if (!attendee.id) {
                  attendee.id = uuidv4();
                }
                
                if (!attendee.role) {
                  attendee.role = 'Member';
                }
                
                return attendee;
              });
            }
          } catch (parseError) {
            console.error("Error parsing attendees:", parseError);
            // If parsing fails, set empty array as fallback
            parsedAttendees = [];
          }
          
          setAttendees(parsedAttendees);
        } catch (error) {
          console.error("Failed to parse attendees:", error);
          setAttendees([]);
        }
      } else {
        setAttendees([]);
      }
      
      // Parse the resources if available
      if (event.resources) {
        try {
          // Try to handle both string and array formats
          let parsedResources = [];
          
          if (typeof event.resources === 'string') {
            try {
              // First try to parse as JSON
              parsedResources = JSON.parse(event.resources);
            } catch (jsonError) {
              // If not valid JSON, assume comma-separated list
              try {
                parsedResources = event.resources.split(',').map(r => r.trim());
              } catch (splitError) {
                console.error("Error parsing resources as list:", splitError);
                parsedResources = [];
              }
            }
          } else if (Array.isArray(event.resources)) {
            // Already an array
            parsedResources = event.resources;
          }
          
          setResources(parsedResources);
        } catch (error) {
          console.error("Failed to parse resources:", error);
          setResources([]);
        }
      } else {
        setResources([]);
      }
      
      // Parse the recurrence rule if available
      if (event.recurrenceRule) {
        try {
          // Use parseRRULEFromEvent instead of useRRuleFromString (which is a hook)
          const parsedRecurrence = parseRRULEFromEvent(event);
          setRecurrence(parsedRecurrence);
        } catch (error) {
          console.error("Failed to parse recurrence rule:", error);
          // Default to no recurrence if parsing fails
          setRecurrence({
            pattern: 'None',
            interval: 1,
            endType: 'Never'
          });
        }
      } else {
        // Default to no recurrence if no rule is provided
        setRecurrence({
          pattern: 'None',
          interval: 1,
          endType: 'Never'
        });
      }
      
      // Handle date and time parsing for existing events
      if (event.startDate && event.endDate) {
        try {
          const startDateTime = new Date(event.startDate);
          const endDateTime = new Date(event.endDate);
          
          if (isValid(startDateTime) && isValid(endDateTime)) {
            // Format dates for input fields
            const formattedStartDate = format(startDateTime, 'yyyy-MM-dd');
            let formattedEndDate = '';
            let formattedStartTime = '';
            let formattedEndTime = '';
            
            // For all-day events, adjust the end date display
            // RFC 5545 specifies end date is exclusive for all-day events
            // So we subtract 1 day from the end date for display purposes
            if (event.allDay) {
              // If the event is an all-day event, subtract 1 day from the end date
              // because the RFC 5545 standard sets the end date as exclusive
              const adjustedEndDate = addDays(endDateTime, -1);
              formattedEndDate = format(adjustedEndDate, 'yyyy-MM-dd');
              
              // For all-day events, don't set times (they aren't used)
              formattedStartTime = '00:00';
              formattedEndTime = '23:59';
              
              console.log(`[DATE DEBUG] All-day event date processing:`, {
                originalStart: startDateTime,
                originalEnd: endDateTime,
                formattedStart: formattedStartDate,
                adjustedEnd: adjustedEndDate,
                formattedEnd: formattedEndDate,
              });
            } else {
              // Regular event (not all-day) - use end date as is
              formattedEndDate = format(endDateTime, 'yyyy-MM-dd');
              
              // For regular events, also set the times
              formattedStartTime = format(startDateTime, 'HH:mm');
              formattedEndTime = format(endDateTime, 'HH:mm');
              
              console.log(`[DATE DEBUG] Regular event time processing:`, {
                originalStart: startDateTime,
                originalEnd: endDateTime,
                formattedStart: formattedStartDate,
                formattedEnd: formattedEndDate,
                startTime: formattedStartTime,
                endTime: formattedEndTime,
              });
            }
            
            // Update form with the date and time values
            form.setValue('startDate', formattedStartDate);
            form.setValue('endDate', formattedEndDate);
            form.setValue('startTime', formattedStartTime);
            form.setValue('endTime', formattedEndTime);
          } else {
            throw new Error('Invalid date format in event');
          }
        } catch (dateError) {
          console.error("Error processing event dates:", dateError);
          
          // Set fallback values for dates and times
          const today = new Date();
          const formattedToday = format(today, 'yyyy-MM-dd');
          
          // Update form with default date and time values
          form.setValue('startDate', formattedToday);
          form.setValue('endDate', formattedToday);
          form.setValue('startTime', '12:00');
          form.setValue('endTime', '13:00');
          
          // Show notification about date format issue
          toast({
            title: 'Date Format Issue',
            description: 'Could not parse event dates. Default values have been set.',
            variant: 'destructive'
          });
        }
      }
    } else {
      // For new events, set default values if selectedDate is not provided
      if (!selectedDate) {
        const now = new Date();
        const formattedDate = format(now, 'yyyy-MM-dd');
        const hourNow = now.getHours();
        const hourNext = hourNow < 23 ? hourNow + 1 : 23;
        const startTime = `${String(hourNow).padStart(2, '0')}:00`;
        const endTime = `${String(hourNext).padStart(2, '0')}:00`;
        
        // Update form with default date and time values
        form.setValue('startDate', formattedDate);
        form.setValue('endDate', formattedDate);
        form.setValue('startTime', startTime);
        form.setValue('endTime', endTime);
        
        console.log(`[DATE DEBUG] Form values set with industry standard defaults:`, {
          startDate: formattedDate,
          endDate: formattedDate,
          startTime: startTime,
          endTime: endTime,
        });
      }
      
      // For new events, default to the first available calendar
      if (calendars && calendars.length > 0 && !form.getValues('calendarId')) {
        const primaryCalendar = calendars.find(cal => cal.isPrimary);
        if (primaryCalendar) {
          form.setValue('calendarId', primaryCalendar.id.toString());
        } else if (calendars[0]) {
          form.setValue('calendarId', calendars[0].id.toString());
        }
      }
      
      // Always add the current user as an attendee if we're creating a new event
      if (user && attendees.length === 0) {
        const defaultAttendees = [{
          id: uuidv4(),
          email: user.email,
          name: user.name || '',
          role: 'Chairman' // Default the creator to Chairman
        }];
        setAttendees(defaultAttendees);
        form.setValue('attendees', defaultAttendees);
      }
      
      // Set default values for other form fields
      form.setValue('title', '');
      form.setValue('description', '');
      form.setValue('location', '');
      form.setValue('allDay', false);
      form.setValue('timezone', 'UTC');
      form.setValue('isBusy', true);
      form.setValue('resources', []);
      form.setValue('recurrence', {
        pattern: 'None',
        interval: 1,
        endType: 'Never'
      });
      form.setValue('sendEmails', true);
    }
    
    // Reset form errors
    setErrors({});
    
    // Reset loading states
    setIsSubmitting(false);
    setIsDeleting(false);
    
    // Always start on the basic tab
    setActiveTab('basic');
  }, [event, selectedDate, calendars, user, toast]);
  
  // Validate the form before submission
  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    // Basic validation
    if (!title.trim()) {
      newErrors.title = 'Title is required';
    }
    
    if (!calendarId) {
      newErrors.calendarId = 'Calendar is required';
    }
    
    if (!startDate) {
      newErrors.startDate = 'Start date is required';
    }
    
    if (!endDate) {
      newErrors.endDate = 'End date is required';
    }
    
    if (!allDay) {
      if (!startTime) {
        newErrors.startTime = 'Start time is required';
      }
      
      if (!endTime) {
        newErrors.endTime = 'End time is required';
      }
      
      // Check if end time is before start time on the same day
      if (startDate === endDate && startTime && endTime) {
        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const [endHours, endMinutes] = endTime.split(':').map(Number);
        
        if (endHours < startHours || (endHours === startHours && endMinutes < startMinutes)) {
          newErrors.endTime = 'End time must be after start time';
        }
      }
    }
    
    // Validate recurrence
    if (recurrence.pattern !== 'None') {
      if (recurrence.interval < 1) {
        newErrors.recurrenceInterval = 'Interval must be at least 1';
      }
      
      if (recurrence.pattern === 'Weekly' && (!recurrence.weekdays || recurrence.weekdays.length === 0)) {
        newErrors.recurrenceWeekdays = 'At least one weekday must be selected';
      }
      
      if (recurrence.pattern === 'Monthly' && (!recurrence.dayOfMonth || recurrence.dayOfMonth < 1 || recurrence.dayOfMonth > 31)) {
        newErrors.recurrenceDayOfMonth = 'Day of month must be between 1 and 31';
      }
      
      if (recurrence.endType === 'After' && (!recurrence.occurrences || recurrence.occurrences < 1)) {
        newErrors.recurrenceOccurrences = 'Number of occurrences must be at least 1';
      }
      
      if (recurrence.endType === 'On' && !recurrence.endDate) {
        newErrors.recurrenceEndDate = 'End date is required';
      }
    }
    
    // Validate attendees
    for (let i = 0; i < attendees.length; i++) {
      const attendee = attendees[i];
      
      if (!attendee.email) {
        newErrors[`attendee_${i}_email`] = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.email)) {
        newErrors[`attendee_${i}_email`] = 'Invalid email format';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  // Group errors by tab for UI indication
  const getErrorsByTab = (errors: Record<string, string>) => {
    const result = {
      basic: false,
      attendees: false,
      resources: false,
      recurrence: false,
      emails: false
    };
    
    // Check for errors in basic tab fields
    const basicFields = ['title', 'calendarId', 'startDate', 'endDate', 'startTime', 'endTime'];
    result.basic = basicFields.some(field => field in errors);
    
    // Check for errors in attendees tab
    result.attendees = Object.keys(errors).some(key => key.startsWith('attendee_'));
    
    // Check for errors in resources tab
    result.resources = Object.keys(errors).some(key => key.startsWith('resource_'));
    
    // Check for errors in recurrence tab
    const recurrenceFields = ['recurrenceInterval', 'recurrenceWeekdays', 'recurrenceDayOfMonth', 'recurrenceOccurrences', 'recurrenceEndDate'];
    result.recurrence = recurrenceFields.some(field => field in errors);
    
    // Check for errors in emails tab
    result.emails = Object.keys(errors).some(key => key.startsWith('email_'));
    
    return result;
  };
  
  // Handler for submitting the form
  const handleSubmit = async () => {
    if (!validateForm()) {
      // If there are errors, check which tab has errors and switch to it
      const tabErrors = getErrorsByTab(errors);
      
      // Find the first tab with errors
      if (tabErrors.basic) {
        setActiveTab('basic');
      } else if (tabErrors.attendees) {
        setActiveTab('attendees');
      } else if (tabErrors.resources) {
        setActiveTab('resources');
      } else if (tabErrors.recurrence) {
        setActiveTab('recurrence');
      } else if (tabErrors.emails) {
        setActiveTab('emails');
      }
      
      return; // Stop form submission
    }
    
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
          
          // Add 1 day to the end date for all-day events (per RFC 5545 requirements)
          // This ensures the event ends at midnight of the following day
          endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
          
          console.log(`[CRITICAL DATE DEBUG] All-day event end date breakdown:`, {
            date: endDate,
            year: endYear,
            month: endMonth,
            monthForJS: endMonth - 1,
            day: endDay,
            dayAdjusted: endDay + 1, // Added 1 day for RFC 5545 compliance
            createdDateUTC: endDateTime.toUTCString(),
            createdDateISO: endDateTime.toISOString(),
            createdDateLocal: endDateTime.toString()
          });
        } else {
          // For time-specific events, we need to handle the timezone explicitly
          // Create a DateTime string that combines date and time with the user's preferred timezone
          startDateTime = new Date(`${startDate}T${startTime}:00${timezone === 'UTC' ? 'Z' : ''}`);
          endDateTime = new Date(`${endDate}T${endTime}:00${timezone === 'UTC' ? 'Z' : ''}`);
          
          console.log(`[CRITICAL DATE DEBUG] Time-specific event date creation:`, {
            startRaw: `${startDate}T${startTime}:00`,
            endRaw: `${endDate}T${endTime}:00`,
            timezone,
            startCreated: startDateTime.toISOString(),
            endCreated: endDateTime.toISOString()
          });
        }
        
        // Final validation of dates
        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
          throw new Error(`Invalid date values: Start ${startDateTime} or End ${endDateTime} resulted in NaN timestamps`);
        }
      } catch (dateError) {
        console.error("Date parsing error:", dateError);
        toast({
          title: 'Invalid Date',
          description: 'Could not process the date values. Please check your inputs.',
          variant: 'destructive'
        });
        setIsSubmitting(false);
        return;
      }
      
      // Serialize attendees and resources for storage
      const attendeesJson = attendees.length > 0 ? JSON.stringify(attendees) : null;
      // Resources should already be an array
      
      // Check for recurrence rule and convert to proper format
      const isRecurringEvent = recurrence.pattern !== 'None';
      
      // Create a sanitized RRULE for RFC 5545 compliance
      let recurrenceRule = null;
      if (isRecurringEvent) {
        // Generate the standardized recurrence rule string
        recurrenceRule = generateRRuleString(recurrence);
        console.log(`[RECURRENCE] Generated RFC 5545 RRULE: ${recurrenceRule}`);
      }
      
      // Determine the correct UID for the event
      let eventUID: string;
      
      try {
        // If the event already exists, keep the same UID
        if (event && event.uid) {
          eventUID = event.uid;
        }
        // For a new event, generate a new UID
        else {
          // Use the hook to get a new RFC-compliant UID
          const newUID = await getOrGenerateUID('event');
          
          if (!newUID) {
            throw new Error('Failed to generate a valid UID');
          }
          
          eventUID = newUID;
        }
        
        if (!eventUID) {
          throw new Error('Failed to get or create a valid UID for the event');
        }
      } catch (uidError) {
        console.error('Error managing event UID:', uidError);
        toast({
          title: 'Error',
          description: 'Failed to generate a unique ID for the event. Please try again.',
          variant: 'destructive'
        });
        setIsSubmitting(false);
        return;
      }

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
        resources: resources.length > 0 ? resources : null,
        recurrenceRule,
        isRecurring: isRecurringEvent, // Set the recurring flag explicitly
        syncStatus: 'pending', // Mark as pending for immediate sync
        // Use the UID we determined above
        uid: eventUID,
      };
      
      // Handle existing events or copies
      if (event) {
        // Check if this is a copy operation by looking for "Copy of" in the title
        const isCopyEvent = title.startsWith('Copy of ');
        
        if (isCopyEvent) {
          console.log("Creating a new event from copy", { title, eventUID });
          
          try {
            // For copied events, prepare complete event data
            const newEventData = {
              ...eventData,
              etag: null,
              url: null,
              rawData: null,
              syncError: null,
              lastSyncAttempt: null,
              emailSent: null,
              emailError: null,
              lastModifiedBy: null, 
              lastModifiedByName: null,
              lastModifiedAt: null,
            };
            
            // Create the new event
            await createEvent(newEventData);
            
            // Creation successful - refresh events and close modal
            queryClient.invalidateQueries({ queryKey: ['/api/events'] });
            
            toast({
              title: "Event Copy Created",
              description: "The event copy was created successfully.",
            });
            
            onClose();
          } catch (createError) {
            console.error("Failed to create event copy:", createError);
            throw createError; // Will be caught by the outer catch block
          }
        } else {
          // Regular update of an existing event
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
      } else {
        // Handle new event creation
        try {
          // For new events, we need to prepare the full event data
          // User auth context is already available at the component level
          
          const newEventData = {
            ...eventData,
            // Include mandatory fields with null/default values to match schema requirements
            etag: null,
            url: null,
            rawData: null,
            syncError: null,
            lastSyncAttempt: null,
            emailSent: null,
            emailError: null,
            // Add required properties for the type validation
            lastModifiedBy: null, 
            lastModifiedByName: null,
            lastModifiedAt: null,
            // Frontend should not set these - let the backend handle it with actual authenticated user
            // This ensures consistent handling of modification tracking
          };
          
          // Debug log for missing fields
          console.log('[EVENT CREATE DEBUG] Complete new event data:', newEventData);
          
          // Create the new event
          // Call the mutation and properly typecast the result
          // This ensures TypeScript understands the return value structure
          const response = await createEvent(newEventData);
          const createdEvent = response as unknown as Event;
          
          // After successful creation, store the UID mapping in IndexedDB for future reference
          // The createEvent mutation returns the created event with an ID
          if (createdEvent && createdEvent.id) {
            try {
              // Use the storeUID function from our enhanced useEventUID hook
              // which only requires eventId and uid (calendarId is not needed)
              await storeUID(createdEvent.id, eventUID);
              console.log(`Stored UID mapping for new event:`, {
                eventId: createdEvent.id,
                uid: eventUID
              });
            } catch (storageError) {
              // Log the error but don't block the event creation
              console.error('Failed to store UID mapping:', storageError);
            }
          }
          
          // Refresh the events list and close modal
          queryClient.invalidateQueries({ queryKey: ['/api/events'] });
          onClose();
        } catch (createError) {
          console.error("Failed to create event:", createError);
          throw createError; // Will be caught by the outer catch block
        }
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
  
  // Handler for Cancel Event action - opens a dialog to confirm cancellation
  const handleCancelEvent = () => {
    // Only allow cancellation if there are attendees
    if (!event || !event.id) {
      return;
    }
    
    if (attendees.length === 0) {
      toast({
        title: "Cannot Cancel Event",
        description: "Event cancellation is only available for events with attendees.",
        variant: "destructive"
      });
      return;
    }
    
    // Open the confirmation dialog
    setShowCancelDialog(true);
  };
  
  // Execute actual cancellation
  const executeCancellation = async () => {
    if (!event || !event.id || isCancelling) return;
    
    setIsCancelling(true);
    
    try {
      // Call the cancelEvent mutation from useCalendarEvents hook
      await cancelEvent(event.id);
      setShowCancelDialog(false);
      
      toast({
        title: "Event Canceled",
        description: "The event has been canceled and attendees have been notified."
      });
      
      // Refresh the events list
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Close the modal
      onClose();
    } catch (error: any) {
      console.error('Error cancelling event:', error);
      toast({
        title: "Cancellation Failed",
        description: error.message || "Failed to cancel the event. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsCancelling(false);
    }
  };
  
  // Handler for adding a new attendee
  const handleAddAttendee = () => {
    if (!newAttendeeEmail) {
      setErrors({
        ...errors,
        newAttendeeEmail: 'Email is required'
      });
      return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newAttendeeEmail)) {
      setErrors({
        ...errors,
        newAttendeeEmail: 'Invalid email format'
      });
      return;
    }
    
    // Check for duplicates
    if (attendees.some(a => a.email.toLowerCase() === newAttendeeEmail.toLowerCase())) {
      setErrors({
        ...errors,
        newAttendeeEmail: 'Attendee already added'
      });
      return;
    }
    
    const newAttendee: Attendee = {
      id: uuidv4(),
      email: newAttendeeEmail,
      name: newAttendeeName || undefined,
      role: newAttendeeRole
    };
    
    setAttendees([...attendees, newAttendee]);
    setNewAttendeeEmail('');
    setNewAttendeeName('');
    setNewAttendeeRole('Member');
    
    // Clear any errors
    const { newAttendeeEmail: _, ...rest } = errors;
    setErrors(rest);
  };
  
  // Handler for removing an attendee
  const handleRemoveAttendee = (id: string) => {
    setAttendees(attendees.filter(a => a.id !== id));
  };
  
  // Handler for updating an attendee's role
  const handleUpdateAttendeeRole = (id: string, role: AttendeeRole) => {
    setAttendees(attendees.map(a => 
      a.id === id ? { ...a, role } : a
    ));
  };
  
  // Handler for adding a new resource
  const handleAddResource = () => {
    if (!newResource) {
      setErrors({
        ...errors,
        newResource: 'Resource name is required'
      });
      return;
    }
    
    // Check for duplicates
    if (resources.some(r => r.toLowerCase() === newResource.toLowerCase())) {
      setErrors({
        ...errors,
        newResource: 'Resource already added'
      });
      return;
    }
    
    setResources([...resources, newResource]);
    setNewResource('');
    
    // Clear any errors
    const { newResource: _, ...rest } = errors;
    setErrors(rest);
  };
  
  // Handler for removing a resource
  const handleRemoveResource = (index: number) => {
    const newResources = [...resources];
    newResources.splice(index, 1);
    setResources(newResources);
  };
  
  // Select a description template
  const handleSelectTemplate = (template: DescriptionTemplate) => {
    setDescription(template.content);
  };
  
  // Handler for form cancellation
  const handleCancel = () => {
    onClose();
  };
  
  // Determine if the form has been modified
  const isFormModified = () => {
    // For existing events, check if values have changed
    if (event) {
      return (
        title !== (event.title || '') ||
        description !== (event.description || '') ||
        location !== (event.location || '') ||
        calendarId !== (event.calendarId?.toString() || '') ||
        allDay !== !!event.allDay ||
        timezone !== (event.timezone || 'UTC') ||
        (isBusy ? 'busy' : 'free') !== event.busyStatus
        // Omitting deeper objects like attendees, resources, and dates for simplicity
      );
    }
    
    // For new events, check if values have been entered
    return (
      !!title ||
      !!description ||
      !!location ||
      recurrence.pattern !== 'None' ||
      attendees.length > 1 || // More than just the creator
      resources.length > 0
    );
  };
  
  // Determine the form title based on whether we're editing or creating
  const formTitle = event
    ? `Edit: ${event.title}`
    : 'Create New Event';
  
  // Determine the submit button text based on event state
  const getSubmitButtonText = () => {
    if (isSubmitting) {
      return 'Saving...';
    }
    
    if (event) {
      // Check if this is a copy operation
      if (title.startsWith('Copy of ')) {
        return 'Create Copy';
      }
      return 'Update Event';
    }
    
    return 'Create Event';
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => {
        if (!open) onClose();
      }}>
        <DialogContent className="sm:max-w-[950px] max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-background to-background/95 border-[0.5px] border-primary/10 shadow-xl">
          <FormProvider {...form}>
            <DialogHeader className="pb-4 border-b">
              <DialogTitle className="flex items-center gap-2 text-lg">
                {event ? (
                  <>
                    <span className="text-primary">{form.getValues('title') || 'Event Details'}</span>
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
            <div className="w-full border-b bg-gray-50 p-2">
              {/* Calculate which tabs have errors for our indicators */}
              {(() => {
                // Get error states for all tabs
                const tabErrors = getErrorsByTab(errors);
                
                return (
                  <TabsList className="flex flex-wrap h-auto min-h-12 w-full justify-evenly rounded-lg overflow-visible gap-1 p-1 bg-muted/20 border border-muted/30">
                    <TabsTrigger 
                      value="basic" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 ${form.getValues('title') || form.getValues('location') || form.getValues('description') ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.basic ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                    >
                      {tabErrors.basic && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Calendar className={`h-4 w-4 ${form.getValues('title') || form.getValues('location') || form.getValues('description') ? 'text-primary' : ''} ${tabErrors.basic ? 'text-red-500' : ''}`} />
                      <span className={tabErrors.basic ? 'text-red-500 font-medium' : ''}>Details</span>
                    </TabsTrigger>
                    
                    <TabsTrigger 
                      value="attendees" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 ${attendees.length > 0 ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.attendees ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                    >
                      {tabErrors.attendees && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Users className={`h-4 w-4 ${attendees.length > 0 ? 'text-primary' : ''} ${tabErrors.attendees ? 'text-red-500' : ''}`} />
                      <span className={tabErrors.attendees ? 'text-red-500 font-medium' : ''}>Attendees</span>
                    </TabsTrigger>
                    
                    <TabsTrigger 
                      value="resources" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 ${resources.length > 0 ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.resources ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                    >
                      {tabErrors.resources && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Package className={`h-4 w-4 ${resources.length > 0 ? 'text-primary' : ''} ${tabErrors.resources ? 'text-red-500' : ''}`} />
                      <span className={tabErrors.resources ? 'text-red-500 font-medium' : ''}>Resources</span>
                    </TabsTrigger>
                    
                    <TabsTrigger 
                      value="recurrence" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 ${recurrence.pattern !== 'None' ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.recurrence ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                    >
                      {tabErrors.recurrence && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Repeat className={`h-4 w-4 ${recurrence.pattern !== 'None' ? 'text-primary' : ''} ${tabErrors.recurrence ? 'text-red-500' : ''}`} />
                      <span className={tabErrors.recurrence ? 'text-red-500 font-medium' : ''}>Recurrence</span>
                    </TabsTrigger>
                    
                    <TabsTrigger 
                      value="emails" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 relative ${attendees.length > 0 ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.emails ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                      disabled={attendees.length === 0}
                    >
                      {tabErrors.emails && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Mail className={`h-4 w-4 ${attendees.length > 0 ? 'text-primary' : ''} ${tabErrors.emails ? 'text-red-500' : ''}`} />
                      <span className={tabErrors.emails ? 'text-red-500 font-medium' : ''}>Email</span>
                    </TabsTrigger>
                  </TabsList>
                );
              })()}
              
            </div>
            
            <ScrollArea className="flex-1 p-4 overflow-y-auto">
              <TabsContent value="basic" className="mt-2 min-h-[50vh]">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel htmlFor="title" className="text-sm font-medium">
                              Title
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                id="title"
                                placeholder="Event title"
                                className={form.formState.errors.title ? 'border-red-500' : ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <FormLabel htmlFor="calendar" className="text-sm font-medium">
                        Calendar
                      </FormLabel>
                      <Select 
                        value={form.getValues('calendarId')} 
                        onValueChange={(value) => form.setValue('calendarId', value)}>
                        <SelectTrigger 
                          className={`w-full ${errors.calendarId ? 'border-red-500' : ''}`}
                        >
                          <SelectValue placeholder="Select a calendar" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Available Calendars</SelectLabel>
                            {calendars?.map(calendar => (
                              <SelectItem 
                                key={calendar.id} 
                                value={calendar.id.toString()}
                                className="flex items-center gap-2"
                              >
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: calendar.color || '#4285F4' }} 
                                  />
                                  {calendar.name}
                                  {calendar.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {errors.calendarId && (
                        <p className="text-xs text-red-500">{errors.calendarId}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <FormLabel htmlFor="location" className="text-sm font-medium">
                        Location
                      </FormLabel>
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                {...field}
                                id="location"
                                placeholder="Event location (optional)"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <FormLabel htmlFor="description" className="text-sm font-medium flex justify-between items-center">
                        <span>Description</span>
                        
                        {descriptionTemplates.length > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <span>Templates</span>
                                <ChevronRight className="h-3 w-3 ml-1" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80">
                              <div className="space-y-2">
                                <h4 className="font-medium text-sm">Description Templates</h4>
                                <div className="max-h-60 overflow-y-auto space-y-1">
                                  {descriptionTemplates.map(template => (
                                    <Button
                                      key={template.id}
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-start font-normal text-xs h-auto py-2"
                                      onClick={() => handleSelectTemplate(template)}
                                    >
                                      {template.name}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </FormLabel>
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Textarea
                                {...field}
                                id="description"
                                placeholder="Event description (optional)"
                                className="min-h-[100px]"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="allDay" 
                        checked={allDay} 
                        onCheckedChange={checked => {
                          setAllDay(!!checked);
                          // If switching to all-day, set appropriate times
                          if (checked) {
                            setStartTime('00:00');
                            setEndTime('23:59');
                          } else {
                            // If switching to timed event, set reasonable default times
                            const now = new Date();
                            const hour = now.getHours();
                            setStartTime(`${String(hour).padStart(2, '0')}:00`);
                            setEndTime(`${String(hour + 1).padStart(2, '0')}:00`);
                          }
                        }}
                      />
                      <FormLabel htmlFor="allDay" className="text-sm font-medium">
                        All-day event
                      </FormLabel>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <FormLabel htmlFor="startDate" className="text-sm font-medium">
                          Start
                        </FormLabel>
                        <div className="flex flex-col md:flex-row gap-2">
                          <div className="flex-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={`w-full justify-start text-left font-normal ${errors.startDate ? 'border-red-500' : ''}`}
                                >
                                  <CalendarIcon className="h-4 w-4 mr-2" />
                                  {startDate ? format(new Date(startDate), 'PPP') : <span>Pick a date</span>}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={startDate ? new Date(startDate) : undefined}
                                  onSelect={date => {
                                    if (date) {
                                      const formattedDate = format(date, 'yyyy-MM-dd');
                                      setStartDate(formattedDate);
                                      
                                      // If end date is before start date, update it
                                      if (endDate) {
                                        const endD = new Date(endDate);
                                        const startD = date;
                                        if (endD < startD) {
                                          setEndDate(formattedDate);
                                        }
                                      } else {
                                        // If no end date set, make it same as start
                                        setEndDate(formattedDate);
                                      }
                                      
                                      // Clear any date-related errors
                                      const { startDate: _, ...rest } = errors;
                                      setErrors(rest);
                                    }
                                  }}
                                />
                              </PopoverContent>
                            </Popover>
                            {errors.startDate && (
                              <p className="text-xs text-red-500 mt-1">{errors.startDate}</p>
                            )}
                          </div>
                          
                          {!allDay && (
                            <div className="w-full md:w-24">
                              <Input
                                type="time"
                                value={startTime}
                                onChange={e => {
                                  const time = e.target.value;
                                  setStartTime(time);
                                  
                                  // If end time is earlier than start time on same day, adjust it
                                  if (startDate === endDate) {
                                    const [startHour, startMinute] = time.split(':').map(Number);
                                    const [endHour, endMinute] = endTime.split(':').map(Number);
                                    
                                    if (endHour < startHour || (endHour === startHour && endMinute <= startMinute)) {
                                      // Calculate a new end time 1 hour after start
                                      let newEndHour = startHour + 1;
                                      if (newEndHour > 23) {
                                        newEndHour = 23;
                                        setEndTime(`${newEndHour}:${startMinute}`);
                                      } else {
                                        setEndTime(`${String(newEndHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`);
                                      }
                                      
                                      console.log(`[CRITICAL DATE DEBUG] Automatically adjusted end time to be after start time`);
                                    }
                                  }
                                  
                                  // Clear any time-related errors
                                  const { startTime: _, ...rest } = errors;
                                  setErrors(rest);
                                }}
                                className={errors.startTime ? 'border-red-500' : ''}
                              />
                              {errors.startTime && (
                                <p className="text-xs text-red-500 mt-1">{errors.startTime}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <FormLabel htmlFor="endDate" className="text-sm font-medium">
                          End
                        </FormLabel>
                        <div className="flex flex-col md:flex-row gap-2">
                          <div className="flex-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={`w-full justify-start text-left font-normal ${errors.endDate ? 'border-red-500' : ''}`}
                                >
                                  <CalendarIcon className="h-4 w-4 mr-2" />
                                  {endDate ? format(new Date(endDate), 'PPP') : <span>Pick a date</span>}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={endDate ? new Date(endDate) : undefined}
                                  onSelect={date => {
                                    if (date) {
                                      const formattedDate = format(date, 'yyyy-MM-dd');
                                      
                                      // Check if end date is before start date
                                      if (startDate) {
                                        const startD = new Date(startDate);
                                        if (date < startD) {
                                          // If user selects end date before start, change both
                                          setStartDate(formattedDate);
                                        }
                                      } else {
                                        // If no start date, set it to same as end
                                        setStartDate(formattedDate);
                                      }
                                      
                                      setEndDate(formattedDate);
                                      
                                      // Clear any date-related errors
                                      const { endDate: _, ...rest } = errors;
                                      setErrors(rest);
                                    }
                                  }}
                                  // Only allow dates on or after the start date
                                  fromDate={startDate ? new Date(startDate) : undefined}
                                />
                              </PopoverContent>
                            </Popover>
                            {errors.endDate && (
                              <p className="text-xs text-red-500 mt-1">{errors.endDate}</p>
                            )}
                          </div>
                          
                          {!allDay && (
                            <div className="w-full md:w-24">
                              <Input
                                type="time"
                                value={endTime}
                                onChange={e => {
                                  const time = e.target.value;
                                  // Check if end time is valid compared to start time
                                  if (startDate === endDate) {
                                    const [startHour, startMinute] = startTime.split(':').map(Number);
                                    const [endHour, endMinute] = time.split(':').map(Number);
                                    
                                    if (endHour < startHour || (endHour === startHour && endMinute <= startMinute)) {
                                      // If end time is invalid, set a default 1 hour after start
                                      let newEndHour = startHour + 1;
                                      if (newEndHour > 23) {
                                        newEndHour = 23;
                                        const newTime = `${newEndHour}:${startMinute}`;
                                        setEndTime(newTime);
                                        
                                        console.log(`[CRITICAL DATE DEBUG] Automatically adjusted invalid end time:`, {
                                          attemptedEndTime: time,
                                          startTime,
                                          correctedEndTime: newTime
                                        });
                                        
                                        // Show notification about automatic adjustment
                                        toast({
                                          title: 'End time adjusted',
                                          description: 'End time must be after start time.',
                                        });
                                        
                                        return;
                                      }
                                    }
                                  }
                                  
                                  setEndTime(time);
                                  
                                  // Clear any time-related errors
                                  const { endTime: _, ...rest } = errors;
                                  setErrors(rest);
                                }}
                                className={errors.endTime ? 'border-red-500' : ''}
                              />
                              {errors.endTime && (
                                <p className="text-xs text-red-500 mt-1">{errors.endTime}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      <div className="space-y-2">
                        <FormLabel htmlFor="timezone" className="text-sm font-medium">
                          Timezone
                        </FormLabel>
                        <Select value={timezone} onValueChange={setTimezone} disabled={allDay}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Common Timezones</SelectLabel>
                              <SelectItem value="UTC">UTC</SelectItem>
                              <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                              <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                              <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                              <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                              <SelectItem value="Europe/London">London (GMT)</SelectItem>
                              <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                              <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                              <SelectItem value="Australia/Sydney">Sydney (AEST)</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {allDay && (
                          <p className="text-xs text-muted-foreground">Timezone is fixed to UTC for all-day events per RFC 5545.</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <FormLabel htmlFor="busy-status" className="text-sm font-medium">
                          Status
                        </FormLabel>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Checkbox 
                              id="busy" 
                              checked={isBusy} 
                              onCheckedChange={checked => setIsBusy(!!checked)}
                            />
                            <FormLabel htmlFor="busy" className="text-sm">
                              Show as busy
                            </FormLabel>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="attendees" className="mt-2 min-h-[50vh]">
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium">Attendees</h3>
                      <p className="text-sm text-muted-foreground">
                        Add people to invite to this event. They will receive an email notification.
                      </p>
                    </div>
                    
                    <div className="flex flex-col md:flex-row gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder="Email address"
                          value={newAttendeeEmail}
                          onChange={e => setNewAttendeeEmail(e.target.value)}
                          className={errors.newAttendeeEmail ? 'border-red-500' : ''}
                        />
                        {errors.newAttendeeEmail && (
                          <p className="text-xs text-red-500 mt-1">{errors.newAttendeeEmail}</p>
                        )}
                      </div>
                      
                      <div className="flex-1">
                        <Input
                          placeholder="Name (optional)"
                          value={newAttendeeName}
                          onChange={e => setNewAttendeeName(e.target.value)}
                        />
                      </div>
                      
                      <div className="w-full md:w-32">
                        <Select value={newAttendeeRole} onValueChange={value => setNewAttendeeRole(value as AttendeeRole)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Chairman">Chairman</SelectItem>
                            <SelectItem value="Secretary">Secretary</SelectItem>
                            <SelectItem value="Member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <Button onClick={handleAddAttendee} type="button" className="w-full md:w-auto">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add
                      </Button>
                    </div>
                    
                    <div className="border rounded-md">
                      {attendees.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground">
                          No attendees added yet.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Email</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead className="w-20">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {attendees.map(attendee => (
                              <TableRow key={attendee.id}>
                                <TableCell>{attendee.email}</TableCell>
                                <TableCell>{attendee.name || '-'}</TableCell>
                                <TableCell>
                                  <Select 
                                    value={attendee.role} 
                                    onValueChange={value => handleUpdateAttendeeRole(attendee.id, value as AttendeeRole)}
                                  >
                                    <SelectTrigger className="h-8 w-28">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Chairman">Chairman</SelectItem>
                                      <SelectItem value="Secretary">Secretary</SelectItem>
                                      <SelectItem value="Member">Member</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleRemoveAttendee(attendee.id)}
                                    className="h-8 w-8"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
          
          <DialogFooter className="px-4 py-4 border-t flex-col sm:flex-row gap-2">
            <div className="flex gap-2 ml-auto">
              {/* Delete button - only show for existing events that are not copies */}
              {event && !title.startsWith('Copy of ') && (
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isSubmitting || isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash className="h-4 w-4 mr-2" />
                  )}
                  Delete
                </Button>
              )}
              
              {/* Cancel button - only show for existing events with attendees that are not copies */}
              {event && attendees.length > 0 && !title.startsWith('Copy of ') && (
                <Button
                  variant="outline"
                  onClick={handleCancelEvent}
                  disabled={isSubmitting || isDeleting || isCancelling}
                  className="border-amber-500 text-amber-600 hover:bg-amber-50"
                >
                  {isCancelling ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BellRing className="h-4 w-4 mr-2" />
                  )}
                  Cancel Event
                </Button>
              )}
              
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {getSubmitButtonText()}
              </Button>
            </div>
          </DialogFooter>
          </FormProvider>
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
              className="bg-red-500 text-white hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Cancel Event Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Event</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the event as canceled and send notifications to all attendees.
              The event will remain visible in the calendar but will be displayed as canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Nevermind</AlertDialogCancel>
            <AlertDialogAction 
              onClick={executeCancellation}
              className="bg-amber-500 text-white hover:bg-amber-600"
            >
              Yes, Cancel Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ImprovedEventFormModal;