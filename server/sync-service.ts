import { storage } from './database-storage';
import { ServerConnection, Calendar, InsertEvent } from '@shared/schema';
import { DAVClient } from 'tsdav';
import * as icalUtils from './ical-utils';
import * as nodeIcal from 'node-ical';

// Define attendee interface
interface CalDAVAttendee {
  email: string;
  name?: string;
  role?: string;
  status?: string;
  type?: string;
  scheduleStatus?: string;
}

// Define resource interface
interface CalDAVResource {
  name: string;
  adminEmail: string;
  type?: string;
}

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
  attendees?: CalDAVAttendee[];
  resources?: CalDAVResource[];
  etag?: string;
  url?: string;
  data?: any; // Original ICS data string
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
  private globalSyncTimer: NodeJS.Timeout | null = null;
  private globalSyncInterval = 300; // 5 minutes in seconds
  private lastGlobalSync: Date | null = null;

  /**
   * Clean up sync jobs for users who are no longer active
   * This ensures we're not wasting resources on sync jobs for users without active sessions
   * @param activeUserIds The list of user IDs with active sessions
   */
  private cleanupInactiveSyncJobs(activeUserIds: number[]) {
    // Create a Set for faster lookups
    const activeUserIdSet = new Set(activeUserIds);
    
    // Get all user IDs that have sync jobs
    const jobUserIds = Array.from(this.jobs.keys());
    
    // Log the current state for debugging
    console.log(`Session-based sync: Found ${activeUserIds.length} active users and ${jobUserIds.length} sync jobs`);
    
    // Find users with jobs but no active sessions
    const inactiveUserIds = jobUserIds.filter(userId => !activeUserIdSet.has(userId));
    
    if (inactiveUserIds.length > 0) {
      console.log(`Found ${inactiveUserIds.length} inactive users with sync jobs to clean up`);
      
      // Stop sync jobs for all inactive users
      for (const userId of inactiveUserIds) {
        console.log(`Cleaning up sync job for inactive user ID ${userId}`);
        this.stopSync(userId);
        this.jobs.delete(userId);
      }
    } else {
      console.log(`Session-based sync: No inactive users found, all ${jobUserIds.length} sync jobs are for active users`);
    }
  }

  /**
   * Initialize the sync service with both session-based and automatic background sync
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('SyncService already initialized, skipping...');
      return;
    }

    try {
      console.log('Initializing SyncService with automatic background sync...');
      // We'll initialize both session-based syncing and a background global sync
      
      // Set up a background timer to periodically check for external changes
      // This ensures changes made in external clients (like Thunderbird) are detected
      // even if no specific user session requests a sync
      this.setupGlobalSyncTimer();
      
      this.isInitialized = true;
      console.log('SyncService initialized with background sync enabled');
    } catch (error) {
      console.error('Failed to initialize SyncService:', error);
    }
  }
  
  /**
   * Set up a global timer to periodically sync all active calendars
   * This ensures external changes are detected even without user activity
   */
  private setupGlobalSyncTimer() {
    // Clear any existing timer
    if (this.globalSyncTimer) {
      clearInterval(this.globalSyncTimer);
    }
    
    console.log(`Setting up global sync timer with interval ${this.globalSyncInterval} seconds`);
    
    // Set up the periodic global sync
    this.globalSyncTimer = setInterval(async () => {
      await this.runGlobalSync();
    }, this.globalSyncInterval * 1000);
  }
  
  /**
   * Run a global sync operation for all active users
   * This is triggered periodically to ensure external changes are detected
   * Only syncs for users with active sessions (Option A)
   */
  private async runGlobalSync() {
    try {
      console.log('Running global sync to check for external changes...');
      this.lastGlobalSync = new Date();
      
      // Get user IDs with active sessions - Option A implementation
      const activeUserIds = await storage.getActiveUserIds();
      
      if (!activeUserIds || activeUserIds.length === 0) {
        console.log('No active user sessions found, skipping global sync');
        return;
      }
      
      console.log(`Found ${activeUserIds.length} active user sessions for background sync`);
      
      // Clean up sync jobs for users who are no longer active
      this.cleanupInactiveSyncJobs(activeUserIds);
      
      // Get server connections, but only for users with active sessions
      const connections = await storage.getAllServerConnections();
      
      if (!connections || connections.length === 0) {
        console.log('No active server connections found, skipping global sync');
        return;
      }
      
      // Filter connections to only include users with active sessions
      const activeConnections = connections.filter(conn => 
        activeUserIds.includes(conn.userId)
      );
      
      console.log(`Found ${connections.length} server connections, ${activeConnections.length} with active sessions`);
      
      // For each active connection, perform a sync
      for (const connection of activeConnections) {
        // Skip connections that are already being synced
        if (this.syncInProgress.has(connection.userId)) {
          console.log(`Sync already in progress for user ID ${connection.userId}, skipping`);
          continue;
        }
        
        // Run a sync for this user
        console.log(`Global sync: checking updates for active user ID ${connection.userId}`);
        await this.syncNow(connection.userId, { 
          isGlobalSync: true, 
          forceRefresh: false 
        });
      }
      
      console.log('Global sync completed');
    } catch (error) {
      console.error('Error during global sync:', error);
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
  async requestSync(userId: number, options: { 
    forceRefresh?: boolean, 
    calendarId?: number | null,
    preserveLocalEvents?: boolean
  } = {}): Promise<boolean> {
    return this.syncNow(userId, options);
  }
  
  /**
   * Run a sync immediately for a user
   * @param userId - The ID of the user to sync
   * @param options - Optional configuration for the sync operation
   * @param options.forceRefresh - Whether to force a full refresh from the server
   * @param options.calendarId - Optional calendar ID to sync just one calendar
   * @param options.isGlobalSync - Whether this sync is triggered by the global sync timer (not a user request)
   */
  async syncNow(userId: number, options: { 
    forceRefresh?: boolean, 
    calendarId?: number | null, 
    isGlobalSync?: boolean,
    preserveLocalEvents?: boolean,
    preserveLocalDeletes?: boolean 
  } = {}): Promise<boolean> {
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
    
    const { forceRefresh = false, calendarId = null, isGlobalSync = false, preserveLocalEvents = false, preserveLocalDeletes = false } = options;
    console.log(`Sync requested for user ID ${userId} with options:`, { forceRefresh, calendarId, isGlobalSync, preserveLocalEvents, preserveLocalDeletes });
    
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
              let caldavEvent: CalDAVEvent | null = null;
              
              // Check if this event has raw data to parse with our enhanced parser
              if (event.data) {
                // Use our improved parser to parse the raw ICS data
                caldavEvent = this.parseRawICSData(event.data, event.etag, event.url);
                if (caldavEvent) {
                  console.log(`Successfully parsed external event: ${caldavEvent.summary}`);
                }
              }
              
              // Fall back to the default tsdav parsing if our improved parser failed
              if (!caldavEvent) {
                // Cast DAVObject to our CalDAVEvent interface for type safety
                caldavEvent = event as unknown as CalDAVEvent;
                
                // Generate UID if missing, before we skip anything
                if (!caldavEvent.uid) {
                  console.warn(`Event is missing a UID, generating one for: ${caldavEvent.summary || 'Untitled Event'}`);
                  caldavEvent.uid = `event-${Date.now()}-${Math.random().toString(36).substring(2, 10)}@caldavclient.local`;
                }
                
                // Skip events that don't have essential data (summary, dates)
                // Check if this is just a placeholder or empty event
                const isEmptyEvent = !caldavEvent.summary && (!caldavEvent.startDate || isNaN(caldavEvent.startDate.getTime()));
                const hasValidDates = caldavEvent.startDate && !isNaN(caldavEvent.startDate.getTime()) && 
                                      caldavEvent.endDate && !isNaN(caldavEvent.endDate.getTime());
                
                // Only skip completely empty events - be more lenient with events from other clients
                if (isEmptyEvent && !hasValidDates) {
                  console.log(`Skipping completely empty event with no title and no valid dates: ${caldavEvent.uid}`);
                  continue; // Skip to the next event
                }
                
                // For events with no summary but valid dates, assign a default title
                if (!caldavEvent.summary && hasValidDates) {
                  console.log(`Event has valid dates but no title, assigning default title: ${caldavEvent.uid}`);
                  caldavEvent.summary = 'Untitled Event';
                }
              }
              
              // Check if this event was recently deleted
              // If preserveLocalDeletes flag is set, we need to check if this event exists locally
              // If it doesn't exist locally, it might have been deleted and we should skip it
              if (options.preserveLocalDeletes && caldavEvent.uid) {
                const existingEvent = await storage.getEventByUID(caldavEvent.uid);
                if (!existingEvent) {
                  console.log(`Skipping event with UID ${caldavEvent.uid} because it doesn't exist locally and preserveLocalDeletes=true`);
                  
                  // If this event is on the server but not locally, we should delete it from the server
                  // to ensure local deletions are propagated to the server during sync operations
                  if (caldavEvent.url && connection) {
                    try {
                      console.log(`Attempting to delete event ${caldavEvent.uid} from server during sync`);
                      
                      // Create a DAV client with headers
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
                      
                      // Delete the event using the URL from the caldavEvent
                      await davClient.deleteCalendarObject({
                        calendarObject: {
                          url: caldavEvent.url,
                          etag: caldavEvent.etag || ''
                        }
                      });
                      
                      console.log(`Successfully deleted event ${caldavEvent.uid} from server during sync`);
                    } catch (deleteError) {
                      console.error(`Failed to delete event ${caldavEvent.uid} from server during sync:`, deleteError);
                      // Continue anyway - we'll skip this event during this sync
                    }
                  }
                  
                  continue; // Skip to next event
                }
              }
              
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
                resources: caldavEvent.resources && caldavEvent.resources.length > 0 ?
                  JSON.stringify(caldavEvent.resources) : null,
                etag: caldavEvent.etag,
                url: caldavEvent.url,
                rawData: caldavEvent.data ? JSON.stringify(caldavEvent.data) : null,
                syncStatus: 'synced',
                lastSyncAttempt: new Date()
              };
              
              if (existingEvent) {
                // Check if this event is pending update (modified locally)
                // If so, we shouldn't overwrite it with server data
                if (existingEvent.syncStatus === 'pending') {
                  console.log(`Skipping update for event "${existingEvent.title}" (ID: ${existingEvent.id}) because it has pending changes`);
                  // Just update the etag to avoid sync conflicts, but preserve local changes
                  if (caldavEvent.etag && caldavEvent.etag !== existingEvent.etag) {
                    await storage.updateEvent(existingEvent.id, { 
                      etag: caldavEvent.etag,
                      // Keep the syncStatus as pending
                      syncStatus: 'pending'
                    });
                  }
                } else {
                  // Update the existing event
                  console.log(`Updating existing event: ${caldavEvent.uid}`);
                  await storage.updateEvent(existingEvent.id, eventData as any);
                }
              } else {
                // Create a new event
                console.log(`Creating new event: ${caldavEvent.uid}`);
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
                  let caldavEvent: CalDAVEvent | null = null;
                  
                  // Check if this event has raw data to parse with our enhanced parser
                  if (event.data) {
                    // Use our improved parser to parse the raw ICS data
                    caldavEvent = this.parseRawICSData(event.data, event.etag, event.url);
                    if (caldavEvent) {
                      console.log(`Successfully parsed external event: ${caldavEvent.summary}`);
                    }
                  }
                  
                  // Fall back to the default tsdav parsing if our improved parser failed
                  if (!caldavEvent) {
                    // Cast DAVObject to our CalDAVEvent interface for type safety
                    caldavEvent = event as unknown as CalDAVEvent;
                    
                    // Generate UID if missing, before we skip anything
                    if (!caldavEvent.uid) {
                      console.warn(`Event is missing a UID, generating one for: ${caldavEvent.summary || 'Untitled Event'}`);
                      caldavEvent.uid = `event-${Date.now()}-${Math.random().toString(36).substring(2, 10)}@caldavclient.local`;
                    }
                    
                    // Skip events that don't have essential data (summary, dates)
                    // Check if this is just a placeholder or empty event
                    const isEmptyEvent = !caldavEvent.summary && (!caldavEvent.startDate || isNaN(caldavEvent.startDate.getTime()));
                    const hasValidDates = caldavEvent.startDate && !isNaN(caldavEvent.startDate.getTime()) && 
                                          caldavEvent.endDate && !isNaN(caldavEvent.endDate.getTime());
                    
                    // Only skip completely empty events - be more lenient with events from other clients
                    if (isEmptyEvent && !hasValidDates) {
                      console.log(`Skipping completely empty event with no title and no valid dates: ${caldavEvent.uid}`);
                      continue; // Skip to the next event
                    }
                    
                    // For events with no summary but valid dates, assign a default title
                    if (!caldavEvent.summary && hasValidDates) {
                      console.log(`Event has valid dates but no title, assigning default title: ${caldavEvent.uid}`);
                      caldavEvent.summary = 'Untitled Event';
                    }
                  }
                  
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
                    resources: caldavEvent.resources && caldavEvent.resources.length > 0 ?
                      JSON.stringify(caldavEvent.resources) : null,  
                    etag: caldavEvent.etag,
                    url: caldavEvent.url,
                    rawData: caldavEvent.data ? JSON.stringify(caldavEvent.data) : null,
                    syncStatus: 'synced',
                    lastSyncAttempt: new Date()
                  };
                  
                  if (existingEvent) {
                    // Check if this event is pending update (modified locally)
                    // If so, we shouldn't overwrite it with server data
                    if (existingEvent.syncStatus === 'pending') {
                      console.log(`Skipping update for event "${existingEvent.title}" (ID: ${existingEvent.id}) because it has pending changes`);
                      // Just update the etag to avoid sync conflicts, but preserve local changes
                      if (caldavEvent.etag && caldavEvent.etag !== existingEvent.etag) {
                        await storage.updateEvent(existingEvent.id, { 
                          etag: caldavEvent.etag,
                          // Keep the syncStatus as pending
                          syncStatus: 'pending'
                        });
                      }
                    } else {
                      // Normal update for events without pending changes
                      console.log(`Updating existing event: ${caldavEvent.uid}`);
                      
                      // Preserve recurrence settings from the existing event if they are present
                      // but missing in the incoming data
                      if (!eventData.recurrenceRule && existingEvent.recurrenceRule) {
                        console.log(`Preserving existing recurrence rule for event ${existingEvent.id}`);
                        eventData.recurrenceRule = existingEvent.recurrenceRule;
                      }
                      
                      await storage.updateEvent(existingEvent.id, eventData as any);
                    }
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
      
      // After downloading events from the server, let's push any local events to the server
      console.log(`Now pushing local events to server for user ID ${userId}`);
      await this.pushLocalEvents(userId, calendarId ? calendarId : undefined);
      
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
   * Parse raw ICS data into a CalDAVEvent object
   * This improves compatibility with other CalDAV clients by using node-ical for parsing
   * @param icsData The raw ICS data as a string
   * @param etag The ETag header value from the server
   * @param url The URL of the event
   */
  private parseRawICSData(icsData: string, etag?: string, url?: string): CalDAVEvent | null {
    try {
      // First, preprocess the ICS data to fix common issues before parsing
      if (!icsData) {
        console.warn('Empty ICS data provided');
        return null;
      }
      
      // Preprocess: Fix SCHEDULE-STATUS problems
      if (icsData.includes('SCHEDULE-STATUS')) {
        console.log('Found SCHEDULE-STATUS in raw ICS data - preprocessing...');
        
        // 1. Fix RRULE lines that contain SCHEDULE-STATUS
        const rruleRegex = /RRULE:[^\r\n]*/g;
        icsData = icsData.replace(rruleRegex, (match) => {
          if (match.includes('SCHEDULE-STATUS')) {
            console.log('Fixing RRULE with SCHEDULE-STATUS');
            // Extract just the valid RRULE parameters
            const parts = match.substring(6).split(';'); // Remove RRULE: prefix
            const validParams = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST', 'BYSETPOS'];
            const validParts = parts.filter(part => {
              if (!part.includes('=')) return false;
              const paramName = part.split('=')[0];
              return validParams.includes(paramName);
            });
            return 'RRULE:' + validParts.join(';');
          }
          return match;
        });
        
        // 2. Fix broken ATTENDEE lines with line breaks or continuation
        icsData = icsData.replace(/ATTENDEE[^:]*\r?\n\s+[^:]*:/g, (match) => {
          return match.replace(/\r?\n\s+/g, '');
        });
      }
      
      // Try to parse the ICS data with node-ical
      let parsedCal;
      try {
        const parseICS = (nodeIcal as any).default?.parseICS || nodeIcal.parseICS;
        parsedCal = parseICS(icsData);
      } catch (parsingError) {
        console.error('Error parsing ICS data with node-ical:', parsingError);
        // Try more aggressive preprocessing if parsing fails
        try {
          const fixedIcsData = this.applyAggressiveFixesToICS(icsData);
          const parseICS = (nodeIcal as any).default?.parseICS || nodeIcal.parseICS;
          parsedCal = parseICS(fixedIcsData);
        } catch (secondError) {
          console.error('Error parsing ICS data even after fixes:', secondError);
          return null;
        }
      }
      
      // Find the first VEVENT in the parsed calendar
      if (!parsedCal) {
        console.warn('No valid calendar found in ICS data');
        return null;
      }
      
      const eventKey = Object.keys(parsedCal).find(key => 
        parsedCal[key]?.type === 'VEVENT'
      );
      
      if (!eventKey || !parsedCal[eventKey]) {
        console.warn('No valid VEVENT found in ICS data');
        return null;
      }
      
      const event = parsedCal[eventKey];
      
      // Process event dates
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      let allDay = false;
      
      // Handle start date
      if (event.start instanceof Date) {
        startDate = event.start;
        
        // Check if it's likely an all-day event (time is midnight)
        const hours = event.start.getHours();
        const minutes = event.start.getMinutes();
        const seconds = event.start.getSeconds();
        
        if (hours === 0 && minutes === 0 && seconds === 0) {
          allDay = true;
        }
      } else if (event.start && typeof event.start === 'object' && 'toJSDate' in event.start) {
        startDate = (event.start as any).toJSDate();
        if ((event.start as any).dateOnly) {
          allDay = true;
        }
      }
      
      // Handle end date
      if (event.end instanceof Date) {
        endDate = event.end;
      } else if (event.end && typeof event.end === 'object' && 'toJSDate' in event.end) {
        endDate = (event.end as any).toJSDate();
      }
      
      // If no end date, derive from start date
      if (!endDate && startDate) {
        endDate = new Date(startDate);
        if (allDay) {
          endDate.setDate(endDate.getDate() + 1);
        } else {
          endDate.setHours(endDate.getHours() + 1);
        }
      }
      
      if (!startDate || !endDate) {
        console.warn('Event has invalid dates');
        return null;
      }
      
      // Process recurrence rules
      let recurrenceRule: string | undefined = undefined;
      try {
        if (event.rrule) {
          if (typeof event.rrule === 'string') {
            recurrenceRule = this.sanitizeRRULE(event.rrule);
          } else if (typeof event.rrule === 'object') {
            recurrenceRule = event.rrule.toString();
            if (recurrenceRule && !recurrenceRule.startsWith('FREQ=')) {
              const rruleMatch = icsData.match(/RRULE:([^\r\n]+)/);
              if (rruleMatch && rruleMatch[1]) {
                recurrenceRule = this.sanitizeRRULE(rruleMatch[1]);
                console.log(`Extracted RRULE from raw ICS data: ${recurrenceRule}`);
              }
            }
          }
        } else {
          // Try to extract from raw data
          const rruleMatch = icsData.match(/RRULE:([^\r\n]+)/);
          if (rruleMatch && rruleMatch[1]) {
            recurrenceRule = this.sanitizeRRULE(rruleMatch[1]);
          }
        }
      } catch (error) {
        console.error('Error processing recurrence rule, setting to undefined:', error);
        recurrenceRule = undefined;
      }
      
      // Process attendees and resources
      let attendees: CalDAVAttendee[] = [];
      let resources: CalDAVResource[] = [];
      
      // Create a set to track already processed resource emails to avoid duplicates
      const resourceEmails = new Set<string>();
      
      try {
        // First, extract all resources from the ICS data to prevent duplication
        const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
        const resourceMatches = Array.from(icsData.matchAll(resourceRegex));
        
        // Process all resources first
        if (resourceMatches && resourceMatches.length > 0) {
          console.log(`RESOURCE EXTRACTION: Found ${resourceMatches.length} resources in ICS data`);
          
          for (const match of resourceMatches) {
            const fullLine = match[0]; // The complete ATTENDEE line 
            const email = match[1]; // The captured email group
            
            // Skip if already processed
            if (resourceEmails.has(email)) {
              continue;
            }
            
            // Add to our set for deduplication
            resourceEmails.add(email);
            
            // Extract resource name from CN
            const cnMatch = fullLine.match(/CN=([^;:]+)/);
            const name = cnMatch ? cnMatch[1].trim() : `Resource`;
            
            // Extract resource type
            const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
            const resourceTypeValue = typeMatch ? typeMatch[1].trim() : 'chairs';
            
            resources.push({
              name: name,
              adminEmail: email,
              type: resourceTypeValue
            });
            
            console.log(`Added resource: ${name} (${email}) of type ${resourceTypeValue}`);
          }
        }
        
        // Now process attendees from node-ical parsing
        if (event.attendees && Array.isArray(event.attendees)) {
          // Filter out any attendees that are actually resources
          attendees = event.attendees.filter((att: any) => {
            if (typeof att === 'object' && att.email) {
              return !resourceEmails.has(att.email);
            }
            return true;
          });
          console.log(`Using ${attendees.length} attendees from event.attendees after filtering out resources`);
        } else if (event.attendee) {
          const rawAttendees = Array.isArray(event.attendee) ? event.attendee : [event.attendee];
          
          // Process each attendee and filter out resources
          for (const attendee of rawAttendees) {
            // Skip if no value or missing email
            if (!attendee.val || !attendee.val.includes('mailto:')) {
              continue;
            }
            
            // Extract email
            const email = attendee.val.replace('mailto:', '');
            
            // Skip this attendee if it's already in our resources set
            if (resourceEmails.has(email)) {
              console.log(`Skipping attendee ${email} as it's already processed as a resource`);
              continue;
            }
            
            // Check if it's a resource or a regular attendee
            // More aggressive resource detection to prevent "Unknown (No email)" attendees
            const isResource = attendee.params && (
                attendee.params.CUTYPE === 'RESOURCE' || 
                (attendee.params.ROLE && attendee.params.ROLE === 'NON-PARTICIPANT') ||
                (email.includes('projector') || email.includes('room') || email.includes('chair')) ||
                (attendee.params.CN && 
                  (attendee.params.CN.includes('Projector') || 
                   attendee.params.CN.includes('Room') ||
                   attendee.params.CN.includes('Chair')))
            );
            
            if (isResource) {
              // Add to our set for deduplication
              resourceEmails.add(email);
              
              // Process as resource
              const name = attendee.params.CN || email.split('@')[0];
              const resourceType = attendee.params['X-RESOURCE-TYPE'] || '';
              
              resources.push({
                name: name,
                adminEmail: email,
                type: resourceType
              });
              
              console.log(`Added node-ical resource: ${name} (${email}) of type ${resourceType}`);
            } else {
              // Process as regular attendee
              const name = attendee.params?.CN;
              const role = attendee.params?.ROLE || 'REQ-PARTICIPANT';
              const status = attendee.params?.PARTSTAT || 'NEEDS-ACTION';
              const scheduleStatus = attendee.params?.['SCHEDULE-STATUS'];
              
              attendees.push({
                email,
                name,
                role,
                status,
                scheduleStatus
              });
              
              console.log(`Added node-ical attendee: ${name || email} (${email})`);
            }
          }
        } else {
          // Fallback: Extract from raw ICS data
          const normalizedIcsData = icsData.replace(/ATTENDEE[^:]*\r?\n\s+[^:]*:/g, line => {
            return line.replace(/\r?\n\s+/g, '');
          });
          
          // First, try to capture multi-line attendee entries
          const lines = normalizedIcsData.split(/\r?\n/);
          let combinedAttendeeLines: string[] = [];
          
          // Process line by line to handle broken formats
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('ATTENDEE')) {
              // Start of an attendee line
              let fullLine = line;
              
              // Look ahead for continuation lines (starting with spaces or containing mailto: without ATTENDEE)
              let j = i + 1;
              while (j < lines.length && 
                    (lines[j].startsWith(' ') || 
                     (!lines[j].includes('ATTENDEE') && lines[j].includes('mailto:')))) {
                fullLine += ' ' + lines[j].trim();
                j++;
              }
              
              // Skip the lines we've merged
              i = j - 1;
              
              // Add the combined line
              combinedAttendeeLines.push(fullLine);
            }
          }
          
          // If we didn't find any combined lines, try regular regex matching
          if (combinedAttendeeLines.length === 0) {
            const attendeeMatches = normalizedIcsData.match(/ATTENDEE[^:\r\n]+:[^\r\n]+/g);
            if (attendeeMatches && attendeeMatches.length > 0) {
              combinedAttendeeLines = attendeeMatches;
            }
          }
          
          if (combinedAttendeeLines.length > 0) {
            console.log(`Found ${combinedAttendeeLines.length} attendees/resources in raw ICS data`);
            
            combinedAttendeeLines.forEach(line => {
              // Make sure it has an email
              if (!line.includes('mailto:')) {
                return;
              }
              
              // Try multiple patterns to capture the email since it might be malformed
              let email = '';
              
              // Try standard pattern first
              const emailMatch = line.match(/mailto:([^>\r\n\s]+)/);
              if (emailMatch && emailMatch[1]) {
                email = emailMatch[1];
              }
              
              // If no match, try another common pattern (multiline format)
              if (!email) {
                const altMatch = line.match(/mailto:([^"'\s\r\n]+)/);
                if (altMatch && altMatch[1]) {
                  email = altMatch[1];
                }
              }
              
              // If no match, try to extract just anything that looks like an email
              if (!email) {
                const anyEmailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (anyEmailMatch && anyEmailMatch[1]) {
                  email = anyEmailMatch[1];
                  console.log(`Found fallback email: ${email}`);
                }
              }
              
              if (!email) {
                console.log(`Could not extract email from line: ${line.substring(0, 50)}...`);
                return;
              }
              
              // Clean up weird combined resource types like "dktest@dil.inProjector"
              let cleanedEmail = email;
              if (email.match(/[^@\s]+@[^@\s.]+\.[a-z]+[A-Za-z]+/)) {
                const domainParts = email.split('@');
                if (domainParts.length === 2) {
                  const domain = domainParts[1];
                  // Find the first TLD dot
                  const dotIndex = domain.indexOf('.');
                  if (dotIndex > 0) {
                    // Get just the proper part of the domain
                    const properDomain = domain.substring(0, dotIndex + 3); // +3 to include the dot and 2 char TLD
                    cleanedEmail = `${domainParts[0]}@${properDomain}`;
                    console.log(`Fixed malformed email from ${email} to ${cleanedEmail}`);
                  }
                }
              }
              
              // Log the extracted email for debugging
              console.log(`Processing attendee with email: ${cleanedEmail} from line: ${line.substring(0, 50)}...`);
              
              const nameMatch = line.match(/CN=([^;:]+)/);
              const name = nameMatch ? nameMatch[1] : '';
              
              const roleMatch = line.match(/ROLE=([^;:]+)/);
              const role = roleMatch ? roleMatch[1] : 'REQ-PARTICIPANT';
              
              const statusMatch = line.match(/PARTSTAT=([^;:]+)/);
              const status = statusMatch ? statusMatch[1] : 'NEEDS-ACTION';
              
              const scheduleStatusMatch = line.match(/SCHEDULE-STATUS=([^;:]+)/);
              const scheduleStatus = scheduleStatusMatch ? scheduleStatusMatch[1] : undefined;
              
              if (line.includes('CUTYPE=RESOURCE')) {
                // Process as resource
                const resourceType = line.match(/X-RESOURCE-TYPE=([^;:]+)/) || 
                                    line.match(/RESOURCE-TYPE=([^;:]+)/);
                
                // Extract resource type from malformed emails if needed
                let resourceTypeValue = resourceType ? resourceType[1] : undefined;
                
                // Try to extract resource type from email if it looks malformed
                if (!resourceTypeValue && email !== cleanedEmail) {
                  // The difference should be the resource type appended to the domain
                  const resourceSuffix = email.substring(cleanedEmail.length);
                  if (resourceSuffix) {
                    resourceTypeValue = resourceSuffix;
                    console.log(`Extracted resource type "${resourceSuffix}" from malformed email`);
                  }
                }
                
                resources.push({
                  name: name || 'Unnamed Resource',
                  adminEmail: cleanedEmail, // Use the cleaned email
                  type: resourceTypeValue
                });
              } else {
                // Process as regular attendee
                const attendeeData: CalDAVAttendee = {
                  email: cleanedEmail, // Use the cleaned email
                  name: name || undefined,
                  role,
                  status
                };
                
                if (scheduleStatus) {
                  attendeeData.scheduleStatus = scheduleStatus;
                }
                
                attendees.push(attendeeData);
              }
            });
          }
        }
      } catch (error) {
        console.error('Error processing attendees/resources:', error);
      }
      
      // Determine timezone
      let timezone = 'UTC';
      if (event.timezone) {
        timezone = event.timezone;
      } else if (event.start && (event.start as any).tz) {
        timezone = (event.start as any).tz;
      }
      
      // Final check: Filter out any attendees that might also be resources
      // This ensures no duplicates between attendees and resources
      const filteredAttendees = attendees.filter((att: any) => {
        if (typeof att === 'string') return true;
        if (!att.email) return true;
        
        // Skip if this attendee's email exists in our resource set
        if (resourceEmails.has(att.email)) {
          console.log(`Final filter: Removing ${att.email} from attendees as it's already in resources`);
          return false;
        }
        return true;
      });
      
      console.log(`Final attendees count: ${filteredAttendees.length}, Resources count: ${resources.length}`);
      
      // Create the final CalDAVEvent
      const caldavEvent: CalDAVEvent = {
        uid: event.uid || `auto-generated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        summary: event.summary || 'Untitled Event',
        description: event.description,
        location: event.location,
        startDate,
        endDate,
        allDay,
        timezone,
        recurrenceRule,
        attendees: filteredAttendees.length > 0 ? filteredAttendees : undefined,
        resources: resources.length > 0 ? resources : undefined,
        etag,
        url,
        data: icsData
      };
      
      return caldavEvent;
    } catch (error) {
      console.error('Error parsing ICS data:', error);
      return null;
    }
  }
  
  /**
   * Apply aggressive fixes to ICS data when normal parsing fails
   * This is a last resort to try to salvage unparseable ICS data
   */
  private applyAggressiveFixesToICS(icsData: string): string {
    try {
      console.log('Applying aggressive fixes to ICS data');
      
      // First pass: Identify the structure and critical issues
      const hasStrayAttendee = icsData.includes('\nmailto:') || icsData.includes('\r\nmailto:');
      const hasProjector = icsData.includes('Projector') || icsData.includes('projector');
      const hasRRULE = icsData.includes('RRULE:');
      const hasScheduleStatus = icsData.includes('SCHEDULE-STATUS');
      const hasCombinedEmailResource = icsData.match(/:mailto:[^@\r\n]+@[^@\r\n]+[a-zA-Z]+[^:\r\n]*[\r\n]/);
      
      if (hasCombinedEmailResource) {
        console.log('Found potentially combined email+resource value');
      }
      
      // Fix 1: Separate combined email+resource into proper ATTENDEE lines
      if (hasCombinedEmailResource) {
        icsData = icsData.replace(/:mailto:([^@\r\n]+@[^@\r\n]+)([a-zA-Z]+[^:\r\n]*[\r\n])/g, (match, email, resource) => {
          console.log(`Separating combined email+resource: ${email} + ${resource}`);
          // Create a proper ending for the email line
          return `:mailto:${email}\r\n`;
        });
      }
      
      // Fix 2: Remove any SCHEDULE-STATUS parameters entirely
      icsData = icsData.replace(/SCHEDULE-STATUS=[^;:\r\n]+(;|:|[\r\n])/g, '$1');
      
      // Fix 3: Clean up RRULE properties - ensure they only contain valid recurrence parameters
      // and extract any attendee data that may have been incorrectly merged
      const extractedAttendees: string[] = [];
      
      // First check if there's a "chairs:" or other resource type followed by a mailto: in the RRULE
      // This is a common pattern in corrupted ICS data
      const resourcePattern = /RRULE:[^:]*:([^:;]+):mailto:([^;\r\n\s]+)/g;
      let resourceMatch;
      while ((resourceMatch = resourcePattern.exec(icsData)) !== null) {
        const resourceType = resourceMatch[1];
        const email = resourceMatch[2];
        
        console.log(`Found resource directly in RRULE: ${resourceType} with email ${email}`);
        
        // Add as a proper resource attendee
        extractedAttendees.push(
          `ATTENDEE;CN=${email.split('@')[0]};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT;X-RESOURCE-TYPE=${resourceType}:mailto:${email}`
        );
        
        // Add a log so we can see this happening
        console.log(`SPECIAL CASE: Created resource line from RRULE data: ${extractedAttendees[extractedAttendees.length-1]}`);
      }
      
      // Now clean up the RRULE properties
      icsData = icsData.replace(/RRULE:[^\r\n]+/g, (match) => {
        console.log(`Sanitizing RRULE: ${match}`);
        
        // Check for attendee or resource info merged into RRULE
        if (match.includes('mailto:')) {
          console.log('Found email in RRULE - extracting and moving to separate ATTENDEE lines');
          
          // Try to extract attendees and resources from the corrupted RRULE
          const mailtoMatches = match.match(/mailto:([^;\r\n\s]+)/g);
          if (mailtoMatches && mailtoMatches.length > 0) {
            mailtoMatches.forEach(mailtoMatch => {
              const email = mailtoMatch.replace('mailto:', '');
              console.log(`Extracted email from corrupted RRULE: ${email}`);
              
              // Check if this is likely a resource based on other terms in the line
              const isResource = match.includes('RESOURCE') || 
                              match.includes('CUTYPE=RESOURCE') || 
                              match.includes('chairs') || 
                              match.includes('room') || 
                              match.includes('projector');
                              
              // Extract the specific resource type if possible
              let resourceName = 'chairs'; // Default
              if (isResource) {
                // Try several patterns to find the resource type
                const typeMatches = [
                  match.match(/([a-zA-Z]+):[^;:\r\n]*mailto:/),
                  match.match(/X-RESOURCE-TYPE=([^;:\r\n]+)/),
                  match.match(/RESOURCE-TYPE=([^;:\r\n]+)/)
                ];
                
                for (const typeMatch of typeMatches) {
                  if (typeMatch && typeMatch[1]) {
                    resourceName = typeMatch[1];
                    break;
                  }
                }
                
                // Also check if the resource type is appended to the email domain
                if (email.match(/[^@\s]+@[^@\s.]+\.[a-z]+[A-Za-z]+/)) {
                  const domainParts = email.split('@');
                  if (domainParts.length === 2) {
                    const domain = domainParts[1];
                    // Find if there's text after the TLD
                    const dotIndex = domain.indexOf('.');
                    if (dotIndex > 0) {
                      const baseDomain = domain.substring(0, dotIndex + 3); // +3 to include the dot and 2 char TLD
                      if (domain.length > baseDomain.length) {
                        resourceName = domain.substring(baseDomain.length);
                        console.log(`Extracted resource type from email domain: ${resourceName}`);
                      }
                    }
                  }
                }
                
                // Now create the proper resource line
                extractedAttendees.push(
                  `ATTENDEE;CN=${email.split('@')[0]};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT;X-RESOURCE-TYPE=${resourceName}:mailto:${email}`
                );
                console.log(`Created resource line from RRULE data: ${extractedAttendees[extractedAttendees.length-1]}`);
              } else {
                // Create a regular attendee line
                extractedAttendees.push(
                  `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${email}`
                );
                console.log(`Created attendee line from RRULE data: ${extractedAttendees[extractedAttendees.length-1]}`);
              }
            });
          }
        }
        
        // Now extract the valid RRULE parts
        const validParams = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST', 'BYSETPOS'];
        const parts = match.substring(6).split(';'); // Remove RRULE: prefix
        const validParts = parts.filter(part => {
          if (!part.includes('=')) return false;
          const paramName = part.split('=')[0];
          return validParams.includes(paramName);
        });
        
        if (validParts.length > 0) {
          return 'RRULE:' + validParts.join(';');
        }
        
        // If no valid parts, get at least the FREQ
        const freqPart = parts.find(p => p.startsWith('FREQ='));
        if (freqPart) {
          return 'RRULE:' + freqPart;
        }
        
        // If no FREQ, just remove the line
        return '';
      });
      
      // Add extracted attendees back to the ICS data
      if (extractedAttendees.length > 0) {
        console.log(`Adding ${extractedAttendees.length} extracted attendees back to ICS data`);
        
        // Find the end of the VEVENT section to add the extracted attendees
        const endEventPos = icsData.lastIndexOf('END:VEVENT');
        if (endEventPos > 0) {
          const before = icsData.substring(0, endEventPos);
          const after = icsData.substring(endEventPos);
          icsData = before + extractedAttendees.join('\r\n') + '\r\n' + after;
        }
      }
      
      // Fix 4: Fix malformed ORGANIZER lines with unwrapped mailto:
      // This handles cases where an email appears on a separate line after ORGANIZER
      icsData = icsData.replace(/ORGANIZER[^:\r\n]+:(\r?\n\s+mailto:[^\r\n]+)(\r?\n\s+mailto:[^\r\n]+)?/g, (match, firstEmail, secondEmail) => {
        // Keep the ORGANIZER line but remove additional emails
        const organizer = match.split('\r\n')[0];
        console.log('Fixing malformed ORGANIZER line:', organizer);
        return organizer;
      });
      
      // Fix 5: Handle any stray mailto: lines that don't have property names
      icsData = icsData.replace(/^\s*mailto:[^\r\n]+\r?\n/gm, '');
      
      // Fix 6: Handle lines ending with a colon but no content
      icsData = icsData.replace(/^.*:[\r\n]+/gm, '');
      
      // Fix 7: Fix specifically the dktest@dil.inProjector pattern
      icsData = icsData.replace(/:mailto:([^@\r\n]+@[^@\r\n.]+\.[a-z]+)([A-Za-z]+)/g, (match, email, resource) => {
        console.log(`Found and fixing "${email}${resource}" pattern`);
        return `:mailto:${email}`;
      });
      
      return icsData;
    } catch (error) {
      console.error('Error applying aggressive fixes to ICS data:', error);
      return icsData; // Return original if fixes fail
    }
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
   * Sanitize a RRULE string by removing any non-recurrence data that might have been incorrectly added
   * This helps fix corrupted RRULE properties that might contain email addresses or other invalid data
   * @param rrule The possibly corrupted RRULE string
   * @returns A cleaned RRULE string containing only valid recurrence parameters
   */
  private sanitizeRRULE(rrule: string): string {
    if (!rrule) return '';
    
    try {
      console.log(`Sanitizing RRULE: ${rrule}`);
      
      // Check for specific malformed patterns (emails merged with resource types)
      if (rrule.includes('@') && (rrule.includes('Projector') || rrule.includes('projector') ||
          rrule.includes('Room') || rrule.includes('room') || rrule.includes('Resource'))) {
        console.log('Found email/resource pattern in RRULE - applying focused fix');
        
        // Specific case: dktest@dil.inProjector
        rrule = rrule.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[A-Za-z]+/g, (match, email) => {
          console.log(`Removing resource suffix from email ${email}`);
          return '';  // Remove the entire problematic part
        });
        
        // After removing problematic parts, check if we still have a valid RRULE
        const freqMatch = rrule.match(/FREQ=([^;]+)/i);
        if (freqMatch) {
          console.log(`Recovered FREQ from corrupted RRULE: FREQ=${freqMatch[1]}`);
          // Just use the basic frequency to be safe
          return `FREQ=${freqMatch[1]}`;
        } else {
          // If we can't recover a FREQ, return a default daily recurrence
          console.log('Could not recover FREQ from corrupted RRULE, using default DAILY');
          return 'FREQ=DAILY';
        }
      }
      
      // If it's already an object in string form, parse it and let our formatter handle it
      if (rrule.startsWith('{') && rrule.endsWith('}')) {
        try {
          return icalUtils.formatRecurrenceRule(rrule);
        } catch (e) {
          console.error("Error parsing recurrence rule JSON:", e);
        }
      }
      
      // Remove any RRULE: prefix if present
      if (rrule.startsWith('RRULE:')) {
        rrule = rrule.substring(6);
      }
      
      // Explicitly check for and remove SCHEDULE-STATUS
      if (rrule.includes('SCHEDULE-STATUS')) {
        console.log('Found SCHEDULE-STATUS in RRULE - removing it');
        rrule = rrule.replace(/SCHEDULE-STATUS=[^;]*(;|$)/g, '');
      }
      
      // Remove any stray "mailto:" sections and anything after a colon that's not part of a valid parameter
      if (rrule.includes('mailto:') || rrule.includes(':')) {
        console.log('Found mailto: or colon in RRULE - cleaning it properly');
        
        // First, separate at any colon that's not part of a parameter definition
        const cleanParts = rrule.split(':');
        if (cleanParts.length > 1) {
          // Only keep the first part before any colon (which should contain the actual RRULE)
          rrule = cleanParts[0];
          console.log(`Split RRULE at colon, keeping only: ${rrule}`);
        }
        
        // Also remove any remaining mailto sections
        rrule = rrule.replace(/mailto:[^;]*(;|$)/g, '');
      }
      
      // If we have a clean RRULE without problematic content, return it
      if (rrule.startsWith('FREQ=') && !rrule.includes('mailto:') && !rrule.includes('PARTSTAT=') && 
          !rrule.includes('SCHEDULE-STATUS') && !rrule.includes('@')) {
        return rrule;
      }
      
      // Extract valid RRULE parameters (whitelist approach)
      const validParams = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST', 'BYSETPOS'];
      const parts = rrule.split(';');
      
      const validParts = parts.filter(part => {
        if (!part.includes('=')) return false;
        const paramName = part.split('=')[0];
        return validParams.includes(paramName);
      });
      
      // If we have valid parts, join them
      if (validParts.length > 0) {
        const sanitizedRule = validParts.join(';');
        console.log(`Sanitized RRULE: ${sanitizedRule}`);
        return sanitizedRule;
      }
      
      // Extract just FREQ as a last resort
      const freqMatch = rrule.match(/FREQ=([^;]+)/i);
      if (freqMatch) {
        console.log(`Extracted only FREQ from RRULE: FREQ=${freqMatch[1]}`);
        return `FREQ=${freqMatch[1]}`;
      }
      
      // If all else fails, return a default or empty
      console.warn(`Could not sanitize RRULE: ${rrule}, returning empty string`);
      return '';
    } catch (e) {
      console.error(`Error sanitizing RRULE: ${e}`);
      return '';
    }
  }

  /**
   * Push local events to the CalDAV server
   * This syncs events from our database to the CalDAV server
   * @param userId The ID of the user to sync events for
   * @param calendarId Optional calendar ID to sync just one calendar
   */
  async pushLocalEvents(userId: number, calendarId?: number): Promise<boolean> {
    console.log(`Pushing local events for user ID ${userId}${calendarId ? ` for calendar ${calendarId}` : ''}`);
    
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    try {
      // Get all local events (pending or not synced)
      const calendars = calendarId 
        ? [await storage.getCalendar(calendarId)]
        : await storage.getCalendars(userId);
      
      if (!calendars || calendars.length === 0 || calendars[0] === undefined) {
        console.log(`No calendars found for user ID ${userId}`);
        return false;
      }
      
      console.log(`Found ${calendars.length} calendars to sync local events for`);
      
      // Create a DAV client
      const davClient = new DAVClient({
        serverUrl: job.connection.url,
        credentials: {
          username: job.connection.username,
          password: job.connection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Login to the server
      await davClient.login();
      
      // For each calendar
      for (const calendar of calendars.filter(Boolean)) {
        if (!calendar) continue; // Skip undefined calendars
        
        console.log(`Processing calendar ${calendar.name} (ID: ${calendar.id})`);
        
        if (!calendar.url) {
          console.log(`Calendar ${calendar.name} (ID: ${calendar.id}) has no URL, skipping`);
          continue;
        }
        
        // Get all events for this calendar
        const events = await storage.getEvents(calendar.id);
        
        // First handle pending updates (they should get priority in case of duplicate UIDs)
        const pendingEvents = events.filter(event => event.syncStatus === 'pending');
        const localEvents = events.filter(event => event.syncStatus === 'local');
        
        // Log what we're doing
        console.log(`Found ${pendingEvents.length} pending events and ${localEvents.length} local events to push for calendar ${calendar.name}`);
        
        // Process pending updates first
        for (const event of pendingEvents) {
          try {
            console.log(`Pushing update for event "${event.title}" (ID: ${event.id}) to server`);
            
            // Create iCalendar data
            let icalData = "";
            let currentSequence = 0;
            const currentTimestamp = this.formatICalDate(new Date());
            
            // If event has raw data, modify it as a template while preserving critical fields
            if (event.rawData) {
              try {
                // Extract raw data string
                let rawDataStr = '';
                if (typeof event.rawData === 'string') {
                  try {
                    const parsedData = JSON.parse(event.rawData);
                    rawDataStr = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData);
                  } catch (e) {
                    // If parsing fails, just use the raw data as is
                    rawDataStr = event.rawData;
                  }
                } else {
                  rawDataStr = JSON.stringify(event.rawData);
                }
                
                // Extract SEQUENCE from existing data
                currentSequence = this.extractSequenceFromICal(rawDataStr);
                
                // For updates, increment the sequence number
                if (event.syncStatus === 'pending' && event.url && event.etag) {
                  currentSequence += 1;
                  console.log(`Incrementing SEQUENCE to ${currentSequence} for event ${event.id}`);
                }
                
                // Process raw data to update only what we need while keeping other properties
                // Split by lines to modify specific properties
                const lines = rawDataStr.split(/\r?\n/);
                let newLines = [];
                let inEvent = false;
                
                for (let line of lines) {
                  // Track when we're inside a VEVENT block
                  if (line.startsWith('BEGIN:VEVENT')) {
                    inEvent = true;
                    newLines.push(line);
                    continue;
                  }
                  
                  if (line.startsWith('END:VEVENT')) {
                    inEvent = false;
                    newLines.push(line);
                    continue;
                  }
                  
                  // Only modify lines inside the VEVENT block
                  if (inEvent) {
                    // Update core properties that might have changed
                    if (line.startsWith('SUMMARY:')) {
                      newLines.push(`SUMMARY:${event.title || "Untitled Event"}`);
                    } 
                    else if (line.startsWith('DTSTART')) {
                      newLines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(event.startDate, event.allDay === true)}`);
                    } 
                    else if (line.startsWith('DTEND')) {
                      newLines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(event.endDate, event.allDay === true)}`);
                    }
                    else if (line.startsWith('LOCATION:') && event.location !== undefined) {
                      if (event.location) {
                        // Use ical-utils to properly escape the location
                        newLines.push(`LOCATION:${icalUtils.escapeICalString(event.location)}`);
                      } else {
                        newLines.push('');
                      }
                    }
                    else if (line.startsWith('DESCRIPTION:') && event.description !== undefined) {
                      if (event.description) {
                        // Check if this might be a special Thunderbird ALTREP description format that we want to preserve
                        const isThunderbirdFormat = 
                          typeof event.description === 'string' && 
                          (event.description.includes('"ALTREP"') || 
                           event.description.includes('"params"') || 
                           event.description.includes('data:text/html'));
                         
                        if (isThunderbirdFormat) {
                          // Carefully preserve the special format
                          // Just fold the line properly without changing its content
                          const descLine = `DESCRIPTION:${event.description}`;
                          // Apply proper iCalendar line folding (lines should be under 75 chars)
                          const foldedLine = icalUtils.foldLine(descLine);
                          // Push each line of the folded content separately
                          foldedLine.split(/\r?\n/).forEach(l => newLines.push(l));
                        } else {
                          // Regular description - use ical-utils to properly escape it
                          newLines.push(`DESCRIPTION:${icalUtils.escapeICalString(event.description)}`);
                        }
                      } else {
                        newLines.push('');
                      }
                    }
                    // Update SEQUENCE
                    else if (line.startsWith('SEQUENCE:')) {
                      newLines.push(`SEQUENCE:${currentSequence}`);
                    }
                    // Update timestamps
                    else if (line.startsWith('DTSTAMP:')) {
                      newLines.push(`DTSTAMP:${currentTimestamp}`);
                    }
                    else if (line.startsWith('LAST-MODIFIED:')) {
                      newLines.push(`LAST-MODIFIED:${currentTimestamp}`);
                    }
                    else if (line.startsWith('CREATED:')) {
                      // Keep the original CREATED timestamp
                      newLines.push(line);
                    }
                    // Keep UID exactly as is
                    else if (line.startsWith('UID:')) {
                      newLines.push(line);
                    }
                    // For RRULE, use our updated version if available
                    else if (line.startsWith('RRULE:') && event.recurrenceRule) {
                      newLines.push(`RRULE:${this.formatRecurrenceRule(event.recurrenceRule)}`);
                    }
                    // Keep existing attendee lines
                    else if (line.startsWith('ATTENDEE')) {
                      // If we have explicit attendees in the event object, we'll handle them separately
                      // Otherwise preserve the existing attendee lines
                      if (!event.attendees || (typeof event.attendees === 'string' && event.attendees === '[]') || 
                          (Array.isArray(event.attendees) && event.attendees.length === 0)) {
                        newLines.push(line);
                      }
                    }
                    // Keep all other lines
                    else {
                      newLines.push(line);
                    }
                  } else {
                    // Outside VEVENT, keep lines as they are
                    newLines.push(line);
                  }
                }
                
                // Process attendees and add them after existing props
                let attendeesAndResourcesSection = '';
                
                // Process attendees if present
                if (event.attendees) {
                  try {
                    const attendeesArray = typeof event.attendees === 'string' 
                      ? JSON.parse(event.attendees) 
                      : event.attendees;
                      
                    if (Array.isArray(attendeesArray)) {
                      attendeesArray.forEach(attendee => {
                        if (attendee && attendee.email) {
                          // Format: ATTENDEE;CN=Name;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;SCHEDULE-STATUS=x.x:mailto:email@example.com
                          const cn = attendee.name ? `;CN=${attendee.name}` : '';
                          const role = attendee.role ? `;ROLE=${attendee.role}` : ';ROLE=REQ-PARTICIPANT';
                          const status = attendee.status ? `;PARTSTAT=${attendee.status}` : ';PARTSTAT=NEEDS-ACTION';
                          const scheduleStatus = attendee.scheduleStatus ? `;SCHEDULE-STATUS=${attendee.scheduleStatus}` : '';
                          
                          console.log(`Adding attendee to event update: ${attendee.name || attendee.email} with status ${attendee.status || 'NEEDS-ACTION'}`);
                          attendeesAndResourcesSection += `ATTENDEE${cn}${role}${status}${scheduleStatus}:mailto:${attendee.email}\r\n`;
                        }
                      });
                    }
                  } catch (e) {
                    console.error(`Error processing attendees for event ${event.id}:`, e);
                  }
                }
                
                // Process resources if present
                if (event.resources) {
                  try {
                    const resourcesArray = typeof event.resources === 'string' 
                      ? JSON.parse(event.resources) 
                      : event.resources;
                      
                    if (Array.isArray(resourcesArray)) {
                      resourcesArray.forEach(resource => {
                        if (resource && resource.adminEmail) {
                          // Format: ATTENDEE;CN=Resource Name;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT;X-RESOURCE-TYPE=type;SCHEDULE-STATUS=x.x:mailto:resource@example.com
                          const cn = resource.adminName ? `;CN=${resource.adminName}` : '';
                          const subType = resource.subType ? `;X-RESOURCE-TYPE=${resource.subType}` : '';
                          const scheduleStatus = resource.scheduleStatus ? `;SCHEDULE-STATUS=${resource.scheduleStatus}` : '';
                          
                          console.log(`Adding resource to event update: ${resource.adminName || 'Unnamed Resource'} (${resource.adminEmail})`);
                          attendeesAndResourcesSection += `ATTENDEE${cn};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT${subType}${scheduleStatus}:mailto:${resource.adminEmail}\r\n`;
                        }
                      });
                    }
                  } catch (e) {
                    console.error(`Error processing resources for event ${event.id}:`, e);
                  }
                }
                
                // Add SEQUENCE if it wasn't there before
                if (!rawDataStr.includes('SEQUENCE:')) {
                  // Find position of END:VEVENT
                  const endEventPos = newLines.findIndex(line => line.startsWith('END:VEVENT'));
                  if (endEventPos > -1) {
                    // Insert before END:VEVENT
                    newLines.splice(endEventPos, 0, `SEQUENCE:${currentSequence}`);
                  }
                }
                
                // Add LAST-MODIFIED if it wasn't there before
                if (!rawDataStr.includes('LAST-MODIFIED:')) {
                  // Find position of END:VEVENT
                  const endEventPos = newLines.findIndex(line => line.startsWith('END:VEVENT'));
                  if (endEventPos > -1) {
                    // Insert before END:VEVENT
                    newLines.splice(endEventPos, 0, `LAST-MODIFIED:${currentTimestamp}`);
                  }
                }
                
                // Insert the attendees and resources section before END:VEVENT
                if (attendeesAndResourcesSection) {
                  const endEventPos = newLines.findIndex(line => line.startsWith('END:VEVENT'));
                  if (endEventPos > -1) {
                    // Insert attendees before END:VEVENT
                    newLines.splice(endEventPos, 0, attendeesAndResourcesSection);
                  }
                }
                
                // Join lines back into iCalendar format
                icalData = newLines.join('\r\n');
                
              } catch (e) {
                console.error(`Error updating raw ICS data for event ${event.id}:`, e);
                // Fallback to creating new iCalendar data using our utilities
                // Check if this might be a special Thunderbird ALTREP description format that we need to preserve
                const hasThunderbirdFormat = 
                  event.description && 
                  typeof event.description === 'string' && 
                  (event.description.includes('"ALTREP"') || 
                   event.description.includes('"params"') || 
                   event.description.includes('data:text/html'));
                
                // If it's a Thunderbird format description, we need special handling
                if (hasThunderbirdFormat) {
                  // Create a basic iCalendar structure and then insert the description as is
                  const baseIcal = icalUtils.generateICalEvent({...event, description: ''}, {
                    organizer: job.connection.username,
                    sequence: currentSequence,
                    timestamp: currentTimestamp
                  });
                  
                  // Insert the special description format preserving its structure
                  // First split the iCalendar data into lines
                  const lines = baseIcal.split(/\r?\n/);
                  // Find position before END:VEVENT
                  const endEventPos = lines.findIndex(line => line.startsWith('END:VEVENT'));
                  
                  if (endEventPos > -1) {
                    // Format and fold the description line
                    const descLine = `DESCRIPTION:${event.description}`;
                    const foldedDesc = icalUtils.foldLine(descLine);
                    // Insert before END:VEVENT
                    lines.splice(endEventPos, 0, foldedDesc);
                    // Join lines back together
                    icalData = lines.join('\r\n');
                  } else {
                    // Fallback if we can't find END:VEVENT
                    icalData = baseIcal;
                  }
                } else {
                  // Normal event - use standard generation
                  icalData = icalUtils.generateICalEvent(event, {
                    organizer: job.connection.username,
                    sequence: currentSequence,
                    timestamp: currentTimestamp
                  });
                }
              }
            } else {
              // No existing raw data, create new iCalendar data using our utilities
              // Check if this might be a special Thunderbird ALTREP description format that we need to preserve
              const hasThunderbirdFormat = 
                event.description && 
                typeof event.description === 'string' && 
                (event.description.includes('"ALTREP"') || 
                 event.description.includes('"params"') || 
                 event.description.includes('data:text/html'));
              
              // If it's a Thunderbird format description, we need special handling
              if (hasThunderbirdFormat) {
                // Create a basic iCalendar structure and then insert the description as is
                const baseIcal = icalUtils.generateICalEvent({...event, description: ''}, {
                  organizer: job.connection.username,
                  sequence: currentSequence,
                  timestamp: currentTimestamp
                });
                
                // Insert the special description format preserving its structure
                // First split the iCalendar data into lines
                const lines = baseIcal.split(/\r?\n/);
                // Find position before END:VEVENT
                const endEventPos = lines.findIndex(line => line.startsWith('END:VEVENT'));
                
                if (endEventPos > -1) {
                  // Format and fold the description line
                  const descLine = `DESCRIPTION:${event.description}`;
                  const foldedDesc = icalUtils.foldLine(descLine);
                  // Insert before END:VEVENT
                  lines.splice(endEventPos, 0, foldedDesc);
                  // Join lines back together
                  icalData = lines.join('\r\n');
                } else {
                  // Fallback if we can't find END:VEVENT
                  icalData = baseIcal;
                }
              } else {
                // Normal event - use standard generation
                icalData = icalUtils.generateICalEvent(event, {
                  organizer: job.connection.username,
                  sequence: currentSequence,
                  timestamp: currentTimestamp
                });
              }
            }
            
            // Determine if we're creating or updating
            if (event.url && event.etag) {
              // Update existing event on server
              console.log(`Updating existing event on server: ${event.title}`);
              
              try {
                // We'll use a direct PUT request instead of tsdav's updateCalendarObject
                // This gives us more control over the exact format of the request
                console.log(`Performing direct PUT request to ${event.url}`);
                
                // First make a PROPFIND request to double-check the event exists and get its current ETag
                const headers = {
                  'Content-Type': 'application/xml; charset=utf-8',
                  'Depth': '0',
                  'Authorization': `Basic ${Buffer.from(`${job.connection.username}:${job.connection.password}`).toString('base64')}`
                };
                
                const propfindResponse = await fetch(event.url, {
                  method: 'PROPFIND',
                  headers,
                  body: `<?xml version="1.0" encoding="utf-8" ?>
                    <D:propfind xmlns:D="DAV:">
                      <D:prop>
                        <D:getetag/>
                      </D:prop>
                    </D:propfind>`
                });
                
                if (!propfindResponse.ok) {
                  throw new Error(`PROPFIND failed: ${propfindResponse.status} ${propfindResponse.statusText}`);
                }
                
                // Parse the PROPFIND response to get the current ETag
                const propfindText = await propfindResponse.text();
                console.log(`PROPFIND response for ${event.url}:`, propfindText.substring(0, 200) + '...');
                
                // Now perform the PUT request with the updated iCalendar data
                const putHeaders = {
                  'Content-Type': 'text/calendar; charset=utf-8',
                  'Authorization': `Basic ${Buffer.from(`${job.connection.username}:${job.connection.password}`).toString('base64')}`,
                  'If-Match': event.etag
                };
                
                console.log(`Sending PUT request to ${event.url} with If-Match: ${event.etag}`);
                console.log(`iCalendar data snippet: ${icalData.substring(0, 100)}...`);
                
                const putResponse = await fetch(event.url, {
                  method: 'PUT',
                  headers: putHeaders,
                  body: icalData
                });
                
                if (!putResponse.ok) {
                  throw new Error(`PUT failed: ${putResponse.status} ${putResponse.statusText}`);
                }
                
                // Get the new ETag from the response headers
                const newEtag = putResponse.headers.get('ETag') || event.etag;
                console.log(`PUT request successful, new ETag: ${newEtag}`);
                
                // Update the event in our database
                await storage.updateEvent(event.id, {
                  syncStatus: 'synced',
                  lastSyncAttempt: new Date(),
                  etag: newEtag,
                  rawData: icalData // Store the exact iCalendar data we sent
                });
                
                console.log(`Successfully updated event on server: ${event.title}`);
                
                // Force a full refresh from the server to ensure we have the latest version
                await this.syncNow(userId, { forceRefresh: true, calendarId: calendar.id });
              } catch (error) {
                console.error(`Error updating event on server:`, error);
                
                // Update the event as failed
                await storage.updateEvent(event.id, {
                  syncStatus: 'error',
                  lastSyncAttempt: new Date()
                });
              }
            } else {
              // Create new event on server
              console.log(`Creating new event on server: ${event.title}`);
              
              try {
                // Get the calendar URL
                const calendarUrl = calendar.url.startsWith('http') 
                  ? calendar.url 
                  : `${job.connection.url}${calendar.url}`;
                
                console.log(`Using calendar URL: ${calendarUrl}`);
                
                // Ensure the calendar URL has a trailing slash
                const normalizedCalendarUrl = calendarUrl.endsWith('/') 
                  ? calendarUrl 
                  : `${calendarUrl}/`;
                  
                // Generate a filename for the event
                const filename = `${event.uid}.ics`;
                const eventUrl = `${normalizedCalendarUrl}${filename}`;
                
                console.log(`Will create event at URL: ${eventUrl}`);
                console.log(`iCalendar data snippet: ${icalData.substring(0, 100)}...`);
                
                // We'll use a direct PUT request for creating the event as well
                const putHeaders = {
                  'Content-Type': 'text/calendar; charset=utf-8',
                  'Authorization': `Basic ${Buffer.from(`${job.connection.username}:${job.connection.password}`).toString('base64')}`
                };
                
                // Make the PUT request to create the event
                const putResponse = await fetch(eventUrl, {
                  method: 'PUT',
                  headers: putHeaders,
                  body: icalData
                });
                
                if (!putResponse.ok) {
                  throw new Error(`PUT failed: ${putResponse.status} ${putResponse.statusText}`);
                }
                
                // Get the ETag from the response headers
                const etag = putResponse.headers.get('ETag');
                console.log(`PUT request successful, ETag: ${etag}`);
                
                // Update the event in our database
                await storage.updateEvent(event.id, {
                  url: eventUrl,
                  etag: etag || '',
                  syncStatus: 'synced',
                  lastSyncAttempt: new Date(),
                  rawData: icalData // Store the exact iCalendar data we sent
                });
                
                console.log(`Successfully created event on server: ${event.title}`);
              } catch (error) {
                console.error(`Error creating event on server:`, error);
                
                // Update the event as failed
                await storage.updateEvent(event.id, {
                  syncStatus: 'error',
                  lastSyncAttempt: new Date()
                });
              }
            }
          } catch (error) {
            console.error(`Error pushing event to server:`, error);
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Error pushing local events to server:`, error);
      return false;
    }
  }
  
  /**
   * Format a date for iCalendar
   */
  private formatICalDate(date: Date | null | undefined, allDay: boolean = false): string {
    // If date is null or undefined, use current date as fallback
    if (!date) {
      console.warn("Converting null/undefined date to current date");
      date = new Date();
    }
    
    // Verify that the date is valid
    if (isNaN(date.getTime())) {
      console.warn("Invalid date detected, using current date instead");
      date = new Date();
    }
    
    try {
      if (allDay) {
        return date.toISOString().replace(/[-:]/g, '').split('T')[0];
      }
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
    } catch (error) {
      console.error("Error formatting date for iCalendar:", error);
      // Last resort fallback - use current time
      const now = new Date();
      return allDay 
        ? now.toISOString().replace(/[-:]/g, '').split('T')[0]
        : now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
    }
  }
  
  /**
   * Format a recurrence rule for iCalendar
   */
  private formatRecurrenceRule(rule: string): string {
    // If rule is empty, return empty string
    if (!rule) return '';
    
    try {
      // First sanitize the rule to ensure it doesn't contain any invalid data like attendee emails
      if (typeof rule === 'string' && rule.includes('mailto:')) {
        rule = this.sanitizeRRULE(rule);
      }
      
      // If the rule is already in FREQ=xxx format after sanitization, return it directly
      if (typeof rule === 'string' && rule.startsWith('FREQ=')) {
        return rule;
      }
      
      try {
        const parsedRule = JSON.parse(rule);
        
        // Start building the RRULE string
        let rrule = '';
        
        // Pattern (FREQ)
        if (parsedRule.pattern) {
          rrule += `FREQ=${parsedRule.pattern.toUpperCase()};`;
        }
        
        // Interval
        if (parsedRule.interval && parsedRule.interval > 1) {
          rrule += `INTERVAL=${parsedRule.interval};`;
        }
        
        // Weekdays (BYDAY) for weekly patterns
        if (parsedRule.pattern === 'Weekly' && parsedRule.weekdays && parsedRule.weekdays.length > 0) {
          const days = parsedRule.weekdays.map((day: string) => {
            switch (day) {
              case 'Monday': return 'MO';
              case 'Tuesday': return 'TU';
              case 'Wednesday': return 'WE';
              case 'Thursday': return 'TH';
              case 'Friday': return 'FR';
              case 'Saturday': return 'SA';
              case 'Sunday': return 'SU';
              default: return '';
            }
          }).filter(Boolean).join(',');
          
          if (days) {
            rrule += `BYDAY=${days};`;
          }
        }
        
        // End type
        if (parsedRule.endType) {
          if (parsedRule.endType === 'After' && parsedRule.occurrences) {
            rrule += `COUNT=${parsedRule.occurrences};`;
          } else if (parsedRule.endType === 'On' && parsedRule.untilDate) {
            const untilDate = new Date(parsedRule.untilDate);
            rrule += `UNTIL=${this.formatICalDate(untilDate)};`;
          }
        }
        
        // Remove trailing semicolon if it exists
        return rrule.endsWith(';') ? rrule.slice(0, -1) : rrule;
      } catch (error) {
        // If JSON parsing fails but we have a string, try to sanitize it
        if (typeof rule === 'string') {
          return this.sanitizeRRULE(rule);
        }
        
        console.error(`Error formatting recurrence rule:`, error);
        return typeof rule === 'string' ? rule : '';
      }
    } catch (error) {
      console.error(`Error in formatRecurrenceRule:`, error);
      return typeof rule === 'string' ? rule : '';
    }
  }

  /**
   * Extract the SEQUENCE value from an iCalendar event string
   * @param icalData The raw iCalendar data string
   * @returns The SEQUENCE value as a number (defaults to 0 if not found)
   */
  private extractSequenceFromICal(icalData: string): number {
    try {
      const sequenceMatch = icalData.match(/SEQUENCE:(\d+)/);
      if (sequenceMatch && sequenceMatch[1]) {
        return parseInt(sequenceMatch[1], 10);
      }
      return 0; // Default if no SEQUENCE is found
    } catch (error) {
      console.error('Error extracting SEQUENCE from iCalendar data:', error);
      return 0; // Safe default
    }
  }
  
  /**
   * Create new iCalendar data for an event when no existing template is available
   * @param event The event to create iCalendar data for
   * @param organizer The username of the organizer
   * @param sequence The sequence number for the event
   * @param timestamp The timestamp to use for DTSTAMP and LAST-MODIFIED
   * @returns iCalendar data as a string
   */
  private createNewICalData(event: any, organizer: string, sequence: number, timestamp: string): string {
    let attendeesSection = '';
    let resourcesSection = '';
    
    // Process attendees if present
    if (event.attendees) {
      try {
        const attendeesArray = typeof event.attendees === 'string' 
          ? JSON.parse(event.attendees) 
          : event.attendees;
          
        if (Array.isArray(attendeesArray)) {
          attendeesArray.forEach(attendee => {
            if (attendee && attendee.email) {
              // Format: ATTENDEE;CN=Name;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:email@example.com
              const cn = attendee.name ? `;CN=${attendee.name}` : '';
              const role = attendee.role ? `;ROLE=${attendee.role}` : ';ROLE=REQ-PARTICIPANT';
              const status = attendee.status ? `;PARTSTAT=${attendee.status}` : ';PARTSTAT=NEEDS-ACTION';
              attendeesSection += `ATTENDEE${cn}${role}${status}:mailto:${attendee.email}\r\n`;
            }
          });
        }
      } catch (e) {
        console.error(`Error processing attendees for event ${event.id}:`, e);
      }
    }
    
    // Process resources if present
    if (event.resources) {
      try {
        const resourcesArray = typeof event.resources === 'string' 
          ? JSON.parse(event.resources) 
          : event.resources;
          
        if (Array.isArray(resourcesArray)) {
          resourcesArray.forEach(resource => {
            if (resource && resource.adminEmail) {
              // Format: ATTENDEE;CN=Resource Name;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT:mailto:resource@example.com
              const cn = resource.adminName ? `;CN=${resource.adminName}` : '';
              const subType = resource.subType ? `;X-RESOURCE-TYPE=${resource.subType}` : '';
              resourcesSection += `ATTENDEE${cn};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT${subType}:mailto:${resource.adminEmail}\r\n`;
            }
          });
        }
      } catch (e) {
        console.error(`Error processing resources for event ${event.id}:`, e);
      }
    }
    
    // Add organizer using username as both name and email (if not available)
    // Extract email from username if it looks like an email
    const emailMatch = organizer.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
    const email = emailMatch ? organizer : `${organizer}@caldavclient.local`;
    const orgSection = `ORGANIZER;CN=${organizer}:mailto:${email}\r\n`;
    
    // Build the iCalendar data
    return `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//CalDAV Client//NONSGML v1.0//EN\r
BEGIN:VEVENT\r
UID:${event.uid}\r
SUMMARY:${event.title || "Untitled Event"}\r
DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(event.startDate, event.allDay === true)}\r
DTEND${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(event.endDate, event.allDay === true)}\r
${event.description ? `DESCRIPTION:${icalUtils.escapeICalString(event.description)}\r\n` : ''}\
${event.location ? `LOCATION:${icalUtils.escapeICalString(event.location)}\r\n` : ''}\
DTSTAMP:${timestamp}\r
CREATED:${timestamp}\r
LAST-MODIFIED:${timestamp}\r
SEQUENCE:${sequence}\r
${event.recurrenceRule ? `RRULE:${this.formatRecurrenceRule(event.recurrenceRule)}\r\n` : ''}\
${orgSection}${attendeesSection}${resourcesSection}END:VEVENT\r
END:VCALENDAR`;
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