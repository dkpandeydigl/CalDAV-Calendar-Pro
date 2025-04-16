/**
 * Extended Exports
 * 
 * This file exports additional modules that enhance the core functionality
 * of the calendar application.
 */

// Export the enhanced sync service
export { enhancedSyncService } from './enhanced-sync-service';

// Export UID management functions
export { 
  generateEventUID,
  extractUIDFromRawData,
  preserveOrGenerateUID,
  registerUIDMapping,
  getInternalUID
} from './uid-management';

// Export iCalendar helpers
export {
  formatICalDate,
  escapeICalText,
  formatContentLine,
  prepareAttendeeForIcal,
  prepareResourceForIcal,
  generateEventICalString
} from './ical-helpers';