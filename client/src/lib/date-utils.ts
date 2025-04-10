import { format, isSameDay, isSameMonth, isToday, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

// Format date as "September 2023"
export const formatMonthYear = (date: Date): string => {
  return format(date, 'MMMM yyyy');
};

// Access user timezone preference through a global variable that we'll set
// This can be updated by components that have access to the user's preference
let userTimezonePreference: string | null = null;

export const setUserTimezonePreference = (timezone: string): void => {
  userTimezonePreference = timezone;
};

// Get user's timezone preference
const getUserTimezone = (): string => {
  // First priority: Use the explicitly set user preference if available
  if (userTimezonePreference) {
    return userTimezonePreference;
  }
  
  // Fallback: Use browser timezone
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {
    return 'UTC'; // Ultimate fallback
  }
};

// Format date as "September 4, 2023"
export const formatFullDate = (date: Date | string, timezone?: string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  
  // Don't do any timezone conversion if:
  // 1. No timezone is provided, or
  // 2. The timezone matches the user's timezone (no conversion needed)
  // 3. Special case for Asia/Kolkata - never convert, use direct format
  const userTimezone = getUserTimezone();
  
  // CRITICAL BUGFIX: Special handling for Asia/Kolkata - never convert these dates
  // This fixes issues with Thunderbird events created in this timezone
  if (timezone === 'Asia/Kolkata') {
    console.log('Using direct format for Asia/Kolkata full date without conversion');
    return format(dateObj, 'MMMM d, yyyy');
  }
  
  // Direct formatting with no timezone conversion 
  if (!timezone || timezone === userTimezone) {
    return format(dateObj, 'MMMM d, yyyy');
  }
  
  // Only convert if timezone differs from user timezone
  return formatInTimeZone(dateObj, timezone, 'MMMM d, yyyy');
};

// Format time as "9:00 AM"
export const formatTime = (date: Date | string, timezone?: string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  
  // Don't do any timezone conversion if:
  // 1. No timezone is provided, or
  // 2. The timezone matches the user's timezone (no conversion needed)
  // 3. Special case for Asia/Kolkata - never convert, use direct format
  const userTimezone = getUserTimezone();
  
  // CRITICAL BUGFIX: Special handling for Asia/Kolkata - never convert these dates
  // This fixes issues with Thunderbird events created in this timezone
  if (timezone === 'Asia/Kolkata') {
    console.log('Using direct format for Asia/Kolkata event time without conversion');
    return format(dateObj, 'h:mm a');
  }
  
  // Direct formatting with no timezone conversion for other conditions
  if (!timezone || timezone === userTimezone) {
    return format(dateObj, 'h:mm a');
  }
  
  // Only convert if timezone differs from user timezone
  return formatInTimeZone(dateObj, timezone, 'h:mm a');
};

// Format date and time as "Monday, September 4, 2023"
export const formatDayOfWeekDate = (date: Date | string, timezone?: string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  
  // Don't do any timezone conversion if:
  // 1. No timezone is provided, or
  // 2. The timezone matches the user's timezone (no conversion needed)
  // 3. Special case for Asia/Kolkata - never convert, use direct format
  const userTimezone = getUserTimezone();
  
  // CRITICAL BUGFIX: Special handling for Asia/Kolkata - never convert these dates
  // This fixes issues with Thunderbird events created in this timezone
  if (timezone === 'Asia/Kolkata') {
    console.log('Using direct format for Asia/Kolkata date without conversion');
    return format(dateObj, 'EEEE, MMMM d, yyyy');
  }
  
  // Direct formatting with no timezone conversion
  if (!timezone || timezone === userTimezone) {
    return format(dateObj, 'EEEE, MMMM d, yyyy');
  }
  
  // Only convert if timezone differs from user timezone
  return formatInTimeZone(dateObj, timezone, 'EEEE, MMMM d, yyyy');
};

// Format date and time range for event display
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
  
  // CRITICAL BUGFIX: Special handling for Asia/Kolkata - never convert these dates
  // This fixes issues with Thunderbird events created in this timezone
  if (timezone === 'Asia/Kolkata') {
    console.log('Using direct format for Asia/Kolkata event time range without conversion');
    // Use direct formatting without timezone conversion
    const isSameDayDirectly = format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd');
    
    if (isSameDayDirectly) {
      return `${format(startDate, 'h:mm a')} - ${format(endDate, 'h:mm a')}`;
    }
    
    return `${format(startDate, 'MMMM d, yyyy')} ${format(startDate, 'h:mm a')} - ${format(endDate, 'MMMM d, yyyy')} ${format(endDate, 'h:mm a')}`;
  }
  
  // Standard handling for other timezones
  // Get user timezone for comparison
  const userTimezone = getUserTimezone();
  
  // Check if we need to do timezone conversion
  const shouldConvert = timezone && timezone !== userTimezone;
  
  // Check same day in appropriate timezone context
  let isSameDayInTZ;
  if (shouldConvert) {
    // Using timezone conversion only if needed
    isSameDayInTZ = formatInTimeZone(startDate, timezone, 'yyyy-MM-dd') === 
                   formatInTimeZone(endDate, timezone, 'yyyy-MM-dd');
  } else {
    // No conversion needed
    isSameDayInTZ = isSameDay(startDate, endDate);
  }
  
  // Same day event
  if (isSameDayInTZ) {
    return `${formatTime(startDate, timezone)} - ${formatTime(endDate, timezone)}`;
  }
  
  // Multi-day event
  return `${formatFullDate(startDate, timezone)} ${formatTime(startDate, timezone)} - ${formatFullDate(endDate, timezone)} ${formatTime(endDate, timezone)}`;
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
