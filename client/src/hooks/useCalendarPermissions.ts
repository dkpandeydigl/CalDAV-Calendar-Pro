import { useCalendars } from './useCalendars';
import { useSharedCalendars } from './useSharedCalendars';
import { useAuth } from '@/contexts/AuthContext';

export interface CalendarPermission {
  canView: boolean;
  canEdit: boolean;
  isOwner: boolean;
}

export const useCalendarPermissions = () => {
  const { calendars } = useCalendars();
  const { sharedCalendars } = useSharedCalendars();
  const { user } = useAuth();

  /**
   * Check if the current user has permission to edit a calendar
   * @param calendarId The ID of the calendar to check
   * @returns Permission information for the calendar
   */
  const getCalendarPermission = (calendarId: number): CalendarPermission => {
    // Default permissions - can't do anything
    const defaultPermission: CalendarPermission = {
      canView: false,
      canEdit: false,
      isOwner: false
    };

    if (!user) return defaultPermission;

    // First check if it's the user's own calendar
    const ownCalendar = calendars.find(cal => cal.id === calendarId);
    if (ownCalendar) {
      // If this is the user's own calendar, they have full permissions
      if (ownCalendar.userId === user.id) {
        return {
          canView: true,
          canEdit: true,
          isOwner: true
        };
      }
      
      // If it's not the user's calendar but we found it in the calendars list,
      // it means it's possibly a local calendar they have access to
      return {
        canView: true,
        canEdit: true,
        isOwner: false
      };
    }

    // Next check if it's a shared calendar
    const sharedCalendar = sharedCalendars.find(cal => cal.id === calendarId);
    if (sharedCalendar) {
      return {
        canView: true,
        canEdit: sharedCalendar.permission === 'edit',
        isOwner: false
      };
    }

    return defaultPermission;
  };

  return {
    getCalendarPermission
  };
};