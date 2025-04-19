// Type definition for calendar types
import { Calendar, User } from "../../../shared/schema";

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
  permission?: 'view' | 'edit' | 'read' | 'write';
  
  // Primary permission field from schema - some endpoints use this 
  permissionLevel: 'view' | 'edit' | 'read' | 'write';
  
  // ID of the calendar sharing record
  sharingId?: number;
  
  // Owner information
  owner?: User;
  
  // Alternative owner identifier
  ownerEmail?: string;
  
  // Utility method to check edit permissions with flexibility
  canEdit?: () => boolean;
}