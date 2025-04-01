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

  // Group events by day - handle multi-day events
  const eventsByDay: Record<string, Event[]> = {};
  
  events.forEach(event => {
    // Process each event and add it to all days it spans
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    
    // Use the start date's month and year to determine if this event should be shown
    // If it belongs to a month being displayed, we'll show it on its day(s)
    const eventStartMonth = startDate.getMonth();
    const eventStartYear = startDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    // Only consider events from the current month view
    if (eventStartMonth === currentMonth && eventStartYear === currentYear) {
      // Add to the start date
      const dateKey = startDate.toISOString().split('T')[0];
      
      if (!eventsByDay[dateKey]) {
        eventsByDay[dateKey] = [];
      }
      
      eventsByDay[dateKey].push(event);
    }
    
    // For debugging
    console.log(`Event "${event.title}" (${startDate.toISOString()}) - Current month: ${currentMonth}, Event month: ${eventStartMonth}`);
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
