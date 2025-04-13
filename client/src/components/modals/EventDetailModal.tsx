import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { formatDayOfWeekDate, formatEventTimeRange } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCalendarPermissions } from '@/hooks/useCalendarPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { 
  MailCheck, AlertTriangle, User as UserIcon, UserRound, 
  VideoIcon, DoorClosed, Laptop, Wrench, Settings, 
  MapPin, Info, Clock, MapPinned, AlertCircle, 
  Trash2, Calendar, History 
} from 'lucide-react';
import DirectResourceExtractor from './DirectResourceExtractor';
import ResourceManager from '@/components/resources/ResourceManager';
import DirectAttendeeExtractor from './DirectAttendeeExtractor';
import AttendeeResponseForm from '../attendees/AttendeeResponseForm';
import AttendeeStatusDisplay from '../attendees/AttendeeStatusDisplay';
import AttendeeDialog from '../attendees/AttendeeDialog';

/**
 * Helper function to sanitize and process description content for display
 * Handles both HTML and plain text descriptions from different CalDAV clients
 */
function sanitizeDescriptionForDisplay(description: string | any): string {
  if (!description) return '';
  
  // If it's not a string, try to convert it
  const descStr = typeof description === 'string' 
    ? description 
    : (description.toString ? description.toString() : JSON.stringify(description));
  
  // Handle Thunderbird's special format
  if (descStr.includes('"ALTREP"') || descStr.includes('"params"')) {
    try {
      // Extract the actual content from Thunderbird format
      const valMatch = descStr.match(/"val"\s*:\s*"([^"]+)"/);
      if (valMatch && valMatch[1]) {
        return valMatch[1].replace(/\\n/g, '<br>').replace(/\\/g, '');
      }
      
      // Try ALTREP if val wasn't found
      const altrepMatch = descStr.match(/"ALTREP"\s*:\s*"data:text\/html[^"]*,([^"]+)"/);
      if (altrepMatch && altrepMatch[1]) {
        try {
          return decodeURIComponent(altrepMatch[1]);
        } catch (e) {
          return altrepMatch[1];
        }
      }
      
      // Fallback to cleaning up the text
      return descStr
        .replace(/["[\]{}]/g, '')
        .replace(/params:|ALTREP:|val:/g, '')
        .replace(/data:text\/html[^,]*,/g, '')
        .trim();
        
    } catch (e) {
      console.error('Error parsing Thunderbird format:', e);
    }
  }
  
  // If it already has HTML tags, return as is
  if (descStr.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
    return descStr;
  }
  
  // Handle escaped HTML
  if (descStr.includes('&lt;') && descStr.includes('&gt;')) {
    const unescaped = descStr
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    if (unescaped.match(/<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/i)) {
      return unescaped;
    }
  }
  
  // Plain text with line breaks
  return descStr
    .replace(/\\n/g, '<br>')
    .replace(/\n/g, '<br>');
}

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
  if (!event) return null;
  
  // State for dialog opens
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [resourcesDialogOpen, setResourcesDialogOpen] = useState(false);
  const [showAllAttendees, setShowAllAttendees] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  
  // Resources array for dialog
  const [resources, setResources] = useState<any[]>([]);
  const [processedAttendees, setProcessedAttendees] = useState<any[]>([]);
  
  // Auth and permissions hooks
  const { user, isAuthError, isLoading: isUserLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data: calendar } = useCalendars(event.calendarId);
  const { mutateAsync: deleteEvent } = useCalendarEvents.delete();
  
  // Get permission states
  const { canEdit, isLoading: isPermissionsLoading } = useCalendarPermissions(event.calendarId);
  
  // Compute if this is the user's own calendar
  const isUsersOwnCalendar = useMemo(() => {
    if (!user || !calendar) return false;
    return calendar.userId === user.id;
  }, [user, calendar]);
  
  // Account for specific permissions in sharingMetadata
  const sharingMetadata = useMemo(() => {
    if (!event.sharingMetadata) return null;
    
    try {
      if (typeof event.sharingMetadata === 'string') {
        return JSON.parse(event.sharingMetadata);
      }
      return event.sharingMetadata;
    } catch (e) {
      console.error('Error parsing sharing metadata:', e);
      return null;
    }
  }, [event.sharingMetadata]);
  
  // Determine whether the user has effective edit rights
  const effectiveCanEdit = useMemo(() => {
    // The user has edit rights if:
    // 1. The resource has sharingMetadata that explicitly grants them edit permission, OR
    // 2. The calendar belongs to the user, OR
    // 3. The user has edit permission on the calendar
    
    if (sharingMetadata?.canEdit === true) {
      return true;
    }
    
    if (sharingMetadata?.canEdit === false) {
      return false;
    }
    
    return isUsersOwnCalendar || canEdit;
  }, [sharingMetadata, isUsersOwnCalendar, canEdit]);
  
  // Get calendar name and color (with fallbacks)
  const calendarName = calendar?.name || '';
  const calendarColor = calendar?.color || '#3b82f6';
  
  // Special conditions for DK Pandey or other super admins
  const isDkPandey = user && user.username.toLowerCase().includes('dk.pandey');
  
  // Determine whether to show the Cancel Event button
  const hasAttendees = !!event.attendees && Array.isArray(event.attendees) && event.attendees.length > 0;
  const hasResources = useMemo(() => {
    if (resources.length > 0) return true;
    if (event.resources && Array.isArray(event.resources) && event.resources.length > 0) return true;
    return false;
  }, [event.resources, resources]);
  
  const shouldShowCancelButton = (isUsersOwnCalendar || isDkPandey) && (hasAttendees || hasResources);
  
  // Parse dates
  let startDate: Date;
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
  } catch (e) {
    console.error('Error parsing event dates:', e);
    startDate = new Date();
    endDate = new Date();
  }
  
  useEffect(() => {
    // Extract resources from raw data when component mounts
    extractResourcesFromRawData();
    
    // Process attendees data
    processAttendees();
  }, [event]);
  
  const extractResourcesFromRawData = () => {
    const extractedResources: any[] = [];
    
    // First check if the event already has resources in structured format
    if (event.resources && Array.isArray(event.resources)) {
      setResources(event.resources);
      return event.resources;
    }
    
    // Otherwise try to extract from raw data
    if (event.rawData && typeof event.rawData === 'string') {
      const rawData = event.rawData;
      
      // Check for resource data patterns in the iCalendar format
      const resourceMatches = rawData.match(/RESOURCE[^:]*:([^\r\n]+)/g);
      if (resourceMatches) {
        resourceMatches.forEach(match => {
          const resourceValue = match.split(':')[1];
          try {
            // Try to parse as JSON first (some clients use JSON format)
            const resourceData = JSON.parse(resourceValue);
            extractedResources.push(resourceData);
          } catch (e) {
            // If not JSON, treat as simple string
            extractedResources.push({
              name: resourceValue,
              email: resourceValue
            });
          }
        });
      }
      
      // Check for X-RESOURCE properties
      const xResourceMatches = rawData.match(/X-RESOURCE[^:]*:([^\r\n]+)/g);
      if (xResourceMatches) {
        xResourceMatches.forEach(match => {
          const resourceValue = match.split(':')[1];
          try {
            const resourceData = JSON.parse(resourceValue);
            extractedResources.push(resourceData);
          } catch (e) {
            extractedResources.push({
              name: resourceValue,
              email: resourceValue
            });
          }
        });
      }
    }
    
    setResources(extractedResources);
    return extractedResources;
  };
  
  const processAttendees = () => {
    let processed: any[] = [];
    
    if (event.attendees && Array.isArray(event.attendees)) {
      processed = event.attendees.map((attendee: any) => {
        // If already in object format, return as is
        if (typeof attendee === 'object' && attendee !== null) {
          return attendee;
        }
        
        // If string, convert to basic object format
        if (typeof attendee === 'string') {
          return {
            email: attendee,
            name: attendee.split('@')[0],
            status: 'NEEDS-ACTION',
            role: 'REQ-PARTICIPANT'
          };
        }
        
        return attendee;
      }).filter(Boolean); // Remove any null/undefined values
    }
    
    setProcessedAttendees(processed);
  };
  
  const handleDelete = async () => {
    if (!event) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      await deleteEvent(event.id);
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      setDeleteDialogOpen(false);
      onClose();
    } catch (error: any) {
      console.error('Error deleting event:', error);
      setDeleteError(error.message || 'Failed to delete event');
    } finally {
      setIsDeleting(false);
    }
  };
  
  const handleCancel = async () => {
    if (!event) return;
    
    setIsCancelling(true);
    setCancelError(null);
    
    try {
      // Send the cancellation email and delete the event
      const response = await fetch(`/api/events/${event.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to cancel event');
      }
      
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      setCancelDialogOpen(false);
      onClose();
    } catch (error: any) {
      console.error('Error cancelling event:', error);
      setCancelError(error.message || 'Failed to cancel event');
    } finally {
      setIsCancelling(false);
    }
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-[95vw] md:max-w-4xl h-[85vh] flex flex-col p-0">
          {/* Header area */}
          <DialogHeader className="p-6 pb-2">
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
          
          {/* Main content container with scrollable area */}
          <div className="flex-1 overflow-y-auto p-6 pt-0">
            <div className="space-y-4">
              {/* Top heading with title and calendar info */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <h1 className="text-xl font-semibold mb-2 sm:mb-0" title={event.title.length > 50 ? event.title : undefined}>
                    {event.title.length > 50 ? `${event.title.substring(0, 50)}...` : event.title}
                  </h1>
                    
                  {/* Sync status indicator */}
                  {event.syncStatus && (
                    <div 
                      className={`text-xs px-2 py-1 rounded-full w-fit ${
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
                  <div className="text-sm text-neutral-500 flex items-center mt-1">
                    <span 
                      className="w-3 h-3 rounded-full mr-2" 
                      style={{ backgroundColor: calendarColor || calendar.color }}
                    ></span>
                    {calendarName || calendar.name} {!calendarName && "Calendar"}
                  </div>
                )}
              </div>

              {/* Responsive layout that works on all screen sizes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          __html: sanitizeDescriptionForDisplay(event.description)
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
                  {resources.length > 0 && (
                    <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 shadow-sm">
                      <h3 className="font-medium mb-2 flex items-center text-amber-800">
                        <Settings className="text-amber-600 mr-2 h-4 w-4" />
                        Resources ({resources.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
                        {resources.slice(0, 2).map((resource: any, index: number) => {
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
                      {resources.length > 2 && (
                        <button 
                          onClick={() => setResourcesDialogOpen(true)}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
                        >
                          Show all {resources.length} resources
                        </button>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Right column - Attendees */}
                <div className="space-y-4">                  
                  {/* Attendees and Response Section - Only shown when event has attendees */}
                  {hasAttendees && processedAttendees.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                      <Tabs defaultValue="status" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4">
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
                              <DirectAttendeeExtractor 
                                rawData={typeof event.rawData === 'string' ? event.rawData : null} 
                                showMoreCount={10}
                                isPreview={false}
                              />
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
          </div>
          
          {/* Fixed footer at the bottom */}
          <div className="sticky bottom-0 bg-background border-t p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
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
                  <span>This event is part of a shared calendar</span>
                </div>
              )}
              </div>
              <Button onClick={onClose} className="w-full sm:w-auto mt-2 sm:mt-0">
                Close
              </Button>
            </div>
          </div>
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