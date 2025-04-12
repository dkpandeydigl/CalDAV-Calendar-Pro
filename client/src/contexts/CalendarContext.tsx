import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays, subDays } from 'date-fns';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, getQueryFn } from '@/lib/queryClient';

type CalendarViewType = 'year' | 'month' | 'week' | 'day';

interface CalendarContextType {
  currentDate: Date;
  viewType: CalendarViewType;
  setViewType: (viewType: CalendarViewType) => void;
  goToNextPeriod: () => void;
  goToPreviousPeriod: () => void;
  goToToday: () => void;
  selectedTimezone: string;
  setSelectedTimezone: (timezone: string) => void;
  saveTimezonePreference: (timezone: string) => Promise<void>;
  isSavingTimezone: boolean;
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
  
  // Fetch user profile to get their preferred timezone
  const userQuery = useQuery({
    queryKey: ['/api/user'],
    queryFn: () => {
      return fetch('/api/user')
        .then(res => {
          if (res.status === 401) return null;
          if (!res.ok) throw new Error('Failed to fetch user data');
          return res.json();
        })
        .catch(err => {
          console.error('Error fetching user data:', err);
          return null;
        });
    }
  });
  const userData = userQuery.data;
  
  // Set timezone when user data is loaded
  useEffect(() => {
    if (userData && typeof userData === 'object' && 'preferredTimezone' in userData) {
      setSelectedTimezone(userData.preferredTimezone);
    }
  }, [userData]);
  
  // Mutation for saving timezone preference
  const { mutateAsync: saveTimezoneAsync, isPending: isSavingTimezone } = useMutation({
    mutationFn: async (timezone: string) => {
      const response = await apiRequest('PUT', '/api/user/timezone', { timezone });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Timezone saved',
        description: 'Your timezone preference has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving timezone',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Calculate view range based on view type and current date
  const getViewDates = () => {
    let start, end;
    
    switch (viewType) {
      case 'year':
        // For year view, show the entire year
        start = new Date(currentDate.getFullYear(), 0, 1);
        end = new Date(currentDate.getFullYear(), 11, 31);
        break;
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
      case 'year':
        // Add one year
        const nextYear = new Date(currentDate);
        nextYear.setFullYear(currentDate.getFullYear() + 1);
        setCurrentDate(nextYear);
        break;
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
      case 'year':
        // Subtract one year
        const prevYear = new Date(currentDate);
        prevYear.setFullYear(currentDate.getFullYear() - 1);
        setCurrentDate(prevYear);
        break;
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
    select: (data: any) => data,
    enabled: false, // We'll handle this with the effect in Calendar component
  });

  // Function to save timezone preference
  const saveTimezonePreference = async (timezone: string) => {
    try {
      // Update UI state immediately for responsive feel
      setSelectedTimezone(timezone);
      
      // Then save to server - if this fails, we already updated the UI
      const result = await saveTimezoneAsync(timezone);
      
      // Log success for debugging
      console.log('Timezone preference saved successfully:', timezone);
      
      return result;
    } catch (error) {
      console.error('Error saving timezone preference:', error);
      throw error; // Re-throw to allow calling code to handle it
    }
  };

  const value = {
    currentDate,
    viewType,
    setViewType,
    goToNextPeriod,
    goToPreviousPeriod,
    goToToday,
    selectedTimezone,
    setSelectedTimezone,
    saveTimezonePreference,
    isSavingTimezone,
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
