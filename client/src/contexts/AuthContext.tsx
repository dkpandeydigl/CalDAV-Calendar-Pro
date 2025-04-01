import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

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
      setUser(data);
    } else if (isError) {
      setUser(null);
    }
  }, [data, isError]);

  // Logout function
  const logout = async () => {
    try {
      await apiRequest('POST', '/api/logout');
      setUser(null);
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