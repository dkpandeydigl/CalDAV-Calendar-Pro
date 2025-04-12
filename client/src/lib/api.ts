/**
 * API utility functions for making requests to the server
 */

/**
 * Make an API request with proper credentials and JSON handling
 */
export async function apiRequest(
  method: string,
  url: string,
  data?: any
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  return fetch(url, options);
}

/**
 * Get share information for a calendar
 */
export async function getCalendarShares(calendarId: number) {
  try {
    console.log(`Fetching shares for calendar ID: ${calendarId}`);
    const response = await apiRequest('GET', `/api/calendars/${calendarId}/shares`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`Successfully fetched shares for calendar ${calendarId}:`, data);
      return data;
    }
    
    console.error(`API Error: Failed to fetch shares for calendar ${calendarId}. Status: ${response.status}`);
    const errorText = await response.text();
    console.error(`Error response body:`, errorText);
    throw new Error(`Failed to fetch shares for calendar ${calendarId}`);
  } catch (error) {
    console.error(`Exception fetching calendar shares:`, error);
    // Return empty array instead of throwing, to make component more resilient
    return [];
  }
}

/**
 * Share a calendar with a user
 */
export async function shareCalendar(
  calendarId: number, 
  email: string, 
  permissionLevel: 'view' | 'edit',
  syncWithServer: boolean = false
) {
  const apiUrl = syncWithServer
    ? `/api/calendars/${calendarId}/shares?syncWithServer=true`
    : `/api/calendars/${calendarId}/shares`;
  
  const response = await apiRequest('POST', apiUrl, {
    sharedWithEmail: email,
    permissionLevel
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to share calendar');
  }
  
  return await response.json();
}

/**
 * Remove calendar sharing
 */
export async function removeCalendarSharing(
  shareId: number,
  syncWithServer: boolean = false
) {
  const apiUrl = syncWithServer
    ? `/api/calendars/shares/${shareId}?syncWithServer=true`
    : `/api/calendars/shares/${shareId}`;
    
  const response = await apiRequest('DELETE', apiUrl);
  
  if (!response.ok) {
    throw new Error('Failed to remove calendar sharing');
  }
  
  return true;
}

/**
 * Update sharing permission
 */
export async function updateSharingPermission(
  shareId: number,
  permissionLevel: 'view' | 'edit',
  syncWithServer: boolean = false
) {
  const apiUrl = syncWithServer
    ? `/api/calendars/shares/${shareId}?syncWithServer=true`
    : `/api/calendars/shares/${shareId}`;
    
  const response = await apiRequest('PATCH', apiUrl, {
    permissionLevel
  });
  
  if (!response.ok) {
    throw new Error('Failed to update sharing permission');
  }
  
  return await response.json();
}