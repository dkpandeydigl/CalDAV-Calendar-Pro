import { useState } from 'react';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarSidebar from '@/components/calendar/CalendarSidebar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import EventFormModal from '@/components/modals/EventFormModal';
import EventDetailModal from '@/components/modals/EventDetailModal';
import ServerConnectionModal from '@/components/modals/ServerConnectionModal';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { Event } from '@shared/schema';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, addDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { Loader2, RefreshCcw } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';

// For different calendar views
type CalendarViewType = 'year' | 'month' | 'week' | 'day';

function YearView({ events, onEventClick }: { events: Event[]; onEventClick: (event: Event) => void }) {
  const { currentDate } = useCalendarContext();
  const year = currentDate.getFullYear();

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">{year}</h2>
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, index) => {
          const monthDate = new Date(year, index);
          const monthName = format(monthDate, 'MMMM');
          
          // Filter events for this month
          const monthEvents = events.filter(event => {
            const eventDate = new Date(event.startDate);
            return eventDate.getMonth() === index && eventDate.getFullYear() === year;
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
  const { currentDate } = useCalendarContext();
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
                  const eventStart = new Date(event.startDate);
                  return format(eventStart, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd');
                })
                .map(event => (
                  <div 
                    key={event.id}
                    className="p-1 m-1 text-xs bg-primary/10 rounded cursor-pointer hover:bg-primary/20"
                    onClick={() => onEventClick(event)}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    <div className="text-muted-foreground">
                      {format(new Date(event.startDate), 'h:mm a')} - {format(new Date(event.endDate), 'h:mm a')}
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
  const { currentDate } = useCalendarContext();
  const hours = Array.from({ length: 24 }).map((_, i) => i);
  
  const dayEvents = events.filter(event => {
    const eventDate = new Date(event.startDate);
    return format(eventDate, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd');
  });
  
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">{format(currentDate, 'EEEE, MMMM d, yyyy')}</h2>
      <div className="flex flex-col border rounded-lg shadow-sm">
        {hours.map(hour => {
          const hourEvents = dayEvents.filter(event => {
            const eventStart = new Date(event.startDate);
            return eventStart.getHours() === hour;
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
                      top: `${(new Date(event.startDate).getMinutes() / 60) * 100}%`,
                    }}
                    onClick={() => onEventClick(event)}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    {!event.allDay && (
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(event.startDate), 'h:mm a')} - {format(new Date(event.endDate), 'h:mm a')}
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
  const { viewStartDate, viewEndDate, viewType, setViewType, setServerStatus } = useCalendarContext();
  const [showSidebar, setShowSidebar] = useState(true);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const { events, isLoading, refetch } = useCalendarEvents(viewStartDate, viewEndDate);
  
  // Server connection status is managed by the useServerConnection hook
  
  const toggleSidebar = () => setShowSidebar(!showSidebar);

  const handleCreateEvent = () => {
    setSelectedEvent(null);
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
  
  const handleSync = async () => {
    try {
      setIsSyncing(true);
      const response = await apiRequest('POST', '/api/sync');
      const result = await response.json();
      
      toast({
        title: "Sync Successful",
        description: `Found ${result.calendarsCount} calendars with ${result.eventsCount || 0} events.`,
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
        {/* Sidebar - hidden on mobile by default */}
        <CalendarSidebar 
          visible={showSidebar} 
          onCreateEvent={handleCreateEvent}
          onOpenServerSettings={handleOpenServerSettings}
        />
        
        {/* Main Calendar */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="p-4 border-b bg-background flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Calendar</h1>
              {user && (
                <p className="text-sm text-muted-foreground">
                  Welcome, {user.username}
                </p>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Sync Now
              </Button>
              
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
              {viewType === 'month' && <CalendarGrid events={events} isLoading={isLoading} onEventClick={handleEventClick} />}
              {viewType === 'week' && <WeekView events={events} onEventClick={handleEventClick} />}
              {viewType === 'day' && <DayView events={events} onEventClick={handleEventClick} />}
            </>
          )}
        </main>
      </div>
      
      {/* Modals */}
      <EventFormModal 
        open={eventFormOpen} 
        event={selectedEvent} 
        onClose={() => setEventFormOpen(false)} 
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
    </div>
  );
}

export default function Calendar() {
  return <CalendarContent />;
}
