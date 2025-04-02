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
  
  // Get calendar metadata, either from rawData or find the calendar
  const calendarMetadata = event.rawData as any;
  const calendarColor = calendarMetadata?.calendarColor;
  
  // If no metadata was found in rawData, find it from calendars
  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  // Format event time
  const startTime = formatTime(new Date(event.startDate));
  const eventDisplay = event.allDay ? event.title : `${startTime} - ${event.title}`;
  
  // Determine border color based on calendar
  const borderColor = calendarColor || calendar?.color || '#0078d4';
  
  // Determine if we need to show sync status indicators
  const needsSyncing = event.syncStatus && event.syncStatus !== 'synced';
  const syncFailed = event.syncStatus === 'sync_failed';
  
  return (
    <div
      className={`text-xs bg-white p-1 mb-1 rounded shadow-sm truncate cursor-pointer hover:bg-neutral-50 ${
        needsSyncing ? 'border border-yellow-300' : ''
      } ${
        syncFailed ? 'border border-red-300' : ''
      }`}
      style={{ borderLeft: `3px solid ${borderColor}` }}
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
