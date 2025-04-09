import React from 'react';
import { Button } from "@/components/ui/button";
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface CleanupButtonProps {
  date: string;
  calendarId: number;
}

export function CleanupButton({ date, calendarId }: CleanupButtonProps) {
  const { toast } = useToast();

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      console.log(`Cleaning up untitled events for date ${date} and calendar ${calendarId}`);
      const res = await apiRequest('POST', '/api/cleanup-duplicate-events', {
        date: date,
        calendarId: calendarId
      });
      return await res.json();
    },
    onSuccess: (data) => {
      console.log('Cleanup response:', data);
      toast({
        title: 'Cleanup successful',
        description: data.message,
        variant: 'default',
      });
      
      // Invalidate events query to refresh the calendar
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    },
    onError: (error) => {
      console.error('Cleanup error:', error);
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
      className="text-xs px-1 py-0 h-auto"
    >
      {cleanupMutation.isPending ? (
        <>
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          <span>Cleaning...</span>
        </>
      ) : (
        'Clean Duplicates'
      )}
    </Button>
  );
}