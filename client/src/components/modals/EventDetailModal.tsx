import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { MailCheck, AlertTriangle, User as UserIcon, UserRound, VideoIcon, DoorClosed, Laptop, Wrench, Settings, MapPin, Info, Clock, MapPinned, AlertCircle, Trash2, Calendar, History, ChevronUp, ChevronDown, Copy, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import DirectResourceExtractor from './DirectResourceExtractor';
import ResourceManager from '@/components/resources/ResourceManager';
import DirectAttendeeExtractor from './DirectAttendeeExtractor';
import AttendeeResponseForm from '../attendees/AttendeeResponseForm';
import AttendeeStatusDisplay from '../attendees/AttendeeStatusDisplay';
import AttendeeDialog from '../attendees/AttendeeDialog';
import { createBasicICS, sanitizeAndFormatICS } from '@shared/ics-formatter';

/**
 * ICS formatting has been moved to shared/ics-formatter.ts
 * Now using imported createBasicICS and sanitizeAndFormatICS functions
 * This ensures consistent RFC 5545 compliant formatting across the application
 */

// Skip TypeScript errors for the JSON fields - they're always going to be tricky to handle
// since they come from dynamic sources. Instead we'll do runtime checks.

/**
 * Helper function to sanitize and process description content for display
 * Handles both HTML and plain text descriptions from different CalDAV clients
 */
function sanitizeDescriptionForDisplay(description: string | any): string {
  if (!description) return '';
  
  // If it's not a string, try to convert it
  if (typeof description !== 'string') {
    try {
      description = JSON.stringify(description);
    } catch (e) {
      description = String(description);
    }
  }
  
  // Check if this is an HTML description (has HTML tags)
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(description);
  
  if (hasHtmlTags) {
    // It's already HTML content, return as is
    return description;
  }
  
  // Check if it has line breaks that should be converted to <br> tags
  if (description.includes('\\n') || description.includes('\n')) {
    // Convert escape sequences and line breaks to HTML
    return description
      .replace(/\\n/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
  }
  
  // Plain text - escape HTML characters and preserve spaces
  return description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/  /g, '&nbsp;&nbsp;');
}

// Define a User interface that matches the schema with email
// Based on shared/schema.ts where email is text("email") (optional)
interface UserWithEmail {
  id: number;
  username: string;
  password: string;
  preferredTimezone: string;
  email: string | null;
}

interface EventDetailModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
  onEdit: () => void;
  onCopy?: (event: Event) => void;
  onPrint?: (event: Event) => void;
}

const EventDetailModal: React.FC<EventDetailModalProps> = ({ 
  open, 
  event, 
  onClose,
  onEdit,
  onCopy,
  onPrint
}) => {
  // Defensive check: ensure we have a valid event object
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Event details not available. Please try refreshing the page.</p>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  // Hook calls - all must be at the top level
  const { calendars } = useCalendars();
  const { deleteEvent, cancelEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoadingFromAuth } = useAuth();
  const queryClient = useQueryClient();
  
  // State hooks - always place ALL hooks at the top level before any conditional logic
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resourcesDialogOpen, setResourcesDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // For download operations
  const [isUserLoading, setIsUserLoading] = useState(isUserLoadingFromAuth);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showAllAttendees, setShowAllAttendees] = useState(false); // For attendee display limit
  const [showAllResources, setShowAllResources] = useState(false); // For resource display limit (unused now - using dialog instead)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null); // For attendee status dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState(false); // For attendee status dialog
  const { toast } = useToast(); // Import toast from useToast hook
  // Section expansion has been removed in favor of always showing scrollable content
  
  // Add a timeout to prevent infinite loading state
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    if (isUserLoadingFromAuth) {
      setIsUserLoading(true);
      timeoutId = setTimeout(() => {
        // Force loading to end after 2 seconds to prevent UI getting stuck
        setIsUserLoading(false);
        console.log("Auth loading timeout - forcing UI to proceed with available permissions");
      }, 2000);
    } else {
      setIsUserLoading(isUserLoadingFromAuth);
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isUserLoadingFromAuth]);
  
  // Get the user's preferred timezone from CalendarContext
  const { selectedTimezone } = useCalendarContext();
  
  // If event is null, show an error state
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Unable to load event details.</p>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Parse the event data
  const calendarMetadata = event.rawData as any || {};
  const calendarName = calendarMetadata?.calendarName;
  const calendarColor = calendarMetadata?.calendarColor;
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Get permissions in a safe way
  const permissions = event.calendarId ? getCalendarPermission(event.calendarId) : { canEdit: false, isOwner: false };
  const canEdit = permissions.canEdit;
  const isOwner = permissions.isOwner;
  
  // For events in user's own calendars, always allow edit
  // First check direct match
  let isUsersOwnCalendar = calendar ? calendar.userId === user?.id : false;
  
  // Special handling for DK Pandey (user ID 4) - consider all events in his calendar as his own
  // This is specifically requested by the client to restore critical functionality
  if (!isUsersOwnCalendar && calendar && user?.id === 4) {
    // For DK Pandey, if it's his calendar, force isUsersOwnCalendar = true
    if (
      calendar.name.toLowerCase().includes('d k pandey') || 
      calendar.name.toLowerCase().includes('pandey')
    ) {
      console.log('Calendar ownership granted to DK Pandey via special case');
      isUsersOwnCalendar = true;
    }
  }
  
  // Second check: if the event has organizer information that matches the current user
  if (!isUsersOwnCalendar && event.rawData && user) {
    try {
      const rawData = typeof event.rawData === 'string' 
        ? JSON.parse(event.rawData) 
        : event.rawData;
        
      // Look for organizer info in the raw data
      if (rawData && typeof rawData === 'object') {
        const organizerEmail = rawData.organizer?.email || 
                              rawData.ORGANIZER?.email ||
                              rawData.organizer || 
                              rawData.ORGANIZER;
                              
        // If we found organizer info, check if it matches the current user
        if (organizerEmail && typeof organizerEmail === 'string') {
          const emailLower = organizerEmail.toLowerCase();
          const usernameLower = user.username.toLowerCase();
          const userEmailLower = (user as any).email?.toLowerCase() || '';
          
          if (emailLower === usernameLower || emailLower === userEmailLower) {
            console.log(`Calendar ownership detected via organizer email match: ${emailLower}`);
            isUsersOwnCalendar = true;
          }
        }
      }
    } catch (e) {
      console.warn('Error parsing event raw data for organizer info:', e);
    }
  }
  
  // Check if this event is from a shared calendar with edit permissions
  // Use the currentUser ID for proper cache key
  const currentUser = queryClient.getQueryData<any>(['/api/user']);
  const currentUserId = currentUser?.id;
  
  // Get shared calendars from the cache using proper query key with user ID
  const sharedCalendars = queryClient.getQueryData<any[]>(['/api/shared-calendars', currentUserId]);
  
  // Check for sharingMetadata in the event (newer implementation)
  const hasSharingMetadata = !!(event as any).sharingMetadata;
  const sharingMetadata = (event as any).sharingMetadata || {};
  
  // Check if this is from a shared calendar with edit permissions
  // First check the new sharingMetadata property, then fall back to old methods
  const isFromSharedCalendarWithEditPermission = 
    // Check the sharingMetadata with normalized permission checks
    (hasSharingMetadata && (
      sharingMetadata.permissionLevel === 'edit' || 
      sharingMetadata.permissionLevel === 'write' ||
      sharingMetadata.permission === 'edit' || 
      sharingMetadata.permission === 'write'
    )) || 
    // Check calendar metadata and shared calendars with normalized permission checks
    (calendarMetadata?.isShared === true && 
     event.calendarId && 
     sharedCalendars?.some?.(cal => {
       // First try to use the canEdit property/method if available
       if (cal.id === event.calendarId) {
         if (typeof cal.canEdit === 'boolean') {
           return cal.canEdit;
         } else if (typeof cal.canEdit === 'function') {
           return cal.canEdit();
         } else {
           // Otherwise do a normalized permission check
           return (
             cal.permission === 'edit' || 
             cal.permission === 'write' || 
             cal.permissionLevel === 'edit' || 
             cal.permissionLevel === 'write'
           );
         }
       }
       return false;
     }));
  
  // Enhanced logging with more detailed permission information
  console.log(`Event ${event.id} permission check:`, {
    isUsersOwnCalendar,
    canEdit,
    isOwner,
    isFromSharedCalendarWithEditPermission,
    hasSharingMetadata,
    sharingMetadata,
    calendarMetadata,
    sharedCalendars: sharedCalendars?.filter(cal => cal.id === event.calendarId).map(cal => ({
      id: cal.id,
      name: cal.name,
      permissionLevel: cal.permissionLevel,
      permission: cal.permission,
      canEditMethod: cal.canEdit ? 'available' : 'unavailable',
      userId: cal.userId,
      currentUserId: currentUserId
    })),
    calendar: calendar ? {
      id: calendar.id,
      name: calendar.name,
      userId: calendar.userId,
      currentUserId: currentUserId,
      isUsersOwn: calendar.userId === currentUserId
    } : 'Calendar not found'
  });
  
  // Determine if the user can edit this event based on all permission factors
  const effectiveCanEdit = isUsersOwnCalendar || canEdit || isOwner || isFromSharedCalendarWithEditPermission;
  
  // Only show auth error if we don't have user info AND don't have calendar data
  // If we have calendar data, assume server session is valid even if client-side auth state is missing
  const isAuthError = !isUserLoading && !user && !calendar;
  
  // Parse dates safely
  let startDate: Date;
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error(`Invalid event dates for "${event.title}"`);
      startDate = new Date();
      endDate = new Date();
      endDate.setHours(endDate.getHours() + 1);
    }
  } catch (error) {
    console.error(`Error parsing dates for event "${event.title}":`, error);
    startDate = new Date();
    endDate = new Date();
    endDate.setHours(endDate.getHours() + 1);
  }

  // Function for resource extraction with improved deduplication and email cleaning
  const extractResourcesFromRawData = () => {
    if (!event) return [];
    
    try {
      // Create a Map to track resources by email for deduplication
      const resourceMap = new Map();
      
      // Helper function to clean malformed email addresses
      const cleanEmailAddress = (email: string): string => {
        if (!email) return '';
        
        // Clean email if it contains embedded ICS tags or line breaks
        if (email.includes('\r\n') || email.includes('END:') || email.includes('VCALENDAR')) {
          // Extract just the valid email portion using a more restrictive regex
          const emailCleanRegex = /([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/;
          const cleanedEmail = email.match(emailCleanRegex);
          
          if (cleanedEmail && cleanedEmail[1]) {
            console.log('Cleaned malformed email from:', email, 'to:', cleanedEmail[1]);
            return cleanedEmail[1];
          }
          
          // If regex didn't match, just take everything before the first line break
          const firstPartEmail = email.split('\r\n')[0];
          console.log('Cleaned malformed email using split from:', email, 'to:', firstPartEmail);
          return firstPartEmail;
        }
        
        return email;
      };
      
      // STEP 1: Try to get resources from the event.resources field first
      if (event.resources) {
        let parsedResources = [];
        
        if (typeof event.resources === 'string') {
          try {
            parsedResources = JSON.parse(event.resources);
          } catch (e) { /* Silent fail */ }
        } else if (Array.isArray(event.resources)) {
          parsedResources = event.resources;
        }
        
        // Add resources to our map for deduplication
        if (Array.isArray(parsedResources)) {
          parsedResources.forEach((resource, index) => {
            let email = resource.adminEmail || resource.email; 
            if (email) {
              // Clean the email address
              email = cleanEmailAddress(email);
              
              const emailKey = email.toLowerCase();
              // Only add if not already in the map (prevents overwriting)
              if (!resourceMap.has(emailKey)) {
                resourceMap.set(emailKey, {
                  id: resource.id || `resource-${index}-${Date.now()}`,
                  adminEmail: email,
                  adminName: resource.adminName || resource.name || 'Resource',
                  subType: resource.subType || resource.type || '',
                  capacity: resource.capacity || 1
                });
              }
            }
          });
        }
      }
      
      // STEP 2: Now extract from VCALENDAR data if available (but don't overwrite existing entries)
      if (event.rawData && typeof event.rawData === 'string') {
        const rawDataStr = event.rawData;
        
        // Improved regex to better match resource emails in ICS data
        const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:]*?mailto:([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/g;
        const matches = Array.from(rawDataStr.matchAll(resourceRegex));
        
        if (matches && matches.length > 0) {
          matches.forEach((match, index) => {
            const fullLine = match[0]; // The complete ATTENDEE line 
            let email = match[1]; // The captured email group
            
            // Clean the email address
            email = cleanEmailAddress(email);
            const emailKey = email.toLowerCase();
            
            // Skip if we already have this resource by email
            if (email && !resourceMap.has(emailKey)) {
              // Extract resource name from CN
              const cnMatch = fullLine.match(/CN=([^;:]+)/);
              const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
              
              // Extract resource type
              const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
              const resourceType = typeMatch ? typeMatch[1].trim() : '';
              
              // Extract capacity if available
              const capacityMatch = fullLine.match(/X-RESOURCE-CAPACITY=([0-9]+)/);
              const capacity = capacityMatch ? parseInt(capacityMatch[1], 10) : 1;
              
              resourceMap.set(emailKey, {
                id: `resource-${index}-${Date.now()}`,
                adminEmail: email,
                adminName: name,
                subType: resourceType,
                capacity: capacity
              });
            }
          });
        }
      }
      
      // Convert map back to array
      return Array.from(resourceMap.values());
    } catch (error) {
      console.error('Error extracting resources:', error);
      return [];
    }
  };

  // Check if this event has attendees or resources with error handling
  const hasAttendees = useMemo(() => {
    try {
      return Boolean(
        event.attendees && 
        (Array.isArray(event.attendees) ? event.attendees.length > 0 : true)
      );
    } catch (error) {
      console.error('Error checking event attendees:', error);
      return false;
    }
  }, [event.attendees]);
  
  // Always use our enhanced extractResourcesFromRawData function to deduplicate resources
  // from all possible sources
  const resources = extractResourcesFromRawData();
  
  const hasResources = Array.isArray(resources) && resources.length > 0;
  
  // Special case for DK Pandey who needs to be able to cancel any event
  const isDKPandey = user?.id === 4 && user?.username === 'dk.pandey@xgenplus.com';
  
  // Only show cancel button if:
  // 1. The event has attendees or resources, AND
  // 2. The user is the owner OR it's DK Pandey (who has special admin privileges)
  const shouldShowCancelButton = (hasAttendees || hasResources) && (isUsersOwnCalendar || effectiveCanEdit || isDKPandey);
  
  // Process attendees from event data with improved handling of different formats
  const processedAttendees = useMemo(() => {
    try {
      // If no attendees data, return empty array
      if (!event.attendees) return [];

      // If it's already an array, use it directly
      if (Array.isArray(event.attendees)) {
        return event.attendees;
      }
      
      // If it's a string that might be JSON, try to parse it
      if (typeof event.attendees === 'string') {
        try {
          const parsed = JSON.parse(event.attendees);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          console.log('Failed to parse attendees string, using as single attendee');
          return [{ id: `attendee-${Date.now()}`, email: event.attendees }];
        }
      }
      
      // If it's an object but not an array, wrap it in array
      if (typeof event.attendees === 'object') {
        return [event.attendees];
      }
      
      // As a last resort, convert to string and use as email
      return [{ id: `attendee-fallback-${Date.now()}`, email: String(event.attendees) }];
    } catch (e) {
      console.error('Error processing attendees:', e);
      return [];
    }
  }, [event.attendees]);

  // Handle Delete Event action with enhanced client-side removal
  const handleDelete = async () => {
    if (!event || !event.id || isDeleting) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      // Store the event ID and data before we delete it
      const eventId = event.id;
      const eventUid = event.uid;
      const calendarId = event.calendarId;
      
      // Mark events for deletion with a safer visual approach
      // Instead of removing DOM elements directly (which can cause race conditions with React), 
      // we'll hide them with CSS and let React handle the actual removal
      try {
        // Add a class to hide elements immediately
        const eventEls = document.querySelectorAll(`[data-event-id="${eventId}"]`);
        if (eventEls.length > 0) {
          console.log(`👉 Hiding ${eventEls.length} DOM elements for event ${eventId}`);
          eventEls.forEach(el => {
            // Use CSS to hide immediately
            (el as HTMLElement).style.display = 'none';
            (el as HTMLElement).style.opacity = '0';
            (el as HTMLElement).style.pointerEvents = 'none';
            el.setAttribute('data-deleted', 'true');
          });
        }
        
        // Also try by UID if available
        if (eventUid) {
          const uidEls = document.querySelectorAll(`[data-event-uid="${eventUid}"]`);
          if (uidEls.length > 0) {
            console.log(`👉 Hiding ${uidEls.length} DOM elements for event UID ${eventUid}`);
            uidEls.forEach(el => {
              // Use CSS to hide immediately
              (el as HTMLElement).style.display = 'none';
              (el as HTMLElement).style.opacity = '0';
              (el as HTMLElement).style.pointerEvents = 'none';
              el.setAttribute('data-deleted', 'true');
            });
          }
        }
        
        // For safety, directly modify the query cache to remove this event
        // This is a more aggressive approach than the normal cache invalidation
        queryClient.setQueryData(['/api/events'], (oldData: any) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          return oldData.filter((e: any) => e.id !== eventId && (!eventUid || e.uid !== eventUid));
        });
        
        // Also update calendar-specific cache
        if (calendarId) {
          queryClient.setQueryData(['/api/calendars', calendarId, 'events'], (oldData: any) => {
            if (!oldData || !Array.isArray(oldData)) return oldData;
            return oldData.filter((e: any) => e.id !== eventId && (!eventUid || e.uid !== eventUid));
          });
        }
        
        // Store deletion info in sessionStorage to ensure cross-component awareness
        try {
          const deletedEventsKey = 'recently_deleted_events';
          const sessionDeletedEvents = JSON.parse(sessionStorage.getItem(deletedEventsKey) || '[]');
          
          sessionDeletedEvents.push({
            id: eventId,
            uid: eventUid,
            title: event.title,
            calendarId: calendarId,
            timestamp: new Date().toISOString()
          });
          
          // Limit history to last 20 events
          while (sessionDeletedEvents.length > 20) {
            sessionDeletedEvents.shift();
          }
          
          sessionStorage.setItem(deletedEventsKey, JSON.stringify(sessionDeletedEvents));
          console.log(`Added event ID ${eventId} to session storage deletion tracking`);
        } catch (e) {
          console.error('Failed to update session storage deletion tracking:', e);
        }
      } catch (domError) {
        console.error('Error eagerly removing event from DOM:', domError);
      }
      
      // Now perform the actual deletion on the server
      await deleteEvent(eventId);
      
      // Close dialogs even if the server deletion failed
      setDeleteDialogOpen(false);
      onClose(); // Close the modal after deletion
      
      // Final safety: Force a full UI refresh
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      }, 100);
    } catch (error) {
      console.error('Error deleting event:', error);
      setDeleteError('Failed to delete the event. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Handle Cancel Event action has been moved to ImprovedEventFormModal

  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <div className="flex justify-between items-center">
              <DialogTitle>
                Event Details
                {isUserLoading && (
                  <span className="ml-2 inline-block w-4 h-4 rounded-full border-2 border-t-transparent border-primary animate-spin" />
                )}
              </DialogTitle>
              {isUserLoading ? (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  Loading...
                </div>
              ) : !(isUsersOwnCalendar || effectiveCanEdit) ? (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  View only
                </div>
              ) : null}
            </div>
          </DialogHeader>
          
          {/* Main content container */}
          <div className="space-y-3">
            {/* Top heading with title and calendar info */}
            <div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold" title={event.title.length > 50 ? event.title : undefined}>
                  {event.title.length > 50 ? `${event.title.substring(0, 50)}...` : event.title}
                </h1>
                  
                {/* Sync status indicator */}
                {event.syncStatus && (
                  <div 
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      event.syncStatus === 'synced' 
                        ? 'bg-green-100 text-green-800' 
                        : event.syncStatus === 'syncing' 
                          ? 'bg-blue-100 text-blue-800' 
                          : event.syncStatus === 'sync_failed' 
                            ? 'bg-red-100 text-red-800' 
                            : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {event.syncStatus === 'synced' 
                      ? 'Synced' 
                      : event.syncStatus === 'syncing' 
                        ? 'Syncing...' 
                        : event.syncStatus === 'sync_failed' 
                          ? 'Sync Failed' 
                          : 'Local'}
                  </div>
                )}
              </div>
                  
              {/* Show calendar info if available */}
              {calendar && (
                <div className="text-sm text-neutral-500 flex items-center -mt-1">
                  <span 
                    className="w-3 h-3 rounded-full mr-1" 
                    style={{ backgroundColor: calendarColor || calendar.color }}
                  ></span>
                  {calendarName || calendar.name} {!calendarName && "Calendar"}
                </div>
              )}
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Left column */}
              <div className="space-y-3">
                {/* Date and time card with improved visual design */}
                <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 shadow-sm">
                  <div className="flex flex-col space-y-2">
                    <div className="flex items-center">
                      <Clock className="text-blue-600 mr-3 h-5 w-5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">
                          {formatDayOfWeekDate(startDate, selectedTimezone)}
                        </div>
                        <div className="text-sm text-blue-700">
                          {event.allDay 
                            ? 'All Day' 
                            : formatEventTimeRange(startDate, endDate, false, selectedTimezone)}
                          <span className="text-blue-600/70 text-xs ml-1">
                            ({selectedTimezone})
                          </span>
                        </div>
                      </div>
                    </div>
                      
                    {/* Location section - only show if there's a location */}
                    {event.location && (
                      <div className="flex items-start pt-2 border-t border-blue-200">
                        <MapPinned className="text-blue-600 mr-3 h-5 w-5 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium">Location</div>
                          <div className="text-sm text-blue-700">{event.location}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                  
                {/* Description section - only show if there's a description */}
                {event.description && (
                  <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-medium mb-1 flex items-center text-sm">
                      <Info className="text-gray-600 mr-1.5 h-4 w-4" />
                      Description
                    </h3>
                    <div className="text-sm prose prose-sm max-w-none bg-white p-2 rounded border border-gray-100 line-clamp-4 overflow-auto max-h-[150px]"
                      dangerouslySetInnerHTML={{ 
                        __html: (() => {
                          if (!event.description) return '';
                          
                          const description = String(event.description);
                          
                          // Case 1: Thunderbird special JSON-like format with ALTREP
                          if (description.includes('"ALTREP"') || description.includes('"params"')) {
                            try {
                              // Extract the actual content
                              // Format is typically: ["params":["ALTREP":"data:text/html..."],"val":"actual text"]
                              
                              // First try to find the "val" property
                              const valMatch = description.match(/"val"\s*:\s*"([^"]+)"/);
                              if (valMatch && valMatch[1]) {
                                return valMatch[1]
                                  .replace(/\\n/g, '<br>')
                                  .replace(/\\/g, ''); // Remove any remaining backslashes
                              }
                              
                              // Try to extract from ALTREP if val wasn't found
                              const altrepMatch = description.match(/"ALTREP"\s*:\s*"data:text\/html[^"]*,([^"]+)"/);
                              if (altrepMatch && altrepMatch[1]) {
                                // It's URL encoded, so decode it
                                try {
                                  return decodeURIComponent(altrepMatch[1]);
                                } catch (e) {
                                  // If decoding fails, just return it as is
                                  return altrepMatch[1];
                                }
                              }
                              
                              // Fallback - use whatever text is available
                              const textContent = description
                                .replace(/["[\]{}]/g, '') // Remove JSON-like symbols
                                .replace(/params:|ALTREP:|val:/g, '') // Remove JSON keys
                                .replace(/data:text\/html[^,]*,/g, '') // Remove MIME type info
                                .trim();
                                
                              return textContent;
                            } catch (e) {
                              console.error('Error parsing Thunderbird special format:', e);
                            }
                          }
                          
                          // Case 2: It's already valid HTML with tags
                          if (description.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
                            return description;
                          }
                          
                          // Case 3: It has escaped HTML tags (from Thunderbird)
                          if (description.includes('&lt;') && description.includes('&gt;')) {
                            // First unescape the HTML entities
                            const unescaped = description
                              .replace(/&lt;/g, '<')
                              .replace(/&gt;/g, '>')
                              .replace(/&quot;/g, '"')
                              .replace(/&amp;/g, '&');
                            
                            // Check if it now has valid HTML
                            if (unescaped.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
                              return unescaped;
                            }
                          }
                          
                          // Case 4: Plain text with escaped newlines
                          return description
                            .replace(/\\n/g, '<br>')
                            .replace(/\n/g, '<br>');
                        })()
                      }}
                    />
                  </div>
                )}
                
                {/* Change History section moved to right column */}
                
                {/* Resources section with improved visual display */}
                {(() => {
                  // Use the resources variable we extracted earlier instead of calling extractResourcesFromRawData() again
                  const resourceCount = resources.length;
                  console.log('Using cached resources:', resources);
                  
                  // Display resources if we have any
                  if (resourceCount > 0) {
                    // Display only 2 resources by default, with dialog for viewing all
                    const displayResources = resources.slice(0, 2);
                    
                    return (
                      <div className="bg-amber-50 p-2 rounded-lg border border-amber-100 shadow-sm">
                        <h3 className="font-medium mb-1 flex items-center text-amber-800 text-sm">
                          <Settings className="text-amber-600 mr-1.5 h-4 w-4" />
                          Resources ({resourceCount})
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {displayResources.map((resource: any, index: number) => {
                            // Get resource name/email/type from various possible formats
                            const name = resource.name || resource.adminName || 'Resource';
                            const email = resource.email || resource.adminEmail || '';
                            const type = resource.type || resource.subType || '';
                            const capacity = resource.capacity || '';
                            
                            return (
                              <div key={index} className="flex items-start bg-white p-3 rounded-md border border-amber-100">
                                {type.toLowerCase().includes('proj') ? (
                                  <VideoIcon className="text-amber-500 mr-2 h-5 w-5 mt-0.5" />
                                ) : type.toLowerCase().includes('room') ? (
                                  <DoorClosed className="text-blue-500 mr-2 h-5 w-5 mt-0.5" />
                                ) : type.toLowerCase().includes('laptop') || type.toLowerCase().includes('computer') ? (
                                  <Laptop className="text-green-500 mr-2 h-5 w-5 mt-0.5" />
                                ) : (
                                  <Wrench className="text-neutral-500 mr-2 h-5 w-5 mt-0.5" />
                                )}
                                <div>
                                  <div className="font-medium">{name}</div>
                                  <div className="text-xs text-amber-700">
                                    {type || 'General Resource'}
                                    {capacity && ` • Capacity: ${capacity}`}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Admin: {email}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Show the View All Resources button if there are more than 2 resources */}
                        {resourceCount > 2 && (
                          <button 
                            onClick={() => setResourcesDialogOpen(true)}
                            className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                          >
                            Show all {resourceCount} resources
                          </button>
                        )}
                      </div>
                    );
                  }
                  
                  return null;
                })()}
              </div>
              
              {/* Right column - Attendees */}
              <div className="space-y-4">
                {/* We've removed DirectResourceExtractor here as it causes duplication with the main resources section */}
                
                {/* Event Modification History - show when available */}
                {event.lastModifiedByName && event.lastModifiedAt && (
                  <div className="bg-purple-50 p-2 rounded-lg border border-purple-100 shadow-sm">
                    <h3 className="font-medium mb-1 flex items-center text-purple-800 text-sm">
                      <History className="text-purple-600 mr-1.5 h-4 w-4" />
                      Change History
                    </h3>
                    <div className="text-sm text-purple-700 space-y-0.5">
                      <div className="flex items-center">
                        <UserRound className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          Last modified by: <span className="font-medium">{event.lastModifiedByName}</span>
                        </span>
                      </div>
                      <div className="flex items-center">
                        <Calendar className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          {(() => {
                            try {
                              // Format with the user's timezone
                              const lastModDate = new Date(event.lastModifiedAt);
                              const formatter = new Intl.DateTimeFormat('en-US', {
                                timeZone: selectedTimezone,
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              });
                              return `Date: ${formatter.format(lastModDate)}`;
                            } catch (error) {
                              console.error('Error formatting last modified date:', error);
                              return `Date: ${new Date(event.lastModifiedAt).toLocaleDateString()}`;
                            }
                          })()}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <Clock className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          {(() => {
                            try {
                              // Format with the user's timezone
                              const lastModTime = new Date(event.lastModifiedAt);
                              const formatter = new Intl.DateTimeFormat('en-US', {
                                timeZone: selectedTimezone,
                                hour: 'numeric',
                                minute: 'numeric',
                                second: 'numeric',
                                hour12: true
                              });
                              return `Time: ${formatter.format(lastModTime)}`;
                            } catch (error) {
                              console.error('Error formatting last modified time:', error);
                              return `Time: ${new Date(event.lastModifiedAt).toLocaleTimeString()}`;
                            }
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Attendees and Response Section - Only shown when event has attendees */}
                {hasAttendees && processedAttendees.length > 0 && (
                  <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 shadow-sm">
                    <Tabs defaultValue="status" className="w-full">
                      <TabsList className="grid grid-cols-2 mb-2">
                        <TabsTrigger value="status">Attendee Status</TabsTrigger>
                        <TabsTrigger value="response">Your Response</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="status" className="space-y-4">
                        {/* Attendee Status Display */}
                        {(() => {
                          const attendeeCount = processedAttendees.length;
                          
                          // Get all attendees from processed attendees
                          if (attendeeCount > 0) {
                            // We'll handle limiting attendees in the AttendeeStatusDisplay component
                              
                            return (
                              <>
                                <AttendeeStatusDisplay 
                                  attendees={processedAttendees} 
                                  isOrganizer={isUsersOwnCalendar}
                                  showAll={showAllAttendees}
                                  onStatusClick={(status) => {
                                    setSelectedStatus(status);
                                    setStatusDialogOpen(true);
                                  }}
                                  onTimeProposalAccept={(attendeeEmail, start, end) => {
                                    // This would update the event with the proposed time
                                    console.log('Accepting time proposal from', attendeeEmail, start, end);
                                    // We'd implement this in a future update
                                  }}
                                />
                                
                                {/* Button to open dialog showing all attendees */}
                                {attendeeCount > 2 && (
                                  <button 
                                    onClick={() => {
                                      setSelectedStatus('all');
                                      setStatusDialogOpen(true);
                                    }}
                                    className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                                  >
                                    Show all {attendeeCount} attendees
                                  </button>
                                )}
                                
                                {/* All Attendees Dialog */}
                                <AttendeeDialog
                                  open={statusDialogOpen}
                                  onOpenChange={setStatusDialogOpen}
                                  attendees={processedAttendees}
                                  title={`All Attendees (${processedAttendees.length})`}
                                  description="Complete list of all attendees for this event"
                                  selectedStatus={selectedStatus || 'all'}
                                />
                              </>
                            );
                          }
                          
                          // If no processed attendees, fall back to raw extraction
                          // Always try DirectAttendeeExtractor, as it's better at extracting attendees from rawData
                          return (
                            <>
                              <div className="border rounded-md">
                                <div className="bg-muted/30 p-2 border-b">
                                  <h3 className="font-medium">Attendee List</h3>
                                </div>
                                <DirectAttendeeExtractor 
                                  rawData={typeof event.rawData === 'string' ? event.rawData : 
                                           typeof event.rawData === 'object' ? event.rawData as object : null}
                                  attendees={processedAttendees}
                                  showMoreCount={10}
                                  isPreview={false}
                                  fallbackEmail={user?.username || ""}
                                />
                              </div>
                            </>
                          );
                        })()}
                      </TabsContent>
                      
                      <TabsContent value="response" className="space-y-4">
                        {/* Attendee Response Form */}
                        {(() => {
                          // Only show response form if the current user is an attendee or if the event has attendees
                          if (user && processedAttendees.length > 0) {
                            // Check if the current user is an attendee
                            const userEmail = (user as any).email || user.username;
                            const isAttendee = processedAttendees.some((attendee: any) => 
                              (typeof attendee === 'string' && attendee === userEmail) ||
                              (typeof attendee === 'object' && 
                               attendee.email && 
                               attendee.email.toLowerCase() === userEmail.toLowerCase())
                            );
                            
                            // If user is not the organizer and is an attendee, show response form
                            if (isAttendee && !isUsersOwnCalendar) {
                              // Find organizer
                              const organizer = processedAttendees.find((attendee: any) => 
                                typeof attendee === 'object' && 
                                attendee.role && 
                                (attendee.role.toLowerCase() === 'chair' || 
                                 attendee.role.toLowerCase() === 'organizer')
                              );
                              
                              return (
                                <AttendeeResponseForm
                                  eventId={event.id}
                                  eventTitle={event.title}
                                  eventStart={startDate}
                                  eventEnd={endDate}
                                  organizer={organizer ? {
                                    email: organizer.email,
                                    name: organizer.name || organizer.email
                                  } : undefined}
                                  currentUserEmail={userEmail}
                                  onResponseSuccess={() => {
                                    console.log('Response submitted successfully');
                                    // We'll implement this in a future update
                                  }}
                                />
                              );
                            }
                          }
                          
                          return (
                            <div className="p-4 bg-gray-100 rounded-md text-center">
                              {isUsersOwnCalendar ? (
                                <p className="text-sm text-gray-600">
                                  You are the organizer of this event.
                                </p>
                              ) : (
                                <p className="text-sm text-gray-600">
                                  You are not listed as an attendee for this event.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <DialogFooter className="flex justify-between items-center mt-4 pt-4 border-t">
            <div className="flex space-x-2">
              {!isUserLoading && (
                <>
                  {/* Copy Event button */}
                  {onCopy && (
                    <Button 
                      variant="outline" 
                      className="border-green-200 text-green-600 hover:bg-green-50 flex items-center gap-1 shadow-sm"
                      onClick={() => {
                        if (!event) return;
                        onCopy(event);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      <span className="hidden sm:inline">Copy</span>
                    </Button>
                  )}
                  
                  {/* Print Event button */}
                  {onPrint && (
                    <Button 
                      variant="outline" 
                      className="border-purple-200 text-purple-600 hover:bg-purple-50 flex items-center gap-1 shadow-sm"
                      onClick={() => {
                        if (!event) return;
                        onPrint(event);
                      }}
                    >
                      <Printer className="h-4 w-4" />
                      <span className="hidden sm:inline">Print</span>
                    </Button>
                  )}
                  
                  {/* Download Event as iCalendar file */}
                  <Button 
                    variant="outline" 
                    className="border-blue-200 text-blue-600 hover:bg-blue-50 flex items-center gap-1 shadow-sm"
                    onClick={() => {
                      if (!event) return;
                      
                      // Start by setting loading state
                      setIsLoading(true);
                      
                      // Function to download via client-side (browser)
                      const downloadViaClientSide = () => {
                        try {
                          console.log('Using client-side fallback for ICS download');
                          
                          // Create a Blob with the event data
                          let icsContent = '';
                          
                          if (event.rawData) {
                            // Use the raw iCalendar data if available but sanitize it first
                            console.log('Using and sanitizing raw ICS data');
                            const rawData = typeof event.rawData === 'string' 
                              ? event.rawData 
                              : JSON.stringify(event.rawData);
                              
                            // Use our shared utility for sanitizing and formatting ICS data
                            icsContent = sanitizeAndFormatICS(rawData);
                          } else {
                            // Create basic iCalendar format
                            const startDate = new Date(event.startDate);
                            const endDate = new Date(event.endDate);
                            
                            console.log('Creating basic ICS content (no raw data available)');
                            
                            // Use the shared utility to create properly formatted ICS content
                            icsContent = createBasicICS({
                              title: event.title,
                              startDate,
                              endDate,
                              description: event.description || '',
                              location: event.location || '',
                              uid: event.uid || `event-${Date.now()}`
                            });
                          }
                          
                          // Create blob and trigger download
                          const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          
                          // Set up download attributes
                          link.href = url;
                          link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
                          document.body.appendChild(link);
                          
                          // Trigger download and clean up
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                          
                          setIsLoading(false);
                          toast({
                            title: "Downloaded Successfully",
                            description: "Calendar file downloaded using client-side method.",
                            variant: "default"
                          });
                          
                          return true;
                        } catch (err) {
                          console.error('Client-side fallback failed:', err);
                          setIsLoading(false);
                          
                          toast({
                            title: 'Download Failed',
                            description: 'Could not download ICS file even with fallback method.',
                            variant: 'destructive'
                          });
                          
                          return false;
                        }
                      };

                      // Handle download failures by switching to client-side method
                      const handleDownloadFailure = (error: any) => {
                        console.error('Download failed, attempting client-side fallback:', error);
                        downloadViaClientSide();
                      };

                      // Handle successful server response
                      const handleServerSuccess = (blob: Blob) => {
                        try {
                          // Create a local URL for the blob
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          
                          // Set up download attributes
                          link.href = url;
                          link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
                          document.body.appendChild(link);
                          
                          // Trigger download and clean up
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                          
                          setIsLoading(false);
                          toast({
                            title: "Downloaded Successfully",
                            description: "Calendar file downloaded successfully.",
                            variant: "default"
                          });
                        } catch (error) {
                          handleDownloadFailure(error);
                        }
                      };

                      // First try server-side download
                      try {
                        console.log('Attempting server-side ICS download for event ID:', event.id);
                        console.log('Has session cookie:', document.cookie.includes('connect.sid'));
                        
                        fetch(`/api/download-ics/${event.id}`, {
                          method: 'GET',
                          credentials: 'include', // Important for session cookies
                          headers: {
                            'Accept': 'text/calendar',
                            'Cache-Control': 'no-cache',
                            'X-Requested-With': 'XMLHttpRequest' // Helps with CORS
                          }
                        })
                        .then(response => {
                          console.log('ICS download response status:', response.status);
                          
                          if (!response.ok) {
                            console.error('Server download failed with status:', response.status);
                            
                            // If server download fails, try to get more information from response
                            const contentType = response.headers.get('content-type');
                            if (contentType && contentType.includes('application/json')) {
                              return response.json().then(data => {
                                console.error('Server error details:', data);
                                throw new Error(data.message || 'Server error');
                              });
                            } else {
                              throw new Error(`HTTP error ${response.status}`);
                            }
                          }
                          
                          return response.blob();
                        })
                        .then(blob => {
                          if (blob) {
                            handleServerSuccess(blob);
                          } else {
                            throw new Error('No blob data received');
                          }
                        })
                        .catch(error => {
                          handleDownloadFailure(error);
                        });
                      } catch (error) {
                        handleDownloadFailure(error);
                      }
                    }}
                  >
                    <Clock className="h-4 w-4" />
                    Download
                  </Button>
                  
                  {/* Cancel Event button has been moved to the edit form modal */}
                
                  {/* Only show edit/delete buttons if user has permission */}
                  {effectiveCanEdit && (
                    <>
                      <Button 
                        variant="outline" 
                        className="border-red-200 text-red-600 hover:bg-red-50 shadow-sm" 
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={onEdit}
                        className="shadow-sm"
                      >
                        Edit
                      </Button>
                    </>
                  )}
                </>
              )}
              {isUserLoading && (
                <div className="text-sm text-muted-foreground py-2">
                  Loading permission information...
                </div>
              )}
              {isAuthError && (
                <div className="text-sm text-muted-foreground py-2 flex items-center">
                  <Info className="text-amber-500 mr-1 h-4 w-4" />
                  <span>This event is part of a shared calendar</span>
                </div>
              )}
            </div>
            <Button onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Event Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="text-red-500 h-5 w-5" />
              Delete Event
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <div className="mb-4">
              <p className="text-lg font-medium mb-2">"{event.title}"</p>
              <p className="mb-1">Are you sure you want to delete this event? This action cannot be undone.</p>
            </div>
            
            <div className="text-sm bg-gray-50 p-3 rounded-md">
              <p className="mb-1">
                <span className="font-medium">Date:</span> {formatDayOfWeekDate(startDate)}
              </p>
              <p>
                <span className="font-medium">Time:</span> {event.allDay ? 'All Day' : formatEventTimeRange(startDate, endDate)}
              </p>
            </div>
            
            {deleteError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600 flex items-start">
                  <AlertCircle className="text-red-500 mr-1 h-4 w-4" />
                  <span>Error: {deleteError}</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleDelete}
              disabled={isDeleting}
              variant="destructive"
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Cancel Event Dialog removed - functionality moved to edit form */}
      
      {/* Resources Dialog */}
      <Dialog open={resourcesDialogOpen} onOpenChange={setResourcesDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="text-amber-600 h-5 w-5" />
              Resources ({resources.length})
            </DialogTitle>
            <DialogDescription>
              All resources booked for this event
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {resources.map((resource: any, index: number) => {
                // Get resource name/email/type from various possible formats
                const name = resource.name || resource.adminName || 'Resource';
                const email = resource.email || resource.adminEmail || '';
                const type = resource.type || resource.subType || '';
                const capacity = resource.capacity || '';
                
                return (
                  <div key={index} className="flex items-start bg-white p-3 rounded-md border border-amber-100">
                    {type.toLowerCase().includes('proj') ? (
                      <VideoIcon className="text-amber-500 mr-2 h-5 w-5 mt-0.5" />
                    ) : type.toLowerCase().includes('room') ? (
                      <DoorClosed className="text-blue-500 mr-2 h-5 w-5 mt-0.5" />
                    ) : type.toLowerCase().includes('laptop') || type.toLowerCase().includes('computer') ? (
                      <Laptop className="text-green-500 mr-2 h-5 w-5 mt-0.5" />
                    ) : (
                      <Wrench className="text-neutral-500 mr-2 h-5 w-5 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium">{name}</div>
                      <div className="text-xs text-amber-700">
                        {type || 'General Resource'}
                        {capacity && ` • Capacity: ${capacity}`}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Admin: {email}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setResourcesDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EventDetailModal;
