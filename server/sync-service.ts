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
      // Parse the ICS data using node-ical
      const parseICS = (nodeIcal as any).default?.parseICS || nodeIcal.parseICS;
      const parsedCal = parseICS(icsData);
      
      // Find the first VEVENT in the parsed calendar
      const eventKey = Object.keys(parsedCal).find(key => 
        parsedCal[key]?.type === 'VEVENT'
      );
      
      if (!eventKey || !parsedCal[eventKey]) {
        console.warn('No valid VEVENT found in ICS data');
        return null;
      }
      
      const event = parsedCal[eventKey];
      
      // Initialize dates
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
          // Potential all-day event
          allDay = true;
        }
      } else if (event.start && typeof event.start === 'object' && 'toJSDate' in event.start) {
        startDate = (event.start as any).toJSDate();
        // Check if it's marked as a date-only event
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
      
      // If no end date is provided, derive from start date
      if (!endDate && startDate) {
        endDate = new Date(startDate);
        if (allDay) {
          // For all-day events, set end to next day
          endDate.setDate(endDate.getDate() + 1);
        } else {
          // For timed events, set end to 1 hour after start
          endDate.setHours(endDate.getHours() + 1);
        }
      }
      
      // Parse RRULE if present
      let recurrenceRule: string | undefined = undefined;
      if (event.rrule) {
        if (typeof event.rrule === 'string') {
          recurrenceRule = event.rrule;
        } else if (event.rrule && typeof event.rrule === 'object') {
          // Try to extract the original RRULE string
          recurrenceRule = event.rrule.toString();
          // If it's not a standard string representation, try to extract it from original ICS data
          if (recurrenceRule && !recurrenceRule.startsWith('FREQ=')) {
            const rruleMatch = icsData.match(/RRULE:([^\r\n]+)/);
            if (rruleMatch && rruleMatch[1]) {
              recurrenceRule = rruleMatch[1];
              console.log(`Extracted RRULE from raw ICS data: ${recurrenceRule}`);
            }
          }
        }
      } else {
        // If node-ical failed to parse the RRULE, try to extract it from raw data
        const rruleMatch = icsData.match(/RRULE:([^\r\n]+)/);
        if (rruleMatch && rruleMatch[1]) {
          recurrenceRule = rruleMatch[1];
          console.log(`Extracted RRULE from raw ICS data (fallback): ${recurrenceRule}`);
        }
      }
      
      // Handle attendees - extract from node-ical parsed data
      let attendees: CalDAVAttendee[] = [];
      let resources: CalDAVResource[] = [];
      
      // First try to get attendees from node-ical's parsing
      if (event.attendees && Array.isArray(event.attendees)) {
        attendees = event.attendees;
      } else if (event.attendee) {
        // Handle case where it might be a single attendee
        attendees = Array.isArray(event.attendee) ? event.attendee : [event.attendee];
      } else {
        // Fallback: Try to extract attendees from raw ICS data using regex
        try {
          const attendeeMatches = icsData.match(/ATTENDEE[^:\r\n]+:[^\r\n]+/g);
          if (attendeeMatches && attendeeMatches.length > 0) {
            console.log(`Found ${attendeeMatches.length} attendees/resources in raw ICS data`);
            
            // Process each attendee line
            attendeeMatches.forEach(line => {
              // Extract common properties from the attendee line
              const emailMatch = line.match(/mailto:([^>\r\n]+)/);
              const email = emailMatch ? emailMatch[1] : '';
              
              const nameMatch = line.match(/CN=([^;:]+)/);
              const name = nameMatch ? nameMatch[1] : '';
              
              const roleMatch = line.match(/ROLE=([^;:]+)/);
              const role = roleMatch ? roleMatch[1] : 'REQ-PARTICIPANT';
              
              const statusMatch = line.match(/PARTSTAT=([^;:]+)/);
              const status = statusMatch ? statusMatch[1] : 'NEEDS-ACTION';
              
              // Check if this is a resource
              const isResource = line.includes('CUTYPE=RESOURCE');
              
              if (isResource) {
                // Process as a resource
                resources.push({
                  name: name || 'Unnamed Resource',
                  adminEmail: email,
                  type: line.match(/RESOURCE-TYPE=([^;:]+)/) ? line.match(/RESOURCE-TYPE=([^;:]+)/)?.[1] : undefined
                });
              } else {
                // Process as a regular attendee
                attendees.push({
                  email,
                  name,
                  role,
                  status
                });
              }
            });
            
            console.log(`Parsed ${attendees.length} attendees and ${resources.length} resources`);
          }
        } catch (e) {
          console.error('Error extracting attendees/resources from raw ICS data:', e);
        }
      }
      
      if (!startDate || !endDate) {
        console.warn('Event has invalid dates');
        return null;
      }
      
      // Check timezone information
      let timezone = 'UTC'; // Default timezone
      
      // Try to extract timezone from the event
      if (event.timezone) {
        timezone = event.timezone;
      } else if (event.start && (event.start as any).tz) {
        timezone = (event.start as any).tz;
      }
      
      // Create the CalDAVEvent object
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
        attendees: attendees.length > 0 ? attendees : undefined,
        resources: resources.length > 0 ? resources : undefined,
        etag,
        url,
        data: icsData // Store the original ICS data
      };
      
      return caldavEvent;
    } catch (error) {
      console.error('Error parsing ICS data:', error);
      return null;
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
        
        // Filter to events that need to be pushed to the server (local/pending)
        const localEvents = events.filter(event => 
          event.syncStatus === 'local' || event.syncStatus === 'pending'
        );
        
        console.log(`Found ${localEvents.length} local events to push for calendar ${calendar.name}`);
        
        // For each local event
        for (const event of localEvents) {
          try {
            console.log(`Pushing event ${event.title} (ID: ${event.id}) to server`);
            
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
                        // Properly escape special characters in location according to RFC 5545
                        const escapedLocation = event.location
                          .replace(/\\/g, '\\\\')  // Escape backslashes
                          .replace(/;/g, '\\;')    // Escape semicolons
                          .replace(/,/g, '\\,')    // Escape commas
                          .replace(/\n/g, '\\n');  // Escape line breaks
                        newLines.push(`LOCATION:${escapedLocation}`);
                      } else {
                        newLines.push('');
                      }
                    }
                    else if (line.startsWith('DESCRIPTION:') && event.description !== undefined) {
                      if (event.description) {
                        // Properly escape special characters in description according to RFC 5545
                        const escapedDescription = event.description
                          .replace(/\\/g, '\\\\')  // Escape backslashes
                          .replace(/;/g, '\\;')    // Escape semicolons
                          .replace(/,/g, '\\,')    // Escape commas
                          .replace(/\n/g, '\\n');  // Escape line breaks
                        newLines.push(`DESCRIPTION:${escapedDescription}`);
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
                    // Skip attendee and resource lines - we'll add them back if needed
                    else if (!line.startsWith('ATTENDEE')) {
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
                          // Format: ATTENDEE;CN=Name;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:email@example.com
                          const cn = attendee.name ? `;CN=${attendee.name}` : '';
                          const role = attendee.role ? `;ROLE=${attendee.role}` : ';ROLE=REQ-PARTICIPANT';
                          const status = attendee.status ? `;PARTSTAT=${attendee.status}` : ';PARTSTAT=NEEDS-ACTION';
                          attendeesAndResourcesSection += `ATTENDEE${cn}${role}${status}:mailto:${attendee.email}\r\n`;
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
                          attendeesAndResourcesSection += `ATTENDEE${cn};CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT${subType}:mailto:${resource.adminEmail}\r\n`;
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
                icalData = icalUtils.generateICalEvent(event, {
                  organizer: job.connection.username,
                  sequence: currentSequence,
                  timestamp: currentTimestamp
                });
              }
            } else {
              // No existing raw data, create new iCalendar data using our utilities
              icalData = icalUtils.generateICalEvent(event, {
                organizer: job.connection.username,
                sequence: currentSequence,
                timestamp: currentTimestamp
              });
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
      console.error(`Error formatting recurrence rule:`, error);
      return rule; // Return the original string if parsing fails
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