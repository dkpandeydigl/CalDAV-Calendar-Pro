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
import { Download } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

// Skip TypeScript errors for the JSON fields - they're always going to be tricky to handle
// since they come from dynamic sources. Instead we'll do runtime checks.

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
  const { deleteEvent } = useCalendarEvents();
  const { getCalendarPermission } = useCalendarPermissions();
  const { user, isLoading: isUserLoadingFromAuth } = useAuth();
  const queryClient = useQueryClient();
  
  // State hooks
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUserLoading, setIsUserLoading] = useState(isUserLoadingFromAuth);
  
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
  const isUsersOwnCalendar = calendar ? calendar.userId === user?.id : false;
  
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
  
  console.log(`User data not loaded yet, but calendar ${event.calendarId} exists - granting view permissions`);
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
  
  // Handle delete event
  const handleDelete = async () => {
    if (!event) return;
    
    try {
      setIsDeleting(true);
      deleteEvent(event.id);
      
      // Force UI refresh
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      if (event.calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', event.calendarId, 'events'] 
        });
      }
      
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error(`Error during delete: ${(error as Error).message}`);
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      onClose();
    }
  };

  // Handle event download
  const handleDownload = async () => {
    if (!event) return;
    
    try {
      setIsDownloading(true);
      
      // Make a fetch request to the event export endpoint
      const response = await fetch(`/api/events/${event.id}/export`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to download event');
      }
      
      // Get the filename from the Content-Disposition header, or create a default one
      let filename = `event_${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
      const contentDisposition = response.headers.get('Content-Disposition');
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }
      
      // Create a blob and download it
      const icsData = await response.text();
      const blob = new Blob([icsData], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      toast({
        title: 'Download successful',
        description: `Event "${event.title}" downloaded as .ics file.`,
        variant: 'default',
      });
      
      setIsDownloading(false);
    } catch (error) {
      console.error(`Error downloading event: ${(error as Error).message}`);
      toast({
        title: 'Download failed',
        description: (error as Error).message || 'Unable to download event',
        variant: 'destructive',
      });
      setIsDownloading(false);
    }
  };
  
  // Parse recurrence rule from event
  const getRecurrenceDisplay = () => {
    // Check if raw data contains recurrence info
    if (event.rawData && typeof event.rawData === 'string') {
      try {
        // Try to parse JSON if needed
        let rawContent: string;
        try {
          rawContent = JSON.parse(event.rawData);
        } catch {
          rawContent = event.rawData;
        }
        
        // Extract RRULE from the raw data
        const rruleMatch = rawContent.match(/RRULE:([^\r\n]+)/);
        if (rruleMatch && rruleMatch[1]) {
          const rrule = rruleMatch[1];
          
          // Parse the RRULE
          const freq = rrule.match(/FREQ=([^;]+)/)?.[1] || '';
          const interval = rrule.match(/INTERVAL=([^;]+)/)?.[1] || '1';
          const count = rrule.match(/COUNT=([^;]+)/)?.[1];
          const until = rrule.match(/UNTIL=([^;]+)/)?.[1];
          const byDay = rrule.match(/BYDAY=([^;]+)/)?.[1];
          
          let readableRule = '';
          
          // Convert FREQ to readable format
          switch (freq) {
            case 'DAILY':
              readableRule = 'Daily';
              break;
            case 'WEEKLY':
              readableRule = 'Weekly';
              break;
            case 'MONTHLY':
              readableRule = 'Monthly';
              break;
            case 'YEARLY':
              readableRule = 'Yearly';
              break;
            default:
              readableRule = freq;
          }
          
          // Add interval if not 1
          if (interval !== '1') {
            readableRule = `Every ${interval} ${readableRule.toLowerCase()}`;
          }
          
          // Add weekdays for weekly recurrence
          if (freq === 'WEEKLY' && byDay) {
            const dayMap: Record<string, string> = {
              'SU': 'Sun',
              'MO': 'Mon',
              'TU': 'Tue',
              'WE': 'Wed',
              'TH': 'Thu',
              'FR': 'Fri',
              'SA': 'Sat'
            };
            
            const days = byDay.split(',')
              .map(day => dayMap[day] || day)
              .join(', ');
            
            readableRule += ` on ${days}`;
          }
          
          // Add end condition
          if (count) {
            readableRule += `, ${count} times`;
          } else if (until) {
            try {
              // Parse the UNTIL date
              const untilDate = new Date(
                parseInt(until.slice(0, 4)),   // Year
                parseInt(until.slice(4, 6)) - 1, // Month (0-based)
                parseInt(until.slice(6, 8))    // Day
              );
              readableRule += `, until ${untilDate.toLocaleDateString()}`;
            } catch {
              readableRule += `, until ${until}`;
            }
          }
          
          return (
            <div className="text-xs mt-1 bg-purple-100 text-purple-800 px-2 py-1 rounded-full inline-block">
              <span className="material-icons text-purple-800 mr-1 text-xs align-text-bottom">repeat</span>
              {readableRule}
            </div>
          );
        }
      } catch (error) {
        console.error('Error parsing recurrence rule:', error);
      }
    }
    
    // Fallback to recurrenceRule property if available
    if (event.recurrenceRule) {
      let rule: any;
      
      if (typeof event.recurrenceRule === 'string') {
        try {
          rule = JSON.parse(event.recurrenceRule);
        } catch {
          // If it's not JSON, but starts with RRULE:, extract the rule part
          if (event.recurrenceRule.startsWith('RRULE:')) {
            return (
              <div className="text-xs mt-1 bg-purple-100 text-purple-800 px-2 py-1 rounded-full inline-block">
                <span className="material-icons text-purple-800 mr-1 text-xs align-text-bottom">repeat</span>
                Recurring Event
              </div>
            );
          }
          // Just use as is
          return (
            <div className="text-xs mt-1 bg-purple-100 text-purple-800 px-2 py-1 rounded-full inline-block">
              <span className="material-icons text-purple-800 mr-1 text-xs align-text-bottom">repeat</span>
              Repeats: {event.recurrenceRule}
            </div>
          );
        }
      } else {
        rule = event.recurrenceRule;
      }
      
      if (rule && rule.pattern) {
        let description = `${rule.pattern}`;
        
        if (rule.interval && rule.interval > 1) {
          description = `Every ${rule.interval} ${rule.pattern.toLowerCase()}s`;
        }
        
        if (rule.weekdays && Array.isArray(rule.weekdays) && rule.weekdays.length > 0) {
          description += ` on ${rule.weekdays.join(', ')}`;
        }
        
        if (rule.endType === 'After' && rule.occurrences) {
          description += `, ${rule.occurrences} times`;
        } else if (rule.endType === 'Until' && rule.untilDate) {
          const untilDate = new Date(rule.untilDate);
          description += `, until ${untilDate.toLocaleDateString()}`;
        }
        
        return (
          <div className="text-xs mt-1 bg-purple-100 text-purple-800 px-2 py-1 rounded-full inline-block">
            <span className="material-icons text-purple-800 mr-1 text-xs align-text-bottom">repeat</span>
            {description}
          </div>
        );
      }
    }
    
    return null;
  };
  
  // Parse attendees from event
  const getAttendees = () => {
    let attendees: any[] = [];
    
    // Try to extract attendees from raw data
    if (event.rawData && typeof event.rawData === 'string') {
      try {
        let rawContent: string;
        try {
          rawContent = JSON.parse(event.rawData);
        } catch {
          rawContent = event.rawData;
        }
        
        // Parse attendees from iCalendar format
        if (rawContent.includes('ATTENDEE;') || rawContent.includes('ATTENDEE:')) {
          const attendeeLines = rawContent.split('\r\n')
            .filter(line => line.startsWith('ATTENDEE'));
          
          if (attendeeLines && attendeeLines.length > 0) {
            attendees = attendeeLines.map(line => {
              // Extract email part
              const emailMatch = line.match(/mailto:([^\r\n]+)$/);
              const email = emailMatch ? emailMatch[1] : '';
              
              // Check for role within the line
              const rolePart = line.includes('ROLE=') ? 
                line.match(/ROLE=([^;:]+)/) : null;
              let role = 'Member';
              
              if (rolePart && rolePart[1]) {
                if (rolePart[1] === 'CHAIR') role = 'Chairman';
                else if (rolePart[1] === 'OPT-PARTICIPANT') role = 'Secretary';
              }
              
              return { email, role };
            });
          }
        }
      } catch (error) {
        console.error('Error parsing attendees from raw data:', error);
      }
    }
    
    // If no attendees from raw data, try from event.attendees
    if (attendees.length === 0 && event.attendees) {
      let eventAttendees: any[] = [];
      
      if (typeof event.attendees === 'string') {
        try {
          // Try to parse JSON string
          const parsed = JSON.parse(event.attendees);
          eventAttendees = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          // Treat as a single string
          eventAttendees = [event.attendees];
        }
      } else if (Array.isArray(event.attendees)) {
        eventAttendees = event.attendees;
      } else if (event.attendees && typeof event.attendees === 'object') {
        eventAttendees = [event.attendees];
      }
      
      attendees = eventAttendees;
    }
    
    // If we have attendees, render them
    if (attendees && attendees.length > 0) {
      return (
        <div>
          <div className="text-sm font-medium mb-1">Attendees</div>
          <div className="text-sm p-3 bg-neutral-100 rounded-md">
            <ul className="space-y-2">
              {attendees
                .filter(Boolean)
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
            </ul>
          </div>
        </div>
      );
    }
    
    return null;
  };
  
  // Get resources from event
  const getResources = () => {
    const resources = event.resources as unknown;
    if (resources && Array.isArray(resources) && resources.length > 0) {
      return (
        <div>
          <div className="text-sm font-medium mb-1">Resources</div>
          <div className="text-sm p-3 bg-neutral-100 rounded-md">
            <ul className="space-y-1">
              {resources
                .filter(Boolean)
                .map((resource, index) => (
                  <li key={index} className="flex items-center">
                    <span className="material-icons text-neutral-500 mr-2 text-sm">room</span>
                    {String(resource)}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      );
    }
    return null;
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
              ) : (isUsersOwnCalendar || effectiveCanEdit) ? (
                <div className="flex">
                  <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
                    <span className="material-icons">edit</span>
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteDialogOpen(true)}
                    title="Delete"
                  >
                    <span className="material-icons">delete</span>
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
                  View only
                </div>
              )}
            </div>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">{event.title}</h1>
                
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
            
            <div className="flex items-start">
              <span className="material-icons text-neutral-500 mr-2">schedule</span>
              <div>
                <div className="text-sm">{formatDayOfWeekDate(startDate)}</div>
                <div className="text-sm">
                  {event.allDay 
                    ? 'All Day' 
                    : formatEventTimeRange(startDate, endDate)}
                  {' '}({event.timezone})
                </div>
                
                {/* Display recurrence information */}
                {getRecurrenceDisplay()}
              </div>
            </div>
            
            {event.location && (
              <div className="flex items-start">
                <span className="material-icons text-neutral-500 mr-2">location_on</span>
                <div className="text-sm">{event.location}</div>
              </div>
            )}
            
            {event.description && typeof event.description === 'string' && (
              <div>
                <div className="text-sm font-medium mb-1">Description</div>
                <div className="text-sm p-3 bg-neutral-100 rounded-md">
                  {event.description}
                </div>
              </div>
            )}
            
            {/* Attendees section */}
            {getAttendees()}
            
            {/* Resources section */}
            {getResources()}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {!isUserLoading && (
                <>
                  {/* Download button visible to everyone */}
                  <Button
                    variant="outline"
                    className="flex items-center border-blue-200 text-blue-600 hover:bg-blue-50"
                    onClick={handleDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <div className="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-blue-600"></div>
                    ) : (
                      <Download className="mr-1 h-4 w-4" />
                    )}
                    {isDownloading ? 'Downloading...' : 'Download ICS'}
                  </Button>
                  
                  {/* Edit and Delete buttons only for users with edit permissions */}
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
      
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default EventDetailModal;