import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getQueryFn } from '@/lib/queryClient';

interface UserDetails {
  id: number;
  username: string;
  email: string | null;
  displayName?: string;
}

/**
 * Hook to fetch user details by their IDs
 * @param userIds Array of user IDs to fetch details for
 * @returns Object with user details and loading/error states
 */
export function useUserDetails(userIds: number[]) {
  // Filter out duplicate IDs and create a stable query key
  const uniqueUserIds = useMemo(() => 
    Array.from(new Set(userIds.filter(id => id !== undefined && id !== null))), 
    [userIds]
  );

  // Build the query parameter - ensure we're using 'ids' parameter which server expects
  const queryParam = useMemo(() => {
    if (uniqueUserIds.length === 0) return '';
    return `ids=${uniqueUserIds.join(',')}`;
  }, [uniqueUserIds]);

  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery<UserDetails[]>({
    queryKey: ['/api/users/details', queryParam],
    queryFn: async () => {
      if (uniqueUserIds.length === 0) return [];
      try {
        // Direct API call to avoid issues with query string parameters
        const response = await fetch(`/api/users/details?ids=${uniqueUserIds.join(',')}`);
        if (response.status === 401) return null;
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return await response.json();
      } catch (err) {
        console.error("Error fetching user details:", err);
        return []; // Return empty array as fallback
      }
    },
    enabled: uniqueUserIds.length > 0, // Only run query if we have user IDs
    retry: 1, // Retry once if failed
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Create a map of userIds to user details for easier lookup
  const userDetailsMap = useMemo(() => {
    if (!data) return {};
    
    return data.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {} as Record<number, UserDetails>);
  }, [data]);

  // Function to get a specific user's details by ID
  const getUserById = (userId: number | undefined | null): UserDetails | undefined => {
    if (userId === undefined || userId === null) return undefined;
    return userDetailsMap[userId];
  };

  return {
    userDetails: data || [],
    userDetailsMap,
    getUserById,
    isLoading,
    error,
    refetch
  };
}