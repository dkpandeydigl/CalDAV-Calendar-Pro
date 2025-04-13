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
import { MailCheck, AlertTriangle, User as UserIcon, UserRound, VideoIcon, DoorClosed, Laptop, Wrench, Settings, MapPin, Info, Clock, MapPinned, AlertCircle, Trash2, Calendar, History } from 'lucide-react';
import DirectResourceExtractor from './DirectResourceExtractor';
import ResourceManager from '@/components/resources/ResourceManager';
import DirectAttendeeExtractor from './DirectAttendeeExtractor';
import AttendeeResponseForm from '../attendees/AttendeeResponseForm';
import AttendeeStatusDisplay from '../attendees/AttendeeStatusDisplay';
import AttendeeDialog from '../attendees/AttendeeDialog';

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
  const [resourcesDialogOpen, setResourcesDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUserLoading, setIsUserLoading] = useState(isUserLoadingFromAuth);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showAllAttendees, setShowAllAttendees] = useState(false); // For attendee display limit
  const [showAllResources, setShowAllResources] = useState(false); // For resource display limit (unused now - using dialog instead)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null); // For attendee status dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState(false); // For attendee status dialog
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
  
  // Check for sharingMetadata in the event (newer implementation)
  const hasSharingMetadata = !!(event as any).sharingMetadata;
  const sharingMetadata = (event as any).sharingMetadata || {};
  
  // Check if this is from a shared calendar with edit permissions
  // First check the new sharingMetadata property, then fall back to old methods
  const isFromSharedCalendarWithEditPermission = 
    (hasSharingMetadata && sharingMetadata.permissionLevel === 'edit') || 
    (calendarMetadata?.isShared === true && 
     event.calendarId && 
     sharedCalendars?.some?.(
       cal => cal.id === event.calendarId && 
         (cal.permission === 'edit' || cal.permissionLevel === 'edit')
     ));
  
  console.log(`Event ${event.id} permission check:`, {
    isUsersOwnCalendar,
    canEdit,
    isOwner,
    isFromSharedCalendarWithEditPermission,
    hasSharingMetadata,
    sharingMetadata,
    calendarMetadata,
    sharedCalendars: sharedCalendars?.filter(cal => cal.id === event.calendarId),
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

  // Function for resource extraction with improved deduplication
  const extractResourcesFromRawData = () => {
    if (!event) return [];
    
    try {
      // Create a Map to track resources by email for deduplication
      const resourceMap = new Map();
      
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
            const email = resource.adminEmail || resource.email; 
            if (email) {
              resourceMap.set(email.toLowerCase(), {
                id: resource.id || `resource-${index}-${Date.now()}`,
                adminEmail: email,
                adminName: resource.adminName || resource.name || 'Resource',
                subType: resource.subType || resource.type || '',
                capacity: resource.capacity || 1
              });
            }
          });
        }
      }
      
      // STEP 2: Now extract from VCALENDAR data if available (but don't overwrite existing entries)
      if (event.rawData && typeof event.rawData === 'string') {
        const rawDataStr = event.rawData;
        
        // Use a simple regex to find any ATTENDEE lines containing CUTYPE=RESOURCE
        const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
        const matches = Array.from(rawDataStr.matchAll(resourceRegex));
        
        if (matches && matches.length > 0) {
          matches.forEach((match, index) => {
            const fullLine = match[0]; // The complete ATTENDEE line 
            const email = match[1]; // The captured email group
            
            // Skip if we already have this resource by email
            if (email && !resourceMap.has(email.toLowerCase())) {
              // Extract resource name from CN
              const cnMatch = fullLine.match(/CN=([^;:]+)/);
              const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
              
              // Extract resource type
              const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
              const resourceType = typeMatch ? typeMatch[1].trim() : '';
              
              resourceMap.set(email.toLowerCase(), {
                id: `resource-${index}-${Date.now()}`,
                adminEmail: email,
                adminName: name,
                subType: resourceType,
                capacity: 1
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

  // Check if this event has attendees or resources
  const hasAttendees = Boolean(
    event.attendees && 
    (Array.isArray(event.attendees) ? event.attendees.length > 0 : true)
  );
  
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
  
  // Process attendees from event data
  const processedAttendees = event.attendees ? 
    (Array.isArray(event.attendees) ? event.attendees : [event.attendees]) : 
    [];

  // Handle Delete Event action
  const handleDelete = async () => {
    if (!event || !event.id || isDeleting) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      await deleteEvent(event.id);
      setDeleteDialogOpen(false);
      onClose(); // Close the modal after successful deletion
    } catch (error) {
      console.error('Error deleting event:', error);
      setDeleteError('Failed to delete the event. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Handle Cancel Event action (sends cancellation notices)
  const handleCancel = async () => {
    if (!event || !event.id || isCancelling) return;
    
    setIsCancelling(true);
    setCancelError(null);
    
    try {
      await cancelEvent(event.id);
      setCancelDialogOpen(false);
      onClose(); // Close the modal after successful cancellation
    } catch (error) {
      console.error('Error cancelling event:', error);
      setCancelError('Failed to cancel the event. Please try again.');
    } finally {
      setIsCancelling(false);
    }
  };

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
          <div className="space-y-5">
            {/* Top heading with title and calendar info */}
            <div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold" title={event.title.length > 50 ? event.title : undefined}>
                  {event.title.length > 50 ? `${event.title.substring(0, 50)}...` : event.title}
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

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Left column */}
              <div className="space-y-4">
                {/* Date and time card with improved visual design */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 shadow-sm">
                  <div className="flex flex-col space-y-3">
                    <div className="flex items-center">
                      <Clock className="text-blue-600 mr-3 h-5 w-5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">
                          {formatDayOfWeekDate(startDate)}
                        </div>
                        <div className="text-sm text-blue-700">
                          {event.allDay 
                            ? 'All Day' 
                            : formatEventTimeRange(startDate, endDate)}
                          {event.timezone && <span className="text-blue-600/70 text-xs ml-1">({event.timezone})</span>}
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
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-medium mb-2 flex items-center">
                      <Info className="text-gray-600 mr-2 h-4 w-4" />
                      Description
                    </h3>
                    <div 
                      className="text-sm prose prose-sm max-w-none overflow-auto max-h-[150px] bg-white p-3 rounded border border-gray-100"
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
                
                {/* Event Modification History - show when available */}
                {event.lastModifiedByName && event.lastModifiedAt && (
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 shadow-sm">
                    <h3 className="font-medium mb-2 flex items-center text-purple-800">
                      <History className="text-purple-600 mr-2 h-4 w-4" />
                      Change History
                    </h3>
                    <div className="text-sm text-purple-700 space-y-1">
                      <div className="flex items-center">
                        <UserRound className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          Last modified by: <span className="font-medium">{event.lastModifiedByName}</span>
                        </span>
                      </div>
                      <div className="flex items-center">
                        <Calendar className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          Date: {new Date(event.lastModifiedAt).toLocaleDateString()} 
                        </span>
                      </div>
                      <div className="flex items-center">
                        <Clock className="text-purple-500 mr-2 h-4 w-4" />
                        <span>
                          Time: {new Date(event.lastModifiedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Resources section with improved visual display */}
                {(() => {
                  const extractedResources = extractResourcesFromRawData();
                  const resourceCount = extractedResources.length;
                  console.log('Parsed resources:', extractedResources);
                  
                  // Display resources if we have any
                  if (resourceCount > 0) {
                    // Display only 2 resources by default, with dialog for viewing all
                    const displayResources = extractedResources.slice(0, 2);
                    
                    return (
                      <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 shadow-sm">
                        <h3 className="font-medium mb-2 flex items-center text-amber-800">
                          <Settings className="text-amber-600 mr-2 h-4 w-4" />
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
                
                {/* Attendees and Response Section - Only shown when event has attendees */}
                {hasAttendees && processedAttendees.length > 0 && (
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                    <Tabs defaultValue="status" className="w-full">
                      <TabsList className="grid grid-cols-2 mb-4">
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
                                {attendeeCount > 3 && (
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
                          return (
                            <>
                              <DirectAttendeeExtractor 
                                rawData={typeof event.rawData === 'string' ? event.rawData : null} 
                                showMoreCount={10}
                                isPreview={false}
                              />
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
                  {/* Download Event as iCalendar file */}
                  <Button 
                    variant="outline" 
                    className="border-blue-200 text-blue-600 hover:bg-blue-50 flex items-center gap-1 shadow-sm"
                    onClick={() => {
                      if (!event) return;
                      
                      // Create a Blob with the event data (either raw data or basic iCalendar format)
                      let icsContent = '';
                      
                      if (event.rawData && typeof event.rawData === 'string') {
                        // Use the raw iCalendar data if available
                        icsContent = event.rawData;
                      } else {
                        // Create basic iCalendar format
                        const startDate = new Date(event.startDate);
                        const endDate = new Date(event.endDate);
                        
                        // Format dates as required by iCalendar format (UTC)
                        const formatDate = (date: Date) => {
                          return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/g, '');
                        };
                        
                        icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//XGenCal//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
SUMMARY:${event.title}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
DESCRIPTION:${event.description || ''}
LOCATION:${event.location || ''}
UID:${event.uid || `event-${Date.now()}`}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
                      }
                      
                      // Create blob and download link
                      const blob = new Blob([icsContent], { type: 'text/calendar' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Clock className="h-4 w-4" />
                    Download
                  </Button>
                  
                  {/* Show Cancel Event button for events with attendees or resources on the user's calendar, or for DK Pandey */}
                  {shouldShowCancelButton && (
                    <Button 
                      variant="outline" 
                      className="border-amber-200 text-amber-600 hover:bg-amber-50 flex items-center gap-1 shadow-sm" 
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
                const attendees = event.attendees;
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
            </div>
            
            <div className="text-sm bg-amber-50 p-3 rounded-md border border-amber-200">
              <div className="flex items-start mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mr-2 mt-0.5" />
                <p className="text-amber-800">
                  This action will send a cancellation email to all attendees and then delete the event.
                </p>
              </div>
              <p className="text-xs text-amber-700">
                The event will be marked as CANCELLED in all calendars.
              </p>
            </div>
            
            {cancelError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600 flex items-start">
                  <AlertCircle className="text-red-500 mr-1 h-4 w-4" />
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
