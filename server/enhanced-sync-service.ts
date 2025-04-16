/**
 * Enhanced Sync Service
 * 
 * This service extends the base sync service with improved UID handling and
 * instant synchronization capabilities for event creation, updates, and cancellations.
 */

import { DAVClient } from 'tsdav';
import { storage } from './memory-storage';
import { syncService } from './sync-service';
import { preserveOrGenerateUID, registerUIDMapping } from './uid-management';
import { Event, InsertEvent, ServerConnection } from '../shared/schema';
import { generateEventICalString, prepareAttendeeForIcal, prepareResourceForIcal } from './ical-helpers';
import { notifyEventChanged } from './websocket-handler';

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
   * @returns The updated event with server sync status
   */
  async updateEventWithSync(userId: number, eventId: number, eventData: Partial<Event>): Promise<{
    event: Event;
    synced: boolean;
    syncDetails?: any;
  }> {
    console.log(`[Enhanced Sync] Updating event ${eventId} for user ${userId}`);
    
    try {
      // Get the original event first
      const originalEvent = await storage.getEvent(eventId);
      
      if (!originalEvent) {
        throw new Error(`Event with ID ${eventId} not found`);
      }
      
      // Preserve the original UID - never change it during updates
      const preservedUID = preserveOrGenerateUID(originalEvent, eventData.rawData);
      
      // Ensure the UID doesn't change
      const eventWithUID = {
        ...eventData,
        uid: preservedUID
      };
      
      // Update the event in local storage
      const updatedEvent = await storage.updateEvent(eventId, eventWithUID);
      
      if (!updatedEvent) {
        throw new Error(`Failed to update event ${eventId}`);
      }
      
      console.log(`[Enhanced Sync] Event updated locally with UID: ${updatedEvent.uid}`);
      
      // Immediately sync to server
      const syncResult = await this.syncEventToServer(userId, updatedEvent);
      
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
      
      // Generate the ICS data for this event
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
        recurrenceRule: event.recurrenceRule || undefined
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
      const pullResult = await syncService.syncCalendars(userId, {
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
      const syncResult = await syncService.syncCalendars(userId, {
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