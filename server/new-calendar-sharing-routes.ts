import { Router } from 'express';
import { z } from 'zod';
import { getCalendarSharingService } from './calendar-sharing-service';
import { storage } from './storage';

// Create a router
const sharingRouter = Router();
const sharingService = getCalendarSharingService(storage);

// Middleware to ensure user is authenticated
const isAuthenticated = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
};

// Validation schemas
const shareCalendarSchema = z.object({
  calendarId: z.number(),
  recipientEmail: z.string().email(),
  permission: z.enum(['view', 'edit']).default('view')
});

const updatePermissionSchema = z.object({
  permission: z.enum(['view', 'edit'])
});

// Get calendars shared with me
sharingRouter.get('/shared-calendars', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await sharingService.getSharedCalendarsForUser(userId);
    
    if ('error' in result) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json(result);
  } catch (error) {
    console.error('[SHARING] Error getting shared calendars:', error);
    return res.status(500).json({ 
      message: 'Failed to get shared calendars',
      error: error.message 
    });
  }
});

// Share a calendar with someone
sharingRouter.post('/share-calendar', isAuthenticated, async (req, res) => {
  try {
    // Validate request body
    const validation = shareCalendarSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: 'Invalid request data',
        errors: validation.error.format()
      });
    }
    
    const { calendarId, recipientEmail, permission } = validation.data;
    const ownerId = req.user.id;
    
    // Share the calendar
    const result = await sharingService.shareCalendar(
      calendarId,
      ownerId,
      recipientEmail,
      permission
    );
    
    if ('error' in result) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.status(201).json(result);
  } catch (error) {
    console.error('[SHARING] Error sharing calendar:', error);
    return res.status(500).json({ 
      message: 'Failed to share calendar',
      error: error.message 
    });
  }
});

// Update sharing permissions
sharingRouter.patch('/sharing/:id', isAuthenticated, async (req, res) => {
  try {
    const sharingId = parseInt(req.params.id);
    if (isNaN(sharingId)) {
      return res.status(400).json({ message: 'Invalid sharing ID' });
    }
    
    // Validate request body
    const validation = updatePermissionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: 'Invalid request data',
        errors: validation.error.format()
      });
    }
    
    // Update sharing permissions
    const result = await sharingService.updateSharingPermission(
      sharingId,
      validation.data.permission
    );
    
    if ('error' in result) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json(result);
  } catch (error) {
    console.error('[SHARING] Error updating sharing:', error);
    return res.status(500).json({ 
      message: 'Failed to update sharing',
      error: error.message 
    });
  }
});

// Remove a sharing
sharingRouter.delete('/sharing/:id', isAuthenticated, async (req, res) => {
  try {
    const sharingId = parseInt(req.params.id);
    if (isNaN(sharingId)) {
      return res.status(400).json({ message: 'Invalid sharing ID' });
    }
    
    const result = await sharingService.removeSharing(sharingId);
    
    if (result === true) {
      return res.json({ success: true });
    } else {
      return res.status(400).json({ message: (result as any).error });
    }
  } catch (error) {
    console.error('[SHARING] Error removing sharing:', error);
    return res.status(500).json({ 
      message: 'Failed to remove sharing',
      error: error.message 
    });
  }
});

// Get shares for a calendar (owner only)
sharingRouter.get('/calendar/:id/shares', isAuthenticated, async (req, res) => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) {
      return res.status(400).json({ message: 'Invalid calendar ID' });
    }
    
    const result = await sharingService.getCalendarShares(calendarId, req.user.id);
    
    if ('error' in result) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json(result);
  } catch (error) {
    console.error('[SHARING] Error getting calendar shares:', error);
    return res.status(500).json({ 
      message: 'Failed to get calendar shares',
      error: error.message 
    });
  }
});

// Remove all shares for a calendar (owner only)
sharingRouter.delete('/calendar/:id/shares', isAuthenticated, async (req, res) => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) {
      return res.status(400).json({ message: 'Invalid calendar ID' });
    }
    
    const result = await sharingService.unshareCalendar(calendarId, req.user.id);
    
    if (result === true) {
      return res.json({ success: true });
    } else {
      return res.status(400).json({ message: (result as any).error });
    }
  } catch (error) {
    console.error('[SHARING] Error unsharing calendar:', error);
    return res.status(500).json({ 
      message: 'Failed to unshare calendar',
      error: error.message 
    });
  }
});

// For backward compatibility - map old endpoints to new service
export function registerCompatibilityRoutes(app: any, customSharingService: any = null) {
  // Use provided sharing service or fall back to the default one
  const servicesToUse = customSharingService || sharingService;
  
  console.log('[SHARING] Registering compatibility routes with service');
  
  // GET /api/shared-calendars - Get calendars shared with me
  app.get('/api/shared-calendars', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await servicesToUse.getSharedCalendarsForUser(userId);
      
      if ('error' in result) {
        return res.status(400).json({ message: result.error });
      }
      
      return res.json(result);
    } catch (error) {
      console.error('[SHARING] Error getting shared calendars:', error);
      return res.status(500).json({ 
        message: 'Failed to get shared calendars',
        error: error.message 
      });
    }
  });
  
  // POST /api/calendar-sharing - Share a calendar
  app.post('/api/calendar-sharing', isAuthenticated, async (req, res) => {
    try {
      // Support old format with permissionLevel field
      const { calendarId, sharedWithEmail, permissionLevel = 'view' } = req.body;
      const ownerId = req.user.id;
      
      if (!calendarId || !sharedWithEmail) {
        return res.status(400).json({ 
          message: 'Invalid request. calendarId and sharedWithEmail are required.' 
        });
      }
      
      // Map permissionLevel to permission for the new service
      const permission = permissionLevel === 'edit' ? 'edit' : 'view';
      
      // Share the calendar
      const result = await servicesToUse.shareCalendar(
        calendarId,
        ownerId,
        sharedWithEmail,
        permission
      );
      
      if ('error' in result) {
        return res.status(400).json({ message: result.error });
      }
      
      return res.status(201).json(result);
    } catch (error) {
      console.error('[SHARING] Error sharing calendar:', error);
      return res.status(500).json({ 
        message: 'Failed to share calendar',
        error: error.message 
      });
    }
  });
  
  // PATCH /api/calendar-sharings/:id - Update sharing permissions
  app.patch('/api/calendar-sharings/:id', isAuthenticated, async (req, res) => {
    try {
      const sharingId = parseInt(req.params.id);
      if (isNaN(sharingId)) {
        return res.status(400).json({ message: 'Invalid sharing ID' });
      }
      
      // Support old format with permissionLevel field
      const { permissionLevel = 'view' } = req.body;
      
      // Map permissionLevel to permission for the new service
      const permission = permissionLevel === 'edit' ? 'edit' : 'view';
      
      // Update sharing permissions
      const result = await servicesToUse.updateSharingPermission(
        sharingId,
        permission
      );
      
      if ('error' in result) {
        return res.status(400).json({ message: result.error });
      }
      
      return res.json(result);
    } catch (error) {
      console.error('[SHARING] Error updating sharing:', error);
      return res.status(500).json({ 
        message: 'Failed to update sharing',
        error: error.message 
      });
    }
  });
  
  // DELETE /api/calendar-sharings/:id - Remove a sharing
  app.delete('/api/calendar-sharings/:id', isAuthenticated, async (req, res) => {
    try {
      const sharingId = parseInt(req.params.id);
      if (isNaN(sharingId)) {
        return res.status(400).json({ message: 'Invalid sharing ID' });
      }
      
      const result = await servicesToUse.removeSharing(sharingId);
      
      if (result === true) {
        return res.json({ success: true });
      } else {
        return res.status(400).json({ message: (result as any).error });
      }
    } catch (error) {
      console.error('[SHARING] Error removing sharing:', error);
      return res.status(500).json({ 
        message: 'Failed to remove sharing',
        error: error.message 
      });
    }
  });
}

export default sharingRouter;