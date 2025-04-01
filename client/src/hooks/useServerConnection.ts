import { useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useCalendarContext } from '@/contexts/CalendarContext';
import type { ServerConnection } from '@shared/schema';

// Define the server connection without the password
export type ServerConnectionWithoutPassword = Omit<ServerConnection, 'password'>;

// Define type for new connection data input
export type NewConnectionData = {
  url: string;
  username: string;
  password: string;
  autoSync: boolean;
  syncInterval: number;
};

// Define type for update connection data input
export type UpdateConnectionData = {
  id: number;
  data: Partial<ServerConnection>;
};

export const useServerConnection = () => {
  const { toast } = useToast();
  const { setServerStatus } = useCalendarContext();

  // Use a more basic query without custom handlers
  const serverConnectionQuery = useQuery<ServerConnectionWithoutPassword>({
    queryKey: ['/api/server-connection']
  });
  
  // Use an effect to handle the status changes
  useEffect(() => {
    if (serverConnectionQuery.error || !serverConnectionQuery.data) {
      setServerStatus('disconnected');
    } else if (serverConnectionQuery.data.status === 'connected') {
      setServerStatus('connected');
    } else {
      setServerStatus('disconnected');
    }
  }, [serverConnectionQuery.data, serverConnectionQuery.error, setServerStatus]);

  const createServerConnectionMutation = useMutation<
    ServerConnectionWithoutPassword, 
    Error, 
    NewConnectionData
  >({
    mutationFn: (connectionData) => {
      return apiRequest('POST', '/api/server-connection', connectionData)
        .then(res => res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/server-connection'] });
      if (data && data.status === 'connected') {
        setServerStatus('connected');
      }
      toast({
        title: "Server Connection Established",
        description: "Successfully connected to the CalDAV server."
      });
    },
    onError: (error) => {
      setServerStatus('disconnected');
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to the CalDAV server. Please check your credentials.",
        variant: "destructive"
      });
    }
  });

  const updateServerConnectionMutation = useMutation<
    ServerConnectionWithoutPassword, 
    Error, 
    UpdateConnectionData
  >({
    mutationFn: ({ id, data }) => {
      return apiRequest('PUT', `/api/server-connection/${id}`, data)
        .then(res => res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/server-connection'] });
      if (data && data.status === 'connected') {
        setServerStatus('connected');
      } else {
        setServerStatus('disconnected');
      }
      toast({
        title: "Server Settings Updated",
        description: "CalDAV server settings have been updated successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update server settings.",
        variant: "destructive"
      });
    }
  });

  const disconnectServerMutation = useMutation<
    boolean | any, 
    Error, 
    number
  >({
    mutationFn: (id) => {
      return apiRequest('DELETE', `/api/server-connection/${id}`)
        .then(res => {
          if (res.status === 204) return true;
          return res.json();
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/server-connection'] });
      setServerStatus('disconnected');
      toast({
        title: "Server Disconnected",
        description: "Disconnected from the CalDAV server."
      });
    },
    onError: (error) => {
      toast({
        title: "Disconnect Failed",
        description: error.message || "Failed to disconnect from the server.",
        variant: "destructive"
      });
    }
  });

  const syncWithServerMutation = useMutation<
    any, 
    Error, 
    void
  >({
    mutationFn: () => {
      return apiRequest('POST', '/api/sync')
        .then(res => res.json());
    },
    onSuccess: () => {
      // Invalidate all event and calendar queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      queryClient.invalidateQueries({ queryKey: ['/api/server-connection'] });
      setServerStatus('connected');
      toast({
        title: "Sync Complete",
        description: "Successfully synchronized with the CalDAV server."
      });
    },
    onError: (error) => {
      setServerStatus('disconnected');
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to synchronize with the server.",
        variant: "destructive"
      });
    }
  });

  return {
    serverConnection: serverConnectionQuery.data,
    isLoading: serverConnectionQuery.isLoading,
    error: serverConnectionQuery.error,
    createServerConnection: createServerConnectionMutation.mutate,
    updateServerConnection: updateServerConnectionMutation.mutate,
    disconnectServer: disconnectServerMutation.mutate,
    syncWithServer: syncWithServerMutation.mutate,
    isSyncing: syncWithServerMutation.isPending
  };
};
