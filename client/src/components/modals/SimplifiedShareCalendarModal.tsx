import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Calendar, CalendarSharing } from '@shared/schema';
import { getCalendarShares, shareCalendar, removeCalendarSharing, updateSharingPermission } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { MoreHorizontal, Trash, UserPlus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ShareCalendarModalProps {
  open: boolean;
  onClose: () => void;
  calendar: Calendar | null | undefined;
}

export function SimplifiedShareCalendarModal({ open, onClose, calendar }: ShareCalendarModalProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shares, setShares] = useState<CalendarSharing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [syncWithServer, setSyncWithServer] = useState(true);
  const { toast } = useToast();

  // Load shares when the modal opens
  useEffect(() => {
    // Reset state when modal closes
    if (!open) {
      setShares([]);
      return;
    }
    
    // Don't try to load if no calendar is selected
    if (!calendar) {
      console.log("No calendar selected, skipping shares fetch");
      return;
    }
    
    // Load calendar shares
    const loadShares = async () => {
      setIsLoading(true);
      try {
        console.log(`SimplifiedShareCalendarModal: Loading shares for calendar ID ${calendar.id}`);
        const data = await getCalendarShares(calendar.id);
        console.log(`SimplifiedShareCalendarModal: Received shares:`, data);
        
        // Always set shares to the data (which might be an empty array)
        setShares(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('SimplifiedShareCalendarModal: Error loading shares:', error);
        // The getCalendarShares function now handles errors and returns an empty array
        setShares([]);
        
        // Only show the toast if we're still mounted
        if (open) {
          toast({
            title: 'Note',
            description: 'No sharing information available for this calendar',
            variant: 'default',
          });
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    loadShares();
  }, [open, calendar?.id, toast]);

  // Handle share calendar action
  const handleShareCalendar = async () => {
    if (!calendar || !email) return;
    
    setIsSubmitting(true);
    
    try {
      await shareCalendar(
        calendar.id, 
        email, 
        permission,
        calendar.url ? syncWithServer : false
      );
      
      toast({
        title: 'Calendar Shared',
        description: `Successfully shared calendar with ${email}${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
      });
      
      // Refresh the shares list
      const updatedShares = await getCalendarShares(calendar.id);
      setShares(updatedShares);
      
      // Clear the email field
      setEmail('');
      
      // Invalidate calendars query to update the UI
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      
    } catch (error: any) {
      toast({
        title: 'Sharing Failed',
        description: error.message || 'Could not share calendar',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove sharing
  const handleRemoveShare = async (shareId: number) => {
    if (!calendar) return;
    
    try {
      await removeCalendarSharing(
        shareId,
        calendar.url ? syncWithServer : false
      );
      
      toast({
        title: 'Sharing Removed',
        description: `Calendar sharing has been removed${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
      });
      
      // Update the local shares list
      setShares(prev => prev.filter(share => share.id !== shareId));
      
      // Invalidate calendars query
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to remove calendar sharing',
        variant: 'destructive'
      });
    }
  };

  // Update permission
  const handleUpdatePermission = async (shareId: number, newPermission: 'view' | 'edit') => {
    if (!calendar) return;
    
    try {
      await updateSharingPermission(
        shareId,
        newPermission,
        calendar.url ? syncWithServer : false
      );
      
      toast({
        title: 'Permission Updated',
        description: `Calendar sharing permission has been updated${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
      });
      
      // Update the local shares list
      setShares(prev => 
        prev.map(share => 
          share.id === shareId 
            ? { ...share, permissionLevel: newPermission } 
            : share
        )
      );
      
      // Invalidate calendars query
      queryClient.invalidateQueries({ queryKey: ['/api/calendars'] });
      
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update sharing permission',
        variant: 'destructive'
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Calendar: {calendar?.name}</DialogTitle>
          <DialogDescription>
            Share this calendar with others. They will be able to see or edit this calendar based on the permissions you set.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              Email
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
          
          {calendar?.url && (
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
        
        <Button 
          onClick={handleShareCalendar} 
          disabled={!email || isSubmitting}
          className="w-full"
        >
          {isSubmitting ? 'Sharing...' : 'Share Calendar'}
        </Button>
        
        {shares.length > 0 && (
          <>
            <div className="border-t my-4"></div>
            <h3 className="font-medium mb-2">Shared With</h3>
            <ScrollArea className="max-h-52">
              <div className="space-y-2">
                {shares.map(share => (
                  <div key={share.id} className="flex items-center justify-between p-2 hover:bg-muted rounded-md">
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{share.sharedWithEmail}</p>
                        <p className="text-xs text-muted-foreground">
                          {share.permissionLevel === 'view' ? 'View only' : 'Can edit'}
                        </p>
                      </div>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleUpdatePermission(
                            share.id, 
                            share.permissionLevel === 'view' ? 'edit' : 'view'
                          )}
                        >
                          Change to {share.permissionLevel === 'view' ? 'Can edit' : 'View only'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleRemoveShare(share.id)}
                          className="text-destructive"
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Remove sharing
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
        
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SimplifiedShareCalendarModal;