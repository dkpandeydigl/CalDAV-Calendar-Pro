import { useEffect, useState, useCallback } from 'react';
import { Progress } from '@/components/ui/progress';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { queryClient } from '@/lib/queryClient';

interface LoadingOverlayProps {
  duration: number;
  message: string;
  onComplete?: () => void;
}

const LoadingOverlay = ({ duration, message, onComplete }: LoadingOverlayProps) => {
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(duration / 1000));
  const { refreshCalendarData } = useCalendarContext();
  
  // Refresh data at different intervals during loading
  const refreshAllData = useCallback(() => {
    console.log('Refreshing calendar data during loading period');
    refreshCalendarData();
    
    // Force refetch events and calendars
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
    queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
    queryClient.invalidateQueries({ queryKey: ['/api/shared-calendars'] });
  }, [refreshCalendarData]);
  
  useEffect(() => {
    // Initial refresh
    refreshAllData();
    
    // Set up interval to update progress bar
    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + (100 / (duration / 100));
        return newProgress > 100 ? 100 : newProgress;
      });
      
      setSecondsLeft((prev) => {
        const newSecondsLeft = prev - 0.1;
        return newSecondsLeft < 0 ? 0 : newSecondsLeft;
      });
    }, 100);
    
    // Set up periodic data refreshes during loading
    const refreshPoints = [
      duration * 0.25, // 25% through loading
      duration * 0.5,  // 50% through loading
      duration * 0.75  // 75% through loading
    ];
    
    const refreshTimers = refreshPoints.map(point => 
      setTimeout(() => refreshAllData(), point)
    );
    
    // Set up the completion timer
    const completionTimer = setTimeout(() => {
      clearInterval(interval);
      
      // Final refresh before completing
      refreshAllData();
      
      if (onComplete) onComplete();
    }, duration);
    
    return () => {
      // Clean up all timers
      clearInterval(interval);
      refreshTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(completionTimer);
    };
  }, [duration, onComplete, refreshAllData]);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4">{message}</h2>
        <Progress value={progress} className="mb-4" />
        <div className="text-center text-sm text-muted-foreground">
          {secondsLeft.toFixed(1)} seconds remaining...
        </div>
      </div>
    </div>
  );
};

export default LoadingOverlay;