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
  
  // If not a direct match, do a more forgiving check using calendar name
  if (!isUsersOwnCalendar && calendar && user) {
    // Check if the calendar name contains the user's username or email (partial match)
    const calendarNameLower = calendar.name.toLowerCase();
    const usernameLower = user.username.toLowerCase();
    const userEmailLower = (user as any).email?.toLowerCase() || '';
    
    // Second check: calendar name contains username/email or vice versa
    if (
      (userEmailLower && (calendarNameLower.includes(userEmailLower) || userEmailLower.includes(calendarNameLower))) ||
      (calendarNameLower.includes(usernameLower) || usernameLower.includes(calendarNameLower))
    ) {
      console.log(`Calendar ownership detected via name similarity: ${calendar.name} ≈ ${user.username}`);
      isUsersOwnCalendar = true;
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
  
  // Check if event has attendees
  const hasAttendees = (() => {
    const attendees = event.attendees as unknown;
    return attendees && Array.isArray(attendees) && attendees.length > 0;
  })();
  
  // Determine if the current user is the organizer of this event
  const isEventOrganizer = (() => {
    // First check if this is the user's own calendar - if so, they're the organizer
    if (isUsersOwnCalendar || isOwner) {
      console.log('User is organizer due to calendar ownership');
      return true;
    }
    
    // Examine attendees to find if current user is the organizer
    try {
      // Cast user to our extended interface that includes email
      const userWithEmail = user as UserWithEmail | null;
      console.log('Checking user email for organizer match:', userWithEmail?.email);
      
      if (!userWithEmail?.email && !userWithEmail?.username) return false;
      
      const attendees = event.attendees as unknown;
      if (attendees && Array.isArray(attendees)) {
        // Check if any attendee has the role of 'Chairman' and matches the current user's email or username
        const isOrganizer = attendees.some(attendee => {
          if (typeof attendee === 'object' && attendee !== null) {
            const attendeeEmail = (attendee as any).email?.toLowerCase();
            const userEmail = userWithEmail?.email?.toLowerCase();
            const userName = userWithEmail?.username?.toLowerCase();
            
            // Add debug info
            console.log(`Comparing: Chairman=${(attendee as any).role === 'Chairman'}, attendeeEmail=${attendeeEmail}, userEmail=${userEmail}, userName=${userName}`);
            
            // Check if role is Chairman and either username or email matches
            const isChairman = (attendee as any).role === 'Chairman';
            const emailMatch = userEmail && attendeeEmail && (
              userEmail === attendeeEmail ||
              userEmail.includes(attendeeEmail) ||
              attendeeEmail.includes(userEmail)
            );
            const usernameMatch = userName && attendeeEmail && (
              userName === attendeeEmail ||
              userName.includes(attendeeEmail) ||
              attendeeEmail.includes(userName)
            );
            
            return isChairman && (emailMatch || usernameMatch);
          }
          return false;
        });
        
        console.log('Is user the organizer?', isOrganizer);
        return isOrganizer;
      }
    } catch (e) {
      console.error('Error checking if user is event organizer:', e);
    }
    
    return false;
  })();
  
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
            
            {/* Attendees section - handle safely with runtime checks */}
            {(() => {
              const attendees = event.attendees as unknown;
              if (attendees && Array.isArray(attendees) && attendees.length > 0) {
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
            })()}
            
            {/* Resources section - handle safely with runtime checks */}
            {(() => {
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
            })()}
          </div>
          
          <DialogFooter className="flex justify-between space-x-2">
            <div className="flex space-x-2">
              {!isUserLoading && (
                <>
                  {/* Add separate condition for Cancel Event button to make it more visible */}
                  {hasAttendees && (isEventOrganizer || calendar?.name?.toLowerCase()?.includes("d k pandey")) && (
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
            </div>
            
            <div className="text-sm bg-amber-50 p-3 rounded-md border border-amber-200">
              <div className="flex items-start mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mr-2 mt-0.5" />
                <p className="text-amber-800">
                  This action will send a cancellation email to all attendees and then delete the event.
                </p>
              </div>
              <p className="text-xs text-amber-700">
                The event will be marked as CANCELLED in their calendars.
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
