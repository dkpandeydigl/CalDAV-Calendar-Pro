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
import RecurringEventEditModal, { RecurringEditMode } from '@/components/modals/RecurringEventEditModal';
import PrintEventModal from '@/components/modals/PrintEventModal';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { Event, Calendar as CalendarType } from '@shared/schema';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, addDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { Loader2, RefreshCcw, Trash } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';
import { generateUID, getOrGenerateUID, ensureCompliantUID } from '@/lib/uid-utils';

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
  const [recurringEditModalOpen, setRecurringEditModalOpen] = useState(false);
  const [printEventModalOpen, setPrintEventModalOpen] = useState(false);
  
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarType | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [cacheVersion, setCacheVersion] = useState(0);
  const { events: rawEvents, isLoading, refetch, deleteEvent } = useCalendarEvents(viewStartDate, viewEndDate);
  
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
      
      // If this is a recurring event, show the recurring edit modal first
      if (selectedEvent.recurrenceRule) {
        setRecurringEditModalOpen(true);
      } else {
        setEventFormOpen(true);
      }
    }
  };
  
  // Handler for copying an event - creates a new event with the same details but a new UID
  // Follows RFC 5545 spec section 3.8.4.7 for UIDs
  const handleCopyEvent = async (event: Event) => {
    if (event) {
      // Close the detail modal
      setEventDetailOpen(false);
      
      try {
        // Get a robust, persistently stored UID using proper IndexedDB for RFC compliance
        const newUID = await getOrGenerateUID();
        
        // Create a clean RFC 5545 compliant event with proper typing
        const copiedEvent: ICalendarEventCreate = {
          calendarId: event.calendarId,
          title: `Copy of ${event.title}`,
          description: event.description || '',
          location: event.location || '',
          startDate: new Date(event.startDate),
          endDate: new Date(event.endDate),
          allDay: Boolean(event.allDay),
          timezone: event.timezone || 'UTC',
          uid: newUID,
          status: 'CONFIRMED',
          syncStatus: 'local',
          // Strip attendees and resources for the copy to avoid notifications
          // RFC 5545 requires all attendee invitations to be explicit
          attendees: [],
          resources: []
        };
        
        // Log for verification
        console.log('Copying event with RFC-compliant UID:', { 
          originalId: event.id,
          originalUID: event.uid,
          newUID: copiedEvent.uid,
          title: copiedEvent.title
        });
        
        // Set as the selected event for the form
        // This cast is necessary due to the DOM Event vs CalendarEvent type conflict
        setSelectedEvent(copiedEvent as any);
        
        // Open the event form to let user modify before saving
        setEventFormOpen(true);
        
        toast({
          title: "Event Copied",
          description: "You can now modify the copy before saving.",
        });
      } catch (error) {
        console.error("Error copying event:", error);
        toast({
          title: "Copy Failed",
          description: "Could not generate a unique identifier for the copied event.",
          variant: "destructive"
        });
      }
    }
  };
  
  // Handler for printing an event
  const handlePrintEvent = (event: Event) => {
    if (event) {
      setSelectedEvent(event);
      setPrintEventModalOpen(true);
    }
  };
  
  // Handler for when the recurring edit modal returns a selection
  const handleRecurringEditConfirm = (mode: RecurringEditMode) => {
    setRecurringEditModalOpen(false);
    
    if (mode === 'cancel') {
      // User canceled editing
      return;
    }
    
    // Store the edit mode in session storage for the form to use
    if (mode === 'single' || mode === 'all') {
      try {
        sessionStorage.setItem('recurring_edit_mode', mode);
        setEventFormOpen(true);
      } catch (error) {
        console.error('Error saving recurring edit mode:', error);
        toast({
          title: "Error",
          description: "Could not save edit mode preference.",
          variant: "destructive"
        });
      }
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
          
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {viewType === 'year' && <YearView events={events} onEventClick={handleEventClick} />}
              {viewType === 'month' && <CalendarGrid events={events} isLoading={isLoading || isSyncing} onEventClick={handleEventClick} onDayDoubleClick={handleCreateEvent} />}
              {viewType === 'week' && <WeekView events={events} onEventClick={handleEventClick} />}
              {viewType === 'day' && <DayView events={events} onEventClick={handleEventClick} />}
            </>
          )}
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
        onCopy={handleCopyEvent}
        onPrint={handlePrintEvent}
      />
      
      <RecurringEventEditModal
        open={recurringEditModalOpen}
        event={selectedEvent}
        onClose={() => setRecurringEditModalOpen(false)}
        onConfirm={handleRecurringEditConfirm}
      />
      
      <PrintEventModal
        open={printEventModalOpen}
        event={selectedEvent}
        onClose={() => setPrintEventModalOpen(false)}
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
  return <CalendarContent />;
}
