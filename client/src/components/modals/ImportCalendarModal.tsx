import React, { ChangeEvent, FC, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCalendars } from '@/hooks/useCalendars';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UploadCloud, RefreshCw } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Calendar } from '@shared/schema';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useSharedCalendars, SharedCalendar } from '@/hooks/useSharedCalendars';
import { useDeletedEventsTracker } from '@/hooks/useDeletedEventsTracker';

interface ImportCalendarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  selected: boolean;
}

export default function ImportCalendarModal({
  open,
  onOpenChange
}: ImportCalendarModalProps) {
  // Get all necessary data with authentication state
  const { calendars, isLoading: isLoadingCalendars, error: calendarError } = useCalendars();
  const { sharedCalendars, isLoading: isLoadingSharedCalendars } = useSharedCalendars();
  const { user, isLoading: isLoadingAuth } = useAuth();
  const { toast } = useToast();
  const { untrackDeletedEvent } = useDeletedEventsTracker();
  
  // Log detailed authentication state for debugging
  useEffect(() => {
    console.log("ImportCalendarModal auth state:", {
      user: user ? { id: user.id, username: user.username } : null,
      isAuthLoading: isLoadingAuth,
      calendarCount: calendars.length,
      sharedCalendarCount: sharedCalendars?.length || 0,
      isLoadingCalendars,
      isLoadingSharedCalendars
    });
  }, [user, isLoadingAuth, calendars, sharedCalendars, isLoadingCalendars, isLoadingSharedCalendars]);

  // Combine user's calendars and shared calendars with edit permission
  const allCalendars = useMemo(() => {
    // Make sure both user and sharedCalendars are loaded before filtering
    if (!user) {
      console.log("ImportCalendarModal: No authenticated user found");
      return [];
    }

    // Make sure shared calendars are defined and properly filtered
    const editableSharedCalendars = sharedCalendars
      ? sharedCalendars
          .filter(cal => cal.permissionLevel === 'edit')
          .map(cal => ({
            ...cal,
            sharedBy: cal.owner?.username || 'Unknown'
          }))
      : [];
      
    console.log(`ImportCalendarModal: Found ${calendars.length} personal calendars and ${editableSharedCalendars.length} editable shared calendars`);
    
    return [
      ...calendars.map(cal => ({ ...cal, isShared: false })),
      ...editableSharedCalendars
    ];
  }, [calendars, sharedCalendars, user]);

  // State for file input
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  
  // State for events parsed from the file
  const [parsedEvents, setParsedEvents] = useState<ICSEvent[]>([]);
  
  // State for calendar selection
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  
  // State for import process
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'select'>('upload');
  const [replaceExisting, setReplaceExisting] = useState(false);
  
  // State for calendar fetch status
  const [isRefreshingCalendars, setIsRefreshingCalendars] = useState(false);
  
  // State for auth verification
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(false);
  
  // Effect to verify authentication and load calendars when modal opens
  useEffect(() => {
    if (open) {
      setIsVerifyingAuth(true);
      
      // Only try to invalidate the user query if needed
      if (!user) {
        // First try to make sure we have the latest user data
        queryClient.invalidateQueries({ queryKey: ['/api/user'] })
          .then(() => {
            // After user data is refreshed, refresh calendar data
            queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
            queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
          })
          .catch(err => {
            console.error('Error invalidating user query:', err);
          })
          .finally(() => {
            setIsVerifyingAuth(false);
          });
      } else {
        // If user already exists, just refresh calendar data
        console.log('User already authenticated, refreshing calendars');
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['/api/calendars'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] })
        ])
        .then(() => {
          console.log('Calendar data refreshed');
        })
        .catch(err => {
          console.error('Error refreshing calendar data:', err);
        })
        .finally(() => {
          setIsVerifyingAuth(false);
        });
      }
    }
  }, [open, user]);
  
  // Effect to set default calendar when calendars are loaded
  useEffect(() => {
    if (allCalendars.length > 0 && !selectedCalendarId && importStep === 'select') {
      // First try to find the primary calendar, then just use the first one
      const defaultCalendar = allCalendars.find(cal => cal.isPrimary) || allCalendars[0];
      setSelectedCalendarId(String(defaultCalendar.id));
      console.log(`Setting default calendar to ${defaultCalendar.name} (ID: ${defaultCalendar.id})`);
    }
  }, [allCalendars, selectedCalendarId, importStep]);
  
  // Refresh calendars from server
  const handleRefreshCalendars = () => {
    setIsRefreshingCalendars(true);
    // Force refresh by invalidating the query cache
    queryClient.invalidateQueries({ queryKey: ['/api/calendars'] })
      .then(() => {
        console.log('Calendars refreshed');
        setIsRefreshingCalendars(false);
      })
      .catch((error) => {
        console.error('Error refreshing calendars:', error);
        setIsRefreshingCalendars(false);
        toast({
          title: "Failed to refresh calendars",
          description: "Please try again or check your connection",
          variant: "destructive"
        });
      });
  };

  // Handle file selection
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith('.ics')) {
        setFile(selectedFile);
        setParseError(null);
      } else {
        toast({
          title: "Invalid file type",
          description: "Please select an .ics (iCalendar) file.",
          variant: "destructive"
        });
        e.target.value = '';
      }
    }
  };

  // Handle file upload and parsing
  const handleUploadAndParse = async () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a file to import.",
        variant: "destructive"
      });
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/calendars/parse-ics', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to parse calendar file');
      }

      const events: ICSEvent[] = await response.json();
      
      // Add selected flag to each event
      const eventsWithSelection = events.map(event => ({
        ...event,
        selected: true,
        startDate: new Date(event.startDate),
        endDate: new Date(event.endDate)
      }));

      setParsedEvents(eventsWithSelection);
      
      // Move to event selection step
      setImportStep('select');
      
      // Set default calendar if there are any calendars
      if (allCalendars.length > 0 && !selectedCalendarId) {
        const defaultCalendar = allCalendars.find(cal => cal.isPrimary) || allCalendars[0];
        setSelectedCalendarId(String(defaultCalendar.id));
      }
    } catch (error) {
      console.error('Error parsing calendar file:', error);
      setParseError(error instanceof Error ? error.message : 'Failed to parse calendar file');
      toast({
        title: "Error parsing file",
        description: error instanceof Error ? error.message : 'Failed to parse calendar file',
        variant: "destructive"
      });
    } finally {
      setIsParsing(false);
    }
  };

  // Toggle selection for an individual event
  const handleToggleEvent = (index: number) => {
    setParsedEvents(events => 
      events.map((event, i) => 
        i === index ? { ...event, selected: !event.selected } : event
      )
    );
  };

  // Toggle all events
  const handleToggleAll = (selected: boolean) => {
    setParsedEvents(events => 
      events.map(event => ({ ...event, selected }))
    );
  };

  // Import selected events
  const handleImport = async () => {
    // Check authentication
    if (!user) {
      console.error("Cannot import events: User not authenticated");
      toast({
        title: "Authentication required",
        description: "Please log in to import events.",
        variant: "destructive"
      });
      return;
    }

    if (!selectedCalendarId) {
      toast({
        title: "No calendar selected",
        description: "Please select a calendar to import events into.",
        variant: "destructive"
      });
      return;
    }

    const selectedEvents = parsedEvents.filter(event => event.selected);
    
    if (selectedEvents.length === 0) {
      toast({
        title: "No events selected",
        description: "Please select at least one event to import.",
        variant: "destructive"
      });
      return;
    }

    // Find the calendar in the combined calendars list
    const targetCalendar = allCalendars.find(cal => String(cal.id) === selectedCalendarId);
    if (!targetCalendar) {
      console.error(`Calendar ID ${selectedCalendarId} not found in available calendars`);
      toast({
        title: "Calendar not found",
        description: "The selected calendar could not be found. Please select another calendar.",
        variant: "destructive"
      });
      return;
    }

    console.log(`Importing events to calendar: ${targetCalendar.name} (ID: ${targetCalendar.id})`);
    setIsImporting(true);

    try {
      // Verify the calendar ID type
      const calendarId = parseInt(selectedCalendarId);
      
      console.log(`Sending import request with calendarId: ${calendarId} (type: ${typeof calendarId})`);
      
      const response = await apiRequest('POST', '/api/calendars/import-events', {
        calendarId,
        events: selectedEvents,
        replaceExisting: replaceExisting
      });

      if (!response.ok) {
        console.error(`Import API error: ${response.status}`, response);
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to import events');
      }

      const result = await response.json();
      
      // Untrack any events that were previously deleted but now reimported
      // This ensures they will appear in the calendar view
      console.log(`Untracking ${selectedEvents.length} imported events from deleted events tracker`);
      selectedEvents.forEach(event => {
        // Untrack each imported event so it will be displayed
        untrackDeletedEvent({
          title: event.summary,
          startDate: event.startDate,
          uid: event.uid
        });
      });
      
      // Force immediate sync to ensure events are updated with server
      console.log("Triggering immediate sync to update event statuses...");
      try {
        // Make a sync request to ensure events are marked as synced
        await apiRequest('POST', '/api/sync', { 
          calendarId: calendarId,
          forceRefresh: true
        });
        console.log("Sync request completed");
      } catch (syncError) {
        console.error("Error triggering sync:", syncError);
      }
      
      // Add a small delay to allow the sync to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Invalidate the events cache to trigger a refetch with updated statuses
      console.log("Invalidating event caches to refresh state...");
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Also invalidate any calendar-specific event queries
      if (calendarId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/calendars', calendarId, 'events'] 
        });
      }
      
      // Invalidate all calendar queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      
      toast({
        title: "Import successful",
        description: `Successfully imported ${result.imported} of ${result.total} events.`,
        variant: "default"
      });
      
      // Reset and close the modal
      resetAndClose();
    } catch (error) {
      console.error('Error importing events:', error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : 'Failed to import events',
        variant: "destructive"
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Reset state and close modal
  const resetAndClose = () => {
    setFile(null);
    setParsedEvents([]);
    setSelectedCalendarId('');
    setParseError(null);
    setImportStep('upload');
    setIsUploading(false);
    setIsParsing(false);
    setIsImporting(false);
    setReplaceExisting(false);
    onOpenChange(false);
  };

  // Format event date for display
  const formatEventDate = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      return `${format(start, 'MMM d, yyyy')}${
        format(start, 'MMM d, yyyy') !== format(new Date(end.getTime() - 1), 'MMM d, yyyy')
          ? ` - ${format(new Date(end.getTime() - 1), 'MMM d, yyyy')}`
          : ''
      } (All day)`;
    }
    
    return `${format(start, 'MMM d, yyyy h:mm a')} - ${
      format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')
        ? format(end, 'h:mm a')
        : format(end, 'MMM d, yyyy h:mm a')
    }`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Calendar</DialogTitle>
          <DialogDescription>
            Upload an .ics file to import events into your calendar.
          </DialogDescription>
        </DialogHeader>

        {isVerifyingAuth ? (
          <div className="py-10 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Verifying authentication...</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {importStep === 'upload' ? (
              <div className="py-4 flex flex-col items-center justify-center min-h-[300px]">
                <div className="w-full max-w-md p-6 border-2 border-dashed border-neutral-300 rounded-lg text-center">
                  <UploadCloud className="h-12 w-12 text-neutral-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-neutral-900 mb-2">Upload Calendar File</h3>
                  <p className="text-sm text-neutral-500 mb-4">
                    Select an iCalendar (.ics) file to import events from
                  </p>
                  
                  <div className="flex flex-col gap-4">
                    <input
                      type="file"
                      accept=".ics"
                      className="hidden"
                      id="calendar-file"
                      onChange={handleFileChange}
                    />
                    <label 
                      htmlFor="calendar-file" 
                      className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none cursor-pointer"
                    >
                      Choose File
                    </label>
                    
                    {file && (
                      <div className="text-sm text-neutral-800 bg-neutral-100 p-2 rounded">
                        Selected: {file.name}
                      </div>
                    )}
                    
                    {parseError && (
                      <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                        {parseError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4">
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <Label htmlFor="calendar-select">Select calendar to import into:</Label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2"
                      onClick={handleRefreshCalendars}
                      disabled={isRefreshingCalendars}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshingCalendars ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                  
                  {!user ? (
                    <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded mb-2 border border-amber-200">
                      <span className="font-medium">Authentication required:</span> You must be logged in to access your calendars.
                    </div>
                  ) : isLoadingCalendars || isLoadingSharedCalendars ? (
                    <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading calendars...
                    </div>
                  ) : calendarError ? (
                    <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-2">
                      Error loading calendars: {calendarError.message || 'Failed to load calendars'}
                    </div>
                  ) : allCalendars.length === 0 ? (
                    <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded mb-2 border border-amber-200">
                      No calendars found. Please refresh or create a new calendar.
                    </div>
                  ) : (
                    <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                      <SelectTrigger id="calendar-select" className="w-full" type="button">
                        <SelectValue placeholder="Select a calendar" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Personal calendars section */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                          Personal Calendars
                        </div>
                        {calendars.map((calendar: Calendar) => (
                          <SelectItem key={calendar.id} value={String(calendar.id)}>
                            <div className="flex items-center">
                              <span 
                                className="inline-block h-3 w-3 rounded-full mr-2" 
                                style={{ backgroundColor: calendar.color }} 
                              />
                              {calendar.name}
                            </div>
                          </SelectItem>
                        ))}
                        
                        {/* Shared calendars section (if any are available) */}
                        {sharedCalendars && sharedCalendars.filter(cal => cal.permissionLevel === 'edit').length > 0 && (
                          <>
                            <div className="px-2 py-1.5 mt-1 text-xs font-medium text-muted-foreground border-t">
                              Shared Calendars (with edit access)
                            </div>
                            {sharedCalendars
                              .filter(cal => cal.permissionLevel === 'edit')
                              .map(shared => (
                                <SelectItem key={`shared-${shared.id}`} value={String(shared.id)}>
                                  <div className="flex items-center">
                                    <span 
                                      className="inline-block h-3 w-3 rounded-full mr-2" 
                                      style={{ backgroundColor: shared.color }} 
                                    />
                                    <span>{shared.name}</span>
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      (from {shared.owner?.username || 'Unknown'})
                                    </span>
                                  </div>
                                </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                
                <div className="flex items-center space-x-2 mb-4">
                  <Checkbox 
                    id="replace-existing"
                    checked={replaceExisting}
                    onCheckedChange={(checked) => setReplaceExisting(checked as boolean)}
                  />
                  <Label 
                    htmlFor="replace-existing"
                    className="cursor-pointer text-sm"
                  >
                    Replace existing events with same UID
                  </Label>
                </div>
                
                <div className="bg-white border rounded-md shadow-sm mb-4">
                  <div className="p-3 border-b flex justify-between items-center bg-neutral-50">
                    <div className="text-sm font-medium">
                      {parsedEvents.length} events found in file
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleToggleAll(true)}
                      >
                        Select All
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleToggleAll(false)}
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>
                  
                  <div className="max-h-[300px] overflow-y-auto">
                    {parsedEvents.map((event, index) => (
                      <div 
                        key={index} 
                        className={`p-3 border-b flex items-start ${
                          event.selected ? 'bg-primary/5' : ''
                        }`}
                      >
                        <Checkbox 
                          id={`event-${index}`}
                          checked={event.selected}
                          onCheckedChange={() => handleToggleEvent(index)}
                          className="mt-1"
                        />
                        <div className="ml-3 flex-1">
                          <Label 
                            htmlFor={`event-${index}`}
                            className="font-medium cursor-pointer"
                          >
                            {event.summary || 'Untitled Event'}
                          </Label>
                          <div className="text-sm text-neutral-600 mt-1">
                            {formatEventDate(event.startDate, event.endDate, event.allDay)}
                          </div>
                          {event.location && (
                            <div className="text-sm text-neutral-500 mt-1">
                              Location: {event.location}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        <DialogFooter className="flex justify-between">
          {importStep === 'upload' ? (
            <>
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleUploadAndParse} 
                disabled={!file || isParsing}
              >
                {isParsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setImportStep('upload')}>
                Back
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={isImporting || parsedEvents.filter(e => e.selected).length === 0}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Import ${parsedEvents.filter(e => e.selected).length} Events`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}