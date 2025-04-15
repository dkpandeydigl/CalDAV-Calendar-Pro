/**
 * Client Sync Service
 * 
 * This service handles synchronization between the client-side IndexedDB
 * and the server. It implements both push and pull synchronization for
 * all entity types.
 */

import { Calendar, Event, User, ServerConnection, CalendarSharing, SmtpConfig, Notification } from '@shared/schema';
import { indexedDBService } from './indexeddb-service';
import { apiRequest } from './queryClient';

interface SyncOptions {
  forceFullSync?: boolean;
  entities?: ('users' | 'calendars' | 'events' | 'serverConnections' | 'calendarSharings' | 'smtpConfigs' | 'notifications')[];
}

interface SyncSummary {
  success: boolean;
  timestamp: Date;
  entities: {
    users?: { pushed: number; pulled: number; errors: number };
    calendars?: { pushed: number; pulled: number; errors: number };
    events?: { pushed: number; pulled: number; errors: number };
    serverConnections?: { pushed: number; pulled: number; errors: number };
    calendarSharings?: { pushed: number; pulled: number; errors: number };
    smtpConfigs?: { pushed: number; pulled: number; errors: number };
    notifications?: { pushed: number; pulled: number; errors: number };
  };
  error?: string;
}

class ClientSyncService {
  private static instance: ClientSyncService;
  private userId: number | null = null;
  private syncInProgress = false;
  private lastSyncTime: Date | null = null;
  private syncListeners: ((summary: SyncSummary) => void)[] = [];

  private constructor() {}

  // Singleton pattern
  public static getInstance(): ClientSyncService {
    if (!ClientSyncService.instance) {
      ClientSyncService.instance = new ClientSyncService();
    }
    return ClientSyncService.instance;
  }

  // Set the current user ID for sync operations
  setUserId(userId: number | null): void {
    this.userId = userId;
  }

  // Get last sync time
  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  // Check if sync is in progress
  isSyncInProgress(): boolean {
    return this.syncInProgress;
  }

  // Add a sync listener
  addSyncListener(listener: (summary: SyncSummary) => void): () => void {
    this.syncListeners.push(listener);
    return () => {
      this.syncListeners = this.syncListeners.filter(l => l !== listener);
    };
  }

  // Trigger sync listeners
  private triggerSyncListeners(summary: SyncSummary): void {
    for (const listener of this.syncListeners) {
      try {
        listener(summary);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    }
  }

  // Start a full sync operation
  async syncAll(options: SyncOptions = {}): Promise<SyncSummary> {
    if (!this.userId) {
      return {
        success: false,
        timestamp: new Date(),
        entities: {},
        error: 'No user ID set for synchronization'
      };
    }

    if (this.syncInProgress) {
      return {
        success: false,
        timestamp: new Date(),
        entities: {},
        error: 'Sync already in progress'
      };
    }

    this.syncInProgress = true;
    console.log(`Starting full sync for user ID ${this.userId}`);

    const summary: SyncSummary = {
      success: true,
      timestamp: new Date(),
      entities: {}
    };

    try {
      // Determine which entities to sync
      const entitiesToSync = options.entities || [
        'users', 'calendars', 'events', 'serverConnections', 
        'calendarSharings', 'smtpConfigs', 'notifications'
      ];

      // Sync user data if needed
      if (entitiesToSync.includes('users')) {
        const userResult = await this.syncUser(this.userId);
        summary.entities.users = userResult;
      }

      // Sync server connections if needed
      if (entitiesToSync.includes('serverConnections')) {
        const connectionResult = await this.syncServerConnections(this.userId);
        summary.entities.serverConnections = connectionResult;
      }

      // Sync SMTP config if needed
      if (entitiesToSync.includes('smtpConfigs')) {
        const smtpResult = await this.syncSmtpConfig(this.userId);
        summary.entities.smtpConfigs = smtpResult;
      }

      // Sync calendars if needed
      if (entitiesToSync.includes('calendars')) {
        const calendarResult = await this.syncCalendars(this.userId);
        summary.entities.calendars = calendarResult;
      }

      // Sync calendar sharings if needed
      if (entitiesToSync.includes('calendarSharings')) {
        const sharingResult = await this.syncCalendarSharings(this.userId);
        summary.entities.calendarSharings = sharingResult;
      }

      // Sync events if needed
      if (entitiesToSync.includes('events')) {
        const eventResult = await this.syncEvents(this.userId);
        summary.entities.events = eventResult;
      }

      // Sync notifications if needed
      if (entitiesToSync.includes('notifications')) {
        const notificationResult = await this.syncNotifications(this.userId);
        summary.entities.notifications = notificationResult;
      }

      // Update last sync time
      this.lastSyncTime = new Date();
      console.log(`Sync completed successfully at ${this.lastSyncTime.toISOString()}`);

      return summary;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Sync error:', errorMessage);
      
      summary.success = false;
      summary.error = errorMessage;
      return summary;
    } finally {
      this.syncInProgress = false;
      this.triggerSyncListeners(summary);
    }
  }

  // Sync user data
  private async syncUser(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing user data for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get user from IndexedDB
      const localUser = await indexedDBService.getUser(userId);
      
      // Pull user data from server
      try {
        const serverUser = await apiRequest<User>('/api/user');
        if (serverUser) {
          // Update local user data if needed
          if (!localUser || this.hasObjectChanges(serverUser, localUser)) {
            await indexedDBService.updateUser(userId, serverUser);
            result.pulled = 1;
          }
        }
      } catch (error) {
        console.error('Error pulling user data:', error);
        result.errors++;
      }

      // We don't push user data to server (it's managed by server-side auth)

      return result;
    } catch (error) {
      console.error('Error syncing user data:', error);
      result.errors++;
      return result;
    }
  }

  // Sync server connections
  private async syncServerConnections(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing server connections for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get local server connection
      const localConnection = await indexedDBService.getServerConnection(userId);
      
      // Pull server connection from server
      try {
        const serverConnection = await apiRequest<ServerConnection>('/api/server-connection');
        if (serverConnection) {
          // Update local connection if needed
          if (!localConnection || this.hasObjectChanges(serverConnection, localConnection)) {
            if (localConnection) {
              await indexedDBService.updateServerConnection(localConnection.id, serverConnection);
            } else {
              await indexedDBService.createServerConnection(serverConnection);
            }
            result.pulled = 1;
          }
        }
      } catch (error) {
        console.error('Error pulling server connection:', error);
        result.errors++;
      }

      // Push local connection to server if it exists and has changes
      if (localConnection && !localConnection.lastSync) {
        try {
          await apiRequest('/api/server-connection', {
            method: 'POST',
            body: JSON.stringify(localConnection)
          });
          result.pushed = 1;
        } catch (error) {
          console.error('Error pushing server connection:', error);
          result.errors++;
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing server connections:', error);
      result.errors++;
      return result;
    }
  }

  // Sync SMTP config
  private async syncSmtpConfig(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing SMTP config for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get local SMTP config
      const localConfig = await indexedDBService.getSmtpConfig(userId);
      
      // Pull SMTP config from server
      try {
        const serverConfig = await apiRequest<SmtpConfig>('/api/smtp-config');
        if (serverConfig) {
          // Update local config if needed
          if (!localConfig || this.hasObjectChanges(serverConfig, localConfig)) {
            if (localConfig) {
              await indexedDBService.updateSmtpConfig(localConfig.id, serverConfig);
            } else {
              await indexedDBService.createSmtpConfig(serverConfig);
            }
            result.pulled = 1;
          }
        }
      } catch (error) {
        console.error('Error pulling SMTP config:', error);
        result.errors++;
      }

      // Push local config to server if it exists and has changes
      if (localConfig && this.shouldPushLocalData(localConfig)) {
        try {
          await apiRequest('/api/smtp-config', {
            method: 'POST',
            body: JSON.stringify(localConfig)
          });
          result.pushed = 1;
        } catch (error) {
          console.error('Error pushing SMTP config:', error);
          result.errors++;
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing SMTP config:', error);
      result.errors++;
      return result;
    }
  }

  // Sync calendars
  private async syncCalendars(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing calendars for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get local calendars
      const localCalendars = await indexedDBService.getCalendars(userId);
      
      // Get shared calendars
      const localSharedCalendars = await indexedDBService.getSharedCalendars(userId);
      
      // Track all local calendar IDs
      const localCalendarIds = new Set(localCalendars.map(c => c.id));
      const localSharedCalendarIds = new Set(localSharedCalendars.map(c => c.id));
      
      // Pull calendars from server
      try {
        const serverCalendars = await apiRequest<Calendar[]>('/api/calendars');
        if (serverCalendars && Array.isArray(serverCalendars)) {
          // Track server calendar IDs
          const serverCalendarIds = new Set(serverCalendars.map(c => c.id));
          
          // Update local calendars with server data
          for (const serverCalendar of serverCalendars) {
            const localCalendar = localCalendars.find(c => c.id === serverCalendar.id);
            
            if (!localCalendar || this.hasObjectChanges(serverCalendar, localCalendar)) {
              if (localCalendar) {
                await indexedDBService.updateCalendar(serverCalendar.id, serverCalendar);
              } else {
                await indexedDBService.createCalendar(serverCalendar);
              }
              result.pulled++;
            }
          }
          
          // Remove calendars that no longer exist on server
          for (const localId of localCalendarIds) {
            if (!serverCalendarIds.has(localId) && !localSharedCalendarIds.has(localId)) {
              await indexedDBService.deleteCalendar(localId);
            }
          }
        }
      } catch (error) {
        console.error('Error pulling calendars:', error);
        result.errors++;
      }
      
      // Pull shared calendars from server
      try {
        const serverSharedCalendars = await apiRequest<Calendar[]>('/api/shared-calendars');
        if (serverSharedCalendars && Array.isArray(serverSharedCalendars)) {
          // Process shared calendars
          for (const serverCalendar of serverSharedCalendars) {
            const localCalendar = localSharedCalendars.find(c => c.id === serverCalendar.id);
            
            if (!localCalendar || this.hasObjectChanges(serverCalendar, localCalendar)) {
              if (localCalendar) {
                await indexedDBService.updateCalendar(serverCalendar.id, serverCalendar);
              } else {
                await indexedDBService.createCalendar(serverCalendar);
              }
              result.pulled++;
            }
          }
        }
      } catch (error) {
        console.error('Error pulling shared calendars:', error);
        result.errors++;
      }

      // Push local calendars to server if they have changes
      for (const localCalendar of localCalendars) {
        if (this.shouldPushLocalData(localCalendar)) {
          try {
            if (localCalendar.id < 0) {
              // New calendar to be created on server
              const createdCalendar = await apiRequest<Calendar>('/api/calendars', {
                method: 'POST',
                body: JSON.stringify(localCalendar)
              });
              
              // Update local calendar with server-generated ID
              if (createdCalendar) {
                // Delete the temporary local calendar
                await indexedDBService.deleteCalendar(localCalendar.id);
                
                // Create a new one with the server ID
                await indexedDBService.createCalendar(createdCalendar);
              }
            } else {
              // Update existing calendar
              await apiRequest(`/api/calendars/${localCalendar.id}`, {
                method: 'PUT',
                body: JSON.stringify(localCalendar)
              });
            }
            result.pushed++;
          } catch (error) {
            console.error(`Error pushing calendar ${localCalendar.id}:`, error);
            result.errors++;
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing calendars:', error);
      result.errors++;
      return result;
    }
  }

  // Sync events
  private async syncEvents(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing events for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get all calendars (owned + shared)
      const ownedCalendars = await indexedDBService.getCalendars(userId);
      const sharedCalendars = await indexedDBService.getSharedCalendars(userId);
      const allCalendars = [...ownedCalendars, ...sharedCalendars];
      
      // Sync events for each calendar
      for (const calendar of allCalendars) {
        // Get local events for this calendar
        const localEvents = await indexedDBService.getEvents(calendar.id);
        
        // Track local event IDs and UIDs
        const localEventIds = new Set(localEvents.map(e => e.id));
        const localEventUids = new Set(localEvents.map(e => e.uid));
        
        // Pull events from server
        try {
          const serverEvents = await apiRequest<Event[]>(`/api/calendars/${calendar.id}/events`);
          if (serverEvents && Array.isArray(serverEvents)) {
            // Track server event IDs and UIDs
            const serverEventIds = new Set(serverEvents.map(e => e.id));
            const serverEventUids = new Set(serverEvents.map(e => e.uid));
            
            // Update local events with server data
            for (const serverEvent of serverEvents) {
              // Look for matching event by ID or UID
              let localEvent = localEvents.find(e => e.id === serverEvent.id);
              if (!localEvent && serverEvent.uid) {
                localEvent = localEvents.find(e => e.uid === serverEvent.uid);
              }
              
              if (!localEvent || this.hasObjectChanges(serverEvent, localEvent)) {
                if (localEvent) {
                  await indexedDBService.updateEvent(localEvent.id, serverEvent);
                } else {
                  await indexedDBService.createEvent(serverEvent);
                }
                result.pulled++;
              }
            }
            
            // Remove events that no longer exist on server
            for (const localEvent of localEvents) {
              const existsOnServer = serverEventIds.has(localEvent.id) || 
                                    (localEvent.uid && serverEventUids.has(localEvent.uid));
              
              if (!existsOnServer && !this.isLocallyCreated(localEvent)) {
                await indexedDBService.deleteEvent(localEvent.id);
              }
            }
          }
        } catch (error) {
          console.error(`Error pulling events for calendar ${calendar.id}:`, error);
          result.errors++;
        }
        
        // Push local events to server if they have changes
        // Only push to owned calendars (not shared calendars)
        if (calendar.userId === userId) {
          for (const localEvent of localEvents) {
            if (this.shouldPushLocalData(localEvent)) {
              try {
                if (localEvent.id < 0 || this.isLocallyCreated(localEvent)) {
                  // New event to be created on server
                  const createdEvent = await apiRequest<Event>(`/api/calendars/${calendar.id}/events`, {
                    method: 'POST',
                    body: JSON.stringify(localEvent)
                  });
                  
                  // Update local event with server-generated ID
                  if (createdEvent) {
                    // Delete the temporary local event
                    await indexedDBService.deleteEvent(localEvent.id);
                    
                    // Create a new one with the server ID
                    await indexedDBService.createEvent(createdEvent);
                  }
                } else {
                  // Update existing event
                  await apiRequest(`/api/calendars/${calendar.id}/events/${localEvent.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(localEvent)
                  });
                }
                result.pushed++;
              } catch (error) {
                console.error(`Error pushing event ${localEvent.id}:`, error);
                result.errors++;
              }
            }
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing events:', error);
      result.errors++;
      return result;
    }
  }

  // Sync calendar sharings
  private async syncCalendarSharings(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing calendar sharings for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get local calendars
      const localCalendars = await indexedDBService.getCalendars(userId);
      
      // Get all local sharings
      const allSharings: CalendarSharing[] = [];
      for (const calendar of localCalendars) {
        const sharings = await indexedDBService.getCalendarSharing(calendar.id);
        allSharings.push(...sharings);
      }
      
      // Track local sharing IDs
      const localSharingIds = new Set(allSharings.map(s => s.id));
      
      // Pull sharings from server
      try {
        const serverSharings = await apiRequest<CalendarSharing[]>('/api/calendar-sharings');
        if (serverSharings && Array.isArray(serverSharings)) {
          // Track server sharing IDs
          const serverSharingIds = new Set(serverSharings.map(s => s.id));
          
          // Update local sharings with server data
          for (const serverSharing of serverSharings) {
            const localSharing = allSharings.find(s => s.id === serverSharing.id);
            
            if (!localSharing || this.hasObjectChanges(serverSharing, localSharing)) {
              if (localSharing) {
                await indexedDBService.updateCalendarSharing(serverSharing.id, serverSharing);
              } else {
                await indexedDBService.shareCalendar(serverSharing);
              }
              result.pulled++;
            }
          }
          
          // Remove sharings that no longer exist on server
          for (const localId of localSharingIds) {
            if (!serverSharingIds.has(localId)) {
              // Only remove if it's not a locally created sharing
              const sharing = allSharings.find(s => s.id === localId);
              if (sharing && !this.isLocallyCreated(sharing)) {
                await indexedDBService.removeCalendarSharing(localId);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error pulling calendar sharings:', error);
        result.errors++;
      }

      // Push local sharings to server if they have changes
      for (const localSharing of allSharings) {
        if (this.shouldPushLocalData(localSharing)) {
          try {
            if (localSharing.id < 0 || this.isLocallyCreated(localSharing)) {
              // New sharing to be created on server
              const createdSharing = await apiRequest<CalendarSharing>('/api/calendar-sharings', {
                method: 'POST',
                body: JSON.stringify(localSharing)
              });
              
              // Update local sharing with server-generated ID
              if (createdSharing) {
                // Delete the temporary local sharing
                await indexedDBService.removeCalendarSharing(localSharing.id);
                
                // Create a new one with the server ID
                await indexedDBService.shareCalendar(createdSharing);
              }
            } else {
              // Update existing sharing
              await apiRequest(`/api/calendar-sharings/${localSharing.id}`, {
                method: 'PUT',
                body: JSON.stringify(localSharing)
              });
            }
            result.pushed++;
          } catch (error) {
            console.error(`Error pushing calendar sharing ${localSharing.id}:`, error);
            result.errors++;
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing calendar sharings:', error);
      result.errors++;
      return result;
    }
  }

  // Sync notifications
  private async syncNotifications(userId: number): Promise<{ pushed: number; pulled: number; errors: number }> {
    console.log(`Syncing notifications for user ID ${userId}`);
    const result = { pushed: 0, pulled: 0, errors: 0 };

    try {
      // Get local notifications
      const localNotifications = await indexedDBService.getNotifications(userId);
      
      // Track local notification IDs
      const localNotificationIds = new Set(localNotifications.map(n => n.id));
      
      // Pull notifications from server
      try {
        const serverNotifications = await apiRequest<Notification[]>('/api/notifications');
        if (serverNotifications && Array.isArray(serverNotifications)) {
          // Track server notification IDs
          const serverNotificationIds = new Set(serverNotifications.map(n => n.id));
          
          // Update local notifications with server data
          for (const serverNotification of serverNotifications) {
            const localNotification = localNotifications.find(n => n.id === serverNotification.id);
            
            if (!localNotification || this.hasObjectChanges(serverNotification, localNotification)) {
              if (localNotification) {
                await indexedDBService.markNotificationRead(serverNotification.id);
              } else {
                await indexedDBService.createNotification(serverNotification);
              }
              result.pulled++;
            }
          }
          
          // Handle notifications that no longer exist on server
          for (const localId of localNotificationIds) {
            if (!serverNotificationIds.has(localId) && !this.isLocallyCreated(localNotifications.find(n => n.id === localId)!)) {
              await indexedDBService.deleteNotification(localId);
            }
          }
        }
      } catch (error) {
        console.error('Error pulling notifications:', error);
        result.errors++;
      }

      // Push notification read status to server
      const readNotifications = localNotifications.filter(n => n.read);
      if (readNotifications.length > 0) {
        try {
          const readIds = readNotifications.map(n => n.id);
          await apiRequest('/api/notifications/mark-read', {
            method: 'POST',
            body: JSON.stringify({ ids: readIds })
          });
          result.pushed += readNotifications.length;
        } catch (error) {
          console.error('Error pushing notification read status:', error);
          result.errors++;
        }
      }

      return result;
    } catch (error) {
      console.error('Error syncing notifications:', error);
      result.errors++;
      return result;
    }
  }

  // Utility methods

  // Check if an object has changes compared to another object
  private hasObjectChanges(obj1: any, obj2: any): boolean {
    // Compare specific fields based on entity type
    if (obj1.hasOwnProperty('updatedAt') && obj2.hasOwnProperty('updatedAt')) {
      // Compare dates for entities with updatedAt field
      const date1 = new Date(obj1.updatedAt).getTime();
      const date2 = new Date(obj2.updatedAt).getTime();
      return date1 !== date2;
    }
    
    if (obj1.hasOwnProperty('lastModified') && obj2.hasOwnProperty('lastModified')) {
      // Compare dates for entities with lastModified field
      const date1 = new Date(obj1.lastModified).getTime();
      const date2 = new Date(obj2.lastModified).getTime();
      return date1 !== date2;
    }
    
    // Default comparison using JSON stringify (not ideal, but works for simple objects)
    return JSON.stringify(obj1) !== JSON.stringify(obj2);
  }

  // Check if an entity was created locally and needs to be pushed to server
  private isLocallyCreated(entity: any): boolean {
    // Negative IDs are used for locally created entities
    return entity.id < 0;
  }

  // Check if local data should be pushed to server
  private shouldPushLocalData(entity: any): boolean {
    // Don't push data that was recently pulled from server
    if (entity._lastPulled && Date.now() - entity._lastPulled < 5000) {
      return false;
    }
    
    // Check for local changes that need to be pushed
    return this.isLocallyCreated(entity) || entity._needsPush;
  }
}

// Export singleton instance
export const clientSyncService = ClientSyncService.getInstance();