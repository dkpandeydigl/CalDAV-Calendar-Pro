import React from 'react';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { getCalendarDays, getWeekdayHeaders } from '@/lib/date-utils';
import CalendarDay from './CalendarDay';
import { Skeleton } from '@/components/ui/skeleton';
import type { Event } from '@shared/schema';

interface CalendarGridProps {
  events: Event[];
  isLoading: boolean;
  onEventClick: (event: Event) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({ events, isLoading, onEventClick }) => {
  const { currentDate, viewType } = useCalendarContext();
  const weekdayHeaders = getWeekdayHeaders();
  
  // Generate calendar days for month view
  const calendarDays = getCalendarDays(currentDate);

  // Group events by day
  const eventsByDay: Record<string, Event[]> = {};
  
  events.forEach(event => {
    const eventDate = new Date(event.startDate);
    const dateKey = eventDate.toISOString().split('T')[0];
    
    if (!eventsByDay[dateKey]) {
      eventsByDay[dateKey] = [];
    }
    
    eventsByDay[dateKey].push(event);
  });

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="grid grid-cols-7 bg-neutral-100 border-b">
          {weekdayHeaders.map((day, index) => (
            <div key={index} className="p-2 text-center text-sm font-medium">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, index) => (
            <div key={index} className="p-2 border min-h-[100px]">
              <Skeleton className="h-6 w-6 rounded-full mb-2 ml-auto" />
              <Skeleton className="h-8 w-full mb-2" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Week Day Headers */}
      <div className="grid grid-cols-7 bg-neutral-100 border-b">
        {weekdayHeaders.map((day, index) => (
          <div key={index} className="p-2 text-center text-sm font-medium">{day}</div>
        ))}
      </div>
      
      {/* Calendar Grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, index) => {
          const dateKey = day.date.toISOString().split('T')[0];
          const dayEvents = eventsByDay[dateKey] || [];
          
          return (
            <CalendarDay
              key={index}
              day={day}
              events={dayEvents}
              onEventClick={onEventClick}
            />
          );
        })}
      </div>
    </>
  );
};

export default CalendarGrid;
