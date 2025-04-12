import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Calendar } from '@shared/schema';
import { shareCalendar } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { CalendarIcon } from 'lucide-react';
import { useCalendars } from '@/hooks/useCalendars';

interface MultiCalendarShareModalProps {
  open: boolean;
  onClose: () => void;
}

export function MultiCalendarShareModal({ open, onClose }: MultiCalendarShareModalProps) {
  const { calendars } = useCalendars();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [syncWithServer, setSyncWithServer] = useState(true);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<number[]>([]);
  const { toast } = useToast();

  // Reset selected calendars when modal opens/closes
  useEffect(() => {
    if (!open) {
      setSelectedCalendarIds([]);
      setEmail('');
    }
  }, [open]);

  // Toggle calendar selection
  const toggleCalendarSelection = (calendarId: number) => {
    setSelectedCalendarIds(prev => {
      if (prev.includes(calendarId)) {
        return prev.filter(id => id !== calendarId);
      } else {
        return [...prev, calendarId];
      }
    });
  };

  // Handle share multiple calendars action
  const handleShareCalendars = async () => {
    if (selectedCalendarIds.length === 0 || !email) {
      toast({
        title: 'Selection Required',
        description: 'Please select at least one calendar and enter an email address',
        variant: 'destructive'
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const successfulShares = [];
      const failedShares = [];
      
      console.log(`Attempting to share ${selectedCalendarIds.length} calendars with ${email}`);
      
      // Process each selected calendar
      for (const calendarId of selectedCalendarIds) {
        const calendar = calendars.find(cal => cal.id === calendarId);
        if (!calendar) {
          console.error(`Calendar with ID ${calendarId} not found`);
          continue;
        }
        
        try {
          console.log(`Sharing calendar ID ${calendarId} (${calendar.name}) with ${email}`);
          
          // Make direct API call instead of using the imported function
          const response = await fetch(`/api/calendars/${calendarId}/shares`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: email,
              permissionLevel: permission,
              syncWithServer: calendar.url ? syncWithServer : false
              // Note: sharedByUserId is automatically added by the server
            }),
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to share calendar');
          }
          
          successfulShares.push(calendar.name);
        } catch (error: any) {
          console.error(`Error sharing calendar ${calendar.name}:`, error);
          failedShares.push({ name: calendar.name, error: error.message || "Unknown error" });
        }
      }
      
      // Show success message if any calendars were shared successfully
      if (successfulShares.length > 0) {
        toast({
          title: 'Calendars Shared',
          description: `Successfully shared ${successfulShares.length} calendar(s) with ${email}${syncWithServer ? ' and synchronized with CalDAV server' : ''}`
        });
      }
      
      // Show error message if any calendars failed to share
      if (failedShares.length > 0) {
        toast({
          title: 'Some Calendars Failed to Share',
          description: `Failed to share ${failedShares.length} calendar(s). Please try again.`,
          variant: 'destructive'
        });
        
        // Log details for debugging
        console.error('Failed shares:', failedShares);
      }
      
      // Clear the email field on success
      if (successfulShares.length > 0) {
        setEmail('');
        setSelectedCalendarIds([]);
      }
      
      // Invalidate calendars query to update the UI
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      
    } catch (error: any) {
      console.error('Error in handleShareCalendars:', error);
      toast({
        title: 'Sharing Failed',
        description: error.message || 'Could not share calendars',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Check if any selected calendar has a server URL (for CalDAV sync)
  const hasCalendarWithServerUrl = selectedCalendarIds.some(id => {
    const calendar = calendars.find(cal => cal.id === id);
    return calendar?.url;
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Multiple Calendars</DialogTitle>
          <DialogDescription>
            Share multiple calendars with a single user at once. Recipients will be able to see or edit these calendars based on the permissions you set.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="border rounded-md p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <CalendarIcon className="h-5 w-5 mr-2 text-primary" />
                <h3 className="font-medium">Select Calendars</h3>
              </div>
              <div className="text-xs bg-muted px-2 py-1 rounded-full">
                {selectedCalendarIds.length} selected
              </div>
            </div>
            
            <ScrollArea className="h-48 rounded-md mb-3">
              <div className="space-y-2 p-1">
                {calendars.map(calendar => (
                  <div 
                    key={calendar.id} 
                    className="flex items-center hover:bg-muted rounded-md cursor-pointer transition-colors p-2"
                    onClick={() => toggleCalendarSelection(calendar.id)}
                  >
                    <Checkbox 
                      id={`calendar-${calendar.id}`}
                      checked={selectedCalendarIds.includes(calendar.id)}
                      onCheckedChange={() => toggleCalendarSelection(calendar.id)}
                      className="mr-2"
                    />
                    <div className="flex items-center flex-1">
                      <span 
                        className="w-3 h-3 rounded-full mr-2 flex-shrink-0 border border-gray-200"
                        style={{ backgroundColor: calendar.color }}
                      ></span>
                      <Label 
                        htmlFor={`calendar-${calendar.id}`}
                        className="cursor-pointer text-sm"
                      >
                        {calendar.name}
                      </Label>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              Share with
            </Label>
            <Input
              id="email"
              placeholder="user@example.com"
              className="col-span-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="permission" className="text-right">
              Permission
            </Label>
            <div className="flex items-center space-x-2 col-span-3">
              <Button
                variant={permission === 'view' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPermission('view')}
              >
                View only
              </Button>
              <Button
                variant={permission === 'edit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPermission('edit')}
              >
                Can edit
              </Button>
            </div>
          </div>
          
          {hasCalendarWithServerUrl && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="sync" className="text-right">
                Sync with server
              </Label>
              <div className="flex items-center space-x-2">
                <Switch
                  id="sync"
                  checked={syncWithServer}
                  onCheckedChange={setSyncWithServer}
                />
                <Label htmlFor="sync">
                  {syncWithServer ? 'Yes' : 'No'}
                </Label>
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleShareCalendars} 
            disabled={selectedCalendarIds.length === 0 || !email || isSubmitting}
          >
            {isSubmitting ? 'Sharing...' : `Share ${selectedCalendarIds.length} Calendar(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MultiCalendarShareModal;