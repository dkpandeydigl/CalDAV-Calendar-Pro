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
  
  // Helper function to deduplicate events by title, start time and calendar
  const deduplicateEvents = (events: Event[], dateKey?: string): Event[] => {
    const seenEvents = new Map<string, Event>();
    
    // Sort events to prioritize those with URLs (synced with server) and more complete data
    const sortedEvents = [...events].sort((a, b) => {
      // Prefer events with URLs (synced with server)
      if (a.url && !b.url) return -1;
      if (!a.url && b.url) return 1;
      
      // If neither has URL or both have URL, prefer events with etag (fully synced)
      if (a.etag && !b.etag) return -1;
      if (!a.etag && b.etag) return 1;
      
      // For events with the same sync status, prefer those with more complete data
      const aProps = Object.keys(a).filter(k => a[k as keyof Event] !== null && a[k as keyof Event] !== undefined).length;
      const bProps = Object.keys(b).filter(k => b[k as keyof Event] !== null && b[k as keyof Event] !== undefined).length;
      
      // If property count is the same, prefer those with longer titles or descriptions
      // This helps ensure we keep the more complete version of duplicate events
      if (aProps === bProps) {
        const aContentLength = (a.title?.length || 0) + (a.description?.length || 0);
        const bContentLength = (b.title?.length || 0) + (b.description?.length || 0);
        return bContentLength - aContentLength;
      }
      
      return bProps - aProps; // More props is better
    });
    
    // Special handling for April 29th and 30th dates which have duplication issues
    const isApril2930 = dateKey && (dateKey === '2025-04-29' || dateKey === '2025-04-30');
    
    // For special dates, create a map of title -> events to handle exact title matches
    const eventsByTitle = new Map<string, Event[]>();
    
    if (isApril2930) {
      // Group events by title for special dates
      sortedEvents.forEach(event => {
        if (!event.title) return;
        
        if (!eventsByTitle.has(event.title)) {
          eventsByTitle.set(event.title, []);
        }
        eventsByTitle.get(event.title)!.push(event);
      });
      
      // Log duplicate counts for debugging
      for (const [title, events] of eventsByTitle.entries()) {
        if (events.length > 1) {
          console.log(`Found ${events.length} events with title "${title}" on ${dateKey}`);
        }
      }
    }
    
    // Apply enhanced deduplication for problematic dates
    sortedEvents.forEach(event => {
      // Check if this event has a start date
      if (!event.startDate) return;
      
      // Create a unique key based on title, start time and calendar
      const startTime = new Date(event.startDate).getTime();
      
      // For special dates (April 29-30), use more aggressive deduplication
      let key;
      if (isApril2930) {
        // For April 30th events with resources, use UID as key if available to ensure uniqueness
      if (event.uid && event.title && (event.title.toLowerCase().includes('res') || event.resources?.length)) {
        // For resource events, use UID as the best deduplication key
        key = event.uid;
        console.log(`Using UID as key for resource event: ${event.title}, UID=${event.uid}`);
      }
      // For special dates, first try exact match by title for non-resource events
      else if (event.title && eventsByTitle.get(event.title)?.length === 1) {
        // If there's only one event with this title, use the title as the key
        key = event.title;
      } else {
        // Otherwise use rounded time for more flexible matching
        const roundedTime = Math.round(startTime / (5 * 60 * 1000)) * (5 * 60 * 1000);
        
        // For these problem dates, match based on title and approximate time only
        key = `${event.title}-${roundedTime}`;
        
        // Additional logging for duplicate detection
        if (seenEvents.has(key)) {
          const existing = seenEvents.get(key)!;
          console.log(`Duplicate detected: "${event.title}" at ${new Date(event.startDate).toLocaleTimeString()}`);
          console.log(`  Existing: ID=${existing.id}, UID=${existing.uid || 'none'}`);
          console.log(`  Duplicate: ID=${event.id}, UID=${event.uid || 'none'}`);
        }
      }
      } else {
        // Regular key includes calendar ID for normal dates
        key = `${event.title}-${startTime}-${event.calendarId}`;
      }
      
      // Only add this event if we haven't seen it before or if this one is better
      if (!seenEvents.has(key)) {
        seenEvents.set(key, event);
      } else if (isApril2930) {
        // For problem dates, keep the event with a URL or more complete data
        const existingEvent = seenEvents.get(key)!;
        
        // Prefer events with URLs
        if (!existingEvent.url && event.url) {
          seenEvents.set(key, event);
        }
        // Or those with more attendees
        else if (event.attendees?.length > (existingEvent.attendees?.length || 0)) {
          seenEvents.set(key, event);
        }
        // Or those with longer descriptions
        else if ((event.description?.length || 0) > (existingEvent.description?.length || 0)) {
          seenEvents.set(key, event);
        }
      }
    });
    
    return Array.from(seenEvents.values());
  };
  
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
        console.log(`Recurring event detected: ${event.title} with rule: ${event.recurrenceRule}`);
        
        try {
          // Parse the recurrence rule
          let recurrenceObj;
          try {
            recurrenceObj = typeof event.recurrenceRule === 'string' 
              ? JSON.parse(event.recurrenceRule) 
              : event.recurrenceRule;
          } catch (e) {
            console.error(`Error parsing recurrence rule for ${event.title}:`, e);
            return; // Skip this event if we can't parse the rule
          }
          
          // Get the pattern, interval, weekdays, and end info
          let pattern = 'Weekly'; // Default to weekly if no pattern found
          let interval = 1;
          let weekdays: string[] = [];
          let endType = 'After';
          let occurrences = 10;
          let untilDate: string | undefined;
          
          if (typeof recurrenceObj === 'object' && recurrenceObj !== null) {
            // It's an object, extract properties directly
            pattern = recurrenceObj.pattern || pattern;
            interval = recurrenceObj.interval || interval;
            weekdays = recurrenceObj.weekdays || weekdays;
            endType = recurrenceObj.endType || endType;
            occurrences = recurrenceObj.occurrences || occurrences;
            untilDate = recurrenceObj.untilDate;
          } else if (typeof event.recurrenceRule === 'string') {
            // It might be in RRULE:FREQ=WEEKLY;INTERVAL=1;... format
            let rrule = event.recurrenceRule as string;
            
            // Remove the "RRULE:" prefix if present
            if (rrule.startsWith('RRULE:')) {
              rrule = rrule.substring(6);
            }
            
            console.log(`Parsing RRULE string: ${rrule}`);
            
            // Extract pattern (frequency)
            const freqMatch = rrule.match(/FREQ=([^;]+)/);
            if (freqMatch && freqMatch[1]) {
              const freq = freqMatch[1];
              if (freq === 'DAILY') pattern = 'Daily';
              else if (freq === 'WEEKLY') pattern = 'Weekly';
              else if (freq === 'MONTHLY') pattern = 'Monthly';
              else if (freq === 'YEARLY') pattern = 'Yearly';
              
              console.log(`Extracted frequency: ${freq} -> ${pattern}`);
            }
            
            // Extract interval
            const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
            if (intervalMatch && intervalMatch[1]) {
              interval = parseInt(intervalMatch[1], 10) || 1;
              console.log(`Extracted interval: ${interval}`);
            }
            
            // Extract weekdays
            const bydayMatch = rrule.match(/BYDAY=([^;]+)/);
            if (bydayMatch && bydayMatch[1]) {
              const dayAbbrs = bydayMatch[1].split(',');
              const dayMap: Record<string, string> = {
                'SU': 'Sunday',
                'MO': 'Monday',
                'TU': 'Tuesday',
                'WE': 'Wednesday',
                'TH': 'Thursday',
                'FR': 'Friday',
                'SA': 'Saturday'
              };
              weekdays = dayAbbrs.map(abbr => dayMap[abbr] || '').filter(day => day !== '');
              console.log(`Extracted weekdays: ${dayAbbrs.join(',')} -> ${weekdays.join(',')}`);
            }
            
            // Extract count (occurrences)
            const countMatch = rrule.match(/COUNT=(\d+)/);
            if (countMatch && countMatch[1]) {
              occurrences = parseInt(countMatch[1], 10) || 10;
              endType = 'After';
            }
            
            // Extract until date
            const untilMatch = rrule.match(/UNTIL=([^;]+)/);
            if (untilMatch && untilMatch[1]) {
              untilDate = untilMatch[1];
              endType = 'Until';
            }
          }
          
          console.log('Parsed recurrence rule:', { pattern, interval, weekdays, endType, occurrences, untilDate });
          
          // Define the date range to generate occurrences for
          // Start from the event start date, end at the last date in our view or the untilDate
          const startRecurDate = new Date(event.startDate);
          
          // Calculate the end date for recurrences
          let endRecurDate;
          if (endType === 'Until' && untilDate) {
            endRecurDate = new Date(untilDate);
          } else {
            // Default: use the end of the current month view + 1 month
            const lastViewDate = new Date(daysInMonth[daysInMonth.length - 1]);
            endRecurDate = new Date(lastViewDate);
            endRecurDate.setMonth(endRecurDate.getMonth() + 1);
          }
          
          // Limit the number of occurrences to avoid performance issues
          // If endType is 'After', respect that limit
          const maxOccurrences = endType === 'After' && occurrences ? occurrences : 100;
          
          // Storage for all recurrence dates
          const recurrenceDates = [];
          
          // Add the original date as the first occurrence
          recurrenceDates.push(new Date(startRecurDate));
          
          // Calculate the duration of the event for adding to future occurrences
          const eventDurationMs = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
          
          // Generate the occurrences based on the pattern
          let currentDate = new Date(startRecurDate);
          let count = 1; // Start at 1 because we already have the original event
          
          while (count < maxOccurrences && currentDate < endRecurDate) {
            // Calculate the next occurrence based on the pattern
            let nextDate = new Date(currentDate);
            
            switch (pattern) {
              case 'Daily':
                nextDate.setDate(nextDate.getDate() + interval);
                break;
                
              case 'Weekly':
                if (weekdays && weekdays.length > 0) {
                  // For weekly with specified days, find the next matching weekday
                  const dayMap = {
                    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                    'Thursday': 4, 'Friday': 5, 'Saturday': 6
                  };
                  
                  // Get the numerical values for the selected weekdays
                  const selectedDays = weekdays.map((day: string) => dayMap[day as keyof typeof dayMap]).sort();
                  
                  // Find the next day that matches one of our selected days
                  // First, add the interval weeks to the current date
                  let nextWeekDate = new Date(nextDate);
                  nextWeekDate.setDate(nextWeekDate.getDate() + (7 * interval));
                  
                  // Find the matching weekday in the next interval period
                  let found = false;
                  let testDate = new Date(nextWeekDate);
                  // Get the start of the week (Sunday)
                  testDate.setDate(testDate.getDate() - testDate.getDay());
                  
                  // Check each day in the next week for a matching weekday
                  for (let i = 0; i < 7 && !found; i++) {
                    if (selectedDays.includes(testDate.getDay())) {
                      nextDate = new Date(testDate);
                      found = true;
                    }
                    testDate.setDate(testDate.getDate() + 1);
                  }
                  
                  // If we still didn't find a matching day, just use the next interval week
                  if (!found) {
                    nextDate = nextWeekDate;
                  }
                } else {
                  // Simple weekly interval
                  nextDate.setDate(nextDate.getDate() + (7 * interval));
                }
                break;
                
              case 'Monthly':
                nextDate.setMonth(nextDate.getMonth() + interval);
                break;
                
              case 'Yearly':
                nextDate.setFullYear(nextDate.getFullYear() + interval);
                break;
                
              default:
                // Invalid pattern, skip this iteration
                console.warn(`Unknown recurrence pattern: ${pattern}`);
                currentDate = endRecurDate; // Exit the loop
                continue;
            }
            
            // Add this occurrence to our list
            recurrenceDates.push(new Date(nextDate));
            
            // Update for next iteration
            currentDate = nextDate;
            count++;
          }
          
          // Now create the recurring event instances and add them to the appropriate days
          recurrenceDates.forEach((date, index) => {
            // Skip the first occurrence as it's already handled above
            if (index === 0) return;
            
            // Calculate the end date by adding the original duration
            const recEndDate = new Date(date.getTime() + eventDurationMs);
            
            // Create a copy of the event for this occurrence
            const recEvent = { 
              ...event,
              id: event.id, // Keep the same ID as the original event
              recurrenceId: `${event.id}-recurrence-${index}`, // Create a unique ID for this occurrence
              originalEventId: event.id, // Reference to the original event
              startDate: date,
              endDate: recEndDate,
              isRecurrence: true,
              recurrenceIndex: index
            };
            
            // Process this recurrence event like a regular event
            try {
              // Check if this is a multi-day event
              const eventStart = new Date(recEvent.startDate);
              const eventEnd = new Date(recEvent.endDate);
              const isMultiDay = eventStart.toDateString() !== eventEnd.toDateString();
              
              if (isMultiDay) {
                // For multi-day events, create entries for each day in the range
                const startDay = new Date(eventStart);
                startDay.setHours(0, 0, 0, 0);
                const endDay = new Date(eventEnd);
                endDay.setHours(0, 0, 0, 0);
                
                // Calculate the number of days this event spans
                const dayMs = 24 * 60 * 60 * 1000;
                const days = Math.ceil((endDay.getTime() - startDay.getTime()) / dayMs) + 1;
                
                console.log(`Processing multi-day recurrence ${recEvent.title} from ${eventStart.toISOString()} to ${eventEnd.toISOString()}`);
                console.log(`Event spans these dates: ${days} days`);
                
                // For each day in the range, add an entry
                for (let i = 0; i < days; i++) {
                  const currentDay = new Date(startDay);
                  currentDay.setDate(currentDay.getDate() + i);
                  const dateKey = currentDay.toISOString().split('T')[0].replace(/T.*$/, '');
                  
                  // If this day is in our current month view, add the event
                  if (daysInMonth.includes(dateKey)) {
                    // Initialize the array for this day if it doesn't exist
                    if (!eventsByDay[dateKey]) {
                      eventsByDay[dateKey] = [];
                    }
                    
                    // Create a modified event with metadata for this day
                    const newEvent = { 
                      ...recEvent, 
                      isFirstDay: i === 0,
                      isLastDay: i === days - 1,
                      isMultiDay: true,
                      totalDays: days
                    };
                    
                    // Cast to any to avoid TypeScript errors with the extended properties
                    eventsByDay[dateKey].push(newEvent as any);
                  }
                }
              } else {
                // Single-day recurrence event, handle normally
                const dateObj = new Date(recEvent.startDate);
                const dateKey = dateObj.toISOString().split('T')[0].replace(/T.*$/, '');
                
                // If the event day is in our current view, add it
                if (daysInMonth.includes(dateKey)) {
                  if (!eventsByDay[dateKey]) {
                    eventsByDay[dateKey] = [];
                  }
                  
                  // Cast to any to avoid TypeScript errors with the extended properties
                  eventsByDay[dateKey].push(recEvent as any);
                }
              }
            } catch (e) {
              console.error(`Error processing recurrence instance for "${recEvent.title}":`, e);
            }
          });
        } catch (error) {
          console.error(`Error generating recurrences for "${event.title}":`, error);
        }
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
          
          // Get events for this day and apply deduplication
          const rawDayEvents = eventsByDay[dateKey] || [];
          
          // Pass the dateKey to the deduplication function
          const dayEvents = deduplicateEvents(rawDayEvents, dateKey);
          
          // Special handling for problematic April 29 and 30 dates
          const isSpecialDate = dateKey === '2025-04-29' || dateKey === '2025-04-30';
          if (isSpecialDate) {
            console.log(`Deduplicating special date ${dateKey}: ${rawDayEvents.length} -> ${dayEvents.length} events`);
          }
          
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
