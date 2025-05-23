import { format, isSameDay, isSameMonth, isToday, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns';

// Format date as "September 2023"
export const formatMonthYear = (date: Date): string => {
  return format(date, 'MMMM yyyy');
};

// Format date as "September 4, 2023"
export const formatFullDate = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, 'MMMM d, yyyy');
};

// Format time as "9:00 AM"
export const formatTime = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, 'h:mm a');
};

// Format date and time as "Monday, September 4, 2023" with timezone support
export const formatDayOfWeekDate = (date: Date | string, timezone?: string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  
  if (timezone) {
    try {
      // Use Intl.DateTimeFormat to format the date in the specified timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      return formatter.format(dateObj);
    } catch (error) {
      console.error(`Error formatting date with timezone ${timezone}:`, error);
      // Fall back to default formatting if there's an error
    }
  }
  
  // Default format without timezone or if there was an error
  return format(dateObj, 'EEEE, MMMM d, yyyy');
};

// Format date and time range for event display with timezone support
export const formatEventTimeRange = (
  start: Date | string, 
  end: Date | string, 
  allDay: boolean = false,
  timezone?: string
): string => {
  const startDate = typeof start === 'string' ? parseISO(start) : start;
  const endDate = typeof end === 'string' ? parseISO(end) : end;

  if (allDay) {
    return 'All Day';
  }
  
  // Format time with timezone support
  const formatTimeWithTZ = (date: Date): string => {
    if (timezone) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          minute: 'numeric',
          hour12: true
        });
        return formatter.format(date);
      } catch (error) {
        console.error(`Error formatting time with timezone ${timezone}:`, error);
      }
    }
    // Default format without timezone or if there was an error
    return formatTime(date);
  };
  
  // Format full date with timezone support
  const formatFullDateWithTZ = (date: Date): string => {
    if (timezone) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        return formatter.format(date);
      } catch (error) {
        console.error(`Error formatting date with timezone ${timezone}:`, error);
      }
    }
    // Default format without timezone or if there was an error
    return formatFullDate(date);
  };
  
  // Check if same day in the specified timezone
  const isSameDayInTZ = (date1: Date, date2: Date): boolean => {
    if (timezone) {
      try {
        const options: Intl.DateTimeFormatOptions = { 
          timeZone: timezone,
          day: 'numeric' as const,
          month: 'numeric' as const,
          year: 'numeric' as const
        };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        return formatter.format(date1) === formatter.format(date2);
      } catch (error) {
        console.error(`Error checking same day in timezone ${timezone}:`, error);
      }
    }
    // Default check without timezone or if there was an error
    return isSameDay(startDate, endDate);
  };
  
  // Same day event
  if (isSameDayInTZ(startDate, endDate)) {
    return `${formatTimeWithTZ(startDate)} - ${formatTimeWithTZ(endDate)}`;
  }
  
  // Multi-day event
  return `${formatFullDateWithTZ(startDate)} ${formatTimeWithTZ(startDate)} - ${formatFullDateWithTZ(endDate)} ${formatTimeWithTZ(endDate)}`;
};

// Get week day headers for calendar grid
export const getWeekdayHeaders = (): string[] => {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
};

// Generate days for calendar month grid
export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export const getCalendarDays = (currentDate: Date): CalendarDay[] => {
  const daysInMonth = [];
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
  // Start from the first day of the week that contains the first day of the month
  const startDate = startOfWeek(firstDayOfMonth);
  // End on the last day of the week that contains the last day of the month
  const endDate = endOfWeek(lastDayOfMonth);
  
  // Generate all days to display in the grid
  let currentDay = startDate;
  while (currentDay <= endDate) {
    daysInMonth.push({
      date: new Date(currentDay),
      isCurrentMonth: isSameMonth(currentDay, currentDate),
      isToday: isToday(currentDay)
    });
    currentDay = addDays(currentDay, 1);
  }
  
  return daysInMonth;
};

// Available timezones
export const getTimezones = (): { label: string, value: string }[] => {
  return [
    { label: "UTC (Coordinated Universal Time)", value: "UTC" },
    
    // Asia
    { label: "Asia/Kolkata (IST, +05:30)", value: "Asia/Kolkata" },
    { label: "Asia/Tokyo (JST, +09:00)", value: "Asia/Tokyo" },
    { label: "Asia/Shanghai (CST, +08:00)", value: "Asia/Shanghai" },
    { label: "Asia/Singapore (SGT, +08:00)", value: "Asia/Singapore" },
    { label: "Asia/Seoul (KST, +09:00)", value: "Asia/Seoul" },
    { label: "Asia/Jakarta (WIB, +07:00)", value: "Asia/Jakarta" },
    { label: "Asia/Manila (PST, +08:00)", value: "Asia/Manila" },
    { label: "Asia/Bangkok (ICT, +07:00)", value: "Asia/Bangkok" },
    { label: "Asia/Dubai (GST, +04:00)", value: "Asia/Dubai" },
    { label: "Asia/Hong_Kong (HKT, +08:00)", value: "Asia/Hong_Kong" },
    { label: "Asia/Karachi (PKT, +05:00)", value: "Asia/Karachi" },
    { label: "Asia/Dhaka (BST, +06:00)", value: "Asia/Dhaka" },
    
    // Americas
    { label: "America/New_York (EDT, -04:00)", value: "America/New_York" },
    { label: "America/Los_Angeles (PDT, -07:00)", value: "America/Los_Angeles" },
    { label: "America/Chicago (CDT, -05:00)", value: "America/Chicago" },
    { label: "America/Toronto (EDT, -04:00)", value: "America/Toronto" },
    { label: "America/Mexico_City (CST, -05:00)", value: "America/Mexico_City" },
    { label: "America/Sao_Paulo (BRT, -03:00)", value: "America/Sao_Paulo" },
    
    // Europe
    { label: "Europe/London (BST, +01:00)", value: "Europe/London" },
    { label: "Europe/Paris (CEST, +02:00)", value: "Europe/Paris" },
    { label: "Europe/Berlin (CEST, +02:00)", value: "Europe/Berlin" },
    { label: "Europe/Moscow (MSK, +03:00)", value: "Europe/Moscow" },
    
    // Oceania
    { label: "Australia/Sydney (AEST, +10:00)", value: "Australia/Sydney" },
    { label: "Pacific/Auckland (NZST, +12:00)", value: "Pacific/Auckland" }
  ];
};
