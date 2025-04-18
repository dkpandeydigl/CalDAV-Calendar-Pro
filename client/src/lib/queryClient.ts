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

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  console.log(`Making ${method} request to ${url}`, data ? 'with data' : 'without data');
  
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        "X-Requested-With": "XMLHttpRequest" // Helps some servers identify AJAX requests
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include", // Include cookies for cross-origin requests
      mode: "same-origin", // Ensures cookies are sent for same-origin requests
      cache: "no-cache" // Prevents caching to ensure fresh responses
    });

    if (method === 'POST' && (url === '/api/login' || url === '/api/register')) {
      console.log(`Auth request to ${url} completed with status: ${res.status}`);
      // Log cookies for debugging (not the values, just existence)
      const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
      console.log('Cookies present after auth:', cookies.length ? cookies.join(', ') : '');
      
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
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include",
        mode: "same-origin",
        cache: "no-cache"
      });
      
      // Enhanced debugging for specific calendar endpoint
      if (url === '/api/calendars') {
        console.log(`[Calendar API] Response status: ${res.status}`);
        
        // Log session state
        const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('[Calendar API] Available cookies:', cookies.length ? cookies.join(', ') : 'none');
        
        // Try to get a brief look at the response body without consuming it
        const clonedRes = res.clone();
        try {
          const text = await clonedRes.text();
          const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
          console.log(`[Calendar API] Response preview: ${preview}`);
        } catch (err) {
          console.error('[Calendar API] Could not preview response', err);
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
      
      // Safely check content type before parsing as JSON
      if (!isJsonResponse(res)) {
        const textContent = await res.text();
        console.error('Non-JSON response from server:', textContent);
        throw new Error('Server returned an invalid response format. Please try again.');
      }
      
      return await res.json();
      
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
