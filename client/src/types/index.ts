// Type definition for calendar types
import { Calendar, User } from "../../../shared/schema";

// Permission type that accepts all supported variations to reduce type errors
export type CalendarPermission = 'view' | 'edit' | 'read' | 'write' | string;

// Extended type for a shared calendar with additional properties
export interface SharedCalendar {
  // Base Calendar properties
  id: number;
  name: string;
  color: string;
  url: string | null;
  syncToken: string | null;
  isPrimary: boolean | null;
  isLocal: boolean | null;
  description: string | null;
  
  // Calendar's original owner ID (required in schema, but may be different from shared calendar owner)
  userId: number;
  
  // Must be explicitly defined to ensure it exists on shared calendars
  enabled: boolean;
  
  // Sharing specific properties
  isShared?: boolean;
  
  // Legacy permission field - some API endpoints use this
  permission?: CalendarPermission;
  
  // Primary permission field from schema - some endpoints use this 
  permissionLevel?: CalendarPermission;
  
  // ID of the calendar sharing record
  sharingId?: number;
  
  // Owner information
  owner?: User;
  
  // Alternative owner identifier
  ownerEmail?: string;
  
  // Utility method to check edit permissions with flexibility
  canEdit?: () => boolean;
  
  // Debug information for sharing/permission troubleshooting
  // This is added by the server to help debug permission issues
  _sharingDebug?: {
    originalPermission?: string;
    normalizedPermission?: string;
    isEdit?: boolean;
    isView?: boolean;
    userMatch?: {
      userId?: number;
      sharingId?: number;
      originalPermission?: string;
      normalizedPermission?: string;
      permissionEquivalents?: {
        isEdit?: boolean;
        isView?: boolean;
      };
      sharedWithEmail?: string;
      sharedWithUserId?: number | null;
      sharedByUserId?: number;
    };
    [key: string]: any; // Allow for additional debug fields
  };
}