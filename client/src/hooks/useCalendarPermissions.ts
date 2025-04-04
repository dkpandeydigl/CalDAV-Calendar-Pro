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

    // If user is not available but we have calendars, we likely have a valid server session
    // so we should still grant some permissions to allow basic operations
    if (!user || !user.id) {
      const calendar = calendars.find(cal => cal.id === calendarId);
      if (calendar) {
        console.log(`User data not loaded yet, but calendar ${calendarId} exists - granting view permissions`);
        return {
          canView: true,
          canEdit: true, // Allow edit since the server will handle actual permission checks
          isOwner: false
        };
      }
      
      console.log(`User data not loaded yet, denying all permissions for calendar ${calendarId}`);
      return defaultPermission;
    }

    // First check if it's the user's own calendar
    const ownCalendar = calendars.find(cal => cal.id === calendarId);
    if (ownCalendar) {
      // If this is the user's own calendar, they have full permissions
      if (ownCalendar.userId === user.id) {
        console.log(`Calendar ${calendarId} is owned by current user - full permissions granted`);
        return {
          canView: true,
          canEdit: true,
          isOwner: true
        };
      }
      
      // If it's not the user's calendar but we found it in the calendars list,
      // it means it's possibly a local calendar they have access to
      console.log(`Calendar ${calendarId} is in user's local calendars but not owned - access granted`);
      return {
        canView: true,
        canEdit: true,
        isOwner: false
      };
    }

    // Next check if it's a shared calendar
    const sharedCalendar = sharedCalendars.find(cal => cal.id === calendarId);
    if (sharedCalendar) {
      // Log extensive details about the shared calendar permissions for debugging
      console.log(`Calendar ${calendarId} (${sharedCalendar.name}) is shared with user - permission type:`, {
        permission: sharedCalendar.permission,
        canEdit: sharedCalendar.permission === 'edit',
        fullCalendar: sharedCalendar
      });
      
      return {
        canView: true,
        canEdit: sharedCalendar.permission === 'edit',
        isOwner: false
      };
    }

    console.log(`Calendar ${calendarId} not found in user's calendars - no permissions`);
    return defaultPermission;
  };

  return {
    getCalendarPermission
  };
};