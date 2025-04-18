// Enhanced version of useAuth with additional utilities
import { useAuth as useOriginalAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export function useAuth() {
  const auth = useOriginalAuth();
  const queryClient = useQueryClient();
  
  // Enhanced version of forceRefreshUserData that also clears the query cache
  const enhancedForceRefreshUserData = useCallback(() => {
    console.log('Enhanced force refresh: clearing query cache and refreshing user data');
    
    // First invalidate important queries
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars/events'] });
    
    // Then call the original refresh function
    if (auth.forceRefreshUserData) {
      auth.forceRefreshUserData();
    }
  }, [auth, queryClient]);
  
  // Calculate derived state
  const isAuthenticated = !!auth.user;
  
  // Return original auth context with enhanced functions
  return {
    ...auth,
    isAuthenticated,
    forceRefreshUserData: enhancedForceRefreshUserData
  };
}