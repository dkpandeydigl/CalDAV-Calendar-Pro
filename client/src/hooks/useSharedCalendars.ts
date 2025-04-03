import { useQuery } from '@tanstack/react-query';
import type { Calendar } from '@shared/schema';

export const useSharedCalendars = () => {
  const sharedCalendarsQuery = useQuery<Calendar[]>({
    queryKey: ['/api/shared-calendars'],
  });

  return {
    sharedCalendars: sharedCalendarsQuery.data || [],
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error
  };
};