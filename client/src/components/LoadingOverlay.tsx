import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  duration?: number;
  onComplete?: () => void;
  message?: string;
}

export default function LoadingOverlay({
  duration = 5000,
  onComplete,
  message = 'Loading your calendars and events...'
}: LoadingOverlayProps) {
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  
  useEffect(() => {
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    const updateProgress = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);
      
      // Update seconds left
      const secondsLeft = Math.max(Math.ceil((endTime - now) / 1000), 0);
      setTimeLeft(secondsLeft);
      
      if (now >= endTime) {
        if (onComplete) onComplete();
        return;
      }
      
      requestAnimationFrame(updateProgress);
    };
    
    const animationId = requestAnimationFrame(updateProgress);
    
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [duration, onComplete]);
  
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="w-full max-w-md p-6 space-y-6 rounded-lg shadow-lg bg-card">
        <div className="flex items-center justify-center space-x-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h2 className="text-2xl font-bold">{message}</h2>
        </div>
        
        <div className="space-y-2">
          <Progress value={progress} className="h-2 w-full" />
          <p className="text-sm text-center text-muted-foreground">
            Refreshing data in {timeLeft} second{timeLeft !== 1 ? 's' : ''}...
          </p>
        </div>
        
        <div className="text-sm text-center text-muted-foreground">
          <p>Synchronizing with CalDAV server</p>
          <p>Please wait while we load your data</p>
        </div>
      </div>
    </div>
  );
}