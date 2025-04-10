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
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "continueWithEmpty";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      } else if (unauthorizedBehavior === "continueWithEmpty") {
        // This is useful for operations that need to continue even if user session is expired
        // but where server-side CalDAV credentials are still valid
        console.log(`401 on ${queryKey[0]}, but continuing with empty data`);
        return [];
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
