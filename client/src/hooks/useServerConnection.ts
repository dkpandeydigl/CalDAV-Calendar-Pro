import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useCalendarContext } from '@/contexts/CalendarContext';
import type { ServerConnection } from '@shared/schema';

export const useServerConnection = () => {
  const { toast } = useToast();
  const { setServerStatus } = useCalendarContext();

  const serverConnectionQuery = useQuery<Omit<ServerConnection, 'password'>>({
    queryKey: ['/api/server-connection'],
    onError: () => {
      setServerStatus('disconnected');
    },
    onSuccess: (data) => {
      if (data && data.status === 'connected') {
        setServerStatus('connected');
      } else {
        setServerStatus('disconnected');
      }
    }
  });

  const createServerConnectionMutation = useMutation({
    mutationFn: (connectionData: Omit<ServerConnection, 'id' | 'userId' | 'lastSync' | 'status'>) => {
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

  const updateServerConnectionMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: Partial<ServerConnection> }) => {
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

  const disconnectServerMutation = useMutation({
    mutationFn: (id: number) => {
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

  const syncWithServerMutation = useMutation({
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
