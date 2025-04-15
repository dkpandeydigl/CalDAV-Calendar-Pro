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
      
      // Get server connection details
      const { url, username, password } = job.connection;
      
      // Setup CalDAV client
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
      try {
        console.log(`Logging in to server ${url} with username ${username}`);
        const accounts = await davClient.login();
        const caldavAccount = accounts.find(acc => acc.accountType === 'caldav');
        
        if (!caldavAccount) {
          console.log(`No CalDAV account found on server ${url}`);
          throw new Error('No CalDAV account found');
        }
        
        console.log(`Found CalDAV account: ${caldavAccount.serverUrl}`);
        
        // Update connection status
        await storage.updateServerConnection(job.connection.id, {
          status: 'connected'
        });
        
        // Fetch calendars
        try {
          console.log(`Fetching calendars for user ID ${userId}`);
          
          const davCalendars = await caldavAccount.calendars();
          console.log(`Found ${davCalendars.length} calendars on server`);
          
          // Get existing calendars from database
          const existingCalendars = await storage.getCalendars(userId);
          
          // Process each calendar from the server
          for (const davCalendar of davCalendars) {
            try {
              // If calendarId is specified, only process that calendar
              const targetCalendarId = calendarId ? parseInt(String(calendarId), 10) : null;
              
              // Find matching calendar in database
              const existingCalendar = existingCalendars.find(cal => 
                cal.url === davCalendar.url || 
                cal.name === davCalendar.displayName
              );
              
              // If calendar ID is specified and this is not the target calendar, skip it
              if (targetCalendarId !== null && existingCalendar && existingCalendar.id !== targetCalendarId) {
                console.log(`Skipping calendar ${davCalendar.displayName} as it's not the target calendar`);
                continue;
              }
              
              // Process the calendar
              let calendarId = existingCalendar?.id;
              
              // Create or update the calendar
              if (!existingCalendar) {
                console.log(`Creating new calendar: ${davCalendar.displayName}`);
                
                // Create new calendar
                const newCalendar = await storage.createCalendar({
                  userId: userId,
                  name: davCalendar.displayName,
                  color: davCalendar.color || this.getRandomColor(),
                  url: davCalendar.url,
                  syncToken: davCalendar.syncToken || null,
                  enabled: true,
                  isPrimary: false,
                  isLocal: false,
                  description: davCalendar.description || null
                });
                
                calendarId = newCalendar.id;
              } else {
                // Update existing calendar
                await storage.updateCalendar(existingCalendar.id, {
                  name: davCalendar.displayName,
                  color: davCalendar.color || existingCalendar.color,
                  syncToken: davCalendar.syncToken || existingCalendar.syncToken,
                  url: davCalendar.url,
                  description: davCalendar.description || existingCalendar.description
                });
                
                calendarId = existingCalendar.id;
              }
              
              // If this is a targeted sync for a specific calendar and we just processed it,
              // we can start fetching events right away
              const isTargetCalendar = targetCalendarId !== null && calendarId === targetCalendarId;
              
              // Skip event fetching if we're not targeting this calendar
              if (targetCalendarId !== null && !isTargetCalendar) {
                continue;
              }
              
              // Fetch events for this calendar
              try {
                console.log(`Fetching events for calendar ${davCalendar.displayName}`);
                
                // Determine time range for events fetch - last 6 months to next 12 months
                const startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 6); // 6 months ago
                
                const endDate = new Date();
                endDate.setMonth(endDate.getMonth() + 12); // 12 months in future
                
                // Only fetch events from the server if we have a calendar URL
                // And if we're not specifically preserving local events
                // (preserveLocalEvents is for specialized sync tasks)
                if (!davCalendar.url) {
                  console.warn(`Calendar ${davCalendar.displayName} has no URL, skipping events`);
                  continue;
                }
                
                if (preserveLocalEvents) {
                  console.log(`Skipping event download for calendar ${davCalendar.displayName} due to preserveLocalEvents flag`);
                  continue;
                }
                
                // Fetch all events
                const events = await davCalendar.calendarQuery({
                  timeRange: {
                    start: startDate.toISOString(),
                    end: endDate.toISOString()
                  },
                  expand: true
                });
                
                console.log(`Found ${events.length} events in calendar ${davCalendar.displayName}`);
                
                // Process each event to update or create in our database
                for (const event of events) {
                  try {
                    // Check if we have a valid ics data
                    if (!event.data) {
                      console.warn(`Event has no data, skipping`);
                      continue;
                    }
                    
                    // Parse the raw ICS data to extract all the needed information
                    const caldavEvent = this.parseRawICSData(event.data, event.etag, event.url);
                    if (!caldavEvent) {
                      console.warn(`Failed to parse event data, skipping`);
                      continue;
                    }
                    
                    // Create event data for our database
                    const eventData = {
                      calendarId: calendarId,
                      uid: caldavEvent.uid,
                      title: caldavEvent.summary,
                      description: caldavEvent.description || null,
                      location: caldavEvent.location || null,
                      startDate: caldavEvent.startDate,
                      endDate: caldavEvent.endDate,
                      allDay: caldavEvent.allDay || false,
                      timezone: caldavEvent.timezone || 'UTC',
                      recurrenceRule: caldavEvent.recurrenceRule || null,
                      url: event.url || null,
                      icsData: event.data,
                      etag: event.etag || null,
                      status: 'confirmed',
                      organizer: '',
                      busyStatus: 'busy'
                    };
                    
                    // Check if this event already exists in our database
                    const existingEvent = await storage.getEventByUID(caldavEvent.uid, calendarId);
                    
                    if (existingEvent) {
                      // Update existing event
                      console.log(`Updating existing event: ${caldavEvent.uid}`);
                      
                      // If etags match and we're not forcing refresh, skip this event
                      if (existingEvent.etag === event.etag && !forceRefresh) {
                        console.log(`Skipping update for event ${caldavEvent.uid} as etags match`);
                        continue;
                      }
                      
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
        } catch (err) {
          console.error(`Error fetching calendars:`, err);
        }
      } catch (loginError) {
        console.error(`Login failed for server ${url}:`, loginError);
        throw new Error(`CalDAV login failed: ${loginError.message}`);
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