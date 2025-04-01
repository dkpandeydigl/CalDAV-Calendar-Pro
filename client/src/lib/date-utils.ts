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

// Format date and time as "Monday, September 4, 2023"
export const formatDayOfWeekDate = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, 'EEEE, MMMM d, yyyy');
};

// Format date and time range for event display
export const formatEventTimeRange = (start: Date | string, end: Date | string, allDay: boolean = false): string => {
  const startDate = typeof start === 'string' ? parseISO(start) : start;
  const endDate = typeof end === 'string' ? parseISO(end) : end;

  if (allDay) {
    return 'All Day';
  }
  
  // Same day event
  if (isSameDay(startDate, endDate)) {
    return `${formatTime(startDate)} - ${formatTime(endDate)}`;
  }
  
  // Multi-day event
  return `${formatFullDate(startDate)} ${formatTime(startDate)} - ${formatFullDate(endDate)} ${formatTime(endDate)}`;
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
    { label: "America/New_York (EDT, -04:00)", value: "America/New_York" },
    { label: "Europe/London (BST, +01:00)", value: "Europe/London" },
    { label: "Asia/Tokyo (JST, +09:00)", value: "Asia/Tokyo" },
    { label: "Australia/Sydney (AEST, +10:00)", value: "Australia/Sydney" },
    { label: "Pacific/Auckland (NZST, +12:00)", value: "Pacific/Auckland" },
    { label: "Asia/Dubai (GST, +04:00)", value: "Asia/Dubai" },
    { label: "Europe/Paris (CEST, +02:00)", value: "Europe/Paris" },
    { label: "America/Los_Angeles (PDT, -07:00)", value: "America/Los_Angeles" },
    { label: "America/Chicago (CDT, -05:00)", value: "America/Chicago" }
  ];
};
