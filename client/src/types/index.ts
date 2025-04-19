// Type definition for calendar types
import { Calendar, User } from "../../../shared/schema";

// Extended type for a shared calendar with additional properties
export interface SharedCalendar extends Calendar {
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
  
  // Alternative owner ID
  userId?: number;
  
  // Utility method to check edit permissions with flexibility
  canEdit?: () => boolean;
}