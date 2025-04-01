import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays, subDays } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

type CalendarViewType = 'month' | 'week' | 'day';

interface CalendarContextType {
  currentDate: Date;
  viewType: CalendarViewType;
  setViewType: (viewType: CalendarViewType) => void;
  goToNextPeriod: () => void;
  goToPreviousPeriod: () => void;
  goToToday: () => void;
  selectedTimezone: string;
  setSelectedTimezone: (timezone: string) => void;
  isLoading: boolean;
  error: Error | null;
  viewStartDate: Date;
  viewEndDate: Date;
  setServerStatus: (status: 'connected' | 'disconnected') => void;
  serverStatus: 'connected' | 'disconnected';
}

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

export const useCalendarContext = () => {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendarContext must be used within a CalendarProvider');
  }
  return context;
};

interface CalendarProviderProps {
  children: ReactNode;
}

export const CalendarProvider = ({ children }: CalendarProviderProps) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<CalendarViewType>('month');
  const [selectedTimezone, setSelectedTimezone] = useState('America/New_York');
  const [serverStatus, setServerStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const { toast } = useToast();

  // Calculate view range based on view type and current date
  const getViewDates = () => {
    let start, end;
    
    switch (viewType) {
      case 'month':
        start = startOfMonth(currentDate);
        end = endOfMonth(currentDate);
        break;
      case 'week':
        start = startOfWeek(currentDate, { weekStartsOn: 0 });
        end = endOfWeek(currentDate, { weekStartsOn: 0 });
        break;
      case 'day':
        start = currentDate;
        end = currentDate;
        break;
      default:
        start = startOfMonth(currentDate);
        end = endOfMonth(currentDate);
    }
    
    return { start, end };
  };
  
  const { start: viewStartDate, end: viewEndDate } = getViewDates();

  // Navigation functions
  const goToNextPeriod = () => {
    switch (viewType) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(addDays(currentDate, 1));
        break;
    }
  };

  const goToPreviousPeriod = () => {
    switch (viewType) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(subDays(currentDate, 1));
        break;
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Check server connection status
  const { isLoading, error } = useQuery({
    queryKey: ['/api/server-connection'],
    onSuccess: (data) => {
      if (data && data.status === 'connected') {
        setServerStatus('connected');
      } else {
        setServerStatus('disconnected');
      }
    },
    onError: () => {
      setServerStatus('disconnected');
      toast({
        title: "Server Connection Error",
        description: "Unable to connect to the CalDAV server",
        variant: "destructive"
      });
    },
  });

  const value = {
    currentDate,
    viewType,
    setViewType,
    goToNextPeriod,
    goToPreviousPeriod,
    goToToday,
    selectedTimezone,
    setSelectedTimezone,
    isLoading,
    error,
    viewStartDate,
    viewEndDate,
    setServerStatus,
    serverStatus
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
};
