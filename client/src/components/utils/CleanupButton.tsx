import React from 'react';
import { Button } from "@/components/ui/button";
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface CleanupButtonProps {
  date: string;
  calendarId: number;
}

export function CleanupButton({ date, calendarId }: CleanupButtonProps) {
  const { toast } = useToast();

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/cleanup-duplicate-events', {
        date: date,
        calendarId: calendarId
      });
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Cleanup successful',
        description: data.message,
        variant: 'default',
      });
      
      // Invalidate events query to refresh the calendar
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    },
    onError: (error) => {
      toast({
        title: 'Cleanup failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  });

  const handleCleanup = () => {
    cleanupMutation.mutate();
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={handleCleanup}
      disabled={cleanupMutation.isPending}
    >
      {cleanupMutation.isPending ? 'Cleaning...' : 'Clean Duplicate Events'}
    </Button>
  );
}