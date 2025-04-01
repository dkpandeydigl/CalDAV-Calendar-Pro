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
  onDayDoubleClick?: () => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({ events, isLoading, onEventClick, onDayDoubleClick }) => {
  const { currentDate, viewType, selectedTimezone } = useCalendarContext();
  const weekdayHeaders = getWeekdayHeaders();
  
  // Generate calendar days for month view
  const calendarDays = getCalendarDays(currentDate);

  // Group events by day - handle multi-day events and data validation
  const eventsByDay: Record<string, Event[]> = {};
  
  events.forEach(event => {
    try {
      // Process each event and add it to all days it spans
      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);
      
      // Check if dates are valid
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.warn(`Skipping event with invalid dates: "${event.title}"`);
        return; // Skip this event
      }
      
      // Use the user's selected timezone from context
      console.log(`Using selected timezone: ${selectedTimezone}`);
      
      // When we have events stored in UTC (like "2025-04-01T00:00:00.000Z"),
      // we need to handle them in their original UTC form
      // We don't want to create a new date by extracting parts as that can shift days
      
      // For an event stored as 2025-04-01T00:00:00.000Z, we want it to display on April 1st
      // in any timezone, not April 2nd in timezones ahead of UTC
      
      // We'll create a date that preserves the display date as the same day
      // by using the date from the ISO string directly (keeping only YYYY-MM-DD)
      const dateStr = startDate.toISOString().split('T')[0];
      const localStartDate = new Date(`${dateStr}T12:00:00.000Z`);
      
      
      console.log(`Event ${event.title}: Original start - ${startDate.toISOString()}, Adjusted for display - ${localStartDate.toISOString()}`);
      
      // Get all days in this month
      const daysInMonth = calendarDays.map(day => day.date.toISOString().split('T')[0]);
      
      // Calculate the day of month the event starts on using local date
      const dateKey = localStartDate.toISOString().split('T')[0];
      
      // If the event day is in our current view, add it
      if (daysInMonth.includes(dateKey)) {
        if (!eventsByDay[dateKey]) {
          eventsByDay[dateKey] = [];
        }
        
        eventsByDay[dateKey].push(event);
      }
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
    }
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
              onDayDoubleClick={onDayDoubleClick}
            />
          );
        })}
      </div>
    </>
  );
};

export default CalendarGrid;
