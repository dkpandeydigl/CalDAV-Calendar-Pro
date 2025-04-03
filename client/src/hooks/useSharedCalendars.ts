import { useQuery } from '@tanstack/react-query';
import type { Calendar } from '@shared/schema';

// Extended calendar type with permission information
export interface SharedCalendar extends Calendar {
  permission: 'view' | 'edit';
  isShared: boolean;
}

export const useSharedCalendars = () => {
  const sharedCalendarsQuery = useQuery<SharedCalendar[]>({
    queryKey: ['/api/shared-calendars'],
  });

  return {
    sharedCalendars: sharedCalendarsQuery.data || [],
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error
  };
};