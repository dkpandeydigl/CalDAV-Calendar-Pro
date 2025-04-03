import { storage } from './storage';
import { ServerConnection } from '@shared/schema';
import { DAVClient } from 'tsdav';

interface SyncJob {
  userId: number;
  connection: ServerConnection;
  interval: number; // in seconds
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastSync: Date | null;
  stopRequested: boolean;
  autoSync: boolean;
}

/**
 * SyncService handles background synchronization of calendars for all users
 * It maintains a collection of sync jobs, one per user, and handles
 * scheduling, starting, stopping, and configuring synchronization
 */
class SyncService {
  private jobs: Map<number, SyncJob> = new Map();
  private defaultSyncInterval = 300; // 5 minutes in seconds
  private syncInProgress: Set<number> = new Set();
  private isInitialized = false;

  /**
   * Initialize the sync service by loading all user connections from storage
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('SyncService already initialized, skipping...');
      return;
    }

    try {
      console.log('Initializing SyncService...');
      // Get all users from storage
      const users = await storage.getAllUsers();
      let setupCount = 0;

      // For each user, check if they have a server connection and set up sync
      for (const user of users) {
        const connection = await storage.getServerConnection(user.id);
        if (connection) {
          await this.setupSyncForUser(user.id, connection);
          setupCount++;
        }
      }

      console.log(`SyncService initialized with ${setupCount} sync jobs`);
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize SyncService:', error);
    }
  }

  /**
   * Set up a sync job for a user with their server connection
   */
  async setupSyncForUser(userId: number, connection: ServerConnection) {
    console.log(`Setting up sync for user ID ${userId}`);
    
    // If there's already a job for this user, stop it
    if (this.jobs.has(userId)) {
      await this.stopSync(userId);
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
      autoSync
    };
    
    // Store the job
    this.jobs.set(userId, job);
    
    // Start sync if auto-sync is enabled
    if (autoSync) {
      this.startSync(userId);
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
   * Run a sync immediately for a user
   */
  async syncNow(userId: number): Promise<boolean> {
    const job = this.jobs.get(userId);
    if (!job) {
      console.log(`No sync job found for user ID ${userId}`);
      return false;
    }
    
    // If a sync is already in progress, don't start another one
    if (job.running || this.syncInProgress.has(userId)) {
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
      const davCalendars = await davClient.fetchCalendars();
      
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