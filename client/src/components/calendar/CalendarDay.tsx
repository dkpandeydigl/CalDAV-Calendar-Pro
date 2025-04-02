import React from 'react';
import { format } from 'date-fns';
import CalendarEvent from './CalendarEvent';
import type { CalendarDay as CalendarDayType } from '@/lib/date-utils';
import type { Event } from '@shared/schema';

interface CalendarDayProps {
  day: CalendarDayType;
  events: Event[];
  onEventClick: (event: Event) => void;
  onDayDoubleClick?: () => void;
}

const CalendarDay: React.FC<CalendarDayProps> = ({ day, events, onEventClick, onDayDoubleClick }) => {
  const { date, isCurrentMonth, isToday } = day;
  
  return (
    <div 
      className={`p-1 border border-neutral-200 min-h-[100px] cursor-pointer ${
        isToday ? 'bg-blue-50' : ''
      }`}
      onDoubleClick={onDayDoubleClick}
    >
      <div className="text-right p-1">
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
