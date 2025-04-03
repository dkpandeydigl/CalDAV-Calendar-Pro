import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Calendar } from '@shared/schema';

// Extended calendar type with permission information
export interface SharedCalendar extends Calendar {
  permission: 'view' | 'edit';
  isShared: boolean;
  ownerEmail?: string; // Email address of the user who shared the calendar
}

export const useSharedCalendars = () => {
  const queryClient = useQueryClient();
  const sharedCalendarsQuery = useQuery<SharedCalendar[]>({
    queryKey: ['/api/shared-calendars'],
  });

  // Toggle the visibility (enabled status) of a shared calendar locally
  // without making a server API call
  const toggleCalendarVisibility = (calendarId: number, enabled: boolean) => {
    const currentData = queryClient.getQueryData<SharedCalendar[]>(['/api/shared-calendars']);
    
    if (!currentData) return;
    
    const updatedData = currentData.map(calendar => 
      calendar.id === calendarId ? { ...calendar, enabled } : calendar
    );
    
    queryClient.setQueryData(['/api/shared-calendars'], updatedData);
  };

  return {
    sharedCalendars: sharedCalendarsQuery.data || [],
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error,
    toggleCalendarVisibility
  };
};