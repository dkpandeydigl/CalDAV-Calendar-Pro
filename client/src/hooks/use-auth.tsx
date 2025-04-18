import { createContext, ReactNode, useContext, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
  QueryClient
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, InsertUser>;
  isPostLoginLoading: boolean; // Added for post-login loading state
};

type LoginData = Pick<InsertUser, "username" | "password"> & { caldavServerUrl?: string };

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [isPostLoginLoading, setIsPostLoginLoading] = useState(false);
  
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Login mutation
  const loginMutation = useMutation<SelectUser, Error, LoginData>({
    mutationFn: async (credentials: LoginData) => {
      console.log("Login mutation called with credentials:", {
        username: credentials.username,
        hasPassword: !!credentials.password,
        serverUrl: credentials.caldavServerUrl
      });

      try {
        // Ensure caldavServerUrl is explicitly included in the request
        const requestData = {
          username: credentials.username,
          password: credentials.password,
          caldavServerUrl: credentials.caldavServerUrl || "https://zpush.ajaydata.com/davical/"
        };

        // Clear existing cookies for clean authentication
        const existingCookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('Existing cookies before login:', existingCookies.length ? existingCookies.join(', ') : 'None');

        // Enhanced fetch with specific options for session handling
        const res = await fetch("/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest", // Helps identify AJAX requests
            "Accept": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate" 
          },
          body: JSON.stringify(requestData),
          credentials: "include", // Critical for session cookies
          mode: "same-origin", // Security measure for cookies
          cache: "no-cache"
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`Login failed with status ${res.status}:`, errorText);
          throw new Error(errorText || `Login failed with status: ${res.status}`);
        }

        // Check for session cookie after login
        const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('Cookies after login:', cookies.length ? cookies.join(', ') : 'None');

        // Get the response data
        let userData;
        
        try {
          userData = await res.json();
          console.log("Login response received:", {
            status: res.status,
            userData: userData ? { id: userData.id, username: userData.username } : null
          });
          
          // Add delay before re-fetching user data to ensure session propagation
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Verify session is properly set with a follow-up request
          const verifyRes = await fetch("/api/user", {
            credentials: "include",
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "Cache-Control": "no-cache, no-store, must-revalidate"
            },
            cache: "no-cache"
          });
          
          console.log("Verification request status:", verifyRes.status);
          
          if (!verifyRes.ok) {
            console.warn("Session verification failed despite successful login");
          }
        } catch (parseError) {
          console.error("Failed to parse login response as JSON:", parseError);
          
          // If we can't parse the response as JSON but the status was 200,
          // try to verify the session is valid by making a direct user request
          const authCheckResponse = await fetch("/api/user", {
            credentials: "include",
            cache: "no-cache",
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "application/json",
              "Cache-Control": "no-cache, no-store, must-revalidate"
            }
          });
          
          if (authCheckResponse.ok) {
            userData = await authCheckResponse.json();
            console.log("User data fetched after login:", userData ? { 
              id: userData.id, 
              username: userData.username 
            } : null);
          } else {
            console.error("Failed to fetch user data after login");
            throw new Error("Login succeeded but failed to retrieve user data.");
          }
        }
        
        // Return the user data
        return userData;
      } catch (error) {
        console.error("Login request failed:", error);
        throw error;
      }
    },
    onSuccess: (userData) => {
      console.log("Login success, user data:", { id: userData.id, username: userData.username });
      
      // Set loading state to true to show overlay
      setIsPostLoginLoading(true);
      
      queryClient.setQueryData(["/api/user"], userData);
      
      // Automatically fetch calendars and connection data after login
      queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/server-connection"] });
      
      // Automatically sync with CalDAV server after login
      apiRequest("POST", "/api/sync")
        .then(() => {
          console.log("Sync completed successfully after login");
          // After sync, refresh calendar and event data
          queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
          queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          queryClient.invalidateQueries({ queryKey: ["/api/shared-calendars"] });
          
          // Set timeout to end loading state after 5 seconds
          setTimeout(() => {
            setIsPostLoginLoading(false);
          }, 5000);
        })
        .catch(err => {
          console.error("Failed to sync after login:", err);
          
          // Refresh data anyway even if sync fails
          queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
          queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          queryClient.invalidateQueries({ queryKey: ["/api/shared-calendars"] });
          
          // Set timeout to end loading state after 5 seconds
          setTimeout(() => {
            setIsPostLoginLoading(false);
          }, 5000);
        });

      toast({
        title: "Login successful",
        description: `Welcome back, ${userData.username}!`,
      });
    },
    onError: (err) => {
      toast({
        title: "Login failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Registration mutation
  const registerMutation = useMutation<SelectUser, Error, InsertUser & { caldavServerUrl?: string }>({
    mutationFn: async (credentials) => {
      console.log("Register mutation called with credentials:", {
        username: credentials.username,
        hasPassword: !!credentials.password,
        serverUrl: credentials.caldavServerUrl
      });

      try {
        // Explicitly include caldavServerUrl in the request
        const requestData = {
          ...credentials,
          // Make sure caldavServerUrl is included in the request
          caldavServerUrl: credentials.caldavServerUrl
        };

        // Use direct fetch call for registration to ensure proper session handling
        const res = await fetch("/api/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json"
          },
          body: JSON.stringify(requestData),
          credentials: "include",
          mode: "same-origin",
          cache: "no-cache"
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`Registration failed with status ${res.status}:`, errorText);
          throw new Error(errorText || `Registration failed with status: ${res.status}`);
        }

        // Check for session cookie after registration
        const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
        console.log('Cookies after registration:', cookies.length ? cookies.join(', ') : 'None');

        // Get the response data
        let userData;
        try {
          userData = await res.json();
          console.log("Registration response received:", {
            status: res.status,
            userData: userData ? { id: userData.id, username: userData.username } : null
          });
        } catch (parseError) {
          console.error("Failed to parse registration response as JSON:", parseError);
          // If we can't parse the response as JSON but the status was 200/201,
          // we'll try to verify the session is valid by making a request to /api/user directly
          const userResponse = await fetch("/api/user", {
            credentials: "include",
            cache: "no-cache",
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "application/json",
              "Cache-Control": "no-cache, no-store, must-revalidate"
            }
          });
          
          if (userResponse.ok) {
            userData = await userResponse.json();
            console.log("Retrieved user data after registration:", userData);
          } else {
            console.error("Failed to get user data after registration");
            throw new Error("Registration seemed to succeed but failed to get user data");
          }
        }
        
        return userData;
      } catch (error) {
        console.error("Registration request failed:", error);
        throw error;
      }
    },
    onSuccess: (userData) => {
      console.log("Registration success, user data:", { id: userData.id, username: userData.username });
      
      // Set loading state to true to show overlay
      setIsPostLoginLoading(true);
      
      queryClient.setQueryData(["/api/user"], userData);
      
      // Automatically fetch calendars and connection data after registration
      queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/server-connection"] });
      
      // Automatically sync with CalDAV server after registration
      apiRequest("POST", "/api/sync")
        .then(() => {
          console.log("Sync completed successfully after registration");
          // After sync, refresh calendar and event data
          queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
          queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          queryClient.invalidateQueries({ queryKey: ["/api/shared-calendars"] });
          
          // Set timeout to end loading state after 5 seconds
          setTimeout(() => {
            setIsPostLoginLoading(false);
          }, 5000);
        })
        .catch(err => {
          console.error("Failed to sync after registration:", err);
          
          // Refresh data anyway even if sync fails
          queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
          queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          queryClient.invalidateQueries({ queryKey: ["/api/shared-calendars"] });
          
          // Set timeout to end loading state after 5 seconds
          setTimeout(() => {
            setIsPostLoginLoading(false);
          }, 5000);
        });
      
      toast({
        title: "Registration successful",
        description: `Welcome, ${userData.username}!`,
      });
    },
    onError: (err) => {
      toast({
        title: "Registration failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      console.log("Logout mutation called");
      
      // First, check the current authentication state
      const beforeLogoutCookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
      console.log('Cookies before logout:', beforeLogoutCookies.length ? beforeLogoutCookies.join(', ') : 'None');
      
      await apiRequest("POST", "/api/logout");
      
      // Check cookies after logout to verify session was cleared
      const afterLogoutCookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
      console.log('Cookies after logout:', afterLogoutCookies.length ? afterLogoutCookies.join(', ') : 'None');
    },
    onSuccess: () => {
      // Clear user data from cache
      queryClient.setQueryData(["/api/user"], null);
      
      // Clear other data that shouldn't be accessible after logout
      queryClient.invalidateQueries({ queryKey: ["/api/calendars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shared-calendars"] });
      
      console.log("Logout successful");
      toast({
        title: "Logout successful",
        description: "You have been successfully logged out.",
      });
    },
    onError: (err) => {
      console.error("Logout failed:", err);
      toast({
        title: "Logout failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
        isPostLoginLoading
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}