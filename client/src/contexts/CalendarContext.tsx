import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays, subDays } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  convertToUserTimezone: (date: Date) => Date;
  convertFromUserTimezone: (date: Date) => Date;
  refreshCalendarData: () => void;
  timezoneLabel: string;
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
  const queryClient = useQueryClient();
  
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
      console.log(`Setting timezone from user data: ${userData.preferredTimezone}`);
      setSelectedTimezone(userData.preferredTimezone);
    }
  }, [userData]);
  
  // Create a readable timezone label for display
  const timezoneLabel = useMemo(() => {
    try {
      // Get the current time in the user's timezone
      const now = new Date();
      const offsetMinutes = now.getTimezoneOffset();
      
      // Format the timezone offset in hours
      const offsetHours = Math.abs(offsetMinutes) / 60;
      const sign = offsetMinutes <= 0 ? "+" : "-";
      
      const formattedOffset = `UTC${sign}${Math.floor(offsetHours)}:${offsetMinutes % 60 === 0 ? '00' : String(Math.abs(offsetMinutes % 60)).padStart(2, '0')}`;
      
      // Try to get a more friendly name if possible
      let friendlyName = selectedTimezone;
      if (selectedTimezone.includes('/')) {
        friendlyName = selectedTimezone.split('/').pop()?.replace(/_/g, ' ') || selectedTimezone;
      }
      
      return `${friendlyName} (${formattedOffset})`;
    } catch (error) {
      console.error('Error creating timezone label:', error);
      return selectedTimezone;
    }
  }, [selectedTimezone]);
  
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

  // Function to refresh all calendar-related data
  const refreshCalendarData = useCallback(() => {
    console.log('Refreshing calendar data after timezone change');
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
    queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
  }, [queryClient]);

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

  // Function to convert a date from UTC to the user's timezone
  const convertToUserTimezone = useCallback((date: Date): Date => {
    if (!date) return date;
    
    try {
      // Create a new date to avoid modifying the original
      const dateObj = new Date(date);
      
      // For all-day events, don't apply timezone conversion
      // We can detect all-day events by checking if the time is exactly 00:00:00
      const isAllDayEvent = 
        dateObj.getUTCHours() === 0 && 
        dateObj.getUTCMinutes() === 0 && 
        dateObj.getUTCSeconds() === 0;
      
      if (isAllDayEvent) {
        return dateObj;
      }
      
      // Apply timezone offset using the Intl.DateTimeFormat API
      // First get the parts in the target timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: selectedTimezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      });
      
      const parts = formatter.formatToParts(dateObj);
      
      // Extract the parts into an object
      const dateParts: Record<string, number> = {};
      parts.forEach(part => {
        if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) {
          dateParts[part.type] = parseInt(part.value, 10);
        }
      });
      
      // Create a new date object with the timezone-adjusted values
      // Note: months are 0-based in JavaScript Date
      return new Date(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        dateParts.hour,
        dateParts.minute,
        dateParts.second
      );
    } catch (error) {
      console.error('Error converting to user timezone:', error);
      return date; // Return original date if conversion fails
    }
  }, [selectedTimezone]);

  // Function to convert a date from the user's timezone to UTC
  const convertFromUserTimezone = useCallback((date: Date): Date => {
    if (!date) return date;
    
    try {
      // Create a new date to avoid modifying the original
      const dateObj = new Date(date);
      
      // For all-day events, don't apply timezone conversion
      // We can detect all-day events by checking if the time is exactly 00:00:00
      const isAllDayEvent = 
        dateObj.getHours() === 0 && 
        dateObj.getMinutes() === 0 && 
        dateObj.getSeconds() === 0;
      
      if (isAllDayEvent) {
        return dateObj;
      }
      
      // Create a formatter for UTC 
      const utcFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      });
      
      // Create a formatter for the user's timezone
      const tzFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: selectedTimezone, 
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      });
      
      // Format the date in UTC and the user's timezone
      const utcString = utcFormatter.format(dateObj);
      const tzString = tzFormatter.format(dateObj);
      
      // If they're different, we need to convert
      if (utcString !== tzString) {
        // Get the UTC year, month, day from the date
        const utcYear = dateObj.getUTCFullYear();
        const utcMonth = dateObj.getUTCMonth();
        const utcDay = dateObj.getUTCDate();
        const utcHours = dateObj.getUTCHours();
        const utcMinutes = dateObj.getUTCMinutes();
        const utcSeconds = dateObj.getUTCSeconds();
        
        // Create a new date with the UTC components using the UTC methods
        return new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHours, utcMinutes, utcSeconds));
      }
      
      return dateObj;
    } catch (error) {
      console.error('Error converting from user timezone:', error);
      return date; // Return original date if conversion fails
    }
  }, [selectedTimezone]);

  // Function to save timezone preference
  const saveTimezonePreference = async (timezone: string) => {
    try {
      // Update UI state immediately for responsive feel
      setSelectedTimezone(timezone);
      
      // Then save to server - if this fails, we already updated the UI
      const result = await saveTimezoneAsync(timezone);
      
      // Refresh calendar data after timezone change
      refreshCalendarData();
      
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
    serverStatus,
    convertToUserTimezone,
    convertFromUserTimezone,
    refreshCalendarData,
    timezoneLabel
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
};
