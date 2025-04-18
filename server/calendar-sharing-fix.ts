import { db } from './db';
import { and, inArray, ne, eq, or } from 'drizzle-orm';
import { calendars, calendarSharing } from '../shared/schema';

/**
 * Fixed implementation of getSharedCalendars that uses the Drizzle ORM properly
 * This version uses the correct table schema and field names
 */
export async function getSharedCalendars(userId: number, storage: any): Promise<any[]> {
  try {
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      console.log(`User with ID ${userId} not found when looking for shared calendars`);
      return [];
    }
    
    console.log(`Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'none'}`);
    
    try {
      // Build query conditions for shared calendars using drizzle-orm
      const conditions = [];
      
      // Condition 1: Shared directly with user ID
      conditions.push(eq(calendarSharing.sharedWithUserId, userId));
      
      // Condition 2: Shared with user's email if available
      if (user.email && user.email.trim() !== '') {
        conditions.push(eq(calendarSharing.sharedWithEmail, user.email));
      }
      
      // Condition 3: Shared with username if it's an email address
      if (user.username && user.username.includes('@')) {
        conditions.push(eq(calendarSharing.sharedWithEmail, user.username));
      }
      
      // Execute the query using Drizzle ORM
      const sharingRecords = await db.select()
        .from(calendarSharing)
        .where(or(...conditions));
      
      console.log(`Found ${sharingRecords.length} sharing records for user ${user.username}`);
      
      if (sharingRecords.length === 0) {
        return [];
      }
      
      // Extract calendar IDs from sharing records
      const calendarIds = Array.from(new Set(
        sharingRecords.map((record) => record.calendarId)
      ));
      
      // Fetch the actual calendar objects
      const sharedCalendars = await db.select()
        .from(calendars)
        .where(
          and(
            inArray(calendars.id, calendarIds),
            ne(calendars.userId, userId)
          )
        );
      
      console.log(`Found ${sharedCalendars.length} calendar objects`);
      
      // Create a map of permissions for each calendar
      const permissionMap = new Map(
        sharingRecords.map((record) => [record.calendarId, record.permissionLevel])
      );
      
      // Create a map to get the sharing record ID for each calendar (for permission management)
      const sharingIdMap = new Map(
        sharingRecords.map((record) => [record.calendarId, record.id])
      );
      
      // Add owner info and permissions to each calendar
      const enhancedCalendarsPromises = sharedCalendars.map(async (calendar) => {
        // Get owner information
        const owner = await storage.getUser(calendar.userId);
        
        return {
          ...calendar,
          owner: owner ? {
            id: owner.id,
            username: owner.username,
            email: owner.email || owner.username
          } : undefined,
          permissionLevel: permissionMap.get(calendar.id) || 'view',
          sharingId: sharingIdMap.get(calendar.id), // Add the sharing ID for permission updates
          isShared: true
        };
      });
      
      return await Promise.all(enhancedCalendarsPromises);
      
    } catch (dbError) {
      console.error('Database error in getSharedCalendars:', dbError);
      return [];
    }
  } catch (error) {
    console.error('Error in getSharedCalendars:', error);
    return [];
  }
}