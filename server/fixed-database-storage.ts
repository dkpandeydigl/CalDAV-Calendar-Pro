  // Fixed implementation of getSharedCalendars that uses raw SQL to avoid the missing column issue
  async getSharedCalendars(userId: number): Promise<Calendar[]> {
    try {
      // Get the user
      const user = await this.getUser(userId);
      if (!user) {
        console.log(`User with ID ${userId} not found when looking for shared calendars`);
        return [];
      }
      
      console.log(`SHARING: Looking for calendars shared with user ID: ${userId}, username: ${user.username}, email: ${user.email || 'none'}`);
      
      try {
        // Try a direct SQL query that avoids the sharedByUserId column
        const rawSql = `
          SELECT * FROM calendar_sharing 
          WHERE shared_with_user_id = $1 
          OR shared_with_email = $2
          ${user.username && user.username.includes('@') ? 'OR shared_with_email = $3' : ''}
        `;
        
        const params = user.username && user.username.includes('@') 
          ? [userId, user.email || '', user.username] 
          : [userId, user.email || ''];
        
        const rawSharingRecords = await neonClient.query(rawSql, params);
        
        if (!rawSharingRecords.rows || !rawSharingRecords.rows.length) {
          console.log('No sharing records found');
          return [];
        }
        
        console.log(`Found ${rawSharingRecords.rows.length} sharing records`);
        
        // Extract calendar IDs from sharing records
        const calendarIds = Array.from(new Set(
          rawSharingRecords.rows.map((record: any) => record.calendar_id)
        ));
        
        if (!calendarIds.length) {
          return [];
        }
        
        // Fetch the actual calendar objects
        const sharedCalendars = await db.select()
          .from(calendars)
          .where(
            and(
              inArray(calendars.id, calendarIds as number[]),
              ne(calendars.userId, userId)
            )
          );
          
        console.log(`Found ${sharedCalendars.length} calendars`);
        
        // Create a permission map
        const permissionMap = new Map(
          rawSharingRecords.rows.map((record: any) => [record.calendar_id, record.permission_level])
        );
        
        // Enhance the calendars with additional info
        const enhancedCalendarsPromises = sharedCalendars.map(async (calendar) => {
          const owner = await this.getUser(calendar.userId);
          
          return {
            ...calendar,
            owner: owner ? {
              id: owner.id,
              username: owner.username,
              email: owner.email
            } : undefined,
            permissionLevel: permissionMap.get(calendar.id) || 'view',
            isShared: true
          };
        });
        
        return await Promise.all(enhancedCalendarsPromises);
      
      } catch (dbError) {
        console.error('Database error in getSharedCalendars:', dbError);
        return [];
      }
    } catch (error) {
      console.error('Error fetching shared calendars:', error);
      return [];
    }
  }