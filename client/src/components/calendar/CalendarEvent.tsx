import React from 'react';
import { formatTime } from '@/lib/date-utils';
import type { Event } from '@shared/schema';
import { useCalendars } from '@/hooks/useCalendars';
import { format } from 'date-fns';

interface CalendarEventProps {
  event: Event;
  onClick: () => void;
}

const CalendarEvent: React.FC<CalendarEventProps> = ({ event, onClick }) => {
  const { calendars } = useCalendars();
  
  // Get calendar metadata, either from rawData or find the calendar
  const calendarMetadata = event.rawData as any;
  const calendarColor = calendarMetadata?.calendarColor;
  
  // If no metadata was found in rawData, find it from calendars
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Check if this is a multi-day event (from the metadata we added)
  const isMultiDay = calendarMetadata?.isMultiDay;
  const isFirstDay = calendarMetadata?.isFirstDay;
  const isLastDay = calendarMetadata?.isLastDay;
  const totalDays = calendarMetadata?.totalDays || 1;
  
  // Format event time
  // Use our utility function which already handles timezone conversion correctly
  const eventTimezone = event.timezone || undefined;
  const rawStartDate = new Date(event.startDate);
  const startTime = formatTime(rawStartDate, eventTimezone);
  
  // Determine what to display based on multi-day status
  let eventDisplay;
  if (isMultiDay) {
    if (isFirstDay) {
      eventDisplay = event.allDay ? `${event.title} (Day 1 of ${totalDays})` : `${startTime} - ${event.title} (Start)`;
    } else if (isLastDay) {
      eventDisplay = `${event.title} (End)`;
    } else {
      eventDisplay = `${event.title} (Continued)`;
    }
  } else {
    eventDisplay = event.allDay ? event.title : `${startTime} - ${event.title}`;
  }
  
  // Determine background and border styling based on multi-day status
  let bgColor = 'bg-white';
  // Initialize with any so TypeScript accepts custom CSS properties
  let borderStyle: any = { borderLeft: `3px solid ${calendarColor || calendar?.color || '#0078d4'}` };
  let additionalClasses = '';
  
  if (isMultiDay) {
    // Multi-day events have a distinct style
    bgColor = 'bg-primary/10';
    additionalClasses = 'border border-primary/30';
    
    // Different styles for first/middle/last day
    if (isFirstDay) {
      // For the first day of a multi-day event
      borderStyle = { 
        borderLeft: `3px solid ${calendarColor || calendar?.color || '#0078d4'}`,
        borderTop: '1px solid rgba(0,120,212,0.5)',
        borderBottom: '1px solid rgba(0,120,212,0.5)'
      };
    } else if (isLastDay) {
      // For the last day of a multi-day event
      borderStyle = { 
        borderRight: `3px solid ${calendarColor || calendar?.color || '#0078d4'}`,
        borderTop: '1px solid rgba(0,120,212,0.5)',
        borderBottom: '1px solid rgba(0,120,212,0.5)'
      };
    } else {
      // For middle days of a multi-day event
      borderStyle = {
        borderTop: '1px solid rgba(0,120,212,0.5)',
        borderBottom: '1px solid rgba(0,120,212,0.5)'
      };
    }
  }
  
  // Determine if we need to show sync status indicators
  const needsSyncing = event.syncStatus && event.syncStatus !== 'synced';
  const syncFailed = event.syncStatus === 'sync_failed';
  
  return (
    <div
      className={`text-xs ${bgColor} p-1 mb-1 rounded shadow-sm truncate cursor-pointer hover:bg-primary/20 ${additionalClasses} ${
        needsSyncing ? 'border border-yellow-300' : ''
      } ${
        syncFailed ? 'border border-red-300' : ''
      }`}
      style={borderStyle}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div className={`flex-1 ${needsSyncing ? 'relative' : ''}`}>
          {calendarMetadata?.calendarName ? (
            <div className="flex flex-col">
              <span>{eventDisplay}</span>
              <span className="text-xs text-gray-500">{calendarMetadata.calendarName}</span>
            </div>
          ) : (
            eventDisplay
          )}
          
          {/* Show a subtle dot indicator for sync status */}
          {needsSyncing && (
            <span 
              className={`absolute top-0 right-0 w-2 h-2 rounded-full ${
                syncFailed ? 'bg-red-500' : 'bg-yellow-500'
              }`}
              title={syncFailed ? 'Failed to sync' : 'Not yet synced'}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarEvent;
