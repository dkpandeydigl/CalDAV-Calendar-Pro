import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Function to check if a response is likely to be JSON
function isJsonResponse(res: Response): boolean {
  const contentType = res.headers.get('content-type');
  return contentType !== null && contentType.includes('application/json');
}

// Enhanced function for safe JSON parsing with detailed error handling
export async function safeParseJson<T>(res: Response): Promise<T> {
  // Check content type first
  if (!isJsonResponse(res)) {
    // Clone the response so we can read the body as text
    const clonedRes = res.clone();
    try {
      const textContent = await clonedRes.text();
      const preview = textContent.length > 300 ? 
        `${textContent.substring(0, 300)}...` : textContent;
      
      console.error(`Non-JSON response (${res.status}) with content type: ${res.headers.get('content-type')}`);
      console.error(`Response body preview: ${preview}`);
      
      // If it's HTML, it might be a server error page or authentication redirect
      if (textContent.includes('<!DOCTYPE html>') || textContent.includes('<html')) {
        if (textContent.includes('login') || textContent.includes('sign in')) {
          throw new Error('Session expired. Please refresh and log in again.');
        } else {
          throw new Error('Server returned HTML instead of JSON. Please try again later.');
        }
      }
      
      throw new Error(`Server returned non-JSON content: ${preview.substring(0, 50)}...`);
    } catch (textError) {
      if (textError instanceof Error) {
        throw textError; // Throw our specific error if we created one
      }
      // Generic error if we couldn't read the response as text
      throw new Error(`Server returned non-JSON content (${res.status})`);
    }
  }
  
  // Now try to parse as JSON
  try {
    return await res.json();
  } catch (jsonError) {
    console.error('Failed to parse JSON response:', jsonError);
    throw new Error('Invalid JSON response from server. Please try again.');
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  console.log(`Making ${method} request to ${url}`, data ? 'with data' : 'without data');
  
  try {
    const headers: Record<string, string> = {
      ...(data ? { "Content-Type": "application/json" } : {}),
      "X-Requested-With": "XMLHttpRequest", // Helps servers identify AJAX requests
      "Accept": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate", // Strong cache busting
      "Pragma": "no-cache" // Legacy cache busting for HTTP 1.0
    };
    
    // Enhanced request with improved cache control and session handling
    const res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include", // Include cookies for cross-origin requests
      mode: "same-origin", // Ensures cookies are sent for same-origin requests
      cache: "no-cache", // Prevents caching to ensure fresh responses
      redirect: "follow" // Follow any redirects (like after login)
    });

    // Enhanced logging for authentication endpoints
    if (method === 'POST' && (url === '/api/login' || url === '/api/register')) {
      console.log(`Auth request to ${url} completed with status: ${res.status}`);
      // Log cookies for debugging (not the values, just existence)
      const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
      console.log('Cookies present after auth:', cookies.length ? cookies.join(', ') : 'None');
      
      // Check for presence of session cookie specifically
      const hasSessionCookie = cookies.some(c => c.includes('sid'));
      console.log('Session cookie present:', hasSessionCookie);
      
      // For 5xx server errors, provide more detailed error information
      if (res.status >= 500) {
        console.error(`Server error (${res.status}) during auth request to ${url}`);
        try {
          const errorText = await res.text();
          console.error('Server error response:', errorText);
          throw new Error(`Server error (${res.status}): ${errorText}`);
        } catch (textError) {
          throw new Error(`Server error (${res.status}): Unable to read response`);
        }
      }
    }
    
    // For calendar retrieval endpoints, add enhanced logging
    if (url.includes('/api/calendars')) {
      console.log(`Calendar request to ${url} completed with status: ${res.status}`);
      
      if (res.status === 401) {
        console.error(`Authentication error for calendar request to ${url}`);
        console.log('Current cookies:', document.cookie ? 'Present' : 'None');
        
        // Try to get status of authentication in separate request
        try {
          const authCheckPromise = fetch('/api/user', { 
            credentials: 'include',
            cache: 'no-cache',
            headers: { 
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "application/json"
            }
          });
          
          // Add timeout to avoid hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Auth check timed out')), 3000)
          );
          
          const authCheckRes = await Promise.race([authCheckPromise, timeoutPromise]) as Response;
          console.log(`Auth check completed with status: ${authCheckRes.status}`);
        } catch (authCheckError) {
          console.error('Failed to check authentication status:', authCheckError);
        }
      }
    }
    
    // For non-authentication endpoints, just log 5xx errors
    if (res.status >= 500) {
      console.error(`Server error (${res.status}) for ${method} request to ${url}`);
    }
    
    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    // Log network errors
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.error(`Network error for ${method} request to ${url}: Could not connect to server`);
      throw new Error('Network error: Could not connect to server. Please check your internet connection.');
    }
    
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw" | "continueWithEmpty";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    console.log(`Making query request to ${url}`);
    
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate", // Strong cache control
          "Pragma": "no-cache" // Legacy cache busting
        },
        credentials: "include",
        mode: "same-origin",
        cache: "no-cache"
      });
      
      // Enhanced debugging for specific calendar endpoint
      if (url === '/api/calendars' || url.includes('/calendars')) {
        console.log(`[Calendar API] Response status: ${res.status} for ${url}`);
        
        // Log session state
        const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('[Calendar API] Available cookies:', cookies.length ? cookies.join(', ') : 'none');
        
        // Check for session cookie specifically
        const hasSessionCookie = cookies.some(c => c.includes('sid'));
        console.log('[Calendar API] Session cookie present:', hasSessionCookie);
        
        // For auth errors, try to fix by refreshing auth status
        if (res.status === 401) {
          console.log('[Calendar API] Authentication error, attempting to verify session status');
          
          try {
            // Try to re-validate session with user endpoint
            const authCheckRes = await fetch('/api/user', {
              credentials: 'include',
              cache: 'no-cache',
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate"
              }
            });
            
            console.log(`[Calendar API] Auth check returned: ${authCheckRes.status}`);
            
            // If auth check succeeded, try the original request again
            if (authCheckRes.ok) {
              console.log('[Calendar API] Auth check succeeded, retrying calendar request');
              
              // Retry the original request
              const retryRes = await fetch(url, {
                method: 'GET',
                headers: {
                  "X-Requested-With": "XMLHttpRequest",
                  "Accept": "application/json",
                  "Cache-Control": "no-cache, no-store, must-revalidate"
                },
                credentials: "include",
                mode: "same-origin",
                cache: "no-cache"
              });
              
              console.log(`[Calendar API] Retry request returned: ${retryRes.status}`);
              
              // If retry succeeded, use that response instead
              if (retryRes.ok) {
                console.log('[Calendar API] Retry succeeded');
                res = retryRes;
              }
            }
          } catch (authCheckErr) {
            console.error('[Calendar API] Auth check failed:', authCheckErr);
          }
        }
        
        // Try to get a brief look at the response body without consuming it
        if (res.ok) {
          const clonedRes = res.clone();
          try {
            const text = await clonedRes.text();
            const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
            console.log(`[Calendar API] Response preview: ${preview}`);
          } catch (err) {
            console.error('[Calendar API] Could not preview response', err);
          }
        }
      }

      if (res.status === 401) {
        console.log(`Authentication error (401) when accessing ${url}`);
        
        // Log session info for debugging
        const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('Current cookies:', cookies.length ? cookies.join(', ') : 'none');
        
        if (unauthorizedBehavior === "returnNull") {
          console.log(`Returning null for ${url} due to 401`);
          return null;
        } else if (unauthorizedBehavior === "continueWithEmpty") {
          // This is useful for operations that need to continue even if user session is expired
          // but where server-side CalDAV credentials are still valid
          console.log(`401 on ${url}, but continuing with empty data as configured`);
          return [];
        }
        
        // If we reach here, we're going to throw - try to get more information first
        try {
          const text = await res.text();
          console.log(`401 response body: ${text}`);
        } catch (err) {
          console.error('Could not read 401 response body', err);
        }
      }
      
      await throwIfResNotOk(res);
      
      // Use our enhanced safe JSON parsing function
      return await safeParseJson(res);
      
    } catch (fetchError) {
      console.error(`[API Error] Failed request to ${url}:`, fetchError);
      throw new Error(`Network error when requesting ${url}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
