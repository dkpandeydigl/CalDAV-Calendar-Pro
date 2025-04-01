import React, { useState } from 'react';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarSidebar from '@/components/calendar/CalendarSidebar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import EventFormModal from '@/components/modals/EventFormModal';
import EventDetailModal from '@/components/modals/EventDetailModal';
import ServerConnectionModal from '@/components/modals/ServerConnectionModal';
import { CalendarProvider, useCalendarContext } from '@/contexts/CalendarContext';
import { Event } from '@shared/schema';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';

// Wrap the actual calendar content in a separate component that uses the context
const CalendarContent: React.FC = () => {
  const { viewStartDate, viewEndDate } = useCalendarContext();
  const [showSidebar, setShowSidebar] = useState(true);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  
  const { events, isLoading } = useCalendarEvents(viewStartDate, viewEndDate);
  
  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

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

  const handleOpenServerSettings = () => {
    setServerSettingsOpen(true);
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
          <CalendarGrid 
            events={events} 
            isLoading={isLoading}
            onEventClick={handleEventClick}
          />
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
};

// Main calendar component that provides the calendar context
const Calendar: React.FC = () => {
  return (
    <CalendarProvider>
      <CalendarContent />
    </CalendarProvider>
  );
};

export default Calendar;
