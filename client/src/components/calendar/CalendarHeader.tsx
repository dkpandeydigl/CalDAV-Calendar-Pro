import React from 'react';
import { Button } from '@/components/ui/button';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { formatMonthYear } from '@/lib/date-utils';

interface CalendarHeaderProps {
  onToggleSidebar: () => void;
  onCreateEvent: () => void;
  showSidebarToggle?: boolean;
}

const CalendarHeader: React.FC<CalendarHeaderProps> = ({ 
  onToggleSidebar, 
  onCreateEvent,
  showSidebarToggle = true
}) => {
  const { 
    currentDate, 
    viewType, 
    setViewType, 
    goToNextPeriod, 
    goToPreviousPeriod, 
    goToToday,
    serverStatus
  } = useCalendarContext();

  return (
    <header className="bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center">
          {showSidebarToggle && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onToggleSidebar}
              className="lg:hidden"
            >
              <span className="material-icons">menu</span>
              <span className="sr-only">Toggle sidebar</span>
            </Button>
          )}
          <h1 className="ml-2 text-xl font-semibold text-neutral-900">CalDAV Calendar</h1>
        </div>
        <div className="flex items-center">
          <div className="mr-4 relative">
            <span className="flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${serverStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${serverStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            </span>
            <span className={`ml-1 text-sm ${serverStatus === 'connected' ? 'text-emerald-500' : 'text-red-500'} hidden md:inline`}>
              {serverStatus === 'connected' ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="relative">
            <Button variant="ghost" size="sm" className="flex items-center">
              <span className="material-icons">account_circle</span>
              <span className="ml-1 text-sm font-medium hidden md:inline">John Doe</span>
            </Button>
          </div>
        </div>
      </div>
      <div className="border-b border-neutral-200"></div>
      
      {/* Calendar Controls */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2">
        <div className="flex items-center mb-2 md:mb-0">
          <Button variant="ghost" size="icon" onClick={goToPreviousPeriod}>
            <span className="material-icons">chevron_left</span>
            <span className="sr-only">Previous</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={goToToday}>
            <span className="material-icons">today</span>
            <span className="sr-only">Today</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextPeriod}>
            <span className="material-icons">chevron_right</span>
            <span className="sr-only">Next</span>
          </Button>
          <h2 className="ml-2 text-lg font-semibold">{formatMonthYear(currentDate)}</h2>
        </div>
        <div className="flex items-center">
          <Button 
            variant={viewType === 'month' ? 'default' : 'outline'} 
            size="sm"
            className="rounded-l-md rounded-r-none"
            onClick={() => setViewType('month')}
          >
            Month
          </Button>
          <Button 
            variant={viewType === 'week' ? 'default' : 'outline'} 
            size="sm"
            className="rounded-none border-x-0"
            onClick={() => setViewType('week')}
          >
            Week
          </Button>
          <Button 
            variant={viewType === 'day' ? 'default' : 'outline'} 
            size="sm"
            className="rounded-r-md rounded-l-none"
            onClick={() => setViewType('day')}
          >
            Day
          </Button>
        </div>
      </div>
    </header>
  );
};

export default CalendarHeader;
