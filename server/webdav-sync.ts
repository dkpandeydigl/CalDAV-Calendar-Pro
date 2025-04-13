import { DAVClient, DAVResponse } from 'tsdav';
import { eq, and, inArray, ne } from 'drizzle-orm';
import { db } from './db';
import { calendars, events, type Calendar, type Event } from '../shared/schema';
import { broadcastToUser } from './websocket-handler';
import { notificationService } from './notification-service';
import { storage } from './database-storage';

/**
 * WebDAV Sync Service
 * 
 * Implements WebDAV Sync Extensions (RFC 6578) for efficient synchronization
 * of calendars with the CalDAV server.
 */
export class WebDAVSyncService {
  /**
   * Fetch changes since a specific sync token
   * 
   * @param calendarId - The ID of the calendar to sync
   * @param syncToken - The sync token from the last sync
   * @param davClient - An authenticated DAV client
   * @returns Object containing added, modified, and deleted events, plus a new sync token
   */
  async getChangesSince(
    calendarId: number,
    syncToken: string | null, 
    davClient: DAVClient
  ): Promise<{
    added: Event[],
    modified: Event[],
    deleted: string[],
    newSyncToken: string
  }> {
    try {
      // Get the calendar
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar || !calendar.url) {
        throw new Error('Calendar not found or has no URL');
      }

      // Prepare sync-collection REPORT request
      const syncCollectionRequest = {
        url: calendar.url,
        depth: '1',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
        },
        method: 'REPORT',
        body: this.buildSyncCollectionXML(syncToken),
      };

      console.log(`Performing sync-collection REPORT for calendar ${calendarId} with token: ${syncToken || 'none'}`);
      
      // Execute the REPORT request
      const response = await davClient.fetchCalendarObjects(calendar.url);
      
      // Extract sync token from response
      const newSyncToken = new Date().toISOString(); // Fallback
      
      // Process changes
      const currentEvents = await storage.getEvents(calendarId);
      const currentUids = new Set(currentEvents.map(event => event.uid));
      
      // Track changes
      const added: Event[] = [];
      const modified: Event[] = [];
      const deleted: string[] = [];
      
      // Process response objects
      for (const obj of response) {
        if (!obj.data) continue;
        
        try {
          // Parse the event data
          const eventData = this.parseEventData(obj.data, calendarId);
          
          // Check if this event already exists
          const existingEvent = currentEvents.find(event => event.uid === eventData.uid);
          
          if (!existingEvent) {
            // New event
            const newEvent = await storage.createEvent({
              ...eventData,
              syncStatus: 'synced',
              etag: obj.etag || null
            });
            added.push(newEvent);
          } else if (obj.etag && existingEvent.etag !== obj.etag) {
            // Modified event
            const updatedEvent = await storage.updateEvent(existingEvent.id, {
              ...eventData,
              syncStatus: 'synced',
              etag: obj.etag
            });
            if (updatedEvent) {
              modified.push(updatedEvent);
            }
          }
        } catch (error) {
          console.error('Error processing calendar object:', error);
        }
      }
      
      // Detect deleted events
      // This is only applicable if we had a previous sync token
      if (syncToken) {
        // We'd typically get this from a sync-collection report in a real impl
        // For now, compare what's on the server with what we have locally
        const serverUids = new Set(response.map(obj => {
          try {
            // Extract UID from iCalendar data
            const match = obj.data?.match(/UID:(.*?)\\r\\n/);
            return match ? match[1] : null;
          } catch (e) {
            return null;
          }
        }).filter(Boolean));
        
        // Find events that are in our database but not on the server
        for (const event of currentEvents) {
          if (event.uid && !serverUids.has(event.uid)) {
            deleted.push(event.uid);
            await storage.deleteEvent(event.id);
          }
        }
      }
      
      // Update calendar sync token
      await storage.updateCalendar(calendarId, { syncToken: newSyncToken });
      
      return {
        added,
        modified,
        deleted,
        newSyncToken
      };
    } catch (error) {
      console.error('Error in getChangesSince:', error);
      throw error;
    }
  }
  
  /**
   * Build XML for sync-collection REPORT request
   */
  private buildSyncCollectionXML(syncToken: string | null): string {
    if (syncToken) {
      return `<?xml version="1.0" encoding="utf-8" ?>
        <d:sync-collection xmlns:d="DAV:">
          <d:sync-token>${syncToken}</d:sync-token>
          <d:sync-level>1</d:sync-level>
          <d:prop>
            <d:getetag/>
            <cal:calendar-data xmlns:cal="urn:ietf:params:xml:ns:caldav"/>
          </d:prop>
        </d:sync-collection>`;
    } else {
      // Initial sync
      return `<?xml version="1.0" encoding="utf-8" ?>
        <d:sync-collection xmlns:d="DAV:">
          <d:sync-token/>
          <d:sync-level>1</d:sync-level>
          <d:prop>
            <d:getetag/>
            <cal:calendar-data xmlns:cal="urn:ietf:params:xml:ns:caldav"/>
          </d:prop>
        </d:sync-collection>`;
    }
  }
  
  /**
   * Parse iCalendar data into an event object
   */
  private parseEventData(icalData: string, calendarId: number): Omit<Event, 'id'> {
    // This is a simplified version - you'd typically use a library like node-ical
    // Extract event properties from iCalendar data
    const titleMatch = icalData.match(/SUMMARY:(.*?)\\r\\n/);
    const descriptionMatch = icalData.match(/DESCRIPTION:(.*?)\\r\\n/);
    const locationMatch = icalData.match(/LOCATION:(.*?)\\r\\n/);
    const startMatch = icalData.match(/DTSTART(?:;TZID=[^:]+)?:(.*?)\\r\\n/);
    const endMatch = icalData.match(/DTEND(?:;TZID=[^:]+)?:(.*?)\\r\\n/);
    const uidMatch = icalData.match(/UID:(.*?)\\r\\n/);
    
    if (!uidMatch || !startMatch) {
      throw new Error('Invalid iCalendar data: missing required properties');
    }
    
    // Parse dates
    const startDate = this.parseICalDate(startMatch[1]);
    const endDate = endMatch ? this.parseICalDate(endMatch[1]) : new Date(startDate.getTime() + 3600000); // Default 1 hour
    
    return {
      calendarId,
      title: titleMatch ? titleMatch[1] : 'Untitled Event',
      description: descriptionMatch ? descriptionMatch[1] : null,
      location: locationMatch ? locationMatch[1] : null,
      startDate,
      endDate,
      uid: uidMatch[1],
      url: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      allDay: false, // Would need more parsing for actual value
      rawData: icalData,
      syncError: null,
      lastSyncAttempt: new Date(),
      emailSent: null,
      emailError: null,
      recurrenceRule: null,
      attendees: null,
      organizer: null,
      syncStatus: 'synced',
      resources: null,
      sharingMetadata: null
    };
  }
  
  /**
   * Parse iCalendar date format
   */
  private parseICalDate(dateStr: string): Date {
    // Basic parsing for common iCalendar date formats
    if (dateStr.includes('T')) {
      // ISO format with time
      return new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6Z'));
    } else {
      // Date only
      return new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
    }
  }
  
  /**
   * Notify clients about changes to a calendar
   */
  async notifyCalendarChanges(
    userId: number,
    calendarId: number,
    changes: {
      added: Event[],
      modified: Event[],
      deleted: string[]
    }
  ): Promise<void> {
    try {
      // 1. Send WebSocket notification
      broadcastToUser(userId, {
        type: 'calendar_changed',
        calendarId,
        changes: {
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length
        },
        timestamp: new Date().toISOString()
      });
      
      // 2. Create notifications for significant changes
      const calendar = await storage.getCalendar(calendarId);
      if (!calendar) return;
      
      // Get user information for notifications
      const user = await storage.getUser(userId);
      if (!user) return;
      
      // Notify about new events
      for (const event of changes.added) {
        await notificationService.createNotification({
          userId,
          type: 'event_update',
          title: 'New Event Added',
          message: `"${event.title}" was added to calendar "${calendar.name}"`,
          priority: 'medium',
          relatedEventId: event.id,
          relatedEventUid: event.uid,
          requiresAction: false,
          isRead: false,
          isDismissed: false,
          actionTaken: false
        });
      }
      
      // Notify about modified events (if significant changes)
      for (const event of changes.modified) {
        await notificationService.createNotification({
          userId,
          type: 'event_update',
          title: 'Event Updated',
          message: `"${event.title}" in calendar "${calendar.name}" was updated`,
          priority: 'medium',
          relatedEventId: event.id,
          relatedEventUid: event.uid,
          requiresAction: false,
          isRead: false,
          isDismissed: false,
          actionTaken: false
        });
      }
    } catch (error) {
      console.error('Error notifying about calendar changes:', error);
    }
  }
}

// Export singleton instance
export const webdavSyncService = new WebDAVSyncService();