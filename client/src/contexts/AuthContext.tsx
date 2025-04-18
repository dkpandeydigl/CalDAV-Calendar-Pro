import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Define the user type
export interface User {
  id: number;
  username: string;
}

// Login form values
interface LoginFormValues {
  username: string;
  password: string;
  caldavServerUrl: string;
}

// Register form values
interface RegisterFormValues {
  username: string;
  password: string;
  caldavServerUrl: string;
}

// Define the auth context type
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  loginMutation: any;
  registerMutation: any;
  forceRefreshUserData: () => void;
}

// Create the auth context with default values
const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  logout: async () => {},
  loginMutation: null,
  registerMutation: null,
  forceRefreshUserData: () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const { toast } = useToast();

  // Query to fetch the current user
  const { data, isLoading, isError, refetch } = useQuery<User>({
    queryKey: ['/api/user'],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // Don't refetch on window focus to avoid unwanted refreshes
    refetchOnWindowFocus: false,
  });
  
  // Force refresh function to manually trigger data reload
  const forceRefreshUserData = useCallback(() => {
    console.log('AuthContext: Force refreshing user data');
    // Invalidate important queries
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars/events'] });
    console.log('Manual force refresh of all user data requested');
    
    // Force a full query client reset
    queryClient.clear();
    
    // First refresh auth state
    refetch().then(() => {
      console.log('Auth refresh completed, now refreshing user data');
      
      // Then refresh all critical data
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Force immediate refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['/api/calendars'] });
        queryClient.refetchQueries({ queryKey: ['/api/shared-calendars'] });
        queryClient.refetchQueries({ queryKey: ['/api/events'] });
        
        console.log('All user data refreshed');
      }, 200);
    });
  }, [refetch]);
  
  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (data: LoginFormValues) => 
      apiRequest('POST', '/api/login', data),
    onSuccess: () => {
      // Refresh user data on successful login
      refetch();
      
      // Force a full refresh of all data after login
      setTimeout(() => {
        forceRefreshUserData();
      }, 500);
    },
    onError: (error: any) => {
      console.error('Login error:', error);
      toast({
        title: 'Login failed',
        description: error.message || 'Please check your credentials and try again.',
        variant: 'destructive',
      });
    }
  });
  
  // Register mutation
  const registerMutation = useMutation({
    mutationFn: (data: RegisterFormValues) => 
      apiRequest('POST', '/api/register', data),
    onSuccess: () => {
      // Refresh user data on successful registration
      refetch();
      
      // Show success toast
      toast({
        title: 'Registration successful',
        description: 'Your account has been created. Welcome!',
      });
      
      // Force a full refresh of all data after registration
      setTimeout(() => {
        forceRefreshUserData();
      }, 500);
    },
    onError: (error: any) => {
      console.error('Registration error:', error);
      toast({
        title: 'Registration failed',
        description: error.message || 'Please try again with different credentials.',
        variant: 'destructive',
      });
    }
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
    loginMutation,
    registerMutation,
    forceRefreshUserData
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};