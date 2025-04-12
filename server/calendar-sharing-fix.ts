import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './db';
import { and, inArray, ne } from 'drizzle-orm/expressions';
import { calendars } from '../shared/schema';

// Use the same connection as the main database
const neonDb: NeonQueryFunction<any, any> = neon(process.env.DATABASE_URL!);

/**
 * Fixed implementation of getSharedCalendars that uses raw SQL to avoid the missing column issue
 */
export async function getSharedCalendars(userId: number, storage: any): Promise<any[]> {
  try {
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      console.log(`User with ID ${userId} not found when looking for shared calendars`);
      return [];
    }
    
    console.log(`SHARING: Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'none'}`);
    
    try {
      // Build the SQL query parameters
      const params: any[] = [];
      params.push(userId);
      
      // Add email condition if available
      let emailCondition = '';
      if (user.email && user.email.trim() !== '') {
        params.push(user.email);
        emailCondition = 'OR shared_with_email = $2';
      }
      
      // Add username as email condition if it's an email address
      let usernameCondition = '';
      if (user.username && user.username.includes('@')) {
        params.push(user.username);
        usernameCondition = 'OR shared_with_email = $' + params.length;
      }
      
      // Execute the raw SQL query that doesn't rely on sharedByUserId
      const query = `
        SELECT * FROM calendar_sharing 
        WHERE shared_with_user_id = $1
        ${emailCondition}
        ${usernameCondition}
      `;
      
      console.log('Executing SQL query:', query, 'with params:', params);
      
      // Execute query directly without using query property
      const result = await neonDb(query, params);
      let records: any[] = [];
      
      // Handle different response formats that neonDb might return
      if (Array.isArray(result)) {
        if (result.length === 0) {
          console.log('No shared calendars found (array format)');
          return [];
        }
        records = result;
      } else if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
        if (result.rows.length === 0) {
          console.log('No shared calendars found (rows format)');
          return [];
        }
        records = result.rows;
      } else {
        console.log('No shared calendars found (unknown format)');
        return [];
      }
      
      console.log(`Found ${records.length} calendar sharing records`);
      
      // Extract calendar IDs from sharing records
      const calendarIds = Array.from(new Set(
        records.map((record: any) => record.calendar_id)
      ));
      
      // Fetch the actual calendar objects
      const sharedCalendars = await db.select()
        .from(calendars)
        .where(
          and(
            inArray(calendars.id, calendarIds as number[]),
            ne(calendars.userId, userId)
          )
        );
      
      console.log(`Found ${sharedCalendars.length} calendar objects`);
      
      // Create a map of permissions for each calendar
      const permissionMap = new Map(
        records.map((record: any) => [record.calendar_id, record.permission_level])
      );
      
      // Create a map to get the sharing record ID for each calendar (for permission management)
      const sharingIdMap = new Map(
        records.map((record: any) => [record.calendar_id, record.id])
      );
      
      // Add owner info and permissions to each calendar
      const enhancedCalendarsPromises = sharedCalendars.map(async (calendar: any) => {
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
      console.error('Database error in fixed getSharedCalendars:', dbError);
      return [];
    }
  } catch (error) {
    console.error('Error in fixed getSharedCalendars:', error);
    return [];
  }
}