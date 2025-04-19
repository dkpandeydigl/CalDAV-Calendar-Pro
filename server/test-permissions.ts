/**
 * Debug utility for testing permissions in calendar sharing
 */
import { Response } from 'express';
import type { IStorage } from './storage';

export function registerTestPermissionEndpoints(app: any, storage: IStorage) {
  // Get all sharing permissions for troubleshooting
  app.get('/api/test/calendar-sharing', async (req, res: Response) => {
    try {
      // This is an admin-only endpoint for debugging
      if (!req.user || req.user.id !== 4) {
        return res.status(403).json({ message: 'Unauthorized - Admin only endpoint' });
      }

      const userId = req.user.id;
      console.log(`[TEST] Fetching all calendar sharing records for user ${userId}`);

      // Direct SQL query to get all calendar sharing records
      const allSharings = await storage.getAllCalendarSharings();
      console.log(`[TEST] Found ${allSharings.length} total calendar sharing records`);

      // Get records where this user shared calendars with others
      const sharedByMe = allSharings.filter(s => s.sharedByUserId === userId);
      console.log(`[TEST] Found ${sharedByMe.length} calendars shared by user ${userId}`);

      // Get records where others shared calendars with this user
      const sharedWithMe = allSharings.filter(s => 
        s.sharedWithUserId === userId || 
        s.sharedWithEmail === req.user.email || 
        s.sharedWithEmail === req.user.username
      );
      console.log(`[TEST] Found ${sharedWithMe.length} calendars shared with user ${userId}`);

      // Return detailed debug info
      return res.json({
        userId,
        username: req.user.username,
        email: req.user.email,
        totalSharings: allSharings.length,
        sharedByMe,
        sharedWithMe,
        allSharings: allSharings.map(s => ({
          ...s,
          debug: {
            matchesUserId: s.sharedWithUserId === userId,
            matchesEmail: req.user.email ? s.sharedWithEmail === req.user.email : false,
            matchesUsername: s.sharedWithEmail === req.user.username
          }
        }))
      });
    } catch (err) {
      console.error('[TEST] Error in test/calendar-sharing endpoint:', err);
      return res.status(500).json({ 
        message: 'Error fetching sharing records', 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  });

  // Test creating a sharing with explicit permission
  app.post('/api/test/create-sharing', async (req, res: Response) => {
    try {
      // This is an admin-only endpoint for debugging
      if (!req.user || req.user.id !== 4) {
        return res.status(403).json({ message: 'Unauthorized - Admin only endpoint' });
      }

      const { calendarId, sharedWithEmail, permissionLevel = 'edit' } = req.body;
      
      if (!calendarId || !sharedWithEmail) {
        return res.status(400).json({ message: 'Missing required fields: calendarId, sharedWithEmail' });
      }

      console.log(`[TEST] Creating test sharing for calendar ${calendarId} with ${sharedWithEmail}, permission: ${permissionLevel}`);

      // Create the sharing record
      const sharing = await storage.shareCalendar({
        calendarId: Number(calendarId),
        sharedWithEmail,
        sharedWithUserId: null, // The server will resolve this
        permissionLevel,
        sharedByUserId: req.user.id,
        createdAt: new Date(),
        lastModified: new Date()
      });

      console.log(`[TEST] Created sharing record with ID ${sharing.id}, permission: ${sharing.permissionLevel}`);
      
      return res.status(201).json({
        success: true,
        sharing,
        message: `Calendar shared with ${sharedWithEmail} with ${permissionLevel} permission`
      });
    } catch (err) {
      console.error('[TEST] Error in test/create-sharing endpoint:', err);
      return res.status(500).json({ 
        message: 'Error creating sharing record', 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  });

  // Test creating a sharing with explicit edit permission for a specific calendar
  app.post('/api/test/share-with-edit', async (req, res: Response) => {
    try {
      // This is an admin-only endpoint for debugging
      if (!req.user || req.user.id !== 4) {
        return res.status(403).json({ message: 'Unauthorized - Admin only endpoint' });
      }

      const { calendarId, email } = req.query;
      
      if (!calendarId || !email) {
        return res.status(400).json({ message: 'Missing required query params: calendarId, email' });
      }

      console.log(`[TEST] Creating edit permission sharing for calendar ${calendarId} with ${email}`);

      // Create the sharing record with explicit edit permission
      const sharing = await storage.shareCalendar({
        calendarId: Number(calendarId),
        sharedWithEmail: String(email),
        sharedWithUserId: null, // The server will resolve this
        permissionLevel: 'edit', // Force edit permission for testing
        sharedByUserId: req.user.id,
        createdAt: new Date(),
        lastModified: new Date()
      });

      console.log(`[TEST] Created EDIT sharing record with ID ${sharing.id}, permission: ${sharing.permissionLevel}`);
      
      return res.status(201).json({
        success: true,
        sharing,
        message: `Calendar ${calendarId} shared with ${email} with EDIT permission`
      });
    } catch (err) {
      console.error('[TEST] Error in test/share-with-edit endpoint:', err);
      return res.status(500).json({ 
        message: 'Error creating sharing record', 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  });
}