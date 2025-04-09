import React from 'react';
import { format } from 'date-fns';
import CalendarEvent from './CalendarEvent';
import { CleanupButton } from '@/components/utils/CleanupButton';
import { useCalendars } from '@/hooks/useCalendars';
import type { CalendarDay as CalendarDayType } from '@/lib/date-utils';
import type { Event } from '@shared/schema';

interface CalendarDayProps {
  day: CalendarDayType;
  events: Event[];
  onEventClick: (event: Event) => void;
  onDayDoubleClick?: (date: Date) => void;
}

const CalendarDay: React.FC<CalendarDayProps> = ({ day, events, onEventClick, onDayDoubleClick }) => {
  const { date, isCurrentMonth, isToday } = day;
  const { calendars } = useCalendars();
  
  // Check if this day has multiple "Untitled Event" entries
  const untitledEvents = events.filter(event => event.title === 'Untitled Event');
  const hasDuplicateUntitledEvents = untitledEvents.length > 1;
  
  // Get the calendar ID for the untitled events (using the first one)
  const calendarId = untitledEvents.length > 0 ? untitledEvents[0].calendarId : undefined;
  
  // Find the calendar name
  const calendar = calendarId ? calendars.find(cal => cal.id === calendarId) : undefined;
  
  const dateStr = format(date, 'yyyy-MM-dd');
  
  return (
    <div 
      className={`p-1 border border-neutral-200 min-h-[100px] cursor-pointer ${
        isToday ? 'bg-blue-50' : ''
      }`}
      onDoubleClick={(e) => onDayDoubleClick && onDayDoubleClick(date)}
    >
      <div className="flex justify-between items-center p-1">
        {hasDuplicateUntitledEvents && calendarId && (
          <div className="flex-shrink-0">
            <CleanupButton date={dateStr} calendarId={calendarId} />
          </div>
        )}
        <div className={`text-right ${hasDuplicateUntitledEvents ? 'ml-auto' : ''}`}>
          {isToday ? (
            <span className="text-sm font-bold bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center">
              {format(date, 'd')}
            </span>
          ) : (
            <span className={`text-sm ${isCurrentMonth ? 'text-neutral-800' : 'text-neutral-400'}`}>
              {format(date, 'd')}
            </span>
          )}
        </div>
      </div>
      
      {/* Events */}
      <div className="space-y-1">
        {events.map((event) => (
          <CalendarEvent 
            key={event.id} 
            event={event} 
            onClick={() => onEventClick(event)} 
          />
        ))}
      </div>
    </div>
  );
};

export default CalendarDay;
