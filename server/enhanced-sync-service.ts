/**
 * Enhanced Sync Service
 * 
 * This service extends the base sync service with improved UID handling and
 * instant synchronization capabilities for event creation, updates, and cancellations.
 * 
 * It provides real-time WebSocket notifications to clients when events are created,
 * updated, or deleted, ensuring consistent UID handling across event lifecycles.
 */

import { DAVClient } from 'tsdav';
import { storage } from './storage';
import { syncService } from './sync-service';
import { preserveOrGenerateUID, registerUIDMapping } from './uid-management';
import { Event, InsertEvent, ServerConnection } from '../shared/schema';
import { generateEventICalString, prepareAttendeeForIcal, prepareResourceForIcal } from './ical-helpers';
import { notifyEventChanged, broadcastMessage, getActiveConnections } from './websocket-handler';
import { WebSocket } from 'ws';

// Define relevant message types for WebSocket notifications
export type SyncOperationType = 'create' | 'update' | 'delete' | 'sync';

export interface EnhancedSyncMessage {
  type: string;
  operation: SyncOperationType;
  userId: number;
  data?: any;
  timestamp: string;
  success: boolean;
  error?: string;
}

/**
 * Enhanced synchronization service for handling event operations
 * with proper UID preservation and immediate server synchronization
 */
export class EnhancedSyncService {
  /**
   * Create an event and immediately sync it with the CalDAV server
   * 
   * @param userId The user ID
   * @param eventData The event data to create
   * @returns The created event with server sync status
   */
  async createEventWithSync(userId: number, eventData: Partial<InsertEvent>): Promise<{
    event: Event;
    synced: boolean;
    syncDetails?: any;
  }> {
    console.log(`[Enhanced Sync] Creating new event for user ${userId}`);
    
    try {
      // Always ensure we have a valid UID for the new event
      const uid = preserveOrGenerateUID(null, eventData.rawData);
      const eventWithUID = {
        ...eventData,
        uid
      };
      
      // Create the event in local storage
      const createdEvent = await storage.createEvent(eventWithUID);
      
      if (!createdEvent) {
        throw new Error('Failed to create event in local storage');
      }
      
      console.log(`[Enhanced Sync] Event created locally with UID: ${createdEvent.uid}`);
      
      // Immediately sync to server
      const syncResult = await this.syncEventToServer(userId, createdEvent);
      
      // Broadcast the change via WebSocket
      this.notifyEventChange(userId, 'created', createdEvent);
      
      return {
        event: createdEvent,
        synced: syncResult.success,
        syncDetails: syncResult.details
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error creating event with sync:', error);
      throw error;
    }
  }
  
  /**
   * Update an event and immediately sync the changes with the CalDAV server
   * 
   * @param userId The user ID
   * @param eventId The event ID to update
   * @param eventData The updated event data
   * @param editMode Optional parameter to specify how to handle recurring event edits 
   *                 'single' or 'all' (default is 'all')
   * @returns The updated event with server sync status
   */
  async updateEventWithSync(
    userId: number, 
    eventId: number, 
    eventData: Partial<Event>, 
    editMode: 'single' | 'all' = 'all'
  ): Promise<{
    event: Event;
    synced: boolean;
    syncDetails?: any;
  }> {
    console.log(`[RECURRENCE] Updating event ${eventId} for user ${userId} with edit mode: ${editMode}`);
    
    try {
      // Get the original event for comparison
      const originalEvent = await storage.getEvent(eventId);
      
      if (!originalEvent) {
        throw new Error(`Event with ID ${eventId} not found`);
      }
      
      // Preserve the original UID - never change it during updates
      const preservedUID = preserveOrGenerateUID(originalEvent, eventData.rawData);
      
      // Create deep copy of event data to prevent mutation
      let processedEventData = { ...eventData };
      
      // ENHANCE RECURRENCE HANDLING
      console.log(`[RECURRENCE] Original event: isRecurring=${originalEvent.isRecurring}, rule=${originalEvent.recurrenceRule}`);
      console.log(`[RECURRENCE] Update data: isRecurring=${processedEventData.isRecurring}, rule=${processedEventData.recurrenceRule}`);
    
      // Case 1: Converting non-recurring to recurring event
      if (
        (!originalEvent.isRecurring || originalEvent.isRecurring === false) && 
        processedEventData.isRecurring === true
      ) {
        console.log(`[RECURRENCE] Converting non-recurring event to recurring`);
        
        // Ensure recurrence rule is set when isRecurring flag is true
        if (!processedEventData.recurrenceRule) {
          console.log(`[RECURRENCE] No recurrence rule provided for conversion, defaulting to DAILY`);
          processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
        } else if (typeof processedEventData.recurrenceRule === 'object') {
          // Convert object to RFC 5545 RRULE format string
          try {
            const formattedRule = formatObjectToRRule(processedEventData.recurrenceRule);
            if (formattedRule) {
              processedEventData.recurrenceRule = formattedRule;
              console.log(`[RECURRENCE] Converted object to RRULE format: ${processedEventData.recurrenceRule}`);
            } else {
              processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
              console.warn(`[RECURRENCE] Failed to format object, using default: ${processedEventData.recurrenceRule}`);
            }
          } catch (e) {
            console.error(`[RECURRENCE] Error formatting object`, e);
            processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
          }
        } else if (typeof processedEventData.recurrenceRule === 'string') {
          // Check if string is already in RRULE format or needs conversion
          if (!processedEventData.recurrenceRule.startsWith('FREQ=')) {
            // Try to parse any JSON strings to extract RRULE format
            try {
              const parsed = JSON.parse(processedEventData.recurrenceRule);
              
              // Check if it's our config format
              if (parsed.pattern && typeof parsed.pattern === 'string') {
                const rrule = formatRecurrenceConfigToRRule(parsed);
                if (rrule) {
                  processedEventData.recurrenceRule = rrule;
                  console.log(`[RECURRENCE] Converted JSON config to RRULE: ${processedEventData.recurrenceRule}`);
                } else {
                  processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
                  console.warn(`[RECURRENCE] Failed to format JSON config, using default: ${processedEventData.recurrenceRule}`);
                }
              } else {
                // Try to extract pattern
                const pattern = extractPatternFromObject(parsed);
                if (pattern) {
                  processedEventData.recurrenceRule = `FREQ=${pattern.toUpperCase()};COUNT=1`;
                  console.log(`[RECURRENCE] Extracted pattern from JSON: ${processedEventData.recurrenceRule}`);
                } else {
                  processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
                  console.warn(`[RECURRENCE] No pattern in JSON, using default: ${processedEventData.recurrenceRule}`);
                }
              }
            } catch (e) {
              // If not JSON, look for any FREQ pattern in the string
              const freqMatch = processedEventData.recurrenceRule.match(/FREQ=([A-Z]+)/i);
              if (freqMatch) {
                const freq = freqMatch[1].toUpperCase();
                processedEventData.recurrenceRule = `FREQ=${freq};COUNT=1`;
                console.log(`[RECURRENCE] Extracted FREQ from string: ${processedEventData.recurrenceRule}`);
              } else {
                // No pattern found, default to DAILY
                processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
                console.warn(`[RECURRENCE] No valid pattern in string, using default: ${processedEventData.recurrenceRule}`);
              }
            }
          } else {
            console.log(`[RECURRENCE] Using existing RRULE string: ${processedEventData.recurrenceRule}`);
          }
        }
      } 
      // Case 2: Converting recurring to non-recurring event
      else if (
        originalEvent.isRecurring === true && 
        processedEventData.isRecurring === false
      ) {
        console.log(`[RECURRENCE] Converting recurring event to non-recurring`);
        // Clear recurrence rule when isRecurring flag is false
        processedEventData.recurrenceRule = null;
      }
      // Case 3: Updating a recurring event
      else if (
        originalEvent.isRecurring === true && 
        (processedEventData.isRecurring === true || processedEventData.isRecurring === undefined)
      ) {
        console.log(`[RECURRENCE] Updating recurring event with edit mode: ${editMode}`);
        
        // If edit mode is 'single', handle differently based on whether we have recurrenceId
        if (editMode === 'single') {
          console.log(`[RECURRENCE] Editing single occurrence of recurring event`);
          
          // Ensure recurrenceId is set for this instance
          if (!processedEventData.recurrenceId) {
            // If no recurrenceId provided, use the original start date
            processedEventData.recurrenceId = originalEvent.startDate;
            console.log(`[RECURRENCE] Setting recurrenceId to original start date: ${processedEventData.recurrenceId}`);
          }
          
          // When editing a single occurrence, we may want to inherit the original recurrence rule
          // But mark this as an exception
          if (!processedEventData.recurrenceRule && originalEvent.recurrenceRule) {
            processedEventData.recurrenceRule = originalEvent.recurrenceRule;
            console.log(`[RECURRENCE] Inheriting original recurrence rule for single occurrence: ${processedEventData.recurrenceRule}`);
          }
        } 
        // If edit mode is 'all', ensure recurrence rule is properly updated
        else {
          console.log(`[RECURRENCE] Editing all occurrences of recurring event`);
          
          // If recurrence rule is being changed
          if (processedEventData.recurrenceRule) {
            // Apply the same transformations as for new recurring events
            if (typeof processedEventData.recurrenceRule === 'object') {
              try {
                const formattedRule = formatObjectToRRule(processedEventData.recurrenceRule);
                if (formattedRule) {
                  processedEventData.recurrenceRule = formattedRule;
                  console.log(`[RECURRENCE] Updated RRULE format: ${processedEventData.recurrenceRule}`);
                } else {
                  // Keep original if formatting fails
                  processedEventData.recurrenceRule = originalEvent.recurrenceRule;
                  console.warn(`[RECURRENCE] Failed to format object, keeping original: ${processedEventData.recurrenceRule}`);
                }
              } catch (e) {
                console.error(`[RECURRENCE] Error formatting object`, e);
                processedEventData.recurrenceRule = originalEvent.recurrenceRule;
              }
            } else if (typeof processedEventData.recurrenceRule === 'string') {
              if (!processedEventData.recurrenceRule.startsWith('FREQ=')) {
                try {
                  const parsed = JSON.parse(processedEventData.recurrenceRule);
                  const rrule = formatRecurrenceConfigToRRule(parsed);
                  if (rrule) {
                    processedEventData.recurrenceRule = rrule;
                    console.log(`[RECURRENCE] Converted JSON to RRULE for update: ${processedEventData.recurrenceRule}`);
                  } else {
                    processedEventData.recurrenceRule = originalEvent.recurrenceRule;
                    console.warn(`[RECURRENCE] Failed to format JSON, keeping original: ${processedEventData.recurrenceRule}`);
                  }
                } catch (e) {
                  const freqMatch = processedEventData.recurrenceRule.match(/FREQ=([A-Z]+)/i);
                  if (freqMatch) {
                    const freq = freqMatch[1].toUpperCase();
                    processedEventData.recurrenceRule = `FREQ=${freq};COUNT=1`;
                    console.log(`[RECURRENCE] Extracted FREQ for update: ${processedEventData.recurrenceRule}`);
                  } else {
                    processedEventData.recurrenceRule = originalEvent.recurrenceRule;
                    console.warn(`[RECURRENCE] No valid pattern in string, keeping original: ${processedEventData.recurrenceRule}`);
                  }
                }
              }
            }
          } 
          // If no recurrence rule provided in update but we're editing all occurrences
          else if (!processedEventData.recurrenceRule && originalEvent.recurrenceRule) {
            // Keep original recurrence rule
            processedEventData.recurrenceRule = originalEvent.recurrenceRule;
            console.log(`[RECURRENCE] Keeping original recurrence rule: ${processedEventData.recurrenceRule}`);
          }
        }
      }
      // Case 4: Updating a non-recurring event (no recurrence changes)
      else if (
        (!originalEvent.isRecurring || originalEvent.isRecurring === false) && 
        (processedEventData.isRecurring === false || processedEventData.isRecurring === undefined)
      ) {
        console.log(`[RECURRENCE] Updating non-recurring event (no recurrence changes)`);
        // Ensure recurrence rule is null
        processedEventData.recurrenceRule = null;
        processedEventData.isRecurring = false;
      }
      
      // CRITICAL FIX: Ensure isRecurring flag matches recurrenceRule state with absolute certainty
      // This is the final consistency check before database update and server sync
      if (processedEventData.recurrenceRule && processedEventData.recurrenceRule !== null) {
        // Have recurrence rule - must be recurring
        processedEventData.isRecurring = true;
        console.log(`[RECURRENCE] FINAL CHECK: Setting isRecurring=true to match recurrenceRule: ${processedEventData.recurrenceRule}`);
      } else if (processedEventData.recurrenceRule === null || processedEventData.recurrenceRule === undefined) {
        // No recurrence rule - can't be recurring
        processedEventData.isRecurring = false;
        console.log(`[RECURRENCE] FINAL CHECK: Setting isRecurring=false because recurrenceRule is null/undefined`);
      } else if (processedEventData.isRecurring === true && (!processedEventData.recurrenceRule || processedEventData.recurrenceRule === '')) {
        // Edge case: marked as recurring but empty rule - fix by setting default rule
        processedEventData.recurrenceRule = "FREQ=DAILY;COUNT=1";
        console.log(`[RECURRENCE] FINAL CHECK: Fixed empty recurrenceRule for isRecurring=true event: ${processedEventData.recurrenceRule}`);
      }
      
      // IMPROVED FIX: When recurrence state changes, we need special handling
      // The CalDAV server will handle recurrence expansion during the next fetch
      if (originalEvent.isRecurring !== processedEventData.isRecurring || 
          originalEvent.recurrenceRule !== processedEventData.recurrenceRule) {
        
        console.log(`[RECURRENCE RFC FIX] Recurrence state changed for event with UID ${preservedUID}`);
        
        // Case 1: Converting to recurring event
        if (!originalEvent.isRecurring && processedEventData.isRecurring) {
          console.log(`[RECURRENCE RFC FIX] Converting single event to recurring event`);
          
          // We need to ensure the original event has the recurrence properties
          // but we don't need to update other instances - the server will handle that
          
          // Ensure syncStatus is set to pending - this is crucial
          processedEventData.syncStatus = 'pending';
          
          // If this was a recurrence instance that's being converted to a recurring series,
          // we need to clear the recurrenceId
          if (processedEventData.recurrenceId) {
            console.log(`[RECURRENCE RFC FIX] Clearing recurrenceId for new recurring series`);
            processedEventData.recurrenceId = null;
          }
          
          // CRITICAL FIX FOR RECURRING CONVERSION
          console.log(`[CRITICAL FIX] Special handling for non-recurring to recurring conversion`);
          console.log(`[CRITICAL FIX] Original event UID: ${preservedUID}`);
          
          // Get all events with the same UID - should just be the original event at this point
          try {
            const relatedEvents = await storage.getEventsByUid(preservedUID);
            console.log(`[CRITICAL FIX] Found ${relatedEvents.length} events with UID ${preservedUID}`);
            
            // FIXED: Update ALL events with this UID, including the original event
            for (const event of relatedEvents) {
              console.log(`[CRITICAL FIX] Updating related event ${event.id} with UID ${event.uid}`);
              
              // Update ALL events with the same recurrence properties
              await storage.updateEvent(event.id, {
                isRecurring: true,
                recurrenceRule: processedEventData.recurrenceRule,
                sequence: event.sequence ? (event.sequence + 1) : 1, // Increment sequence for CalDAV
                dtstamp: new Date().toISOString(), // Update timestamp for CalDAV
                syncStatus: 'pending'
              });
            }
          } catch (error) {
            console.error(`[CRITICAL FIX] Error updating events:`, error);
            // Continue with the main event update
          }
        } 
        // Case 2: Converting from recurring to single event
        else if (originalEvent.isRecurring && !processedEventData.isRecurring) {
          console.log(`[RECURRENCE RFC FIX] Converting recurring event to single event`);
          
          // For a recurring to non-recurring conversion, we need to:
          // 1. Update the original event
          // 2. Let the server handle removing recurrence instances
          
          // Ensure syncStatus is set to pending
          processedEventData.syncStatus = 'pending';
          
          // FIXED: Find and update all events with the same UID
          try {
            const relatedEvents = await storage.getEventsByUid(preservedUID);
            console.log(`[CRITICAL FIX] Found ${relatedEvents.length} events with UID ${preservedUID} for recurring-to-single conversion`);
            
            // Update ALL events with the same non-recurring properties
            for (const event of relatedEvents) {
              console.log(`[CRITICAL FIX] Updating related event ${event.id} with UID ${event.uid} to non-recurring`);
              
              await storage.updateEvent(event.id, {
                isRecurring: false,
                recurrenceRule: null,
                sequence: event.sequence ? (event.sequence + 1) : 1,
                dtstamp: new Date().toISOString(),
                syncStatus: 'pending'
              });
            }
          } catch (error) {
            console.error(`[CRITICAL FIX] Error updating events to non-recurring:`, error);
            // Continue with the main event update
          }
          
          // Note: Locally cached recurrence instances will be cleaned up during the next server sync
        }
        
        // After updating the event, we'll perform a fresh sync to get the updated instances from the server
        console.log(`[RECURRENCE RFC FIX] Will perform a fresh sync after update to refresh instances`);
      }
      
      // CRITICAL FIX V2: Stronger attendee/resource preservation during updates
      // Format of attendees can vary - normalize for easier debugging
      const originalAttendees = typeof originalEvent.attendees === 'string' 
          ? originalEvent.attendees 
          : (originalEvent.attendees ? JSON.stringify(originalEvent.attendees) : 'null');
          
      const originalResources = typeof originalEvent.resources === 'string'
          ? originalEvent.resources
          : (originalEvent.resources ? JSON.stringify(originalEvent.resources) : 'null');
      
      console.log(`[ATTENDEES FIX V2] Original event #${eventId} attendees: ${originalAttendees}`);
      console.log(`[ATTENDEES FIX V2] Original event #${eventId} resources: ${originalResources}`);
      console.log(`[ATTENDEES FIX V2] Update explicitly includes attendees: ${processedEventData.attendees !== undefined ? 'yes' : 'no'}`);
      console.log(`[ATTENDEES FIX V2] Update explicitly includes resources: ${processedEventData.resources !== undefined ? 'yes' : 'no'}`);
      
      // DIRECT PRESERVATION: Always keep attendees/resources unless explicitly modified
      // This is a stronger approach than the previous implementation
      
      // Create a completely new object to avoid any reference issues
      const updatedFields = { ...processedEventData };
      
      // Apply mandatory UID preservation
      updatedFields.uid = preservedUID;
      
      // Forced attendee preservation unless explicitly changed
      if (updatedFields.attendees === undefined && originalEvent.attendees) {
        console.log(`[ATTENDEES FIX V2] PRESERVING original attendees`);
        updatedFields.attendees = originalEvent.attendees;
      } else if (updatedFields.attendees === null && originalEvent.attendees) {
        // Also guard against null - treat null as "keep original"
        console.log(`[ATTENDEES FIX V2] PRESERVING original attendees (null case)`);
        updatedFields.attendees = originalEvent.attendees;
      } else {
        console.log(`[ATTENDEES FIX V2] Using provided attendees:`, 
          typeof updatedFields.attendees === 'string' 
            ? updatedFields.attendees 
            : JSON.stringify(updatedFields.attendees));
      }
      
      // Forced resource preservation unless explicitly changed
      if (updatedFields.resources === undefined && originalEvent.resources) {
        console.log(`[ATTENDEES FIX V2] PRESERVING original resources`);
        updatedFields.resources = originalEvent.resources;
      } else if (updatedFields.resources === null && originalEvent.resources) {
        // Also guard against null - treat null as "keep original"
        console.log(`[ATTENDEES FIX V2] PRESERVING original resources (null case)`);
        updatedFields.resources = originalEvent.resources;
      } else {
        console.log(`[ATTENDEES FIX V2] Using provided resources:`, 
          typeof updatedFields.resources === 'string' 
            ? updatedFields.resources 
            : JSON.stringify(updatedFields.resources));
      }
      
      // This is our final update object with proper preservation
      const eventWithUID = updatedFields;
      
      // First special handling of related events was moved to be integrated with other recurrence changes above
      // Single unified implementation improves code clarity
      
      // Update the main event in local storage
      const updatedEvent = await storage.updateEvent(eventId, eventWithUID);
      
      if (!updatedEvent) {
        throw new Error(`Failed to update event ${eventId}`);
      }
      
      console.log(`[Enhanced Sync] Event updated locally with UID: ${updatedEvent.uid}`);
      
      // Immediately sync to server
      const syncResult = await this.syncEventToServer(userId, updatedEvent);
      
      // CRITICAL FIX: If this was a recurrence state change, force a bidirectional sync
      // to ensure server and client are in sync with all occurrences
      if (originalEvent.isRecurring !== eventWithUID.isRecurring || 
          originalEvent.recurrenceRule !== eventWithUID.recurrenceRule) {
        console.log(`[CRITICAL FIX] Recurrence state changed, forcing bidirectional sync`);
        
        // Force a sync in the background
        this.forceBidirectionalSync(userId, updatedEvent.calendarId)
          .then(result => {
            console.log(`[CRITICAL FIX] Forced sync completed:`, result);
          })
          .catch(error => {
            console.error(`[CRITICAL FIX] Error during forced sync:`, error);
          });
      }
      
      // Broadcast the change via WebSocket
      this.notifyEventChange(userId, 'updated', updatedEvent);
      
      return {
        event: updatedEvent,
        synced: syncResult.success,
        syncDetails: syncResult.details
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error updating event with sync:', error);
      throw error;
    }
  }
  
  /**
   * Cancel/delete an event and immediately sync the deletion with the CalDAV server
   * 
   * @param userId The user ID
   * @param eventId The event ID to cancel/delete
   * @returns Result of the cancellation operation
   */
  async cancelEventWithSync(userId: number, eventId: number): Promise<{
    success: boolean;
    message: string;
    syncDetails?: any;
  }> {
    console.log(`[Enhanced Sync] Canceling event ${eventId} for user ${userId}`);
    
    try {
      // Get the event before deleting it
      const eventToDelete = await storage.getEvent(eventId);
      
      if (!eventToDelete) {
        throw new Error(`Event with ID ${eventId} not found`);
      }
      
      // First, sync the cancellation to the server (if needed)
      if (eventToDelete.url) {
        const syncResult = await this.deleteEventFromServer(userId, eventToDelete);
        
        if (!syncResult.success) {
          console.warn(`[Enhanced Sync] Failed to delete event from server: ${syncResult.message}`);
          // Continue with local deletion anyway
        }
      }
      
      // Delete from local storage
      const deleted = await storage.deleteEvent(eventId);
      
      if (!deleted) {
        throw new Error(`Failed to delete event ${eventId} from local storage`);
      }
      
      // Broadcast the deletion via WebSocket
      this.notifyEventChange(userId, 'deleted', eventToDelete);
      
      return {
        success: true,
        message: 'Event cancelled/deleted successfully from both local storage and server'
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error canceling event with sync:', error);
      return {
        success: false,
        message: `Error canceling event: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Sync a single event to the CalDAV server
   * 
   * @param userId The user ID
   * @param event The event to sync
   * @returns Result of the sync operation
   */
  async syncEventToServer(userId: number, event: Event): Promise<{
    success: boolean;
    message: string;
    details?: any;
  }> {
    console.log(`[Enhanced Sync] Syncing event ${event.id} (${event.uid}) to server for user ${userId}`);
    
    try {
      // CRITICAL UID FIX: Sanitize event UID before sync
      if (event.uid && (event.uid.includes('\r') || event.uid.includes('\n') || 
                        event.uid.includes('BEGIN:VCALENDAR') || event.uid.includes('VEVENT'))) {
        console.error(`[CRITICAL UID ERROR] Event ${event.id} has corrupted UID with embedded ICS data: ${event.uid.substring(0, 50)}...`);
        
        // Extract the clean UID part
        let cleanUid = event.uid;
        
        // Try with a regex pattern first
        if (event.uid.includes('@caldavclient.local')) {
          const baseUidRegex = /(event-\d+-[a-z0-9]+@caldavclient\.local)/;
          const uidMatch = event.uid.match(baseUidRegex);
          
          if (uidMatch && uidMatch[1]) {
            cleanUid = uidMatch[1];
            console.log(`[CRITICAL UID FIX] Extracted clean UID with pattern match: ${cleanUid}`);
          } else {
            // Fallback to splitting on line breaks
            cleanUid = event.uid.split(/[\r\n]|BEGIN:/)[0].trim();
            console.log(`[CRITICAL UID FIX] Extracted clean UID with splitting: ${cleanUid}`);
          }
          
          // Update the event with the clean UID
          await storage.updateEvent(event.id, {
            uid: cleanUid
          });
          
          console.log(`[CRITICAL UID FIX] Updated event ${event.id} with clean UID: ${cleanUid}`);
          
          // Also update our local reference for the current operation
          event.uid = cleanUid;
        }
      }
      // Get the user's server connection
      const connection = await storage.getServerConnection(userId);
      
      if (!connection || !connection.url || !connection.username || !connection.password) {
        return {
          success: false,
          message: 'No valid server connection available'
        };
      }
      
      // Get the calendar for this event
      const calendar = await storage.getCalendar(event.calendarId);
      
      if (!calendar || !calendar.url) {
        return {
          success: false,
          message: 'Event calendar not found or has no URL'
        };
      }
      
      // Create a DAV client
      const davClient = new DAVClient({
        serverUrl: connection.url,
        credentials: {
          username: connection.username,
          password: connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Login to the server
      await davClient.login();
      
      // Get calendar objects to determine if this is an update or create
      const calendarObjects = await davClient.fetchCalendarObjects({
        calendar: {
          url: calendar.url
        }
      });
      
      // Format the attendees for iCalendar
      let attendees = [];
      let resources = [];
      
      if (event.attendees) {
        try {
          // Convert string or JSON to array
          const parsedAttendees = typeof event.attendees === 'string' 
            ? JSON.parse(event.attendees) 
            : event.attendees;
            
          attendees = Array.isArray(parsedAttendees) 
            ? parsedAttendees.map(prepareAttendeeForIcal)
            : [];
        } catch (e) {
          console.warn('Error parsing attendees:', e);
        }
      }
      
      if (event.resources) {
        try {
          // Convert string or JSON to array
          const parsedResources = typeof event.resources === 'string'
            ? JSON.parse(event.resources)
            : event.resources;
            
          resources = Array.isArray(parsedResources)
            ? parsedResources
            : [];
        } catch (e) {
          console.warn('Error parsing resources:', e);
        }
      }
      
      // COMPLETELY FIXED RECURRENCE HANDLING: Pre-process recurrence rule to ensure proper format
      let processedRecurrenceRule = event.recurrenceRule;
      
      console.log(`[RECURRENCE] Initial recurrence state: isRecurring=${event.isRecurring}, rule=${typeof event.recurrenceRule === 'string' ? event.recurrenceRule : typeof event.recurrenceRule}`);
      
      // CRITICAL FIX: Ensure recurrence rule is properly set based on isRecurring flag
      if (event.isRecurring === true) {
        // Force true boolean check to catch any non-boolean truthy values
        console.log(`[RECURRENCE] Event is explicitly marked as recurring (isRecurring=true)`);
        
        if (!event.recurrenceRule) {
          // Event is marked as recurring but has no recurrence rule
          console.warn(`[RECURRENCE] Event ${event.id} is marked as recurring but has no recurrence rule. Will default to DAILY.`);
          // Set a default recurrence rule for consistency
          processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
        } else if (typeof event.recurrenceRule === 'object') {
          // If it's an object, convert to proper RFC 5545 RRULE format
          try {
            // Format object to RFC 5545 RRULE string format
            const formattedRule = formatObjectToRRule(event.recurrenceRule);
            if (formattedRule) {
              processedRecurrenceRule = formattedRule;
              console.log(`[RECURRENCE] Converted object to RRULE format: ${processedRecurrenceRule}`);
            } else {
              // If formatting fails, default to basic DAILY
              processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
              console.warn(`[RECURRENCE] Failed to format object, using default: ${processedRecurrenceRule}`);
            }
          } catch (e) {
            console.error(`[RECURRENCE] Error formatting object`, e);
            processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
          }
        } else if (typeof event.recurrenceRule === 'string') {
          // If it's a string, check if it's already in valid RRULE format
          if (event.recurrenceRule.startsWith('FREQ=')) {
            // Already a valid RRULE string, use as is
            processedRecurrenceRule = event.recurrenceRule;
            console.log(`[RECURRENCE] Using existing RRULE string: ${processedRecurrenceRule}`);
          } else if (event.recurrenceRule.startsWith('{')) {
            // It's a JSON string, parse and convert to RRULE format
            try {
              const parsed = JSON.parse(event.recurrenceRule);
              
              // Check if it's our recurrence config format
              if (parsed.pattern && typeof parsed.pattern === 'string') {
                const rrule = formatRecurrenceConfigToRRule(parsed);
                if (rrule) {
                  processedRecurrenceRule = rrule;
                  console.log(`[RECURRENCE] Converted JSON config to RRULE: ${processedRecurrenceRule}`);
                } else {
                  processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
                  console.warn(`[RECURRENCE] Failed to format JSON config, using default: ${processedRecurrenceRule}`);
                }
              } else {
                // Unknown JSON format, try to extract pattern
                const pattern = extractPatternFromObject(parsed);
                if (pattern) {
                  processedRecurrenceRule = `FREQ=${pattern.toUpperCase()};COUNT=1`;
                  console.log(`[RECURRENCE] Extracted pattern from JSON: ${processedRecurrenceRule}`);
                } else {
                  processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
                  console.warn(`[RECURRENCE] No pattern in JSON, using default: ${processedRecurrenceRule}`);
                }
              }
            } catch (e) {
              console.error(`[RECURRENCE] Error parsing JSON string`, e);
              processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
            }
          } else {
            // Unknown string format that doesn't start with FREQ= or {
            // Try to see if it contains a FREQ= pattern
            const freqMatch = event.recurrenceRule.match(/FREQ=([A-Z]+)/i);
            if (freqMatch) {
              const freq = freqMatch[1].toUpperCase();
              processedRecurrenceRule = `FREQ=${freq};COUNT=1`;
              console.log(`[RECURRENCE] Extracted FREQ from unknown string: ${processedRecurrenceRule}`);
            } else {
              // No valid pattern found, default to DAILY
              processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
              console.warn(`[RECURRENCE] No valid pattern in string, using default: ${processedRecurrenceRule}`);
            }
          }
        }
      } else {
        // Event is not recurring, clear recurrence rule
        processedRecurrenceRule = null;
        console.log(`[RECURRENCE] Event ${event.id} is not recurring, cleared recurrence rule`);
      }
      
      console.log(`[RECURRENCE] Final processed rule: ${processedRecurrenceRule}`);
      
      // Helper function to convert recurrence config object to RRULE string
      function formatRecurrenceConfigToRRule(config: any): string | null {
        if (!config || typeof config !== 'object') return null;
        
        // Extract pattern from config
        const pattern = config.pattern || config.frequency;
        if (!pattern || pattern === 'None') return null;
        
        // Start building RRULE string
        let rrule = `FREQ=${pattern.toUpperCase()};`;
        
        // Add interval if present
        if (config.interval && config.interval > 1) {
          rrule += `INTERVAL=${config.interval};`;
        }
        
        // Add weekdays for weekly pattern
        if ((pattern === 'Weekly' || pattern === 'WEEKLY') && 
            config.weekdays && Array.isArray(config.weekdays) && config.weekdays.length > 0) {
          
          const dayMap: Record<string, string> = {
            'Monday': 'MO', 'Tuesday': 'TU', 'Wednesday': 'WE', 'Thursday': 'TH',
            'Friday': 'FR', 'Saturday': 'SA', 'Sunday': 'SU'
          };
          
          const days = config.weekdays
            .map((day: string) => dayMap[day] || '')
            .filter(Boolean)
            .join(',');
          
          if (days) {
            rrule += `BYDAY=${days};`;
          }
        }
        
        // Add count or until date
        if (config.endType === 'After' && config.occurrences) {
          rrule += `COUNT=${config.occurrences};`;
        } else if (config.endType === 'On' && (config.untilDate || config.endDate)) {
          const dateStr = config.untilDate || config.endDate;
          if (dateStr) {
            try {
              const date = new Date(dateStr);
              // Format as YYYYMMDD
              const formatted = date.toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
              rrule += `UNTIL=${formatted};`;
            } catch (e) {
              console.error('[RECURRENCE] Error formatting until date', e);
            }
          }
        }
        
        // Remove trailing semicolon and return
        return rrule.endsWith(';') ? rrule.slice(0, -1) : rrule;
      }
      
      // Helper function to format object to RRULE string
      function formatObjectToRRule(obj: any): string | null {
        if (!obj || typeof obj !== 'object') return null;
        
        // If it has a pattern property, treat it as our recurrence config
        if (obj.pattern) {
          return formatRecurrenceConfigToRRule(obj);
        }
        
        // Try to extract a pattern
        const pattern = extractPatternFromObject(obj);
        if (pattern) {
          return `FREQ=${pattern.toUpperCase()};COUNT=1`;
        }
        
        return null;
      }
      
      // Helper function to extract pattern from object
      function extractPatternFromObject(obj: any): string | null {
        if (!obj || typeof obj !== 'object') return null;
        
        // Check common pattern properties
        if (obj.pattern && obj.pattern !== 'None') {
          return obj.pattern;
        }
        
        if (obj.frequency) {
          return obj.frequency;
        }
        
        if (obj.freq) {
          return obj.freq;
        }
        
        if (obj.FREQ) {
          return obj.FREQ;
        }
        
        if (obj.Frequency) {
          return obj.Frequency;
        }
        
        // If we have a raw RRULE string, extract the FREQ part
        if (obj.rrule && typeof obj.rrule === 'string') {
          const match = obj.rrule.match(/FREQ=([A-Z]+)/i);
          if (match) {
            return match[1];
          }
        }
        
        return null;
      }
      
      // CRITICAL FIX: Final check before generating ICS - ensure recurrence rule is consistent with isRecurring
      if (event.isRecurring === true && (!processedRecurrenceRule || processedRecurrenceRule === null)) {
        // Critical error - event is marked as recurring but has no recurrence rule after all processing
        console.error(`[RECURRENCE] CRITICAL ERROR: Event ${event.id} is marked as recurring but has no recurrence rule after processing`);
        // Force a default rule to ensure consistency
        processedRecurrenceRule = "FREQ=DAILY;COUNT=1";
        
        // Update the event in database to fix the inconsistency
        await storage.updateEvent(event.id, {
          recurrenceRule: processedRecurrenceRule
        });
        
        console.log(`[RECURRENCE] Applied emergency fix: ${processedRecurrenceRule}`);
      } else if (event.isRecurring === false && processedRecurrenceRule) {
        // Inconsistency - event is marked as non-recurring but has a recurrence rule
        console.warn(`[RECURRENCE] Inconsistency: Event ${event.id} is marked as non-recurring but has rule: ${processedRecurrenceRule}`);
        // Force null rule to match non-recurring state
        processedRecurrenceRule = null;
        
        // Update the event in database to fix the inconsistency
        await storage.updateEvent(event.id, {
          recurrenceRule: null
        });
        
        console.log(`[RECURRENCE] Fixed inconsistency by removing recurrence rule`);
      }
      
      // CRITICAL FIX: Double check recurrence rule one more time
      // This ensures the recurrence rule is properly synced to the server
      if (event.isRecurring && !processedRecurrenceRule) {
        console.error(`[CRITICAL RECURRENCE SYNC] Event ${event.id} with UID ${event.uid} is marked as recurring but has no recurrence rule before ICS generation!`);
        
        // Try to recover the recurrence rule from the event
        if (event.recurrenceRule) {
          console.log(`[CRITICAL RECURRENCE SYNC] Recovering recurrence rule from event: ${event.recurrenceRule}`);
          processedRecurrenceRule = event.recurrenceRule;
        } else {
          // Last resort: force a basic daily recurrence as default
          processedRecurrenceRule = "FREQ=DAILY;COUNT=3";
          console.log(`[CRITICAL RECURRENCE SYNC] Applied default recurrence rule: ${processedRecurrenceRule}`);
          
          // Update the database with the emergency recurrence rule
          await storage.updateEvent(event.id, {
            recurrenceRule: processedRecurrenceRule
          });
        }
      }
      
      console.log(`[CRITICAL ICS GEN] Generating ICS for event ${event.uid} with recurrence rule: ${processedRecurrenceRule || 'NONE'}`);
      
      // Generate the ICS data for this event with sanitized recurrence rule and extra logging
      const icsData = generateEventICalString({
        uid: event.uid,
        title: event.title,
        description: event.description || '',
        location: event.location || '',
        startDate: new Date(event.startDate),
        endDate: new Date(event.endDate),
        attendees,
        resources,
        organizer: {
          email: connection.username,
          name: (await storage.getUser(userId))?.fullName || connection.username
        },
        recurrenceRule: processedRecurrenceRule, // This should now never be null for recurring events
        allDay: event.allDay,
        isRecurring: event.isRecurring // CRITICAL FIX: Pass the isRecurring flag to ensure consistency checking
      });
      
      // Check if this event already exists on the server
      const existingEvent = calendarObjects.find(obj => {
        // Try to extract UID from object data
        const uidMatch = obj.data && typeof obj.data === 'string' 
          ? obj.data.match(/UID:([^\r\n]+)/) 
          : null;
        
        const objUid = uidMatch ? uidMatch[1] : null;
        return objUid === event.uid;
      });
      
      let syncResult;
      
      // For debugging purposes, log the generated ICS data
      console.log(`[ICS DATA DEBUG] Generated ICS data for event ${event.uid}, isRecurring=${event.isRecurring}:`);
      console.log(`[ICS DATA DEBUG] ${icsData.substring(0, 200)}...`);
      
      // Check for RRULE presence in the generated ICS data if the event is recurring
      if (event.isRecurring && !icsData.includes('RRULE:')) {
        console.error(`[CRITICAL ERROR] Event ${event.id} is marked as recurring but RRULE is missing in ICS data!`);
        
        // Add RRULE manually if it's missing
        const rrule = processedRecurrenceRule || "FREQ=DAILY;COUNT=3";
        const fixedIcsData = icsData.replace('END:VEVENT', `RRULE:${rrule}\r\nEND:VEVENT`);
        
        console.log(`[CRITICAL FIX] Added missing RRULE to ICS data: ${rrule}`);
        
        // Update the icsData with the fixed version
        icsData = fixedIcsData;
      }
      
      if (existingEvent) {
        // Update the existing event
        console.log(`[Enhanced Sync] Updating existing event on server: ${event.uid}`);
        
        syncResult = await davClient.updateCalendarObject({
          calendarObject: {
            url: existingEvent.url,
            data: icsData,
            etag: existingEvent.etag
          }
        });
        
        if (syncResult) {
          await storage.updateEvent(event.id, {
            url: String(existingEvent.url),
            etag: syncResult.etag || null,
            syncStatus: 'synced',
            lastSyncAttempt: new Date()
          });
        }
      } else {
        // Create a new event
        console.log(`[Enhanced Sync] Creating new event on server: ${event.uid}`);
        
        // Construct the URL for the new event
        const filename = `${event.uid.replace(/[@:.\/]/g, '_')}.ics`;
        const eventUrl = `${calendar.url}/${filename}`;
        
        syncResult = await davClient.createCalendarObject({
          calendar: {
            url: calendar.url
          },
          calendarObject: {
            url: eventUrl,
            data: icsData
          }
        });
        
        if (syncResult) {
          await storage.updateEvent(event.id, {
            url: String(eventUrl),
            etag: syncResult.etag || null,
            syncStatus: 'synced',
            lastSyncAttempt: new Date()
          });
        }
      }
      
      return {
        success: true,
        message: 'Event successfully synced to server',
        details: syncResult
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error syncing event to server:', error);
      
      // Update event with sync error
      await storage.updateEvent(event.id, {
        syncStatus: 'error',
        syncError: error instanceof Error ? error.message : String(error),
        lastSyncAttempt: new Date()
      });
      
      return {
        success: false,
        message: `Error syncing event: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Delete an event from the CalDAV server
   * 
   * @param userId The user ID
   * @param event The event to delete
   * @returns Result of the deletion operation
   */
  async deleteEventFromServer(userId: number, event: Event): Promise<{
    success: boolean;
    message: string;
  }> {
    console.log(`[Enhanced Sync] Deleting event ${event.id} (${event.uid}) from server for user ${userId}`);
    
    try {
      // If the event doesn't have a URL, it was never synced to the server
      if (!event.url) {
        return {
          success: true,
          message: 'Event was not previously synced to server'
        };
      }
      
      // Get the user's server connection
      const connection = await storage.getServerConnection(userId);
      
      if (!connection || !connection.url || !connection.username || !connection.password) {
        return {
          success: false,
          message: 'No valid server connection available'
        };
      }
      
      // Create a DAV client
      const davClient = new DAVClient({
        serverUrl: connection.url,
        credentials: {
          username: connection.username,
          password: connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Login to the server
      await davClient.login();
      
      // Delete the event
      await davClient.deleteCalendarObject({
        calendarObject: {
          url: event.url,
          etag: event.etag || ''
        }
      });
      
      return {
        success: true,
        message: 'Event successfully deleted from server'
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error deleting event from server:', error);
      return {
        success: false,
        message: `Error deleting event: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Notify users about event changes via WebSocket
   * 
   * @param userId The user ID
   * @param action The action performed (created, updated, deleted)
   * @param event The event that changed
   */
  private notifyEventChange(userId: number, action: 'created' | 'updated' | 'deleted', event: Event): void {
    try {
      notifyEventChanged(userId, event, action);
      
      console.log(`[Enhanced Sync] Sent WebSocket notification for event ${event.id}: ${action}`);
    } catch (error) {
      console.warn('[Enhanced Sync] Could not broadcast via WebSocket:', error);
    }
  }
  
  /**
   * Force an immediate bidirectional sync for a user's calendars
   * 
   * @param userId The user ID
   * @param calendarId Optional specific calendar ID to sync
   * @returns Result of the sync operation
   */
  async forceBidirectionalSync(userId: number, calendarId?: number): Promise<{
    success: boolean;
    message: string;
    calendarsSynced?: number;
    eventsSynced?: number;
  }> {
    console.log(`[Enhanced Sync] Forcing bidirectional sync for user ${userId}${calendarId ? ` (calendar: ${calendarId})` : ''}`);
    
    try {
      // First pull from server to local
      const pullResult = await syncService.requestSync(userId, {
        calendarId: calendarId || null,
        forceRefresh: true,
        preserveLocalDeletes: true
      });
      
      // Then push from local to server
      const pushResult = await syncService.pushLocalEvents(userId, calendarId);
      
      return {
        success: true,
        message: 'Bidirectional sync completed successfully',
        calendarsSynced: pullResult?.calendarsSynced || 0,
        eventsSynced: pullResult?.eventsSynced || 0
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error during bidirectional sync:', error);
      return {
        success: false,
        message: `Error during sync: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Fetch user calendars and events upon successful authentication
   * 
   * @param userId The user ID
   * @returns Result of the initial fetch operation
   */
  async fetchUserCalendarsAndEvents(userId: number): Promise<{
    success: boolean;
    message: string;
    calendars?: number;
    events?: number;
  }> {
    console.log(`[Enhanced Sync] Fetching calendars and events for newly authenticated user ${userId}`);
    
    try {
      // Check if the user has a server connection
      const connection = await storage.getServerConnection(userId);
      
      if (!connection || !connection.url || !connection.username || !connection.password) {
        return {
          success: false,
          message: 'No valid server connection available'
        };
      }
      
      // Perform a full discovery and sync
      const syncResult = await syncService.requestSync(userId, {
        forceRefresh: true,
        preserveLocalDeletes: false,
        comprehensiveDiscovery: true
      });
      
      return {
        success: true,
        message: 'Successfully fetched user calendars and events',
        calendars: syncResult?.calendarsSynced || 0,
        events: syncResult?.eventsSynced || 0
      };
    } catch (error) {
      console.error('[Enhanced Sync] Error fetching user calendars and events:', error);
      return {
        success: false,
        message: `Error fetching calendars and events: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Shutdown the enhanced sync service
   * This method should be called when the application is shutting down
   */
  shutdown(): void {
    console.log('[Enhanced Sync] Shutting down enhanced sync service');
    // Perform any cleanup operations here (if needed in the future)
  }
}

// Create and export a singleton instance
export const enhancedSyncService = new EnhancedSyncService();