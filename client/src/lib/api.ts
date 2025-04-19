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
  // CRITICAL FIX: Log and normalize permission values for better troubleshooting
  console.log(`[API] Sharing calendar ID ${calendarId} with ${email}, permission: ${permissionLevel}`);
  
  // Normalize permission value to ensure consistent format
  // This provides an additional safeguard in case the UI sends unexpected values
  const normalizedPermission = 
    permissionLevel.toLowerCase().includes('edit') || 
    permissionLevel.toLowerCase().includes('write') ? 
    'edit' : 'view';
    
  if (normalizedPermission !== permissionLevel) {
    console.log(`[API] Normalized permission from "${permissionLevel}" to "${normalizedPermission}"`);
  }
  
  const apiUrl = syncWithServer
    ? `/api/calendars/${calendarId}/shares?syncWithServer=true`
    : `/api/calendars/${calendarId}/shares`;
  
  // Get current user data to include sharedByUserId
  const userResponse = await apiRequest('GET', '/api/user');
  let currentUserId = null;
  
  if (userResponse.ok) {
    const userData = await userResponse.json();
    currentUserId = userData.id;
  } else {
    throw new Error('Failed to get current user data');
  }
  
  const requestData = {
    email: email, // Server expects 'email', not 'sharedWithEmail'
    permissionLevel: normalizedPermission,
    permission: normalizedPermission, // Include both for backward compatibility
    sharedByUserId: currentUserId
  };
  
  console.log(`[API] Sending calendar sharing request:`, requestData);
  
  const response = await apiRequest('POST', apiUrl, requestData);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[API] Failed to share calendar:`, errorText);
    
    try {
      const error = JSON.parse(errorText);
      throw new Error(error.message || 'Failed to share calendar');
    } catch (e) {
      throw new Error('Failed to share calendar: ' + errorText);
    }
  }
  
  const result = await response.json();
  console.log(`[API] Successfully shared calendar:`, result);
  return result;
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
  // CRITICAL FIX: Log and normalize permission values for better troubleshooting
  console.log(`[API] Updating sharing permission for ID ${shareId} to ${permissionLevel}`);
  
  // Normalize permission value to ensure consistent format
  // This provides an additional safeguard in case the UI sends unexpected values
  const normalizedPermission = 
    permissionLevel.toLowerCase().includes('edit') || 
    permissionLevel.toLowerCase().includes('write') ? 
    'edit' : 'view';
    
  if (normalizedPermission !== permissionLevel) {
    console.log(`[API] Normalized permission from "${permissionLevel}" to "${normalizedPermission}"`);
  }
  
  const apiUrl = syncWithServer
    ? `/api/calendar-sharings/${shareId}?syncWithServer=true`
    : `/api/calendar-sharings/${shareId}`;
    
  // CRITICAL FIX: Include both permission fields for consistency and backwards compatibility
  const requestData = {
    permissionLevel: normalizedPermission,
    permission: normalizedPermission // Include both for backward compatibility
  };
  
  console.log(`[API] Sending permission update request:`, requestData);
  const response = await apiRequest('PATCH', apiUrl, requestData);
  
  if (!response.ok) {
    console.error(`[API] Failed to update sharing permission for ID ${shareId}`, await response.text());
    throw new Error('Failed to update sharing permission');
  }
  
  const result = await response.json();
  console.log(`[API] Successfully updated sharing permission for ID ${shareId}`, result);
  return result;
}

/**
 * Update user's full name for display in email communications
 */
export async function updateUserFullName(fullName: string) {
  const response = await apiRequest('PUT', '/api/user/fullname', { fullName });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update full name');
  }
  
  return await response.json();
}