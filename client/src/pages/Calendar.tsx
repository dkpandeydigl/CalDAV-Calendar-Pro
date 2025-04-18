import { useState, useEffect, useMemo } from 'react';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarSidebar from '@/components/calendar/CalendarSidebar';
import EnhancedCalendarSidebar from '@/components/calendar/EnhancedCalendarSidebar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import ImprovedEventFormModal from '@/components/modals/ImprovedEventFormModal';
import EventDetailModal from '@/components/modals/EventDetailModal';
import ServerConnectionModal from '@/components/modals/ServerConnectionModal';
import { SyncSettingsModal } from '@/components/modals/SyncSettingsModal';
import ShareCalendarModal from '@/components/modals/SimplifiedShareCalendarModal';
import MultiCalendarShareModal from '@/components/modals/MultiCalendarShareModal';
import ExportCalendarModal from '@/components/modals/ExportCalendarModal';
import ImportCalendarModal from '@/components/modals/ImportCalendarModal';
import { BulkDeleteModal } from '@/components/modals/BulkDeleteModal';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { Event, Calendar as CalendarType } from '@shared/schema';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useCalendars } from '@/hooks/useCalendars';
import { useSharedCalendars } from '@/hooks/useSharedCalendars';  
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, addDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { Loader2, RefreshCcw, RefreshCw, Trash, Calendar as CalendarIcon } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient, useQuery } from '@tanstack/react-query';

// For different calendar views
type CalendarViewType = 'year' | 'month' | 'week' | 'day';

function YearView({ events, onEventClick }: { events: Event[]; onEventClick: (event: Event) => void }) {
  const { currentDate, selectedTimezone } = useCalendarContext();
  const year = currentDate.getFullYear();

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">{year}</h2>
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, index) => {
          const monthDate = new Date(year, index);
          const monthName = format(monthDate, 'MMMM');
          
          // Filter events for this month with error handling
          const monthEvents = events.filter(event => {
            try {
              const eventDate = new Date(event.startDate);
              
              // Check if date is valid
              if (isNaN(eventDate.getTime())) {
                return false;
              }
              
              // Use the selected timezone to determine the month/year of the event
              console.log(`Year view using timezone: ${selectedTimezone}`);
              
              // When we have events stored in UTC (like "2025-04-01T00:00:00.000Z"),
              // we need to preserve the calendar date rather than shifting it
              
              // We'll create a date that preserves the display date as the same day
              // by using the date from the ISO string directly (keeping only YYYY-MM-DD)
              const dateStr = eventDate.toISOString().split('T')[0];
              const localEventDate = new Date(`${dateStr}T12:00:00.000Z`);
              
              return localEventDate.getMonth() === index && localEventDate.getFullYear() === year;
            } catch (error) {
              console.error(`Error filtering event for month ${monthName}:`, error);
              return false;
            }
          });
          
          return (
            <div key={index} className="border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="font-medium text-lg">{monthName}</h3>
              <p className="text-sm text-muted-foreground">{monthEvents.length} events</p>
              <ul className="mt-2 max-h-24 overflow-hidden">
                {monthEvents.slice(0, 3).map((event) => (
                  <li 
                    key={event.id} 
                    className="text-xs truncate cursor-pointer hover:text-primary"
                    onClick={() => onEventClick(event)}
                  >
                    {event.title}
                  </li>
                ))}
                {monthEvents.length > 3 && (
                  <li className="text-xs text-muted-foreground">
                    +{monthEvents.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ events, onEventClick }: { events: Event[]; onEventClick: (event: Event) => void }) {
  const { currentDate, selectedTimezone } = useCalendarContext();
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday
  
  const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));
  
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">
        {format(days[0], 'MMM d')} - {format(days[6], 'MMM d, yyyy')}
      </h2>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, dayIndex) => (
          <div key={dayIndex} className="border">
            <div className="bg-secondary p-2 text-center sticky top-0">
              <div className="font-medium">{format(day, 'EEE')}</div>
              <div className={`text-sm ${format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto' : ''}`}>
                {format(day, 'd')}
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {events
                .filter(event => {
                  try {
                    const eventStart = new Date(event.startDate);
                    
                    // Check if date is valid
                    if (isNaN(eventStart.getTime())) {
                      return false;
                    }
                    
                    // Use the user's selected timezone from context
                    console.log(`Week view using timezone: ${selectedTimezone}`);
                    
                    // When we have events stored in UTC (like "2025-04-01T00:00:00.000Z"),
                    // we need to preserve the calendar date rather than shifting it
                    
                    // We'll create a date that preserves the display date as the same day
                    // by using the date from the ISO string directly (keeping only YYYY-MM-DD)
                    const dateStr = eventStart.toISOString().split('T')[0];
                    const localStartDate = new Date(`${dateStr}T12:00:00.000Z`);
                    
                    const eventDay = format(localStartDate, 'yyyy-MM-dd');
                    const currentDay = format(day, 'yyyy-MM-dd');
                    return eventDay === currentDay;
                  } catch (error) {
                    console.error(`Error filtering event in week view:`, error);
                    return false;
                  }
                })
                .map(event => (
                  <div 
                    key={event.id}
                    className="p-1 m-1 text-xs bg-primary/10 rounded cursor-pointer hover:bg-primary/20"
                    onClick={() => onEventClick(event)}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    <div className="text-muted-foreground">
                      {format(new Date(new Date(event.startDate).toUTCString()), 'h:mm a')} - 
                      {format(new Date(new Date(event.endDate).toUTCString()), 'h:mm a')}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ events, onEventClick }: { events: Event[]; onEventClick: (event: Event) => void }) {
  const { currentDate, selectedTimezone } = useCalendarContext();
  const hours = Array.from({ length: 24 }).map((_, i) => i);
  
  // Get all events for this day with robust error handling
  const dayEvents = events.filter(event => {
    try {
      const eventDate = new Date(event.startDate);
      
      // Check if date is valid
      if (isNaN(eventDate.getTime())) {
        console.warn(`DayView: Skipping event with invalid date: "${event.title}"`);
        return false;
      }
      
      // Use the user's selected timezone from context
      console.log(`Day view using timezone: ${selectedTimezone}`);
      
      // When we have events stored in UTC (like "2025-04-01T00:00:00.000Z"),
      // we need to preserve the calendar date rather than shifting it
      
      // We'll create a date that preserves the display date as the same day
      // by using the date from the ISO string directly (keeping only YYYY-MM-DD)
      const dateStr = eventDate.toISOString().split('T')[0];
      const localEventDate = new Date(`${dateStr}T12:00:00.000Z`);
      
      const eventDay = format(localEventDate, 'yyyy-MM-dd');
      const currentDay = format(currentDate, 'yyyy-MM-dd');
      const match = eventDay === currentDay;
      
      // Debug output
      console.log(`DayView: Event: ${event.title}, Date: ${eventDay}, CurrentDay: ${currentDay}, Match: ${match}`);
      
      return match;
    } catch (error) {
      console.error(`Error filtering event in day view: "${event.title}"`, error);
      return false;
    }
  });
  
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">{format(currentDate, 'EEEE, MMMM d, yyyy')}</h2>
      <div className="flex flex-col border rounded-lg shadow-sm">
        {hours.map(hour => {
          const hourEvents = dayEvents.filter(event => {
            try {
              const eventStart = new Date(event.startDate);
              
              // Check if date is valid
              if (isNaN(eventStart.getTime())) {
                return false;
              }
              
              // For hour filtering, we use the original UTC time as we want to preserve
              // the actual time regardless of the day
              return eventStart.getUTCHours() === hour;
            } catch (error) {
              console.error(`Error filtering event by hour: "${event.title}"`, error);
              return false;
            }
          });
          
          return (
            <div key={hour} className="flex border-b last:border-b-0">
              <div className="w-20 p-2 border-r text-muted-foreground text-sm flex items-start justify-end">
                {format(new Date().setHours(hour, 0, 0, 0), 'h:mm a')}
              </div>
              <div className="flex-1 min-h-[60px] p-1 relative">
                {hourEvents.map(event => (
                  <div 
                    key={event.id}
                    className="absolute top-0 left-0 right-0 m-1 p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20"
                    style={{
                      height: `${event.allDay ? 100 : 50}%`,
                      top: `${(new Date(event.startDate).getUTCMinutes() / 60) * 100}%`,
                    }}
                    onClick={() => onEventClick(event)}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    {!event.allDay && (
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(new Date(event.startDate).toUTCString()), 'h:mm a')} - 
                        {format(new Date(new Date(event.endDate).toUTCString()), 'h:mm a')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarContent() {
  const { viewStartDate, viewEndDate, viewType, setViewType, setServerStatus, currentDate } = useCalendarContext();
  const [showSidebar, setShowSidebar] = useState(true);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shareCalendarOpen, setShareCalendarOpen] = useState(false);
  const [multiShareCalendarOpen, setMultiShareCalendarOpen] = useState(false);
  const [exportCalendarOpen, setExportCalendarOpen] = useState(false);
  const [importCalendarOpen, setImportCalendarOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarType | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Get user calendars and shared calendars
  const { calendars, isLoading: isCalendarsLoading } = useCalendars();
  const { sharedCalendars, isLoading: isSharedCalendarsLoading } = useSharedCalendars();
  
  const [cacheVersion, setCacheVersion] = useState(0);
  const { events: rawEvents, isLoading: isEventsLoading, refetch, deleteEvent } = useCalendarEvents(viewStartDate, viewEndDate);
  
  // Force loading state to true for a brief period after component mounts,
  // and also enforce a maximum loading time to prevent infinite loading
  const [initialLoadingComplete, setInitialLoadingComplete] = useState(false);
  const [forceLoadComplete, setForceLoadComplete] = useState(false);
  
  // State for manual reload button
  const [showReloadButton, setShowReloadButton] = useState(false);
  
  useEffect(() => {
    // Always show loading state when component first mounts
    const initialTimer = setTimeout(() => {
      setInitialLoadingComplete(true);
    }, 1500); // Show loading for at least 1.5 seconds
    
    // Force complete loading after 8 seconds even if data is still loading
    // This prevents users from being stuck in an indefinite loading state
    const forceTimer = setTimeout(() => {
      console.log("Force loading complete due to timeout");
      setForceLoadComplete(true);
      
      // Show reload button after a brief delay
      setTimeout(() => {
        setShowReloadButton(true);
      }, 1000);
    }, 8000);
    
    return () => {
      clearTimeout(initialTimer);
      clearTimeout(forceTimer);
    };
  }, []);
  
  // Function to handle manual page reload
  const handleForceReload = () => {
    console.log("User triggered manual reload");
    window.location.reload();
  };
  
  // Combined loading state for all data, with a maximum loading time
  const isLoading = (isEventsLoading || isCalendarsLoading || isSharedCalendarsLoading || !initialLoadingComplete) 
                    && !forceLoadComplete;
  
  // Use useMemo to ensure filteredEvents only updates when rawEvents or cacheVersion changes
  const events = useMemo(() => {
    console.log(`Memoizing filtered events (cache version: ${cacheVersion})`);
    
    // Log current cache state for debugging
    const queryCache = queryClient.getQueryData(['/api/events']);
    console.log('Query cache state:', 
      queryCache ? `${(queryCache as any[]).length} events` : 'empty', 
      'Raw events:', rawEvents ? `${rawEvents.length} events` : 'empty'
    );
    
    if (!rawEvents || rawEvents.length === 0) return [];
    
    // We're using a simple passthrough for now, but could add additional filtering if needed
    // The key is that this creates a new array reference whenever rawEvents changes
    return [...rawEvents];
  }, [rawEvents, cacheVersion, queryClient]);
  
  // Server connection status is managed by the useServerConnection hook
  
  // Add event listeners for export and import calendar buttons
  useEffect(() => {
    const handleExportCalendarEvent = () => {
      setExportCalendarOpen(true);
    };
    
    const handleImportCalendarEvent = () => {
      setImportCalendarOpen(true);
    };
    
    window.addEventListener('export-calendar', handleExportCalendarEvent);
    window.addEventListener('import-calendar', handleImportCalendarEvent);
    
    return () => {
      window.removeEventListener('export-calendar', handleExportCalendarEvent);
      window.removeEventListener('import-calendar', handleImportCalendarEvent);
    };
  }, []);
  
  const toggleSidebar = () => setShowSidebar(!showSidebar);

  const handleCreateEvent = (date?: Date) => {
    setSelectedEvent(null);
    // Always create a new date object to prevent references issues
    // This ensures that when we select e.g. April 25th, we get that exact date
    setSelectedDate(date ? new Date(date) : undefined);
    console.log(`Calendar: Setting selected date to ${date?.toISOString()}`);
    setEventFormOpen(true);
  };

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event);
    setEventDetailOpen(true);
  };

  const handleEditEvent = () => {
    if (selectedEvent) {
      setEventDetailOpen(false);
      setEventFormOpen(true);
    }
  };

  const handleOpenServerSettings = () => setServerSettingsOpen(true);
  
  const handleOpenSyncSettings = () => setSyncSettingsOpen(true);
  
  // This function can accept a possibly undefined calendar
  const handleShareCalendar = (calendar: CalendarType | undefined) => {
    // Only set selected calendar if it's defined
    if (calendar) {
      setSelectedCalendar(calendar);
    } else {
      // In multi-select mode we don't need a specific calendar
      setSelectedCalendar(null);
    }
    setShareCalendarOpen(true);
  };
  
  // New function to handle multi-calendar sharing
  const handleMultiShareCalendars = () => {
    setMultiShareCalendarOpen(true);
  };
  
  const handleExportCalendar = () => {
    setExportCalendarOpen(true);
  };
  
  const handleImportCalendar = () => {
    setImportCalendarOpen(true);
  };
  
  const handleBulkDelete = () => {
    setBulkDeleteOpen(true);
  };
  
  const handleSync = async () => {
    try {
      setIsSyncing(true);
      const response = await apiRequest('POST', '/api/sync');
      const result = await response.json();
      
      // Get calendar and event counts from the response or use default values
      const calendarsCount = result.calendarsCount || 0;
      const eventsCount = result.eventsCount || 0;
      
      toast({
        title: "Sync Successful",
        description: `Found ${calendarsCount} calendars with ${eventsCount} events.`,
      });
      
      // Refetch calendars and events
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      refetch();
    } catch (error) {
      toast({
        title: "Sync Failed",
        description: "Could not sync with the CalDAV server.",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-50">
      <CalendarHeader 
        onToggleSidebar={toggleSidebar} 
        onCreateEvent={handleCreateEvent}
        showSidebarToggle={!showSidebar}
      />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Enhanced Sidebar with better handling for large calendar lists */}
        <EnhancedCalendarSidebar 
          visible={showSidebar} 
          onCreateEvent={handleCreateEvent}
          onOpenServerSettings={handleOpenServerSettings}
          onOpenSyncSettings={handleOpenSyncSettings}
          onShareCalendar={handleShareCalendar}
          onMultiShareCalendars={handleMultiShareCalendars}
          onImportCalendar={handleImportCalendar}
        />
        
        {/* Main Calendar */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="p-4 border-b bg-background flex justify-between items-center">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">Calendar</h1>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="text-sm"
                >
                  {isSyncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Sync
                </Button>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleBulkDelete}
                  className="text-sm"
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Bulk Delete
                </Button>
              </div>
              
              <Tabs defaultValue={viewType} onValueChange={(value) => setViewType(value as CalendarViewType)}>
                <TabsList>
                  <TabsTrigger value="year">Year</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="day">Day</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          
          {/* Always render the calendar views, but add a clear loading indicator overlay when loading */}
          <div className="relative">
            {isLoading && (
              <div className="absolute inset-0 bg-white/80 z-10 flex justify-center items-center">
                <div className="flex flex-col items-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <div className="text-lg font-medium text-primary mb-2">Loading calendars and events...</div>
                  
                  {showReloadButton && (
                    <div className="mt-4">
                      <p className="text-amber-600 mb-2 text-center">
                        Taking longer than expected? The WebSocket connection might have issues.
                      </p>
                      <Button 
                        variant="outline" 
                        onClick={handleForceReload}
                        className="mt-2"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Reload Page
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {viewType === 'year' && <YearView events={events} onEventClick={handleEventClick} />}
            {viewType === 'month' && <CalendarGrid events={events} isLoading={isLoading || isSyncing} onEventClick={handleEventClick} onDayDoubleClick={handleCreateEvent} />}
            {viewType === 'week' && <WeekView events={events} onEventClick={handleEventClick} />}
            {viewType === 'day' && <DayView events={events} onEventClick={handleEventClick} />}
          </div>
        </main>
      </div>
      
      {/* Modals */}
      <ImprovedEventFormModal 
        open={eventFormOpen} 
        event={selectedEvent}
        // Make sure we pass the selected date correctly
        selectedDate={!selectedEvent ? selectedDate : undefined} 
        onClose={() => {
          console.log(`[DATE DEBUG] Closing event form modal, clearing selectedDate`);
          setEventFormOpen(false);
          setSelectedDate(undefined);
        }} 
      />
      
      <EventDetailModal 
        open={eventDetailOpen} 
        event={selectedEvent} 
        onClose={() => setEventDetailOpen(false)}
        onEdit={handleEditEvent}
      />
      
      <ServerConnectionModal 
        open={serverSettingsOpen} 
        onClose={() => setServerSettingsOpen(false)} 
      />
      
      <SyncSettingsModal
        open={syncSettingsOpen}
        onClose={() => setSyncSettingsOpen(false)}
      />
      
      <ShareCalendarModal
        open={shareCalendarOpen}
        onClose={() => setShareCalendarOpen(false)}
        calendar={selectedCalendar}
      />
      
      <ExportCalendarModal
        open={exportCalendarOpen}
        onOpenChange={setExportCalendarOpen}
      />
      
      <ImportCalendarModal
        open={importCalendarOpen}
        onOpenChange={setImportCalendarOpen}
      />
      
      <BulkDeleteModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
      />
      
      <MultiCalendarShareModal
        open={multiShareCalendarOpen}
        onClose={() => setMultiShareCalendarOpen(false)}
      />
    </div>
  );
}

export default function Calendar() {
  const { user, isLoading: authLoading, forceRefreshUserData = () => {} } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [forceRefreshAttempted, setForceRefreshAttempted] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [showContent, setShowContent] = useState(false);
  
  // When the component mounts, trigger a data refresh if authenticated
  useEffect(() => {
    if (user && !forceRefreshAttempted) {
      console.log(`Calendar: Triggering force refresh on mount for user ${user.username} (ID: ${user.id})`);
      
      // First clear any existing cached data
      queryClient.clear();
      
      // Then trigger a fresh reload
      forceRefreshUserData();
      setForceRefreshAttempted(true);
      
      // Set a timeout to show content even if loading takes too long
      const timer = setTimeout(() => {
        console.log('Loading timeout reached - showing content anyway');
        setLoadingTimeout(true);
      }, 5000); // 5 seconds timeout
      
      return () => clearTimeout(timer);
    }
  }, [user, forceRefreshUserData, forceRefreshAttempted, queryClient]);
  
  // Set a flag to show content either immediately or after timeout
  useEffect(() => {
    if (!authLoading || loadingTimeout) {
      // Add slight delay to ensure all queries are properly registered
      const timer = setTimeout(() => {
        setShowContent(true);
        
        // If we're showing due to timeout, inform the user
        if (loadingTimeout && user) {
          toast({
            title: "Some data still loading",
            description: "We're showing your calendar while some data continues to load in the background.",
            duration: 5000,
          });
          
          // Try one more force refresh
          setTimeout(() => {
            forceRefreshUserData();
          }, 1000);
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [authLoading, loadingTimeout, user, toast, forceRefreshUserData]);
  
  // Manual reload button handler
  const handleManualReload = () => {
    window.location.reload();
  };
  
  // Show loading screen if still loading and timeout hasn't occurred
  if (!showContent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h2 className="text-xl font-medium">Loading your calendar...</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Please wait while we prepare your calendar data
          </p>
          
          {/* Add a manual reload button if it's taking too long */}
          {loadingTimeout && (
            <Button 
              variant="outline" 
              onClick={handleManualReload}
              className="mt-4"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reload Page
            </Button>
          )}
        </div>
      </div>
    );
  }
  
  return <CalendarContent />;
}
