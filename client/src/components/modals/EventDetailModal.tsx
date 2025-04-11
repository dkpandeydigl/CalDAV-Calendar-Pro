import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { MailCheck, AlertTriangle } from 'lucide-react';
import DirectResourceExtractor from './DirectResourceExtractor';

// Skip TypeScript errors for the JSON fields - they're always going to be tricky to handle
// since they come from dynamic sources. Instead we'll do runtime checks.

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
}

const EventDetailModal: React.FC<EventDetailModalProps> = ({ 
  open, 
  event, 
  onClose,
  onEdit
}) => {
  // Hook calls - all must be at the top level
  const { calendars } = useCalendars();
  const { deleteEvent, cancelEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoadingFromAuth } = useAuth();
  const queryClient = useQueryClient();
  
  // State hooks - always place ALL hooks at the top level before any conditional logic
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUserLoading, setIsUserLoading] = useState(isUserLoadingFromAuth);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
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
  
  const isFromSharedCalendarWithEditPermission = 
    calendarMetadata?.isShared === true && 
    event.calendarId && 
    sharedCalendars?.some?.(
      cal => cal.id === event.calendarId && cal.permission === 'edit'
    );
  
  console.log(`Event ${event.id} permission check:`, {
    isUsersOwnCalendar,
    canEdit,
    isOwner,
    isFromSharedCalendarWithEditPermission,
    calendarMetadata
  });
  
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
  
  // Parse and extract attendees from raw data if needed
  const extractAttendeesFromRawData = () => {
    if (!event.rawData) return [];
    
    try {
      // First, try to parse the raw data as JSON
      let rawData;
      
      if (typeof event.rawData === 'string') {
        try {
          rawData = JSON.parse(event.rawData);
        } catch (e) {
          // If it can't be parsed as JSON, it might be a raw iCalendar string
          // Look for attendee lines in iCalendar format
          const attendeeRegex = /ATTENDEE[^:\r\n]+:[^\r\n]+/g;
          const matches = event.rawData.match(attendeeRegex);
          
          if (matches && matches.length > 0) {
            console.log(`Found ${matches.length} attendee lines in raw iCalendar data`);
            
            return matches.map(line => {
              const emailMatch = line.match(/mailto:([^>\r\n]+)/);
              const email = emailMatch ? emailMatch[1].trim() : '';
              
              const nameMatch = line.match(/CN=([^;:]+)/);
              const name = nameMatch ? nameMatch[1].trim() : '';
              
              const roleMatch = line.match(/ROLE=([^;:]+)/);
              const role = roleMatch ? roleMatch[1].trim() : '';
              
              const isResource = line.includes('CUTYPE=RESOURCE');
              
              return {
                email,
                name: name || email,
                role,
                isResource
              };
            }).filter(attendee => !attendee.isResource && attendee.email);
          }
          
          return []; // No attendees found in iCalendar format
        }
      } else {
        // It's already an object
        rawData = event.rawData;
      }
      
      if (rawData && typeof rawData === 'object') {
        // Check for attendees in various possible formats
        const attendeesInRaw = rawData.attendees || rawData.ATTENDEE || rawData.ATTENDEES;
        
        if (attendeesInRaw) {
          if (Array.isArray(attendeesInRaw)) {
            return attendeesInRaw;
          } else if (typeof attendeesInRaw === 'string') {
            try {
              // It might be a stringified array
              return JSON.parse(attendeesInRaw);
            } catch (e) {
              // It's a single attendee as string
              return [{ email: attendeesInRaw }];
            }
          } else {
            // It's a single attendee object
            return [attendeesInRaw];
          }
        }
      }
      
      return []; // No attendees found
    } catch (e) {
      console.warn('Error extracting attendees from raw data:', e);
      return [];
    }
  };
  
  // Parse and extract resources from raw data if needed
  const extractResourcesFromRawData = () => {
    if (!event) return [];
    
    console.log('RESOURCE DEBUG - Extracting resources from event:', event.title);
    
    try {
      // DIRECT EXTRACTION FROM VCALENDAR DATA
      // This is the most reliable method as it works with the raw iCalendar data
      if (event.rawData && typeof event.rawData === 'string') {
        const rawDataStr = event.rawData;
        console.log('RESOURCE DEBUG - Raw data available, length:', rawDataStr.length);
        
        // Use a simple regex to find any ATTENDEE lines containing CUTYPE=RESOURCE
        const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
        const matches = [...rawDataStr.matchAll(resourceRegex)];
        
        if (matches && matches.length > 0) {
          console.log(`RESOURCE DEBUG - Found ${matches.length} resource matches in raw data:`, matches);
          
          const extractedResources = matches.map((match, index) => {
            const fullLine = match[0]; // The complete ATTENDEE line 
            const email = match[1]; // The captured email group
            
            // Extract resource name from CN
            const cnMatch = fullLine.match(/CN=([^;:]+)/);
            const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
            
            // Extract resource type
            const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
            const resourceType = typeMatch ? typeMatch[1].trim() : '';
            
            const resource = {
              id: `resource-${index}-${Date.now()}`,
              adminEmail: email,
              adminName: name,
              subType: resourceType,
              capacity: 1
            };
            
            console.log(`RESOURCE DEBUG - Extracted resource: ${name}, email: ${email}, type: ${resourceType}`);
            return resource;
          });
          
          if (extractedResources.length > 0) {
            console.log('RESOURCE DEBUG - Successfully extracted resources from raw VCALENDAR data', extractedResources);
            return extractedResources;
          }
        } else {
          console.log('RESOURCE DEBUG - No resource matches found in raw data');
        }
      }
      
      // FALLBACK 1: Check already parsed resources
      if (event.resources) {
        console.log('RESOURCE DEBUG - Checking event.resources:', event.resources);
        
        if (typeof event.resources === 'string') {
          try {
            const parsedResources = JSON.parse(event.resources);
            if (Array.isArray(parsedResources) && parsedResources.length > 0) {
              console.log('RESOURCE DEBUG - Successfully parsed resources from JSON string');
              return parsedResources;
            }
          } catch (e) {
            console.warn('RESOURCE DEBUG - Failed to parse resources JSON:', e);
          }
        } else if (Array.isArray(event.resources) && event.resources.length > 0) {
          console.log('RESOURCE DEBUG - Using existing resources array');
          return event.resources;
        }
      }
      
      // FALLBACK 2: Try one last time with manual regex on the title
      // This is very hacky but can catch resources mentioned in the title
      if (event.title && event.title.toLowerCase().includes('resource')) {
        console.log('RESOURCE DEBUG - Trying to extract resources from title');
        const match = event.title.match(/resource\s*[:,-]?\s*([^,]+)/i);
        if (match && match[1]) {
          const resourceName = match[1].trim();
          console.log(`RESOURCE DEBUG - Extracted potential resource from title: ${resourceName}`);
          return [{
            id: `resource-title-${Date.now()}`,
            adminName: resourceName,
            adminEmail: '',
            subType: '',
            capacity: 1
          }];
        }
      }
    } catch (error) {
      console.error('RESOURCE DEBUG - Error extracting resources:', error);
    }
    
    console.log('RESOURCE DEBUG - No resources found');
    return [];
  };
  
  // Process attendees data
  const processedAttendees = (() => {
    // First check if we already have parsed attendees
    if (event.attendees) {
      if (typeof event.attendees === 'string') {
        try {
          const parsedAttendees = JSON.parse(event.attendees);
          if (Array.isArray(parsedAttendees) && parsedAttendees.length > 0) {
            return parsedAttendees;
          }
        } catch (e) {
          console.warn('Failed to parse attendees JSON:', e);
        }
      } else if (Array.isArray(event.attendees) && event.attendees.length > 0) {
        return event.attendees;
      }
    }
    
    // If we don't have attendees yet, try to extract them from raw data
    return extractAttendeesFromRawData();
  })();
  
  // Process resources data
  const processedResources = (() => {
    // First check if we already have parsed resources
    if (event.resources) {
      if (typeof event.resources === 'string') {
        try {
          const parsedResources = JSON.parse(event.resources);
          if (Array.isArray(parsedResources) && parsedResources.length > 0) {
            return parsedResources;
          }
        } catch (e) {
          console.warn('Failed to parse resources JSON:', e);
        }
      } else if (Array.isArray(event.resources) && event.resources.length > 0) {
        return event.resources;
      }
    }
    
    // If we don't have resources yet, try to extract them from raw data
    return extractResourcesFromRawData();
  })();
  
  console.log('Raw resources data:', event.resources);
  console.log('Parsed resources:', processedResources);
  
  // Check if event has attendees
  const hasAttendees = processedAttendees.length > 0;
  
  // Check if event has resources
  const hasResources = processedResources.length > 0;

  // Determine if the event should show a Cancel Event button
  // We want to show this button for ANY of these cases:
  // 1. User is DK Pandey (ID 4) and viewing ANY event with attendees/resources (per client request)
  // 2. The event belongs to user's own calendar AND has attendees/resources
  // 3. User has edit permissions for this calendar AND the event has attendees/resources
  
  let shouldShowCancelButton = false;
  
  // Special case for DK Pandey (USER ID 4) - allow cancelling any events with attendees
  if (user?.id === 4 && (hasAttendees || hasResources)) {
    shouldShowCancelButton = true;
    console.log('Cancel button enabled for DK Pandey via special case');
  }
  // Standard case: user owns the event and it has attendees or resources
  else if (isUsersOwnCalendar && (hasAttendees || hasResources)) {
    shouldShowCancelButton = true;
    console.log('Cancel button enabled: User owns calendar and event has attendees/resources');
  }
  // User has edit permissions and event has attendees/resources
  else if (effectiveCanEdit && (hasAttendees || hasResources)) {
    shouldShowCancelButton = true;
    console.log('Cancel button enabled: User has edit permissions and event has attendees/resources');
  }
  
  console.log('Cancel button check:', { 
    shouldShowCancelButton, 
    isDKPandey: user?.id === 4,
    hasAttendees, 
    hasResources,
    isUsersOwnCalendar,
    effectiveCanEdit
  });
  
  // Handle delete event
  const handleDelete = async () => {
    if (!event) return;
    
    // Clear any previous errors
    setDeleteError(null);
    
    try {
      setIsDeleting(true);
      
      // Call the delete mutation
      await deleteEvent(event.id);
      
      // Force UI refresh after successful deletion
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      if (event.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', event.calendarId, 'events'] 
        });
      }
      
      // Close dialogs and cleanup
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error(`Error during delete: ${(error as Error).message}`);
      
      // Show the error in the alert dialog
      setDeleteError((error as Error).message || 'Failed to delete event');
      setIsDeleting(false);
      
      // We don't close dialogs on error so user can retry
    }
  };
  
  // Handle cancel event with notifications
  const handleCancel = async () => {
    if (!event) return;
    
    // Clear any previous errors
    setCancelError(null);
    
    try {
      setIsCancelling(true);
      
      // Call the cancel mutation
      await cancelEvent(event.id);
      
      // Force UI refresh after successful cancellation
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      if (event.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', event.calendarId, 'events'] 
        });
      }
      
      // Close dialogs and cleanup
      setIsCancelling(false);
      setCancelDialogOpen(false);
      onClose();
    } catch (error) {
      console.error(`Error during cancel: ${(error as Error).message}`);
      
      // Show the error in the dialog
      setCancelError((error as Error).message || 'Failed to cancel event');
      setIsCancelling(false);
      
      // We don't close dialogs on error so user can retry
    }
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
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
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold" title={event.title.length > 30 ? event.title : undefined}>
                  {event.title.length > 30 ? `${event.title.substring(0, 30)}...` : event.title}
                </h1>
                
                {/* Sync status indicator */}
                {event.syncStatus && (
                  <div 
                    className={`text-xs px-2 py-1 rounded-full ${
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
                <div className="text-sm text-neutral-500 flex items-center">
                  <span 
                    className="w-3 h-3 rounded-full mr-2" 
                    style={{ backgroundColor: calendarColor || calendar.color }}
                  ></span>
                  {calendarName || calendar.name} {!calendarName && "Calendar"}
                </div>
              )}
            </div>
            
            <div className="flex items-start mb-3 p-2 bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg border border-primary/20">
              <span className="material-icons text-primary mr-2 bg-white p-1 rounded-md shadow-sm">schedule</span>
              <div>
                <div className="text-sm font-medium text-primary/90">{formatDayOfWeekDate(startDate)}</div>
                <div className="text-sm text-primary/80">
                  {event.allDay 
                    ? '🕒 All Day' 
                    : `🕒 ${formatEventTimeRange(startDate, endDate)}`}
                  {' '}({event.timezone})
                </div>
              </div>
            </div>
            
            {event.location && (
              <div className="flex items-start mb-3 p-2 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border border-blue-200">
                <span className="material-icons text-blue-500 mr-2 bg-white p-1 rounded-md shadow-sm">location_on</span>
                <div className="text-sm font-medium text-blue-700">{event.location}</div>
              </div>
            )}
            
            {event.description && typeof event.description === 'string' && (
              <div>
                <div className="text-sm font-medium mb-1">
                  <span>Description</span>
                </div>
                <div 
                  className="text-sm p-3 bg-neutral-50 rounded-md rich-text-content shadow-inner border border-neutral-200 line-clamp-3 hover:line-clamp-none hover:max-h-[12em] hover:overflow-y-auto pr-2"
                  dangerouslySetInnerHTML={{ __html: event.description }}
                />
              </div>
            )}
            
            {/* Direct Resource Extractor Component */}
            {typeof event.rawData === 'string' && (
              <DirectResourceExtractor rawData={event.rawData} />
            )}
            
            {/* Attendees section - handle safely with runtime checks */}
            {(() => {
              const attendees = event.attendees as unknown;
              if (attendees && Array.isArray(attendees) && attendees.length > 0) {
                return (
                  <div>
                    <div className="text-sm font-medium mb-1">
                      <span>Attendees ({attendees.length})</span>
                    </div>
                    <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
                      <ul className="space-y-2 max-h-[10em] overflow-y-auto pr-2">
                        {attendees
                          .filter(Boolean)
                          .slice(0, 2) // Show only the first 2 attendees
                          .map((attendee, index) => {
                            // Handle both string and object formats
                            if (typeof attendee === 'object' && attendee !== null) {
                              // Object format with email and role
                              const { email, role } = attendee as { email: string; role?: string };
                              return (
                                <li key={index} className="flex items-start">
                                  <span className="material-icons text-neutral-500 mr-2 text-sm mt-0.5">person</span>
                                  <div>
                                    <div className="font-medium">{email}</div>
                                    {role && (
                                      <div className="text-xs text-muted-foreground">
                                        <span className={`inline-block px-2 py-0.5 rounded ${
                                          role === 'Chairman' ? 'bg-red-100 text-red-800' : 
                                          role === 'Secretary' ? 'bg-blue-100 text-blue-800' : 
                                          'bg-gray-100 text-gray-800'
                                        }`}>
                                          {role}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </li>
                              );
                            } else {
                              // Fallback for string format
                              return (
                                <li key={index} className="flex items-center">
                                  <span className="material-icons text-neutral-500 mr-2 text-sm">person</span>
                                  {String(attendee)}
                                </li>
                              );
                            }
                          })}
                        {attendees.length > 2 && (
                          <li className="text-xs text-muted-foreground italic text-center py-1">
                            <span className="bg-slate-200 px-2 py-0.5 rounded-full text-slate-500">
                              + {attendees.length - 2} more attendee{attendees.length > 3 ? 's' : ''}
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            
            {/* Resources section - handle safely with runtime checks */}
            {(() => {
              // Advanced handling of resources with enhanced parsing logic
              let resourcesData = event.resources as unknown;
              console.log('Raw resources data:', resourcesData);
              
              // Handle cases where resources might be deeply nested in JSON strings
              const parseResourcesData = (data: any): any[] => {
                if (!data) return [];
                
                // If already an array, use it
                if (Array.isArray(data)) return data;
                
                // If it's a string, try to parse it
                if (typeof data === 'string') {
                  try {
                    // First try direct JSON.parse
                    const parsed = JSON.parse(data);
                    return Array.isArray(parsed) ? parsed : [parsed];
                  } catch (e) {
                    // If that fails, try removing extra quotes (double-escaped JSON)
                    try {
                      // Handle double-escaped JSON strings from PostgreSQL or CalDAV server
                      const cleanedString = data
                        .replace(/\\"/g, '"')
                        .replace(/^"|"$/g, '')
                        .replace(/\\\\/g, '\\');
                        
                      try {
                        const parsed = JSON.parse(cleanedString);
                        return Array.isArray(parsed) ? parsed : [parsed];
                      } catch (e3) {
                        // Try one more level of escaping for deeply nested cases
                        const deepCleanedString = cleanedString
                          .replace(/\\\\"/g, '"')
                          .replace(/\\\"/g, '"');
                        try {
                          const parsed = JSON.parse(deepCleanedString);
                          return Array.isArray(parsed) ? parsed : [parsed];
                        } catch (e4) {
                          console.warn('Failed all attempts to parse complex JSON string');
                          // If it's just a simple string, return it as an item
                          return [data];
                        }
                      }
                    } catch (e2) {
                      console.warn('Failed to parse resources string:', e2);
                      // If it's just a simple string, return it as an item
                      return [data];
                    }
                  }
                }
                
                // If it's an object but not an array, wrap it
                if (typeof data === 'object' && data !== null) {
                  return [data];
                }
                
                return [];
              };
              
              // Process the resources data
              const parsedResources = parseResourcesData(resourcesData);
              console.log('Parsed resources:', parsedResources);
              
              if (parsedResources.length > 0) {
                return (
                  <div>
                    <div className="text-sm font-medium mb-1">
                      <span>Resources ({parsedResources.length})</span>
                    </div>
                    <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
                      <ul className="space-y-1 max-h-[10em] overflow-y-auto pr-2">
                        {parsedResources
                          .slice(0, 1) // Show only the first resource
                          .map((resource: any, index) => {
                          try {
                            // Parse resource if it's a string that might be JSON
                            let resourceObj = resource;
                            if (typeof resource === 'string') {
                              try {
                                if (resource.startsWith('{') || resource.startsWith('[')) {
                                  resourceObj = JSON.parse(resource);
                                } else if (resource.includes('\\\"') || resource.includes('\\\\')) {
                                  // Handle escaped JSON strings
                                  const cleanedString = resource
                                    .replace(/\\"/g, '"')
                                    .replace(/^"|"$/g, '')
                                    .replace(/\\\\/g, '\\');
                                    
                                  try {
                                    resourceObj = JSON.parse(cleanedString);
                                  } catch (e2) {
                                    // Try one more level of escaping for deeply nested cases
                                    const deepCleanedString = cleanedString
                                      .replace(/\\\\"/g, '"')
                                      .replace(/\\\"/g, '"');
                                    try {
                                      resourceObj = JSON.parse(deepCleanedString);
                                    } catch (e3) {
                                      // Keep original
                                    }
                                  }
                                }
                              } catch (e) {
                                // Keep as string if parsing fails
                                console.warn('Failed to parse individual resource JSON:', e);
                              }
                            }
                            
                            // Check if we have a structured resource object with more flexible criteria
                            const isResourceObject = 
                              resourceObj && 
                              typeof resourceObj === 'object' && 
                              !Array.isArray(resourceObj) &&
                              (
                                // Either has type info
                                ('subType' in resourceObj || 'type' in resourceObj) ||
                                // Or admin contact info
                                ('adminEmail' in resourceObj || 'email' in resourceObj) ||
                                // Or is a resource with capacity info
                                ('id' in resourceObj && 'capacity' in resourceObj) ||
                                // Or has specific resource markers
                                ('resourceId' in resourceObj || 'resourceType' in resourceObj)
                              );
                            
                            if (isResourceObject) {
                              // Handle both property naming conventions
                              const subType = resourceObj.subType || resourceObj.type || 'Resource';
                              const adminEmail = resourceObj.adminEmail || resourceObj.email || 'No admin email';
                              const adminName = resourceObj.adminName || resourceObj.name || adminEmail;
                              const capacity = 
                                resourceObj.capacity !== undefined 
                                  ? resourceObj.capacity 
                                  : 'Not specified';
                              const remarks = resourceObj.remarks || resourceObj.description || '';
                              
                              return (
                                <li key={index} className="flex items-start mb-2">
                                  <span className="material-icons text-neutral-500 mr-2 text-sm mt-0.5">meeting_room</span>
                                  <div>
                                    <div className="font-medium">{subType}</div>
                                    <div className="text-xs text-neutral-600">
                                      Capacity: {capacity}
                                    </div>
                                    <div className="text-xs text-neutral-600">
                                      Administrator: {adminName}
                                    </div>
                                    {remarks && (
                                      <div className="text-xs text-neutral-600 italic mt-1">{remarks}</div>
                                    )}
                                  </div>
                                </li>
                              );
                            } else {
                              // Display simple string resources
                              const displayValue = typeof resourceObj === 'object' 
                                ? 'Resource' // Fallback for objects without expected properties
                                : String(resourceObj);
                              
                              return (
                                <li key={index} className="flex items-center">
                                  <span className="material-icons text-neutral-500 mr-2 text-sm">room</span>
                                  {displayValue}
                                </li>
                              );
                            }
                          } catch (error) {
                            console.error('Error rendering resource:', error);
                            return (
                              <li key={index} className="flex items-center">
                                <span className="material-icons text-neutral-500 mr-2 text-sm">error</span>
                                Error displaying resource
                              </li>
                            );
                          }
                        })}
                        {parsedResources.length > 1 && (
                          <li className="text-xs text-muted-foreground italic text-center py-1">
                            <span className="bg-slate-200 px-2 py-0.5 rounded-full text-slate-500">
                              + {parsedResources.length - 1} more resource{parsedResources.length > 2 ? 's' : ''}
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {!isUserLoading && (
                <>
                  {/* Show Cancel Event button for events with attendees or resources on the user's calendar, or for DK Pandey */}
                  {shouldShowCancelButton && (
                    <Button 
                      variant="outline" 
                      className="border-amber-200 text-amber-600 hover:bg-amber-50 flex items-center gap-1" 
                      onClick={() => setCancelDialogOpen(true)}
                    >
                      <MailCheck className="h-4 w-4" />
                      Cancel Event
                    </Button>
                  )}
                  
                  {/* Only show edit/delete buttons if user has permission */}
                  {effectiveCanEdit && (
                    <>
                      <Button 
                        variant="outline" 
                        className="border-red-200 text-red-600 hover:bg-red-50" 
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        Delete
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={onEdit}
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
                  <span className="material-icons text-amber-500 mr-1 text-sm">info</span>
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-primary hover:text-primary/80 font-normal"
                    onClick={() => {
                      onClose();
                      window.location.href = '/auth';
                    }}
                  >
                    Log in to edit events
                  </Button>
                </div>
              )}
            </div>
            <Button onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Use a Dialog instead of AlertDialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <span className="material-icons text-red-500">warning</span>
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
                  <span className="material-icons text-red-500 mr-1 text-sm">error</span>
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
      
      {/* Cancel Event Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-600 flex items-center gap-2">
              <MailCheck className="h-5 w-5" />
              Cancel Event with Notifications
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <div className="mb-4">
              <p className="text-lg font-medium mb-2">"{event.title}"</p>
              <p className="mb-1 text-sm">
                This will notify all attendees that the event has been cancelled and remove it from their calendars.
              </p>
              
              {/* Show attendees */}
              {(() => {
                const attendees = event.attendees as unknown;
                if (attendees && Array.isArray(attendees) && attendees.length > 0) {
                  return (
                    <div className="mt-3">
                      <p className="text-sm font-medium mb-1">Attendees to be notified:</p>
                      <div className="text-sm p-3 bg-gray-50 rounded-md">
                        <ul className="space-y-1 list-disc pl-5">
                          {attendees
                            .filter(Boolean)
                            .map((attendee, index) => {
                              if (typeof attendee === 'object' && attendee !== null) {
                                return <li key={index}>{(attendee as any).email}</li>;
                              } else {
                                return <li key={index}>{String(attendee)}</li>;
                              }
                            })}
                        </ul>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Show resources */}
              {(() => {
                // Use the same parsing approach we used above for resources
                let resourcesData = event.resources as unknown;
                if (!resourcesData) return null;
                
                // Parse the resources data
                const parseResourcesData = (data: any): any[] => {
                  if (!data) return [];
                  
                  // If already an array, use it
                  if (Array.isArray(data)) return data;
                  
                  // If it's a string, try to parse it
                  if (typeof data === 'string') {
                    try {
                      // First try direct JSON.parse
                      const parsed = JSON.parse(data);
                      return Array.isArray(parsed) ? parsed : [parsed];
                    } catch (e) {
                      // If that fails, try removing extra quotes
                      try {
                        const cleanedString = data.replace(/\\"/g, '"').replace(/^"|"$/g, '').replace(/\\\\/g, '\\');
                        const parsed = JSON.parse(cleanedString);
                        return Array.isArray(parsed) ? parsed : [parsed];
                      } catch (e2) {
                        // Last resort, treat as a simple string
                        return [data];
                      }
                    }
                  }
                  
                  // If it's an object but not an array, wrap it
                  if (typeof data === 'object' && data !== null) {
                    return [data];
                  }
                  
                  return [];
                };
                
                // Process the resources
                const resources = parseResourcesData(resourcesData);
                if (resources.length > 0) {
                  return (
                    <div className="mt-3">
                      <p className="text-sm font-medium mb-1">Resources to be released:</p>
                      <div className="text-sm p-3 bg-gray-50 rounded-md">
                        <ul className="space-y-1 list-disc pl-5">
                          {resources.map((resource, index) => {
                            // Handle both string and object formats
                            if (typeof resource === 'object' && resource !== null) {
                              // Extract the email, name, or id for display
                              const email = resource.email || resource.adminEmail;
                              const name = resource.name || resource.subType || resource.id;
                              const display = name || email || 'Resource';
                              const detail = resource.subType || resource.id;
                              
                              return <li key={index}>{display} {detail ? `(${detail})` : ''}</li>;
                            } else {
                              // Simple string format
                              return <li key={index}>{String(resource)}</li>;
                            }
                          })}
                        </ul>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            
            <div className="text-sm bg-amber-50 p-3 rounded-md border border-amber-200">
              <div className="flex items-start mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mr-2 mt-0.5" />
                <p className="text-amber-800">
                  This action will send a cancellation email to all attendees, release any booked resources, and then delete the event.
                </p>
              </div>
              <p className="text-xs text-amber-700">
                The event will be marked as CANCELLED in all calendars, and any reserved resources will be released.
              </p>
            </div>
            
            {cancelError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600 flex items-start">
                  <span className="material-icons text-red-500 mr-1 text-sm">error</span>
                  <span>Error: {cancelError}</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => setCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              Back
            </Button>
            <Button 
              onClick={handleCancel}
              disabled={isCancelling}
              variant="default"
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {isCancelling ? 'Sending Cancellations...' : 'Send Cancellation & Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EventDetailModal;
