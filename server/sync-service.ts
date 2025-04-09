import { storage } from './database-storage';
import { ServerConnection, Calendar, InsertEvent } from '@shared/schema';
import { DAVClient } from 'tsdav';

// Extend the DAVObject interface to include properties we need
interface CalDAVEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
  timezone?: string;
  recurrenceRule?: string;
  attendees?: any[];
  etag?: string;
  url?: string;
  data?: any;
}

interface SyncJob {
  userId: number;
  connection: ServerConnection;
  interval: number; // in seconds
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastSync: Date | null;
  stopRequested: boolean;
  autoSync: boolean;
  sessionCount: number; // Count of active sessions for this user
}

/**
 * SyncService handles background synchronization of calendars for users with active sessions
 * It maintains a collection of sync jobs, one per active user, and handles
 * scheduling, starting, stopping, and configuring synchronization
 */
export class SyncService {
  private jobs: Map<number, SyncJob> = new Map();
  private defaultSyncInterval = 300; // 5 minutes in seconds
  private syncInProgress: Set<number> = new Set();
  private isInitialized = false;

  /**
   * Initialize the sync service - doesn't start any background jobs automatically
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('SyncService already initialized, skipping...');
      return;
    }

    try {
      console.log('Initializing SyncService (session-based)...');
      // We no longer initialize jobs for all users at startup
      // Instead, jobs will be created when users log in
      
      this.isInitialized = true;
      console.log('SyncService initialized with session-based sync management');
    } catch (error) {
      console.error('Failed to initialize SyncService:', error);
    }
  }

  /**
   * Set up a sync job for a user with their server connection
   * This should be called when a user logs in
   */
  async setupSyncForUser(userId: number, connection: ServerConnection) {
    console.log(`Setting up sync for user ID ${userId} (session-based)`);
    
    // Check if there's already a job for this user
    if (this.jobs.has(userId)) {
      // Increment the session count
      const existingJob = this.jobs.get(userId)!;
      existingJob.sessionCount = (existingJob.sessionCount || 0) + 1;
      console.log(`User ID ${userId} now has ${existingJob.sessionCount} active sessions`);
      
      // Job already exists, no need to start a new one
      return true;
    }
    
    // Use the interval from the connection or default
    const interval = connection.syncInterval || this.defaultSyncInterval;
    const autoSync = connection.autoSync ?? true; // Default to true if not specified
    
    // Create a new job
    const job: SyncJob = {
      userId,
      connection,
      interval,
      timer: null,
      running: false,
      lastSync: connection.lastSync ? new Date(connection.lastSync) : null,
      stopRequested: false,
      autoSync,
      sessionCount: 1 // Initialize with 1 session
    };
    
    // Store the job
    this.jobs.set(userId, job);
    
    // Log that we're starting sync for this user
    console.log(`Starting sync for newly logged in user ID ${userId}`);
    
    // Start sync if auto-sync is enabled
    if (autoSync) {
      this.startSync(userId);
      
      // Also trigger an immediate sync to get fresh data
      this.syncNow(userId, { forceRefresh: true });
    }
    
    return true;
  }
  
  /**
   * Handle user logout - decrements session count and stops sync when no sessions remain
   */
  async handleUserLogout(userId: number) {
    const job = this.jobs.get(userId);
    if (!job) {
      // No job for this user, nothing to do
      return false;
    }
    
    // Decrement the session count
    job.sessionCount = Math.max(0, (job.sessionCount || 1) - 1);
    console.log(`User ID ${userId} logged out, ${job.sessionCount} sessions remaining`);
    
    // If no more sessions, stop the sync job
    if (job.sessionCount <= 0) {
      console.log(`No more active sessions for user ID ${userId}, stopping sync job`);
      await this.stopSync(userId);
      
      // Remove the job from the map
      this.jobs.delete(userId);
    }
    
    return true;
  }

  /**
   * Start the sync job for a user
   */
  startSync(userId: number) {
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    // Clear any existing timer
    if (job.timer) {
      clearInterval(job.timer);
    }
    
    console.log(`Starting sync job for user ID ${userId} with interval ${job.interval} seconds`);
    
    // Reset stop requested flag
    job.stopRequested = false;
    
    // Set up the periodic sync
    job.timer = setInterval(async () => {
      // Don't start a new sync if one is already running or if stop was requested
      if (job.running || job.stopRequested) return;
      
      // Run a sync
      await this.syncNow(userId);
    }, job.interval * 1000);
    
    return true;
  }

  /**
   * Stop the sync job for a user
   */
  async stopSync(userId: number) {
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    console.log(`Stopping sync job for user ID ${userId}`);
    
    // Set the stop requested flag
    job.stopRequested = true;
    
    // Clear the timer
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
    
    // Wait for any running sync to finish
    if (job.running) {
      console.log(`Waiting for sync job for user ID ${userId} to finish...`);
      // We'll let it finish naturally and not forcibly terminate
    }
    
    return true;
  }

  /**
   * Request a sync operation - alias for syncNow for backward compatibility
   */
  async requestSync(userId: number, options: { forceRefresh?: boolean, calendarId?: number | null } = {}): Promise<boolean> {
    return this.syncNow(userId, options);
  }
  
  /**
   * Run a sync immediately for a user
   * @param userId - The ID of the user to sync
   * @param options - Optional configuration for the sync operation
   * @param options.forceRefresh - Whether to force a full refresh from the server
   * @param options.calendarId - Optional calendar ID to sync just one calendar
   */
  async syncNow(userId: number, options: { forceRefresh?: boolean, calendarId?: number | null } = {}): Promise<boolean> {
    let job = this.jobs.get(userId);
    
    // If no job exists, try to create one on-demand
    if (!job) {
      console.log(`No sync job found for user ID ${userId}, attempting to create one`);
      
      // Get the server connection for this user
      const connection = await storage.getServerConnection(userId);
      if (!connection) {
        console.log(`Cannot create sync job: No server connection for user ID ${userId}`);
        return false;
      }
      
      // Setup a sync job for this user
      const setupSuccess = await this.setupSyncForUser(userId, connection);
      if (!setupSuccess) {
        console.log(`Failed to set up sync job for user ID ${userId}`);
        return false;
      }
      
      // Get the newly created job
      job = this.jobs.get(userId);
      if (!job) {
        console.log(`Failed to retrieve newly created sync job for user ID ${userId}`);
        return false;
      }
    }
    
    const { forceRefresh = false, calendarId = null } = options;
    console.log(`Sync requested for user ID ${userId} with options:`, { forceRefresh, calendarId });
    
    // If a sync is already in progress, don't start another one
    // Unless forceRefresh is true, in which case we'll proceed anyway
    if ((job.running || this.syncInProgress.has(userId)) && !forceRefresh) {
      console.log(`Sync already in progress for user ID ${userId}`);
      return true; // Return true because the sync is indeed happening
    }
    
    // Mark sync as in progress
    job.running = true;
    this.syncInProgress.add(userId);
    
    try {
      console.log(`Starting sync for user ID ${userId}`);
      
      const { url, username, password } = job.connection;
      
      // Create a new DAV client
      const davClient = new DAVClient({
        serverUrl: url,
        credentials: {
          username,
          password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Try to login and fetch calendars
      await davClient.login();
      
      // Discover calendars
      console.log(`Discovering calendars for user ID ${userId}`);
      
      // If a specific calendar ID was provided, only sync that calendar
      if (calendarId !== null) {
        console.log(`Targeting sync for specific calendar ID: ${calendarId}`);
        
        // Get the calendar from the database
        const calendar = await storage.getCalendar(calendarId);
        if (!calendar) {
          console.warn(`Calendar with ID ${calendarId} not found`);
          return false;
        }
        
        // Make API call to just sync this specific calendar
        try {
          // Fetch all events for this calendar
          // Construct the calendar URL based on how it's stored in our system
          // Uses the calendar URL or falls back to a default path
          const calendarUrl = calendar.url ? 
            (calendar.url.startsWith('http') ? calendar.url : `${url}${calendar.url}`) : 
            `${url}/caldav.php/${username}/${calendar.name}/`;
          console.log(`Syncing calendar at ${calendarUrl}`);
          
          // Force update events for this calendar
          console.log(`Forcing update of events for calendar ${calendar.name} (ID: ${calendarId})`);
          try {
            // First, get events from the CalDAV server for this calendar
            console.log(`Fetching events for calendar ${calendar.name} from ${calendarUrl}`);
            
            // Use the DAVClient to fetch the calendar objects (events)
            const events = await davClient.fetchCalendarObjects({
              calendar: {
                url: calendarUrl
              }
            });
            
            console.log(`Retrieved ${events.length} events from calendar ${calendar.name}`);
            
            // Process the events
            for (const event of events) {
              // Cast DAVObject to our CalDAVEvent interface for type safety
              const caldavEvent = event as unknown as CalDAVEvent;
              
              // Check if we already have this event in our database
              const existingEvent = await storage.getEventByUID(caldavEvent.uid);
              
              // Convert the event data
              const eventData: Partial<InsertEvent> = {
                uid: caldavEvent.uid,
                calendarId: calendar.id,
                title: caldavEvent.summary || 'Untitled Event',
                description: caldavEvent.description,
                location: caldavEvent.location,
                startDate: caldavEvent.startDate,
                endDate: caldavEvent.endDate,
                allDay: caldavEvent.allDay || false,
                timezone: caldavEvent.timezone || 'UTC',
                recurrenceRule: caldavEvent.recurrenceRule,
                attendees: caldavEvent.attendees && caldavEvent.attendees.length > 0 ? 
                  JSON.stringify(caldavEvent.attendees) : null,
                etag: caldavEvent.etag,
                url: caldavEvent.url,
                rawData: caldavEvent.data ? JSON.stringify(caldavEvent.data) : null,
                syncStatus: 'synced',
                lastSyncAttempt: new Date()
              };
              
              if (existingEvent) {
                // Update the existing event
                console.log(`Updating existing event: ${(event as unknown as CalDAVEvent).uid}`);
                await storage.updateEvent(existingEvent.id, eventData as any);
              } else {
                // Create a new event
                console.log(`Creating new event: ${(event as unknown as CalDAVEvent).uid}`);
                await storage.createEvent(eventData as any);
              }
            }
            
            console.log(`Successfully synced ${events.length} events for calendar ${calendar.name}`);
            
            // Also update the calendar sync token/status
            await storage.updateCalendar(calendar.id, {
              syncToken: new Date().toISOString()
            });
          } catch (err) {
            console.error(`Error syncing calendar ${calendar.name}:`, err);
          }
        } catch (err) {
          console.error(`Error in targeted sync for calendar ID ${calendarId}:`, err);
        }
      } else {
        // Normal sync for all calendars
        const davCalendars = await davClient.fetchCalendars();
        console.log(`Retrieved ${davCalendars.length} calendars from CalDAV server`);
        
        // Process each calendar - first update our local calendars database
        for (const davCalendar of davCalendars) {
          try {
            // Check if we have this calendar in our database
            // First try to find by URL
            let localCalendar = await this.findCalendarByUrl(davCalendar.url, userId);
            
            // If we couldn't find it by URL, try to find it by name
            if (!localCalendar) {
              // Get all calendars for this user
              const userCalendars = await storage.getCalendars(userId);
              localCalendar = userCalendars.find(cal => cal.name === davCalendar.displayName);
            }
            
            let calendarId: number;
            
            if (localCalendar) {
              // Update the existing calendar
              console.log(`Updating calendar: ${davCalendar.displayName}`);
              const updated = await storage.updateCalendar(localCalendar.id, {
                name: String(davCalendar.displayName || ''),
                url: String(davCalendar.url || ''),
                syncToken: new Date().toISOString()
              });
              calendarId = localCalendar.id;
            } else {
              // Create a new calendar
              console.log(`Creating new calendar: ${davCalendar.displayName}`);
              // Use default color since DAVCalendar doesn't have a color property
              const calendarColor = '#3788d8';
                
              const newCalendar = await storage.createCalendar({
                name: String(davCalendar.displayName || ''),
                color: calendarColor,
                userId,
                url: String(davCalendar.url || ''),
                syncToken: new Date().toISOString(),
                enabled: true,
                isPrimary: false,
                isLocal: false
              });
              calendarId = newCalendar.id;
            }
            
            // Now fetch events for this calendar
            console.log(`Fetching events for calendar ${davCalendar.displayName} from ${davCalendar.url}`);
            
            try {
              // Use the DAVClient to fetch the calendar objects (events)
              const events = await davClient.fetchCalendarObjects({
                calendar: davCalendar
              });
              
              console.log(`Retrieved ${events.length} events from calendar ${davCalendar.displayName}`);
              
              // Process the events
              for (const event of events) {
                try {
                  // Cast DAVObject to our CalDAVEvent interface for type safety
                  const caldavEvent = event as unknown as CalDAVEvent;
                  
                  // Check if we already have this event in our database
                  const existingEvent = await storage.getEventByUID(caldavEvent.uid);
                  
                  // Convert the event data
                  const eventData: Partial<InsertEvent> = {
                    uid: caldavEvent.uid,
                    calendarId,
                    title: caldavEvent.summary || 'Untitled Event',
                    description: caldavEvent.description,
                    location: caldavEvent.location,
                    startDate: caldavEvent.startDate,
                    endDate: caldavEvent.endDate,
                    allDay: caldavEvent.allDay || false,
                    timezone: caldavEvent.timezone || 'UTC',
                    recurrenceRule: caldavEvent.recurrenceRule,
                    attendees: caldavEvent.attendees && caldavEvent.attendees.length > 0 ? 
                      JSON.stringify(caldavEvent.attendees) : null,
                    etag: caldavEvent.etag,
                    url: caldavEvent.url,
                    rawData: caldavEvent.data ? JSON.stringify(caldavEvent.data) : null,
                    syncStatus: 'synced',
                    lastSyncAttempt: new Date()
                  };
                  
                  if (existingEvent) {
                    // Update the existing event
                    console.log(`Updating existing event: ${caldavEvent.uid}`);
                    await storage.updateEvent(existingEvent.id, eventData as any);
                  } else {
                    // Create a new event
                    console.log(`Creating new event: ${caldavEvent.uid}`);
                    await storage.createEvent(eventData as any);
                  }
                } catch (error) {
                  console.error(`Error processing event:`, error);
                }
              }
              
              console.log(`Successfully synced ${events.length} events for calendar ${davCalendar.displayName}`);
            } catch (error) {
              console.error(`Error fetching events for calendar ${davCalendar.displayName}:`, error);
            }
          } catch (error) {
            console.error(`Error processing calendar ${davCalendar.displayName}:`, error);
          }
        }
      }
      
      // Store the time of the sync
      const syncTime = new Date();
      
      // Update connection status
      await storage.updateServerConnection(job.connection.id, {
        status: 'connected',
        lastSync: syncTime
      });
      
      // Update the job's last sync time
      job.lastSync = syncTime;
      
      console.log(`Sync completed for user ID ${userId}`);
      return true;
    } catch (error) {
      console.error(`Sync failed for user ID ${userId}:`, error);
      
      // Update connection status
      await storage.updateServerConnection(job.connection.id, {
        status: 'error'
      });
      
      return false;
    } finally {
      // Mark sync as no longer in progress
      job.running = false;
      this.syncInProgress.delete(userId);
    }
  }

  /**
   * Helper method to find a calendar by URL
   * @param url The URL of the calendar to find
   * @param userId The user ID to limit the search to
   * @returns The calendar if found, undefined otherwise
   */
  private async findCalendarByUrl(url: string, userId: number): Promise<Calendar | undefined> {
    const calendars = await storage.getCalendars(userId);
    
    // Check for exact match
    const exactMatch = calendars.find(cal => cal.url === url);
    if (exactMatch) {
      return exactMatch;
    }
    
    // No match found
    return undefined;
  }
  
  /**
   * Update the sync interval for a user
   */
  async updateSyncInterval(userId: number, interval: number) {
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    console.log(`Updating sync interval for user ID ${userId} to ${interval} seconds`);
    
    // Update the interval
    job.interval = interval;
    
    // If sync is running, restart it with the new interval
    if (job.timer && job.autoSync) {
      this.stopSync(userId);
      this.startSync(userId);
    }
    
    return true;
  }

  /**
   * Update whether auto-sync is enabled for a user
   */
  async updateAutoSync(userId: number, autoSync: boolean) {
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    console.log(`Updating auto-sync for user ID ${userId} to ${autoSync}`);
    
    // Update the auto-sync setting
    job.autoSync = autoSync;
    
    // Start or stop sync based on the new setting
    if (autoSync) {
      this.startSync(userId);
    } else {
      this.stopSync(userId);
    }
    
    // Update in database
    await storage.updateServerConnection(job.connection.id, {
      autoSync
    });
    
    return true;
  }

  /**
   * Get the sync status for a user
   */
  getSyncStatus(userId: number) {
    const job = this.jobs.get(userId);
    if (!job) {
      return {
        configured: false,
        syncing: false,
        lastSync: null,
        interval: this.defaultSyncInterval,
        inProgress: false,
        autoSync: true
      };
    }
    
    return {
      configured: true,
      syncing: job.timer !== null,
      lastSync: job.lastSync ? job.lastSync.toISOString() : null,
      interval: job.interval,
      inProgress: job.running,
      autoSync: job.autoSync
    };
  }

  /**
   * Shut down all sync jobs, used when the server is shutting down
   */
  shutdownAll() {
    console.log('Shutting down all sync jobs...');
    const userIds = Array.from(this.jobs.keys());
    
    for (const userId of userIds) {
      this.stopSync(userId);
    }
    
    console.log(`Shut down ${userIds.length} sync jobs`);
  }
}

export const syncService = new SyncService();

/**
 * Initialize the sync service
 * Call this on server startup
 */
export const initializeSyncService = async () => {
  await syncService.initialize();
};