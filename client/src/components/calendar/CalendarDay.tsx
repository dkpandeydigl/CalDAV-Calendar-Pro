import React, { useEffect } from 'react';
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
  
  const dateStr = format(date, 'yyyy-MM-dd');
  
  // Find all events with "Untitled Event" in the title (case insensitive)
  const untitledEvents = events.filter(event => 
    event.title && event.title.toLowerCase() === 'untitled event'
  );
  
  // Get a unique list of calendar IDs that have untitled events
  const calendarIds: number[] = [];
  // Use a manual approach to filter unique IDs
  untitledEvents.forEach(event => {
    if (event.calendarId && !calendarIds.includes(event.calendarId)) {
      calendarIds.push(event.calendarId);
    }
  });
  
  // Debug information about untitled events - only log once during initial render
  useEffect(() => {
    if (untitledEvents.length > 1) {
      console.log(`Date ${dateStr} has ${untitledEvents.length} untitled events:`, 
        untitledEvents.map(e => ({ id: e.id, title: e.title, calendarId: e.calendarId }))
      );
    }
  }, []);
  
  // Show cleanup button if we have multiple untitled events
  const showCleanupButton = untitledEvents.length > 1;
  
  // Use the first calendar ID if there are untitled events
  const calendarId = calendarIds.length > 0 ? calendarIds[0] : undefined;
  
  return (
    <div 
      className={`p-1 border border-neutral-200 min-h-[100px] cursor-pointer ${
        isToday ? 'bg-blue-50' : ''
      }`}
      onDoubleClick={(e) => {
        if (onDayDoubleClick) {
          console.log(`[DATE DEBUG] Double-clicked day: ${date.toISOString()}`);
          console.log(`[DATE DEBUG] Date object being passed to handler:`, date);
          
          // Important: Create a NEW date object here to avoid reference issues
          const selectedDate = new Date(date);
          console.log(`[DATE DEBUG] New date created for event: ${selectedDate.toISOString()}`);
          
          onDayDoubleClick(selectedDate);
        }
      }}
    >
      <div className="flex justify-between items-center p-1">
        {showCleanupButton && calendarId && (
          <div className="flex-shrink-0">
            <CleanupButton date={dateStr} calendarId={calendarId} />
          </div>
        )}
        <div className={`text-right ${showCleanupButton ? 'ml-auto' : ''}`}>
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
      
      {/* Show count of untitled events as a debug indicator */}
      {untitledEvents.length > 1 && (
        <div className="text-xs text-red-500 font-semibold mb-1">
          {untitledEvents.length} untitled events
        </div>
      )}
      
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
