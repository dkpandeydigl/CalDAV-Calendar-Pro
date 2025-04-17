import React, { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DescriptionEditor from '@/components/description/DescriptionEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { getTimezones } from '@/lib/date-utils';
import { apiRequest } from '@/lib/queryClient';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { useSharedCalendars } from '@/hooks/useSharedCalendars';
import { useEventUID } from '@/hooks/useEventUID';
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
  Info,
  Fingerprint
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
import { extractResourcesFromEvent } from '@/lib/resource-utils';
// Removed DirectResourceExtractor import - now using our enhanced resource extraction function
import { parseResourcesFromEvent } from '@/utils/resourceUtils';
import type { Event } from '@shared/schema';
import { 
  PREDEFINED_TEMPLATES, 
  loadCustomTemplates, 
  saveCustomTemplate, 
  type DescriptionTemplate 
} from '@/components/description/templates';
import SavedTemplateManager from '@/components/description/SavedTemplateManager';
// UID persistence hook is already imported above

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
  
  // Use the UID persistence hook with the current event ID
  // This will either retrieve an existing UID or generate a new one if not found
  const { 
    uid: persistedUID, 
    isLoading: uidLoading, 
    error: uidError, 
    storeUID,
    generateUID,
    loadUID
  } = useEventUID({
    eventId: event?.id,
    uid: event?.uid
  });
  
  // Debug log for UID persistence
  useEffect(() => {
    if (persistedUID) {
      console.log(`[ImprovedEventFormModal] Using persisted UID: ${persistedUID}`, {
        eventId: event?.id,
        eventUID: event?.uid,
        persistedUID,
      });
    }
  }, [persistedUID, event?.id, event?.uid]);
  
  // Filter shared calendars to only include those with edit permissions
  // Filter shared calendars with edit permissions
  const editableSharedCalendars = sharedCalendars.filter(cal => cal.permissionLevel === 'edit');
  
  console.log('Shared calendars:', sharedCalendars);
  console.log('Editable shared calendars:', editableSharedCalendars);
  
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [isBusy, setIsBusy] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isNextDayAdjusted, setIsNextDayAdjusted] = useState<boolean>(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  
  // Advanced form state
  const [activeTab, setActiveTab] = useState('basic');
  
  // Reset to basic tab whenever modal opens
  useEffect(() => {
    if (open) {
      setActiveTab('basic');
    }
  }, [open]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendeeRole, setAttendeeRole] = useState<AttendeeRole>('Member');
  const [resources, setResources] = useState<Resource[]>([]);
  // Enhanced resource extraction function with deduplication
  const extractResourcesFromRawData = (eventData: any) => {
    if (!eventData) return [];
    
    try {
      // Create a Map to track resources by email for deduplication
      const resourceMap = new Map();
      
      // STEP 1: Try to get resources from the event.resources field first (highest priority)
      if (eventData.resources) {
        let parsedResources = [];
        
        if (typeof eventData.resources === 'string') {
          try {
            parsedResources = JSON.parse(eventData.resources);
            console.log('Parsed resources from string JSON:', parsedResources);
          } catch (e) { 
            console.warn('Failed to parse resources JSON string:', e);
          }
        } else if (Array.isArray(eventData.resources)) {
          parsedResources = eventData.resources;
          console.log('Using existing resources array:', parsedResources);
        }
        
        // Add resources to our map for deduplication, preserving ALL properties
        if (Array.isArray(parsedResources) && parsedResources.length > 0) {
          parsedResources.forEach((resource, index) => {
            const email = resource.adminEmail || resource.email; 
            if (email) {
              // Store the complete resource object with all properties intact
              // Just ensure required fields are present
              const resourceWithId = {
                ...resource, // Keep all original properties
                id: resource.id || `resource-${index}-${Date.now()}`,
                name: resource.name || resource.adminName || 'Resource',
                adminEmail: email,
                subType: resource.subType || resource.type || '',
                capacity: resource.capacity || 1
              };
              
              resourceMap.set(email.toLowerCase(), resourceWithId);
              console.log(`Added resource from event.resources: ${email}`, resourceWithId);
            }
          });
        }
      }
      
      // STEP 2: Now extract from VCALENDAR data if available (but don't overwrite existing entries)
      if (eventData.rawData && typeof eventData.rawData === 'string') {
        const rawDataStr = eventData.rawData.toString();
        
        // Use a simple regex to find any ATTENDEE lines containing CUTYPE=RESOURCE
        const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
        const matches = Array.from(rawDataStr.matchAll(resourceRegex));
        
        if (matches && matches.length > 0) {
          console.log(`Found ${matches.length} resource matches in raw data`);
          
          matches.forEach((match: RegExpMatchArray, index) => {
            const fullLine = match[0] || ''; // The complete ATTENDEE line 
            const email = match[1] || ''; // The captured email group
            
            // Skip if we already have this resource by email - PRESERVE EXISTING DATA
            if (email && !resourceMap.has(email.toLowerCase())) {
              // Extract resource name from CN
              const cnMatch = fullLine.match(/CN=([^;:]+)/);
              const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
              
              // Extract resource type
              const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
              const resourceType = typeMatch ? typeMatch[1].trim() : '';
              
              const newResource = {
                id: `resource-${index}-${Date.now()}`,
                name: name,
                adminEmail: email,
                subType: resourceType || 'Projector', // Default to Projector if no type specified
                capacity: 1
              };
              
              resourceMap.set(email.toLowerCase(), newResource);
              console.log(`Added resource from rawData: ${email}`, newResource);
            }
          });
        }
      }
      
      // Convert map back to array
      const result = Array.from(resourceMap.values());
      console.log(`Extracted ${result.length} total resources:`, result);
      return result;
    } catch (error) {
      console.error('Error extracting resources:', error);
      return [];
    }
  };

  // This works around a bug in the rendering by creating a useEffect that runs once
  // and sets the resources directly using our enhanced extraction function
  useEffect(() => {
    if (event && open) {
      console.log('[RESOURCE DEBUG] Event opened for editing:', event);
      console.log('[RESOURCE DEBUG] Raw data in event:', event.rawData);
      
      // Deep inspect the object for resources anywhere in the structure
      if (event.rawData) {
        console.log('[RESOURCE DEBUG] Raw data type:', typeof event.rawData);
        try {
          if (typeof event.rawData === 'string') {
            const resourceMatches = (event.rawData as string).match(/CUTYPE=RESOURCE/g);
            console.log('[RESOURCE DEBUG] CUTYPE=RESOURCE matches in rawData:', resourceMatches);
          }
          
          // Check if resources exist in event directly
          console.log('[RESOURCE DEBUG] Resources property exists in event?', 'resources' in event);
          if ('resources' in event) {
            console.log('[RESOURCE DEBUG] Resources in event:', event.resources);
            console.log('[RESOURCE DEBUG] Resources type:', typeof event.resources);
          }
        } catch (e) {
          console.error('[RESOURCE DEBUG] Error inspecting rawData:', e);
        }
      }
      
      // Use our new utility function from resource-utils.ts instead of the local one
      const extractedResources = extractResourcesFromEvent(event);
      console.log('[RESOURCE DEBUG] Extracted deduplicated resources:', extractedResources);
      
      if (extractedResources.length > 0) {
        console.log('[RESOURCE DEBUG] Setting resources state with extracted data');
        setResources(extractedResources);
      } else {
        console.warn('[RESOURCE DEBUG] No resources extracted from event data');
      }
    }
  }, [event, open]);
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
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  
  // Import templates from components/description/templates.ts
  const templates = [
    ...PREDEFINED_TEMPLATES,
    ...loadCustomTemplates(),
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
    
    // One-time initialization for the form when modal opens
    const initializeForm = () => {
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
            let parsedAttendees;
            
            if (typeof event.attendees === 'string') {
              try {
                // Try to parse as JSON
                parsedAttendees = JSON.parse(event.attendees);
                console.log('Parsed attendees as JSON:', parsedAttendees);
                
                // If we have parsed attendees with "params" and "val", transform them to our format
                if (Array.isArray(parsedAttendees) && parsedAttendees.length > 0 && parsedAttendees[0].params) {
                  parsedAttendees = parsedAttendees
                    // Filter out resource attendees
                    .filter(att => !att.params.CUTYPE || att.params.CUTYPE !== 'RESOURCE')
                    .map((att, index) => {
                      // Extract email from val (remove mailto: prefix)
                      const email = att.val ? att.val.replace('mailto:', '') : '';
                      
                      // Determine role from params
                      let role: AttendeeRole = 'Member';
                      if (att.params.ROLE === 'CHAIR' || att.params.ROLE === 'Chairman') {
                        role = 'Chairman';
                      } else if (att.params.ROLE === 'REQ-PARTICIPANT' || att.params.ROLE === 'Secretary') {
                        role = 'Secretary';
                      }
                      
                      // Extract name from CN if available
                      const name = att.params.CN || '';
                      
                      return {
                        id: att.id || `attendee-${index}-${Date.now()}`,
                        email,
                        name, 
                        role
                      };
                    });
                  
                  console.log('Transformed attendees from params/val format:', parsedAttendees);
                }
              } catch (parseError) {
                console.warn('Attendees was not valid JSON, attempting to extract from raw data');
                
                // If it's a string but not JSON, check if it's in the raw data
                if (event.rawData) {
                  const attendeeMatches = typeof event.rawData === 'string' 
                    ? event.rawData.match(/ATTENDEE[^:\r\n]*(?:(?!CUTYPE=RESOURCE)[^:\r\n])*:[^\r\n]+/g)
                    : null;
                    
                  if (attendeeMatches && attendeeMatches.length > 0) {
                    console.log(`Found ${attendeeMatches.length} attendee matches in raw data`);
                    
                    parsedAttendees = attendeeMatches.map((line, index) => {
                      const emailMatch = line.match(/mailto:([^>\r\n]+)/);
                      const email = emailMatch ? emailMatch[1].trim() : `unknown${index}@example.com`;
                      
                      const nameMatch = line.match(/CN=([^;:]+)/);
                      const name = nameMatch ? nameMatch[1].trim() : '';
                      
                      const roleMatch = line.match(/ROLE=([^;:]+)/);
                      let role: AttendeeRole = 'Member';
                      
                      if (roleMatch) {
                        const rawRole = roleMatch[1].trim();
                        if (rawRole === 'CHAIR' || rawRole === 'Chairman') {
                          role = 'Chairman';
                        } else if (rawRole === 'REQ-PARTICIPANT' || rawRole === 'Secretary') {
                          role = 'Secretary';
                        }
                      }
                      
                      return {
                        id: `attendee-${index}-${Date.now()}`,
                        email,
                        name,
                        role
                      };
                    });
                  }
                }
              }
            } else {
              // It's already an object
              parsedAttendees = event.attendees;
            }
              
            if (Array.isArray(parsedAttendees) && parsedAttendees.length > 0) {
              // Filter out any invalid entries or resource entries
              const validAttendees = parsedAttendees.filter(att => 
                att && 
                (att.email || att.val) && 
                (!att.params || att.params.CUTYPE !== 'RESOURCE')
              );
              
              // Make sure each attendee has an id and transform to our format if needed
              const attendeesWithIds = validAttendees.map((attendee, index) => {
                // If attendee has val but no email, it might be in params/val format from node-ical
                if (attendee.val && !attendee.email) {
                  return {
                    id: attendee.id || `attendee-${index}-${Date.now()}`,
                    email: attendee.val.replace('mailto:', ''),
                    name: attendee.params?.CN || '',
                    role: attendee.params?.ROLE === 'CHAIR' ? 'Chairman' : 
                          attendee.params?.ROLE === 'REQ-PARTICIPANT' ? 'Secretary' : 'Member'
                  };
                }
                
                // Otherwise use standard format
                return {
                  ...attendee,
                  id: attendee.id || `attendee-${index}-${Date.now()}`
                };
              });
              
              setAttendees(attendeesWithIds);
              console.log('Successfully parsed attendees:', attendeesWithIds);
            }
          }
        } catch (error) {
          console.error('Failed to parse attendees', error);
          // Ensure attendees is reset to empty array on error
          setAttendees([]);
        }
        
        // Try to parse resources from event if available
        try {
          // DEBUG: Log the entire event object to inspect structure
          console.log('DEBUG EVENT DATA FOR RESOURCES:', {
            id: event.id,
            title: event.title,
            rawData: typeof event.rawData === 'string' ? (event.rawData.length > 100 ? event.rawData.substring(0, 100) + '...' : event.rawData) : null,
            attendees: event.attendees,
            resources: event.resources,
            hasAttendeeField: !!event.attendees,
            hasResourcesField: !!event.resources,
            hasRawData: !!event.rawData
          });
          
          // First try using the utility function
          const parsedResources = parseResourcesFromEvent(event);
          
          if (parsedResources.length > 0) {
            setResources(parsedResources);
            console.log('Successfully parsed resources using utility:', parsedResources);
          } else if (event.rawData) {
            // Log full raw data if it's not too long
            const fullRawData = typeof event.rawData === 'string' ? 
              (event.rawData.length > 1000 ? event.rawData.substring(0, 1000) + '...' : event.rawData) : null;
            console.log('Full raw event data for resource extraction:', fullRawData);
              
            // Try both the standard pattern and a more flexible one
            const resourceMatches = typeof event.rawData === 'string'
              ? event.rawData.match(/ATTENDEE[^:]*CUTYPE=RESOURCE[^:\r\n]*:[^\r\n]+/g) || 
                event.rawData.match(/ATTENDEE[^:]*CUTYPE="?RESOURCE"?[^:\r\n]*:[^\r\n]+/g) ||
                event.rawData.match(/ATTENDEE.*?CUTYPE.*?RESOURCE.*?:[^\r\n]+/g)
              : null;
            
            console.log('Resource regex matches:', resourceMatches);
              
            // Also check for attendees with resource types  
            if (event.attendees && typeof event.attendees === 'string') {
              console.log('Checking attendees string for resources:', event.attendees);
              
              // Look for "CUTYPE" or "Resource" in the attendees string
              if (event.attendees.includes('CUTYPE') || event.attendees.includes('Resource')) {
                try {
                  const attendeesData = JSON.parse(event.attendees);
                  console.log('Parsed attendees data for resource check:', attendeesData);
                  
                  // Extract any attendees that have CUTYPE=RESOURCE
                  const resourceAttendees = Array.isArray(attendeesData) ? 
                    attendeesData.filter(a => a && a.params && 
                      (a.params.CUTYPE === 'RESOURCE' || a.params.ROLE === 'NON-PARTICIPANT')) : [];
                      
                  console.log('Resource attendees filtered:', resourceAttendees);
                  
                  if (resourceAttendees.length > 0) {
                    const extractedResourcesFromAttendees = resourceAttendees.map((att, index) => {
                      const email = att.val ? att.val.replace('mailto:', '') : '';
                      const name = att.params.CN || `Resource ${index + 1}`;
                      const subType = att.params['X-RESOURCE-TYPE'] || '';
                      
                      return {
                        id: `resource-${index}-${Date.now()}`,
                        name,
                        adminEmail: email,
                        subType,
                        capacity: 1
                      };
                    });
                    
                    if (extractedResourcesFromAttendees.length > 0) {
                      setResources(extractedResourcesFromAttendees);
                      console.log('Extracted resources from attendees data:', extractedResourcesFromAttendees);
                      return; // Skip further processing if we found resources
                    }
                  }
                } catch (err) {
                  console.warn('Failed to parse attendees JSON for resources:', err);
                }
              }
            }
              
            if (resourceMatches && resourceMatches.length > 0) {
              console.log(`Found ${resourceMatches.length} resource matches in raw data:`, resourceMatches);
              
              const extractedResources = resourceMatches.map((line, index) => {
                const emailMatch = line.match(/mailto:([^>\r\n]+)/);
                const adminEmail = emailMatch ? emailMatch[1].trim() : '';
                
                const nameMatch = line.match(/CN="?([^";:]+)"?/);
                const name = nameMatch ? nameMatch[1].trim() : `Resource ${index + 1}`;
                
                // Try several patterns for resource type
                const typeMatch = 
                  line.match(/X-RESOURCE-TYPE="?([^";:]+)"?/) || 
                  line.match(/RESOURCE-TYPE="?([^";:]+)"?/) ||
                  line.match(/TYPE="?([^";:]+)"?/);
                const subType = typeMatch ? typeMatch[1].trim() : name;
                
                return {
                  id: `resource-${index}-${Date.now()}`,
                  name,
                  adminEmail,
                  subType,
                  capacity: 1
                };
              });
              
              if (extractedResources.length > 0) {
                setResources(extractedResources);
                console.log('Successfully parsed resources from raw data:', extractedResources);
              }
            }
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
              // First try to parse as JSON
              const recurrenceRule = event.recurrenceRule;
              let recurrenceConfig: RecurrenceConfig = {
                pattern: 'None',
                interval: 1,
                weekdays: [],
                endType: 'Never',
                occurrences: 10
              };
              
              // Try to parse as JSON first
              try {
                // Attempt to parse recurrence rule if it's in our expected format
                const parsedRecurrence = JSON.parse(recurrenceRule);
                if (parsedRecurrence && typeof parsedRecurrence === 'object') {
                  // Default values for any missing fields
                  recurrenceConfig = {
                    pattern: parsedRecurrence.pattern || 'None',
                    interval: parsedRecurrence.interval || 1,
                    weekdays: parsedRecurrence.weekdays || [],
                    dayOfMonth: parsedRecurrence.dayOfMonth,
                    monthOfYear: parsedRecurrence.monthOfYear,
                    endType: parsedRecurrence.endType || 'Never',
                    occurrences: parsedRecurrence.occurrences || 10,
                    endDate: parsedRecurrence.endDate ? new Date(parsedRecurrence.endDate) : undefined
                  };
                  console.log('Successfully parsed recurrence rule from JSON:', recurrenceConfig);
                }
              } catch (jsonParseError) {
                // If it's not JSON, check if it's an iCalendar format (FREQ=DAILY;COUNT=3)
                if (recurrenceRule.includes('FREQ=')) {
                  console.log('Parsing iCalendar RRULE format:', recurrenceRule);
                  
                  // Extract frequency
                  const freqMatch = recurrenceRule.match(/FREQ=([^;]+)/);
                  if (freqMatch && freqMatch[1]) {
                    const freq = freqMatch[1];
                    if (freq === 'DAILY') recurrenceConfig.pattern = 'Daily';
                    else if (freq === 'WEEKLY') recurrenceConfig.pattern = 'Weekly';
                    else if (freq === 'MONTHLY') recurrenceConfig.pattern = 'Monthly';
                    else if (freq === 'YEARLY') recurrenceConfig.pattern = 'Yearly';
                    console.log(`Extracted frequency: ${freq}, mapped to pattern: ${recurrenceConfig.pattern}`);
                  }
                  
                  // Extract interval
                  const intervalMatch = recurrenceRule.match(/INTERVAL=(\d+)/);
                  if (intervalMatch && intervalMatch[1]) {
                    recurrenceConfig.interval = parseInt(intervalMatch[1], 10);
                    console.log(`Extracted interval: ${recurrenceConfig.interval}`);
                  }
                  
                  // Extract count
                  const countMatch = recurrenceRule.match(/COUNT=(\d+)/);
                  if (countMatch && countMatch[1]) {
                    recurrenceConfig.occurrences = parseInt(countMatch[1], 10);
                    recurrenceConfig.endType = 'After';
                    console.log(`Extracted count: ${recurrenceConfig.occurrences}, setting endType: After`);
                  }
                  
                  // Extract until
                  const untilMatch = recurrenceRule.match(/UNTIL=([^;]+)/);
                  if (untilMatch && untilMatch[1]) {
                    // Parse iCalendar date format like 20250428T235959Z
                    const untilStr = untilMatch[1];
                    let untilDate;
                    
                    if (untilStr.includes('T')) {
                      // Date with time
                      const year = parseInt(untilStr.substring(0, 4), 10);
                      const month = parseInt(untilStr.substring(4, 6), 10) - 1; // Month is 0-indexed
                      const day = parseInt(untilStr.substring(6, 8), 10);
                      const hour = parseInt(untilStr.substring(9, 11), 10);
                      const minute = parseInt(untilStr.substring(11, 13), 10);
                      const second = parseInt(untilStr.substring(13, 15), 10);
                      
                      untilDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                    } else {
                      // Date only
                      const year = parseInt(untilStr.substring(0, 4), 10);
                      const month = parseInt(untilStr.substring(4, 6), 10) - 1;
                      const day = parseInt(untilStr.substring(6, 8), 10);
                      
                      untilDate = new Date(Date.UTC(year, month, day));
                    }
                    
                    recurrenceConfig.endDate = untilDate;
                    recurrenceConfig.endType = 'On';
                    console.log(`Extracted until: ${untilStr}, parsed to ${untilDate}, setting endType: On`);
                  }
                  
                  // Extract BYDAY for weekly recurrences
                  if (recurrenceConfig.pattern === 'Weekly') {
                    const bydayMatch = recurrenceRule.match(/BYDAY=([^;]+)/);
                    if (bydayMatch && bydayMatch[1]) {
                      const days = bydayMatch[1].split(',');
                      const dayMap: Record<string, string> = {
                        'SU': 'Sunday',
                        'MO': 'Monday',
                        'TU': 'Tuesday',
                        'WE': 'Wednesday',
                        'TH': 'Thursday',
                        'FR': 'Friday',
                        'SA': 'Saturday'
                      };
                      
                      recurrenceConfig.weekdays = days.map(day => dayMap[day] || day);
                      console.log(`Extracted BYDAY=${bydayMatch[1]}, mapped to weekdays:`, recurrenceConfig.weekdays);
                    }
                  }
                  
                  console.log('Successfully parsed iCalendar RRULE:', recurrenceConfig);
                }
              }
              
              // Now set the recurrence config regardless of how it was parsed
              if (recurrenceConfig.pattern !== 'None') {
                setRecurrence(recurrenceConfig);
              }
            } catch (innerError) {
              console.error('Failed to parse recurrence rule', innerError);
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
        // INDUSTRY BEST PRACTICE TIMEZONE HANDLING
        // Following Google/Outlook standards to preserve "wall time" in user's local timezone
        
        console.log(`[DATE DEBUG] ------- Event Form Date Initialization with Best Practices -------`);
        console.log(`[DATE DEBUG] Received selectedDate: ${selectedDate instanceof Date ? selectedDate.toString() : selectedDate}`);
        console.log(`[DATE DEBUG] User timezone: ${selectedTimezone}`);
        console.log(`[DATE DEBUG] Browser timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
        
        // Create a proper date object from the selected date
        const localDate = new Date(selectedDate);
        
        if (!isNaN(localDate.getTime())) {
          // Extract date components IN LOCAL TIMEZONE to preserve the calendar day the user clicked on
          const year = localDate.getFullYear();
          const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
          const day = localDate.getDate().toString().padStart(2, '0');
          const formattedDate = `${year}-${month}-${day}`;
          
          console.log(`[DATE DEBUG] Selected date components (local timezone): year=${year}, month=${month}, day=${day}`);
          console.log(`[DATE DEBUG] Formatted as YYYY-MM-DD: ${formattedDate}`);
          
          // Set the same date for both start and end
          setStartDate(formattedDate);
          setEndDate(formattedDate);
          
          // Default to regular time-based events (not all-day) when clicking on a day
          setAllDay(false);
          
          // BEST PRACTICE: Use 9:00 AM as default start time instead of current time
          // This follows Google/Outlook convention of using reasonable business hours as defaults
          const defaultStartHour = 9;  // 9:00 AM
          const defaultEndHour = 10;   // 10:00 AM (1 hour meeting)
          const defaultMinute = 0;
          
          // Format default times (9 AM - 10 AM)
          const formattedStartTime = `${String(defaultStartHour).padStart(2, '0')}:${String(defaultMinute).padStart(2, '0')}`;
          const formattedEndTime = `${String(defaultEndHour).padStart(2, '0')}:${String(defaultMinute).padStart(2, '0')}`;
          
          setStartTime(formattedStartTime);
          setEndTime(formattedEndTime);
          
          // Always use the user's selected timezone
          setTimezone(selectedTimezone);
          
          console.log(`[DATE DEBUG] Form values set with industry standard defaults:`, {
            startDate: formattedDate,
            endDate: formattedDate,
            startTime: formattedStartTime, 
            endTime: formattedEndTime,
            allDay: false,
            timezone: selectedTimezone
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
    
    // Call the initialization function once
    initializeForm();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, selectedDate]);
  
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
    setIsNextDayAdjusted(false);
  };
  
  // This function handles the automatic next-day adjustment when end time is earlier than start time
  const checkAndAdjustNextDay = () => {
    if (allDay || !startDate || !endDate || !startTime || !endTime) return;
    
    // Only apply this when the user has selected the same date for start and end
    if (startDate === endDate) {
      // Create date objects to compare times
      const [startHour, startMinute] = startTime.split(':').map(Number);
      const [endHour, endMinute] = endTime.split(':').map(Number);
      
      // Compare times - if end time is earlier than start time on the same day
      if ((endHour < startHour) || (endHour === startHour && endMinute < startMinute)) {
        // Calculate next day date
        const startDateObj = new Date(startDate);
        const nextDay = new Date(startDateObj);
        nextDay.setDate(nextDay.getDate() + 1);
        
        // Format the next day as YYYY-MM-DD
        const nextDayFormatted = nextDay.toISOString().split('T')[0];
        
        // Set the end date to the next day and mark as adjusted
        setEndDate(nextDayFormatted);
        setIsNextDayAdjusted(true);
        
        // Clear any endDate validation errors since we've fixed the issue
        if (errors.endDate) {
          const { endDate, ...restErrors } = errors;
          setErrors(restErrors);
        }
        
        console.log(`[AUTO ADJUST] End time ${endTime} is earlier than start time ${startTime}, adjusted end date to next day: ${nextDayFormatted}`);
      } else if (isNextDayAdjusted) {
        // If times are now valid and we previously adjusted, reset back to same day
        setEndDate(startDate);
        setIsNextDayAdjusted(false);
        console.log(`[AUTO ADJUST] Times are now valid, reset end date to match start date: ${startDate}`);
      }
    }
  };
  
  // Helper function that determines which tabs have errors
  const getErrorsByTab = (errors: Record<string, string>) => {
    return {
      basic: !!errors.title || !!errors.startDate || !!errors.endDate || !!errors.startTime || 
             !!errors.endTime || !!errors.calendarId,
      attendees: !!errors.attendees || !!errors.attendeeInput,
      resources: !!errors.resources,
      recurrence: !!errors.recurrence,
      emails: !!errors.emails
    };
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
      
      // For same-day events with end time before start time, we'll auto-adjust to next day when submitting
      // so we should only show the validation error if different days are explicitly chosen and end is still before start
      if (end < start && startDate !== endDate) {
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
    
    // Find template in both predefined and custom templates
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setDescription(template.content);
      setSelectedTemplate(templateId);
    }
  };
  
  const handleSelectTemplate = (template: DescriptionTemplate) => {
    setDescription(template.content);
    setSelectedTemplate(template.id);
    setTemplateManagerOpen(false);
  };
  
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
          console.log(`[CRITICAL DATE DEBUG] ************************`);
          console.log(`[CRITICAL DATE DEBUG] Regular timed event submission - BEST PRACTICE IMPLEMENTATION`);
          console.log(`[CRITICAL DATE DEBUG] Form date strings:`, { startDate, endDate, startTime, endTime });
          console.log(`[CRITICAL DATE DEBUG] User selected timezone: ${timezone}`);
          console.log(`[CRITICAL DATE DEBUG] Browser timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
          
          // BEST PRACTICE: Create date objects in the user's specified timezone
          // When applying the "wall time principle" we need to ensure the time displayed to the user
          // matches exactly what they expect in their timezone
          
          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
          const [startHour, startMinute] = startTime.split(':').map(Number);
          
          // BEST PRACTICE: Preserve the wall time exactly as the user entered it
          // Use Date constructor with explicit components to ensure timezone is properly applied
          startDateTime = new Date(startYear, startMonth - 1, startDay, startHour, startMinute);
          
          // For debugging, log the timezone-aware creation information
          console.log(`[CRITICAL DATE DEBUG] Creating start date with details:`, {
            inputDate: startDate,
            inputTime: startTime,
            year: startYear,
            month: startMonth, // Original month (1-indexed)
            monthForJS: startMonth - 1, // JS month (0-indexed)
            day: startDay,
            hour: startHour,
            minute: startMinute,
            createdDateISO: startDateTime.toISOString(),
            createdDateLocale: startDateTime.toString(),
            userTimezone: timezone
          });
          
          // Get end date and time components
          const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
          const [endHour, endMinute] = endTime.split(':').map(Number);
          
          // Handle end date/time creation with timezone preservation
          if (startDate === endDate) {
            // For same-day events, ensure the end time reflects what the user sees
            endDateTime = new Date(startYear, startMonth - 1, startDay, endHour, endMinute);
            
            // AUTOMATIC NEXT-DAY ADJUSTMENT (Google/Outlook behavior):
            // If end time is earlier than start time, adjust to next day 
            if (endDateTime < startDateTime) {
              // End time is earlier than start time on the same day, move to next day
              endDateTime.setDate(endDateTime.getDate() + 1);
              console.log(`[CRITICAL DATE DEBUG] Automatically adjusted end date to next day (industry standard practice)`);
            } else {
              console.log(`[CRITICAL DATE DEBUG] Using same date for end time (wall time preserved)`);
            }
          } else {
            // Different dates selected, create exact end date as specified by user
            endDateTime = new Date(endYear, endMonth - 1, endDay, endHour, endMinute);
            console.log(`[CRITICAL DATE DEBUG] Using different dates for multi-day event (user explicitly selected)`);
          }
          
          console.log(`[CRITICAL DATE DEBUG] Regular event date objects:`, {
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString(),
            datesEqual: startDate === endDate
          });
          console.log(`[CRITICAL DATE DEBUG] ************************`);
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
            
      // Get or create a UID as needed
      let eventUID: string;

      try {
        if (event?.uid) {
          // For existing events, always use the existing UID
          eventUID = event.uid;
          console.log(`Using existing event UID: ${eventUID}`);
        } else if (persistedUID) {
          // For new events with a persisted UID already available, use it
          eventUID = persistedUID;
          console.log(`Using persisted UID from IndexedDB: ${eventUID}`);
        } else {
          // For completely new events without a stored UID, generate a new one
          // and store it for future reference
          eventUID = generateUID();
          console.log(`Generated new UID for event: ${eventUID}`);
        }

        // Log the UID source for debugging
        console.log(`Final event UID (${event ? 'update' : 'create'}): ${eventUID}`, {
          source: event?.uid ? 'existing' : (persistedUID ? 'persisted' : 'generated'),
          eventId: event?.id,
        });

        // Validate that we have a valid UID
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
        syncStatus: 'pending', // Mark as pending for immediate sync
        // Use the UID we determined above
        uid: eventUID,
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
        try {
          // For new events, we need to prepare the full event data
          const newEventData = {
            ...eventData,
            // Include mandatory fields with null/default values to match schema requirements
            etag: null,
            url: null,
            rawData: null,
            syncError: null,
            lastSyncAttempt: null,
            emailSent: null,
            emailError: null
          };
          
          // Create the new event
          const createdEvent = await createEvent(newEventData);
          
          // After successful creation, store the UID mapping in IndexedDB for future reference
          if (createdEvent?.id) {
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
  
  // Handle Cancel Event action - opens a dialog to confirm cancellation
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
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => {
        if (!open) onClose();
      }}>
        <DialogContent className="sm:max-w-[950px] max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-background to-background/95 border-[0.5px] border-primary/10 shadow-xl">
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
            <div className="w-full border-b bg-gray-50 p-2">
              {/* Calculate which tabs have errors for our indicators */}
              {(() => {
                // Get error states for all tabs
                const tabErrors = getErrorsByTab(errors);
                
                return (
                  <TabsList className="flex flex-wrap h-auto min-h-12 w-full justify-evenly rounded-lg overflow-visible gap-1 p-1 bg-muted/20 border border-muted/30">
                    <TabsTrigger 
                      value="basic" 
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md transition-all hover:bg-background/80 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:border-0 py-2 ${title || location || description ? 'bg-primary/5 before:absolute before:top-1 before:right-1 before:w-2 before:h-2 before:bg-primary before:rounded-full' : ''} ${tabErrors.basic ? 'border-red-500 before:right-auto before:left-1 before:bg-red-500' : ''}`}
                    >
                      {tabErrors.basic && (
                        <AlertCircle className="h-4 w-4 text-red-500 absolute top-1 left-1" />
                      )}
                      <Calendar className={`h-4 w-4 ${title || location || description ? 'text-primary' : ''} ${tabErrors.basic ? 'text-red-500' : ''}`} />
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
                            onChange={(e) => {
                              const newStartDate = e.target.value;
                              setStartDate(newStartDate);
                              
                              // If dates were previously the same, update end date to match new start date
                              // This keeps the behavior consistent with how calendar apps typically work
                              if (startDate === endDate) {
                                setEndDate(newStartDate);
                              }
                              
                              // Reset adjustment flag since user manually changed the date
                              setIsNextDayAdjusted(false);
                            }}
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
                              onChange={(e) => {
                                setStartTime(e.target.value);
                                // Check for adjustment after setting time
                                setTimeout(checkAndAdjustNextDay, 0);
                              }}
                              className={`${errors.startTime ? 'border-destructive' : ''} [&::-webkit-calendar-picker-indicator]:z-50 [&::-webkit-calendar-picker-indicator]:relative`}
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
                            onChange={(e) => {
                              setEndDate(e.target.value);
                              // Reset the next day adjustment flag when date is manually changed
                              setIsNextDayAdjusted(false);
                            }}
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
                              onChange={(e) => {
                                setEndTime(e.target.value);
                                // Check for adjustment after setting time
                                setTimeout(checkAndAdjustNextDay, 0);
                              }}
                              className={`${errors.endTime ? 'border-destructive' : ''} [&::-webkit-calendar-picker-indicator]:z-50 [&::-webkit-calendar-picker-indicator]:relative`}
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
                          
                          // Set default time values for non-all-day events to current time
                          const now = new Date();
                          const currentHour = now.getHours();
                          const currentMinute = now.getMinutes();
                          // Format current time as HH:MM
                          const formattedStartTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
                          // End time is 1 hour later
                          const endHour = (currentHour + 1) % 24; // Handle wrap around midnight
                          const formattedEndTime = `${String(endHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
                          
                          setStartTime(formattedStartTime);
                          setEndTime(formattedEndTime);
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
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-7 text-xs px-2 flex items-center gap-1"
                          onClick={() => setTemplateManagerOpen(true)}
                        >
                          <Save className="h-3 w-3" />
                          Manage
                        </Button>
                      </div>
                    </div>
                    
                    {/* Template Manager Modal */}
                    <SavedTemplateManager 
                      open={templateManagerOpen}
                      onOpenChange={setTemplateManagerOpen}
                      onSelectTemplate={handleSelectTemplate}
                    />
                    <div className="rich-text-editor-container">
                      <DescriptionEditor
                        value={description}
                        onChange={setDescription}
                        placeholder="Event Description"
                        eventData={{
                          title,
                          location,
                          startDate: startDate ? new Date(`${startDate}${allDay ? '' : `T${startTime}`}`) : null,
                          endDate: endDate ? new Date(`${endDate}${allDay ? '' : `T${endTime}`}`) : null,
                          attendees,
                          resources
                        }}
                      />
                    </div>
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
                          
                          // Generate email preview with proper date handling
                          let startDateTime, endDateTime;
                          
                          // Use the same careful date construction that we use in the form submission
                          if (allDay) {
                            console.log(`[EMAIL PREVIEW] Creating dates for all-day event preview`);
                            
                            // Use UTC dates for all-day events to avoid timezone issues
                            const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                            startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                            
                            // For the end date, use the same approach
                            const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                            
                            // Add one day to the end date per CalDAV convention for all-day events
                            endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                            
                            console.log(`[EMAIL PREVIEW] All-day event dates created:`, {
                              startDateTime: startDateTime.toISOString(),
                              endDateTime: endDateTime.toISOString()
                            });
                          } else {
                            // For regular events, use the date-time strings
                            startDateTime = new Date(`${startDate}T${startTime}:00`);
                            endDateTime = new Date(`${endDate}T${endTime}:00`);
                            
                            console.log(`[EMAIL PREVIEW] Regular event dates created:`, {
                              startDateTime: startDateTime.toISOString(),
                              endDateTime: endDateTime.toISOString()
                            });
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
                {/* No need for DirectResourceExtractor since resources are already extracted and deduplicated */}
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
                        
                        // Use the same careful date handling as in preview and submission
                        let startDateTime, endDateTime;
                        
                        if (allDay) {
                          console.log(`[EMAIL SEND] Creating dates for all-day event`);
                          
                          // Use UTC dates for all-day events to avoid timezone issues
                          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                          startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                          
                          // For the end date, use the same approach
                          const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                          
                          // Add one day to the end date per CalDAV convention for all-day events
                          endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                          
                          console.log(`[EMAIL SEND] All-day event dates created:`, {
                            startDateTime: startDateTime.toISOString(),
                            endDateTime: endDateTime.toISOString()
                          });
                        } else {
                          // For regular events, use the date-time strings
                          startDateTime = new Date(`${startDate}T${startTime}:00`);
                          endDateTime = new Date(`${endDate}T${endTime}:00`);
                          
                          console.log(`[EMAIL SEND] Regular event dates created:`, {
                            startDateTime: startDateTime.toISOString(),
                            endDateTime: endDateTime.toISOString()
                          });
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
                        // Use the same careful date handling approach
                        let startDateTime, endDateTime;
                        
                        if (allDay) {
                          console.log(`[EMAIL REFRESH] Creating dates for all-day event`);
                          
                          // Use UTC dates for all-day events to avoid timezone issues
                          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                          startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                          
                          // For the end date, use the same approach
                          const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                          
                          // Add one day to the end date per CalDAV convention for all-day events
                          endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                          
                          console.log(`[EMAIL REFRESH] All-day event dates created:`, {
                            startDateTime: startDateTime.toISOString(),
                            endDateTime: endDateTime.toISOString()
                          });
                        } else {
                          // For regular events, use the date-time strings
                          startDateTime = new Date(`${startDate}T${startTime}:00`);
                          endDateTime = new Date(`${endDate}T${endTime}:00`);
                          
                          console.log(`[EMAIL REFRESH] Regular event dates created:`, {
                            startDateTime: startDateTime.toISOString(),
                            endDateTime: endDateTime.toISOString()
                          });
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
                    
                    // Prepare date objects using the consistent approach
                    let startDateTime, endDateTime;
                    
                    if (allDay) {
                      console.log(`[SEND BUTTON] Creating dates for all-day event`);
                      
                      // Use UTC dates for all-day events to avoid timezone issues
                      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                      startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                      
                      // For the end date, use the same approach
                      const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                      
                      // Add one day to the end date per CalDAV convention for all-day events
                      endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                      
                      console.log(`[SEND BUTTON] All-day event dates created:`, {
                        startDateTime: startDateTime.toISOString(),
                        endDateTime: endDateTime.toISOString()
                      });
                    } else {
                      // For regular events, use the date-time strings
                      startDateTime = new Date(`${startDate}T${startTime}:00`);
                      endDateTime = new Date(`${endDate}T${endTime}:00`);
                      
                      console.log(`[SEND BUTTON] Regular event dates created:`, {
                        startDateTime: startDateTime.toISOString(),
                        endDateTime: endDateTime.toISOString()
                      });
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
                          // Prepare full event data with consistent date handling
                          let startDateTime, endDateTime;
                          
                          if (allDay) {
                            console.log(`[EMAIL SENT UPDATE] Creating dates for all-day event`);
                            
                            // Use UTC dates for all-day events to avoid timezone issues
                            const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                            startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                            
                            // For the end date, use the same approach
                            const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                            
                            // Add one day to the end date per CalDAV convention for all-day events
                            endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                            
                            console.log(`[EMAIL SENT UPDATE] All-day event dates created:`, {
                              startDateTime: startDateTime.toISOString(),
                              endDateTime: endDateTime.toISOString()
                            });
                          } else {
                            // For regular events, use the date-time strings
                            startDateTime = new Date(`${startDate}T${startTime}:00`);
                            endDateTime = new Date(`${endDate}T${endTime}:00`);
                            
                            console.log(`[EMAIL SENT UPDATE] Regular event dates created:`, {
                              startDateTime: startDateTime.toISOString(),
                              endDateTime: endDateTime.toISOString()
                            });
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
                    // Prepare full event data with consistent date handling
                    let startDateTime, endDateTime;
                    
                    if (allDay) {
                      console.log(`[ALERT DIALOG] Creating dates for all-day event`);
                      
                      // Use UTC dates for all-day events to avoid timezone issues
                      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
                      startDateTime = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));
                      
                      // For the end date, use the same approach
                      const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
                      
                      // Add one day to the end date per CalDAV convention for all-day events
                      endDateTime = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1, 0, 0, 0));
                      
                      console.log(`[ALERT DIALOG] All-day event dates created:`, {
                        startDateTime: startDateTime.toISOString(),
                        endDateTime: endDateTime.toISOString()
                      });
                    } else {
                      // For regular events, use the date-time strings
                      startDateTime = new Date(`${startDate}T${startTime}:00`);
                      endDateTime = new Date(`${endDate}T${endTime}:00`);
                      
                      console.log(`[ALERT DIALOG] Regular event dates created:`, {
                        startDateTime: startDateTime.toISOString(),
                        endDateTime: endDateTime.toISOString()
                      });
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