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
  onDayDoubleClick?: (date: Date) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({ events, isLoading, onEventClick, onDayDoubleClick }) => {
  const { currentDate, viewType, selectedTimezone } = useCalendarContext();
  const weekdayHeaders = getWeekdayHeaders();
  
  // Generate calendar days for month view
  const calendarDays = getCalendarDays(currentDate);

  // Group events by day - handle multi-day events and data validation
  const eventsByDay: Record<string, Event[]> = {};
  
  // Get all days in this month as date keys
  const daysInMonth = calendarDays.map(day => {
    const d = day.date;
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  });
  
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
      
      // If the event is a multi-day event, display it on all days between start and end
      const isMultiDayEvent = startDate.toISOString().split('T')[0] !== endDate.toISOString().split('T')[0];
      
      // If it's a multi-day event or has recurrence, handle it specially
      if (isMultiDayEvent) {
        console.log(`Processing multi-day event "${event.title}" from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        // Create an array of all days this event spans
        const eventDates: string[] = [];
        
        // Start with the first day
        const firstDay = startDate.toISOString().split('T')[0];
        eventDates.push(firstDay);
        
        // Add all days up to the end date (using the date portion only)
        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + 1); // Start with next day
        
        const endDay = endDate.toISOString().split('T')[0];
        
        while (currentDate.toISOString().split('T')[0] <= endDay) {
          eventDates.push(currentDate.toISOString().split('T')[0]);
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        console.log(`Event spans these dates: ${eventDates.join(', ')}`);
        
        // Add event to every day it spans that's in the current month view
        eventDates.forEach(dateStr => {
          const parts = dateStr.split('-');
          const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
          
          // Check if this day is in the current view
          if (daysInMonth.includes(dateKey)) {
            if (!eventsByDay[dateKey]) {
              eventsByDay[dateKey] = [];
            }
            
            // Create a new event object with additional metadata
            const existingRawData = event.rawData ? 
                (typeof event.rawData === 'object' ? event.rawData : {}) : {};
                
            const newEvent = {
              ...event,
              // Add metadata about which day in the span this is (first, middle, last)
              rawData: {
                ...existingRawData,
                isMultiDay: true,
                isFirstDay: dateStr === firstDay,
                isLastDay: dateStr === endDay,
                totalDays: eventDates.length
              }
            };
            
            eventsByDay[dateKey].push(newEvent);
          }
        });
      } else {
        // Single-day event, handle normally
        const dateObj = new Date(startDate);
        const dateKey = dateObj.toISOString().split('T')[0].replace(/T.*$/, '');
        
        console.log(`Event ${event.title}: Single-day event on ${dateKey}, User timezone: ${selectedTimezone}`);
        
        // If the event day is in our current view, add it
        if (daysInMonth.includes(dateKey)) {
          if (!eventsByDay[dateKey]) {
            eventsByDay[dateKey] = [];
          }
          
          eventsByDay[dateKey].push(event);
        }
      }
      
      // Handle recurring events (if they have a recurrenceRule property)
      if (event.recurrenceRule) {
        console.log(`Event ${event.title} has recurrence rule: ${event.recurrenceRule}`);
        // This would be where we generate recurring instances
        // For now, we'll add more detailed logging to understand the recurrence
        console.log(`Recurring event detected: ${event.title} with rule: ${event.recurrenceRule}`);
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
          // Generate dateKey in the same format as we do for events
          const d = day.date;
          const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
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
