import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';

// Define the user type
export interface User {
  id: number;
  username: string;
}

// Define the auth context type
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

// Create the auth context
const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);

  // Query to fetch the current user
  const { data, isLoading, isError, refetch } = useQuery<User>({
    queryKey: ['/api/user'],
    retry: false,
    // Don't refetch on window focus to avoid unwanted refreshes
    refetchOnWindowFocus: false,
  });

  // Update user state when data changes
  useEffect(() => {
    if (data) {
      // User logged in
      setUser(data);
      
      // When user changes, force a refresh of user-specific data
      // This ensures the new user doesn't see the previous user's data
      console.log(`User authenticated: ${data.username} (ID: ${data.id})`);
      
      // IMPORTANT: We need to wait a moment to ensure all query keys are properly registered 
      // before invalidating them, otherwise the queries won't reload properly
      setTimeout(() => {
        console.log('Refreshing all user data with forced invalidation');
        
        // Invalidate shared calendars query to trigger a fresh fetch for the new user
        // Use the new user ID in the query key
        queryClient.invalidateQueries({ 
          queryKey: ['/api/shared-calendars'] 
        });
        
        // Also invalidate other user-specific queries as needed
        queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        // Force refetch of all critical queries
        queryClient.refetchQueries({ queryKey: ['/api/calendars'] });
        queryClient.refetchQueries({ queryKey: ['/api/shared-calendars'] });
        queryClient.refetchQueries({ queryKey: ['/api/events'] });
      }, 500);
    } else if (isError) {
      // User logged out or auth error
      setUser(null);
      
      // Clear shared calendars data on logout to prevent data leak to next user
      queryClient.setQueryData(['/api/shared-calendars'], []);
    }
  }, [data, isError]);

  // Logout function
  const logout = async () => {
    try {
      // Clear all shared calendars from cache BEFORE logout
      console.log('Clearing shared calendars from cache for user switch');
      queryClient.setQueryData(['/api/shared-calendars'], []);
      queryClient.removeQueries({ queryKey: ['/api/shared-calendars'] });
      
      // Now proceed with logout
      await apiRequest('POST', '/api/logout');
      setUser(null);
      
      // Clear ALL user-specific queries from cache
      queryClient.removeQueries();
      
      // Force refetch to update auth state
      refetch();
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  // Auth context value
  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};