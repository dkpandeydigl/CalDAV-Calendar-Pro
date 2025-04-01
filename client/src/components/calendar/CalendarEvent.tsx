import React from 'react';
import { formatTime } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useCalendars } from '@/hooks/useCalendars';

interface CalendarEventProps {
  event: Event;
  onClick: () => void;
}

const CalendarEvent: React.FC<CalendarEventProps> = ({ event, onClick }) => {
  const { calendars } = useCalendars();
  
  // Find the calendar this event belongs to
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Format event time
  const startTime = formatTime(new Date(event.startDate));
  const eventDisplay = event.allDay ? event.title : `${startTime} - ${event.title}`;
  
  // Determine border color based on calendar
  const borderColor = calendar?.color || '#0078d4';
  
  return (
    <div
      className="text-xs bg-white p-1 mb-1 rounded shadow-sm truncate cursor-pointer hover:bg-neutral-50"
      style={{ borderLeft: `3px solid ${borderColor}` }}
      onClick={onClick}
    >
      {eventDisplay}
    </div>
  );
};

export default CalendarEvent;
