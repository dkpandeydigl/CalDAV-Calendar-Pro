import { 
  Calendar, 
  CalendarSharing, 
  InsertCalendarSharing, 
  User 
} from '@shared/schema';
import { IStorage } from './storage';

// Permission systems should use clear, secure defaults
const DEFAULT_PERMISSION: 'view' | 'edit' = 'view';

/**
 * CalendarSharingService - A dedicated service for handling calendar sharing
 * with secure defaults and proper permission management.
 */
export class CalendarSharingService {
  constructor(private storage: IStorage) {}

  /**
   * Share a calendar with another user with secure defaults
   */
  async shareCalendar(
    calendarId: number, 
    ownerUserId: number, 
    recipientEmail: string, 
    permission: 'view' | 'edit' = DEFAULT_PERMISSION
  ): Promise<CalendarSharing | { error: string }> {
    try {
      // Validate owner has the calendar
      const calendar = await this.storage.getCalendar(calendarId);
      if (!calendar) {
        return { error: 'Calendar not found' };
      }

      // Verify owner owns the calendar
      if (calendar.userId !== ownerUserId) {
        return { error: 'User does not own this calendar' };
      }

      // Validate recipient email format
      if (!recipientEmail || !recipientEmail.includes('@')) {
        return { error: 'Invalid recipient email' };
      }

      // Find the recipient user if they exist in the system
      let recipientUserId: number | null = null;
      const potentialUser = await this.storage.getUserByUsername(recipientEmail);
      if (potentialUser) {
        recipientUserId = potentialUser.id;
      }

      // Check if the calendar is already shared with this recipient
      const existingShares = await this.storage.getCalendarSharing(calendarId);
      const alreadyShared = existingShares.find(
        share => 
          share.sharedWithEmail.toLowerCase() === recipientEmail.toLowerCase() ||
          (recipientUserId && share.sharedWithUserId === recipientUserId)
      );

      if (alreadyShared) {
        // Calendar is already shared, update permissions instead
        const updated = await this.updateSharingPermission(
          alreadyShared.id, 
          permission
        );
        if ('error' in updated) {
          return updated;
        }
        return updated;
      }

      // Normalize permission to ensure consistency
      const normalizedPermission = this.normalizePermission(permission);
      
      // Create the sharing record with validated data
      const sharingData: InsertCalendarSharing = {
        calendarId,
        sharedByUserId: ownerUserId,
        sharedWithEmail: recipientEmail,
        sharedWithUserId: recipientUserId,
        permissionLevel: normalizedPermission
      };

      console.log(`[CalendarSharingService] Creating new share with permission: ${normalizedPermission}`);
      
      // Save the sharing to storage
      const result = await this.storage.shareCalendar(sharingData);
      
      return result;
    } catch (error) {
      console.error('[CalendarSharingService] Error sharing calendar:', error);
      return { error: 'Failed to share calendar' };
    }
  }

  /**
   * Update an existing calendar sharing with secure defaults
   */
  async updateSharingPermission(
    sharingId: number, 
    permission: 'view' | 'edit' = DEFAULT_PERMISSION
  ): Promise<CalendarSharing | { error: string }> {
    try {
      const existingSharing = await this.getSharingById(sharingId);
      if (!existingSharing) {
        return { error: 'Sharing record not found' };
      }

      // Normalize permission before update
      const normalizedPermission = this.normalizePermission(permission);
      
      // Only update if permission has changed
      if (existingSharing.permissionLevel === normalizedPermission) {
        return existingSharing;
      }

      console.log(`[CalendarSharingService] Updating sharing ID ${sharingId} from '${existingSharing.permissionLevel}' to '${normalizedPermission}'`);
      
      // Update the permission level
      const updated = await this.storage.updateCalendarSharing(sharingId, {
        permissionLevel: normalizedPermission
      });

      if (!updated) {
        return { error: 'Failed to update sharing permission' };
      }

      return updated;
    } catch (error) {
      console.error('[CalendarSharingService] Error updating sharing:', error);
      return { error: 'Failed to update sharing permission' };
    }
  }

  /**
   * Remove a calendar sharing
   */
  async removeSharing(sharingId: number): Promise<boolean | { error: string }> {
    try {
      const existingSharing = await this.getSharingById(sharingId);
      if (!existingSharing) {
        return { error: 'Sharing record not found' };
      }

      const result = await this.storage.removeCalendarSharing(sharingId);
      return result;
    } catch (error) {
      console.error('[CalendarSharingService] Error removing sharing:', error);
      return { error: 'Failed to remove sharing' };
    }
  }

  /**
   * Unshare a calendar (remove all shares for the calendar)
   */
  async unshareCalendar(calendarId: number, ownerUserId: number): Promise<boolean | { error: string }> {
    try {
      // Verify caller owns the calendar
      const calendar = await this.storage.getCalendar(calendarId);
      if (!calendar) {
        return { error: 'Calendar not found' };
      }

      if (calendar.userId !== ownerUserId) {
        return { error: 'User does not own this calendar' };
      }

      // Get all shares for this calendar
      const shares = await this.storage.getCalendarSharing(calendarId);
      let success = true;

      // Remove each share
      for (const share of shares) {
        const result = await this.storage.removeCalendarSharing(share.id);
        if (!result) success = false;
      }

      return success;
    } catch (error) {
      console.error('[CalendarSharingService] Error unsharing calendar:', error);
      return { error: 'Failed to unshare calendar' };
    }
  }

  /**
   * Get calendar shares by calendar ID with owner authorization check
   */
  async getCalendarShares(calendarId: number, requestingUserId: number): Promise<CalendarSharing[] | { error: string }> {
    try {
      const calendar = await this.storage.getCalendar(calendarId);
      if (!calendar) {
        return { error: 'Calendar not found' };
      }

      // Only calendar owner can see sharing information
      if (calendar.userId !== requestingUserId) {
        return { error: 'Unauthorized to view sharing information' };
      }

      const shares = await this.storage.getCalendarSharing(calendarId);
      return shares;
    } catch (error) {
      console.error('[CalendarSharingService] Error getting calendar shares:', error);
      return { error: 'Failed to get calendar shares' };
    }
  }

  /**
   * Get calendars shared with a specific user
   */
  async getSharedCalendarsForUser(userId: number): Promise<Calendar[] | { error: string }> {
    try {
      // First get the user to validate existence
      const user = await this.storage.getUser(userId);
      if (!user) {
        return { error: 'User not found' };
      }

      // Use the storage implementation to get shared calendars
      const calendars = await this.storage.getSharedCalendars(userId);
      
      // Enhance calendars with proper permission details
      const enhancedCalendars = await Promise.all(
        calendars.map(async (calendar) => {
          // Get owner information
          const owner = await this.storage.getUser(calendar.userId);
          
          // Find the actual sharing record to get the latest permission
          const shares = await this.storage.getCalendarSharing(calendar.id);
          const userShare = shares.find(share => 
            (share.sharedWithUserId === userId) || 
            (user.email && share.sharedWithEmail.toLowerCase() === user.email.toLowerCase()) ||
            (share.sharedWithEmail.toLowerCase() === user.username.toLowerCase())
          );

          // Default to view permission for security if we can't find the share record
          const permissionLevel = userShare?.permissionLevel || 'view';
          
          // Create an enhanced calendar object with all needed metadata
          return {
            ...calendar,
            owner: owner ? {
              id: owner.id,
              username: owner.username,
              email: owner.email,
              password: '', // Required by schema but not used
              preferredTimezone: owner.preferredTimezone,
              fullName: owner.fullName,
            } : null,
            ownerEmail: owner?.email || owner?.username || 'unknown',
            permissionLevel,
            permission: permissionLevel, // For backward compatibility
            canEdit: permissionLevel === 'edit',
            isShared: true,
            sharingId: userShare?.id,
          };
        })
      );

      // Group by owner for better organization
      return enhancedCalendars;
    } catch (error) {
      console.error('[CalendarSharingService] Error getting shared calendars:', error);
      return { error: 'Failed to get shared calendars' };
    }
  }

  // ====== Helper Methods ======

  /**
   * Get a sharing record by ID
   */
  private async getSharingById(sharingId: number): Promise<CalendarSharing | null> {
    try {
      // Get all calendar sharings (IStorage might not have a direct method)
      const allSharings = await this.storage.getAllCalendarSharings();
      return allSharings.find(share => share.id === sharingId) || null;
    } catch (error) {
      console.error('[CalendarSharingService] Error getting sharing by ID:', error);
      return null;
    }
  }

  /**
   * Normalize permission value to ensure consistent handling
   */
  private normalizePermission(permission: string | undefined | null): 'view' | 'edit' {
    // Default to view for security if no permission is specified
    if (permission === undefined || permission === null || permission === '') {
      return 'view';
    }

    const normalized = String(permission).toLowerCase().trim();

    // Handle edit permissions (any variant)
    if (['edit', 'write', 'readwrite', 'read-write', 'modify', 'rw', 'editor', 'true', '1', 'yes'].includes(normalized)) {
      return 'edit';
    }

    // Handle view permissions (any variant)
    if (['view', 'read', 'readonly', 'read-only', 'ro', 'viewer', 'false', '0', 'no'].includes(normalized)) {
      return 'view';
    }

    // For any other value, default to view (most secure option)
    return 'view';
  }
}

// Singleton instance
let sharingServiceInstance: CalendarSharingService | null = null;

/**
 * Get or create the calendar sharing service
 */
export function getCalendarSharingService(storage: IStorage): CalendarSharingService {
  if (!sharingServiceInstance) {
    sharingServiceInstance = new CalendarSharingService(storage);
  }
  return sharingServiceInstance;
}