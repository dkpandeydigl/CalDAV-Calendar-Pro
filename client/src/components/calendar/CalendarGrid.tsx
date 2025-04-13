import React from 'react';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { getCalendarDays, getWeekdayHeaders } from '@/lib/date-utils';
import CalendarDay from './CalendarDay';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
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
      // Prefer events with attendees or resources (more complete data)
      const aHasAttendees = !!a.attendees && (
        (typeof a.attendees === 'string' && a.attendees.length > 0) ||
        (Array.isArray(a.attendees) && a.attendees.length > 0)
      );
      const bHasAttendees = !!b.attendees && (
        (typeof b.attendees === 'string' && b.attendees.length > 0) ||
        (Array.isArray(b.attendees) && b.attendees.length > 0)
      );
      
      const aHasResources = !!a.resources && (
        (typeof a.resources === 'string' && a.resources.length > 0) ||
        (Array.isArray(a.resources) && a.resources.length > 0)
      );
      const bHasResources = !!b.resources && (
        (typeof b.resources === 'string' && b.resources.length > 0) ||
        (Array.isArray(b.resources) && b.resources.length > 0)
      );
      
      // Prefer events with attendees
      if (aHasAttendees && !bHasAttendees) return -1;
      if (!aHasAttendees && bHasAttendees) return 1;
      
      // Prefer events with resources
      if (aHasResources && !bHasResources) return -1;
      if (!aHasResources && bHasResources) return 1;
      
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
    
    // Special handling for all dates to prevent duplication after updates
    const eventsByUid = new Map<string, Event[]>();
    
    // Create a map of UIDs for all events to better handle duplicates
    sortedEvents.forEach(event => {
      if (!event.uid) return;
      
      if (!eventsByUid.has(event.uid)) {
        eventsByUid.set(event.uid, []);
      }
      eventsByUid.get(event.uid)!.push(event);
    });
    
    // For special dates, create a map of title -> events to handle exact title matches
    const eventsByTitle = new Map<string, Event[]>();
    
    // Special handling for April 29th and 30th dates which have duplication issues
    const isApril2930 = dateKey && (dateKey === '2025-04-29' || dateKey === '2025-04-30');
    
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
      Array.from(eventsByTitle.entries()).forEach(([title, events]) => {
        if (events.length > 1) {
          console.log(`Found ${events.length} events with title "${title}" on ${dateKey}`);
        }
      });
    }
    
    // Apply enhanced deduplication for all dates
    sortedEvents.forEach(event => {
      // Check if this event has a start date
      if (!event.startDate) return;
      
      // Create a unique key based on title, start time and calendar
      const startTime = new Date(event.startDate).getTime();
      
      // Determine if this is a resource-related event
      const isResourceEvent = 
        (event.title && event.title.toLowerCase().includes('res')) ||
        (event.resources && (
          (typeof event.resources === 'string' && event.resources.length > 0) ||
          (Array.isArray(event.resources) && event.resources.length > 0)
        ));
      
      // Generate a unique key for the event
      let key;
      
      // If the event has a UID and there are duplicates with the same UID,
      // use the UID as the primary deduplication key, especially for resource events
      if (event.uid && (isResourceEvent || (eventsByUid.get(event.uid) && eventsByUid.get(event.uid)!.length > 1))) {
        key = event.uid;
        if (isApril2930) {
          console.log(`Using UID as key for resource event: ${event.title}, UID=${event.uid}`);
        }
      }
      // For special dates, first try exact match by title for non-resource events
      else if (isApril2930 && event.title && eventsByTitle.get(event.title)?.length === 1) {
        // If there's only one event with this title, use the title as the key
        key = event.title;
      } 
      // For special dates with potential duplicates, use more aggressive deduplication
      else if (isApril2930) {
        // Use rounded time for more flexible matching
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
      } else {
        // Regular key includes calendar ID and exact time for normal dates
        key = `${event.title}-${startTime}-${event.calendarId}`;
      }
      
      // Only add this event if we haven't seen it before or if this one is better
      if (!seenEvents.has(key)) {
        seenEvents.set(key, event);
      } else {
        // For all dates, apply intelligent deduplication by keeping the best version
        const existingEvent = seenEvents.get(key)!;
        
        // Prefer events with resources or attendees (more complete data)
        const hasAttendees = !!event.attendees && (
          (typeof event.attendees === 'string' && event.attendees.length > 0) ||
          (Array.isArray(event.attendees) && event.attendees.length > 0)
        );
        const existingHasAttendees = !!existingEvent.attendees && (
          (typeof existingEvent.attendees === 'string' && existingEvent.attendees.length > 0) ||
          (Array.isArray(existingEvent.attendees) && existingEvent.attendees.length > 0)
        );
        
        const hasResources = !!event.resources && (
          (typeof event.resources === 'string' && event.resources.length > 0) ||
          (Array.isArray(event.resources) && event.resources.length > 0)
        );
        const existingHasResources = !!existingEvent.resources && (
          (typeof existingEvent.resources === 'string' && existingEvent.resources.length > 0) ||
          (Array.isArray(existingEvent.resources) && existingEvent.resources.length > 0)
        );
        
        // Replace if this event has resources/attendees but existing doesn't
        if ((hasResources && !existingHasResources) || (hasAttendees && !existingHasAttendees)) {
          seenEvents.set(key, event);
        }
        // Or if this event has a URL but existing doesn't
        else if (!existingEvent.url && event.url) {
          seenEvents.set(key, event);
        }
        // Note: The updatedAt property isn't in our schema, so we'll use lastSyncAttempt instead
        // This is a fallback for recency comparison
        else if (event.lastSyncAttempt && existingEvent.lastSyncAttempt && 
                 new Date(event.lastSyncAttempt) > new Date(existingEvent.lastSyncAttempt)) {
          seenEvents.set(key, event);
        }
        // Or if this event has a lower ID (usually means it was created first)
        else if (event.id < existingEvent.id && event.uid === existingEvent.uid) {
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
      
      // Special handling for all-day events
      let isMultiDayEvent = startDate.toISOString().split('T')[0] !== endDate.toISOString().split('T')[0];
      
      // For all-day events, always treat them as single-day events
      // This fixes issues with CalDAV format where end date is the next day
      // and also handles cases where end date is many days later but we only want to
      // show the event on its start date
      if (event.allDay === true) {
        console.log(`All-day event "${event.title}" detected - treating as single day event on ${startDate.toISOString().split('T')[0]}`);
        isMultiDayEvent = false;
      }
      
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
            if (typeof event.recurrenceRule === 'string') {
              // Attempt to parse as JSON first
              try {
                recurrenceObj = JSON.parse(event.recurrenceRule);
              } catch (jsonError) {
                // If it's not JSON, check if it's an iCalendar format (FREQ=DAILY;COUNT=3)
                if (event.recurrenceRule.includes('FREQ=')) {
                  try {
                    // This is an iCalendar RRULE, convert it to our format
                    const rrule = event.recurrenceRule;
                    console.log(`Processing iCalendar RRULE: ${rrule}`);
                    
                    // Initialize with default values
                    const recurrenceData: any = {
                      pattern: 'Daily', // Default to daily
                      interval: 1,
                      weekdays: [],
                      endType: 'After',
                      occurrences: 10 // Default to 10 occurrences
                    };
                    
                    // Extract frequency
                    const freqMatch = rrule.match(/FREQ=([^;]+)/);
                    if (freqMatch && freqMatch[1]) {
                      const freq = freqMatch[1];
                      if (freq === 'DAILY') recurrenceData.pattern = 'Daily';
                      else if (freq === 'WEEKLY') recurrenceData.pattern = 'Weekly';
                      else if (freq === 'MONTHLY') recurrenceData.pattern = 'Monthly';
                      else if (freq === 'YEARLY') recurrenceData.pattern = 'Yearly';
                      console.log(`Extracted FREQ=${freq}, setting pattern to ${recurrenceData.pattern}`);
                    }
                    
                    // Extract interval
                    const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
                    if (intervalMatch && intervalMatch[1]) {
                      recurrenceData.interval = parseInt(intervalMatch[1], 10) || 1;
                      console.log(`Extracted INTERVAL=${recurrenceData.interval}`);
                    }
                    
                    // Extract count
                    const countMatch = rrule.match(/COUNT=(\d+)/);
                    if (countMatch && countMatch[1]) {
                      recurrenceData.occurrences = parseInt(countMatch[1], 10) || 10;
                      recurrenceData.endType = 'After';
                      console.log(`Extracted COUNT=${recurrenceData.occurrences}, setting endType to ${recurrenceData.endType}`);
                    }
                    
                    // Extract until
                    const untilMatch = rrule.match(/UNTIL=([^;]+)/);
                    if (untilMatch && untilMatch[1]) {
                      // Parse iCalendar date format like 20250428T235959Z
                      const untilStr = untilMatch[1];
                      let untilDate;
                      
                      if (untilStr.includes('T')) {
                        // Date with time
                        const year = parseInt(untilStr.substring(0, 4), 10);
                        const month = parseInt(untilStr.substring(4, 6), 10) - 1; // Month is 0-indexed
                        const day = parseInt(untilStr.substring(6, 8), 10);
                        const hour = parseInt(untilStr.substring(9, 11), 10);
                        const minute = parseInt(untilStr.substring(11, 13), 10);
                        const second = parseInt(untilStr.substring(13, 15), 10);
                        
                        untilDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                      } else {
                        // Date only
                        const year = parseInt(untilStr.substring(0, 4), 10);
                        const month = parseInt(untilStr.substring(4, 6), 10) - 1;
                        const day = parseInt(untilStr.substring(6, 8), 10);
                        
                        untilDate = new Date(Date.UTC(year, month, day));
                      }
                      
                      recurrenceData.untilDate = untilDate.toISOString();
                      recurrenceData.endType = 'Until';
                      console.log(`Extracted UNTIL=${untilStr}, parsed to ${recurrenceData.untilDate}, setting endType to ${recurrenceData.endType}`);
                    }
                    
                    // Extract BYDAY for weekly recurrences
                    if (recurrenceData.pattern === 'Weekly') {
                      const bydayMatch = rrule.match(/BYDAY=([^;]+)/);
                      if (bydayMatch && bydayMatch[1]) {
                        const days = bydayMatch[1].split(',');
                        const dayMap: Record<string, string> = {
                          'SU': 'Sunday',
                          'MO': 'Monday',
                          'TU': 'Tuesday',
                          'WE': 'Wednesday',
                          'TH': 'Thursday',
                          'FR': 'Friday',
                          'SA': 'Saturday'
                        };
                        
                        recurrenceData.weekdays = days.map(day => dayMap[day] || day);
                        console.log(`Extracted BYDAY=${bydayMatch[1]}, mapped to weekdays:`, recurrenceData.weekdays);
                      }
                    }
                    
                    // Store the original RRULE for reference
                    recurrenceData.originalRrule = rrule;
                    
                    // Assign to recurrenceObj
                    recurrenceObj = recurrenceData;
                    
                    console.log(`Successfully parsed iCalendar RRULE to:`, recurrenceObj);
                  } catch (error) {
                    console.error(`Error parsing iCalendar RRULE:`, error);
                    // Create a fallback simple recurrence object that uses just the FREQ and COUNT
                    try {
                      console.log(`Attempting fallback RRULE parsing for: ${event.recurrenceRule}`);
                      const simplifiedObj: any = {
                        pattern: 'Daily',
                        interval: 1,
                        endType: 'After',
                        occurrences: 3,
                        weekdays: []
                      };
                      
                      if (event.recurrenceRule.includes('FREQ=DAILY')) {
                        simplifiedObj.pattern = 'Daily';
                      } else if (event.recurrenceRule.includes('FREQ=WEEKLY')) {
                        simplifiedObj.pattern = 'Weekly';
                      } else if (event.recurrenceRule.includes('FREQ=MONTHLY')) {
                        simplifiedObj.pattern = 'Monthly';
                      } else if (event.recurrenceRule.includes('FREQ=YEARLY')) {
                        simplifiedObj.pattern = 'Yearly';
                      }
                      
                      const countMatch = event.recurrenceRule.match(/COUNT=(\d+)/);
                      if (countMatch && countMatch[1]) {
                        simplifiedObj.occurrences = parseInt(countMatch[1], 10);
                      }
                      
                      recurrenceObj = simplifiedObj;
                      console.log(`Applied fallback RRULE parsing:`, recurrenceObj);
                    } catch (fallbackError) {
                      console.error(`Fallback RRULE parsing also failed:`, fallbackError);
                      throw error; // Re-throw the original error
                    }
                  }
                } else {
                  // Not recognized format, log error and skip
                  console.error(`Unrecognized recurrence rule format: ${event.recurrenceRule}`);
                  return;
                }
              }
            } else {
              // Object is already a recurrence object
              recurrenceObj = event.recurrenceRule;
            }
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
            // We already processed this as an object in the previous try-catch block
            // No need to process it again, but we should double-check a few things
            
            // Check if recurrenceObj was properly set - if not, we missed something
            if (!recurrenceObj) {
              console.error(`Failed to parse recurrence rule string properly: ${event.recurrenceRule}`);
              return; // Skip this event
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
          
          // Storage for the current date we're working with
          let currentDate = new Date(startRecurDate);

          // IMPORTANT: Always include the original start date as the first occurrence,
          // regardless of whether it matches the recurrence pattern or not
          
          // For reporting purposes, determine if the original start date matches the recurrence pattern
          let startDateMatchesPattern = true;
          
          // For weekly recurrence with specific weekdays, check if the start date matches any selected weekday
          if (pattern === 'Weekly' && weekdays && weekdays.length > 0) {
            const dayMap = {
              'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
              'Thursday': 4, 'Friday': 5, 'Saturday': 6
            };
            
            // Get the numerical values for the selected weekdays
            const selectedDays = weekdays.map((day: string) => dayMap[day as keyof typeof dayMap]);
            
            // Check if the start date's day matches any of the selected weekdays
            const startDateDay = startRecurDate.getDay();
            startDateMatchesPattern = selectedDays.includes(startDateDay);
            
            console.log(`[RECURRENCE] Start date is ${startRecurDate.toDateString()} (day ${startDateDay})`);
            console.log(`[RECURRENCE] Selected weekdays: ${weekdays.join(', ')} (days ${selectedDays.join(', ')})`);
            console.log(`[RECURRENCE] Start date matches pattern: ${startDateMatchesPattern}`);
          }
          
          // Always include the start date as the first occurrence, regardless of pattern
          console.log('[RECURRENCE] Including start date in occurrences count as first occurrence');
          recurrenceDates.push(new Date(startRecurDate));
          
          // Calculate the duration of the event for adding to future occurrences
          const eventDurationMs = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
          
          // No need to reset currentDate here as we already initialized it and updated it if needed
          
          // Calculate the current count based on what's already in recurrenceDates
          let count = recurrenceDates.length;
          
          // Log the current count for debugging
          console.log(`[RECURRENCE] Initial recurrence count: ${count} dates`);
          if (count > 0) {
            console.log(`[RECURRENCE] First date is: ${recurrenceDates[0].toDateString()}`);
          }
          
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
                  
                  // Start from the current date and find the next occurrence
                  let found = false;
                  let testDate = new Date(currentDate);
                  
                  // Add 1 day to start looking for the next date (avoid repeating the current date)
                  testDate.setDate(testDate.getDate() + 1);
                  
                  // Look for a matching day within the next 2 weeks (to be safe)
                  for (let i = 0; i < 14 && !found; i++) {
                    // Check if this day matches one of our selected weekdays
                    if (selectedDays.includes(testDate.getDay())) {
                      // Check if this date maintains the interval pattern
                      // For weekly recurrences, the day of the week matters, but also ensure
                      // we're not picking dates too close to the current date
                      const weekDiff = Math.floor((testDate.getTime() - currentDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
                      
                      if (weekDiff >= interval) {
                        // Found a matching day that also maintains the interval
                        nextDate = new Date(testDate);
                        found = true;
                        console.log(`[RECURRENCE] Found next occurrence on ${nextDate.toDateString()} (day ${nextDate.getDay()})`);
                      }
                    }
                    
                    // Try the next day
                    testDate.setDate(testDate.getDate() + 1);
                  }
                  
                  // Fallback if no day was found (shouldn't happen with a valid pattern)
                  if (!found) {
                    console.log('[RECURRENCE] Failed to find next weekday match, using simple week interval');
                    nextDate = new Date(currentDate);
                    nextDate.setDate(nextDate.getDate() + (7 * interval));
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
          // First, log the total recurrence dates for debugging
          console.log(`[RECURRENCE] Total recurrence dates: ${recurrenceDates.length}`);
          
          // Process each recurrence date
          recurrenceDates.forEach((date, index) => {
            // Skip processing the original event date if it's already processed
            // This is only true for the first entry in the array which should be the start date
            if (index === 0 && date.toDateString() === new Date(startRecurDate).toDateString()) {
              console.log(`[RECURRENCE] Skipping first occurrence as it matches the original event`);
              return;
            }
            
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
    <div className="relative">
      {/* Sync Overlay - Only visible during sync operations */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-lg shadow-md border border-primary/20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <h3 className="text-lg font-medium mb-1">Syncing Calendar</h3>
              <p className="text-sm text-muted-foreground">
                Please wait while we update your events...
              </p>
            </div>
          </div>
        </div>
      )}
      
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
    </div>
  );
};

export default CalendarGrid;
