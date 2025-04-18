import { createContext, ReactNode, useContext, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
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

  const loginMutation = useMutation({
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

        const res = await apiRequest("POST", "/api/login", requestData);
        const userData = await res.json();
        console.log("Login response received:", {
          status: res.status,
          userData: userData ? { id: userData.id, username: userData.username } : null
        });
        return userData;
      } catch (error) {
        console.error("Login request failed:", error);
        throw error;
      }
    },
    onSuccess: (user: SelectUser) => {
      console.log("Login success, user data:", { id: user.id, username: user.username });
      
      // Set loading state to true to show overlay
      setIsPostLoginLoading(true);
      
      queryClient.setQueryData(["/api/user"], user);
      
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
        .catch(error => {
          console.error("Failed to sync after login:", error);
          
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
        description: `Welcome back, ${user.username}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: InsertUser & { caldavServerUrl?: string }) => {
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

        const res = await apiRequest("POST", "/api/register", requestData);
        const userData = await res.json();
        console.log("Registration response received:", {
          status: res.status,
          userData: userData ? { id: userData.id, username: userData.username } : null
        });
        return userData;
      } catch (error) {
        console.error("Registration request failed:", error);
        throw error;
      }
    },
    onSuccess: (user: SelectUser) => {
      console.log("Registration success, user data:", { id: user.id, username: user.username });
      
      // Set loading state to true to show overlay
      setIsPostLoginLoading(true);
      
      queryClient.setQueryData(["/api/user"], user);
      
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
        .catch(error => {
          console.error("Failed to sync after registration:", error);
          
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
        description: `Welcome, ${user.username}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Logged out successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
        isPostLoginLoading,
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