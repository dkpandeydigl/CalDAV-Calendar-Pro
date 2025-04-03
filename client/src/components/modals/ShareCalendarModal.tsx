import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@shared/schema";
import { Trash2, Server } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Switch } from "@/components/ui/switch";

interface ShareCalendarModalProps {
  open: boolean;
  onClose: () => void;
  calendar: Calendar | null;
}

interface CalendarSharing {
  id: number;
  calendarId: number;
  userId: number | null;
  email: string;
  username: string | null;
  permission: 'read' | 'write';
}

export function ShareCalendarModal({ open, onClose, calendar }: ShareCalendarModalProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shares, setShares] = useState<CalendarSharing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [syncWithServer, setSyncWithServer] = useState(true);
  const { toast } = useToast();

  // Fetch existing shares when calendar changes
  useEffect(() => {
    if (calendar?.id) {
      fetchShares(calendar.id);
    }
  }, [calendar]);

  const fetchShares = async (calendarId: number) => {
    setIsLoading(true);
    try {
      const response = await apiRequest('GET', `/api/calendars/${calendarId}/shares`);
      if (response.ok) {
        const data = await response.json();
        setShares(data);
      } else {
        throw new Error('Failed to fetch calendar shares');
      }
    } catch (error) {
      console.error('Error fetching calendar shares:', error);
      toast({
        title: 'Error',
        description: 'Failed to load calendar sharing information',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleShareCalendar = async () => {
    if (!calendar?.id || !email) return;

    setIsSubmitting(true);
    try {
      // Build the API URL with sync flag if enabled and calendar has a URL
      const apiUrl = calendar.url && syncWithServer
        ? `/api/calendars/${calendar.id}/shares?syncWithServer=true`
        : `/api/calendars/${calendar.id}/shares`;
        
      const response = await apiRequest('POST', apiUrl, {
        sharedWithEmail: email,
        permissionLevel: permission === 'read' ? 'view' : 'edit'
      });

      if (response.ok) {
        toast({
          title: 'Calendar Shared',
          description: `Calendar shared with ${email} successfully${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        setEmail('');
        // Refresh the shares list
        fetchShares(calendar.id);
        // Invalidate any related queries
        queryClient.invalidateQueries({queryKey: ['/api/calendars']});
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to share calendar');
      }
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

  const handleRemoveShare = async (shareId: number) => {
    if (!calendar?.id) return;

    try {
      // Build the API URL with sync flag if enabled and calendar has a URL
      const apiUrl = calendar.url && syncWithServer
        ? `/api/calendars/shares/${shareId}?syncWithServer=true`
        : `/api/calendars/shares/${shareId}`;
          
      const response = await apiRequest('DELETE', apiUrl);

      if (response.ok) {
        toast({
          title: 'Sharing Removed',
          description: `Calendar sharing has been removed${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        // Update the local state to remove this share
        setShares(shares.filter(share => share.id !== shareId));
        // Invalidate any related queries
        queryClient.invalidateQueries({queryKey: ['/api/calendars']});
      } else {
        throw new Error('Failed to remove calendar sharing');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to remove calendar sharing',
        variant: 'destructive'
      });
    }
  };

  const handleUpdatePermission = async (shareId: number, newPermission: 'read' | 'write') => {
    if (!calendar?.id) return;

    try {
      // Build the API URL with sync flag if enabled and calendar has a URL
      const apiUrl = calendar.url && syncWithServer
        ? `/api/calendars/shares/${shareId}?syncWithServer=true`
        : `/api/calendars/shares/${shareId}`;
          
      const response = await apiRequest('PATCH', apiUrl, {
        permissionLevel: newPermission === 'read' ? 'view' : 'edit'
      });

      if (response.ok) {
        toast({
          title: 'Permission Updated',
          description: `Calendar sharing permission has been updated${syncWithServer && calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        // Update the local state with the new permission
        setShares(shares.map(share => 
          share.id === shareId ? {...share, permission: newPermission} : share
        ));
        // Invalidate any related queries
        queryClient.invalidateQueries({queryKey: ['/api/calendars']});
      } else {
        throw new Error('Failed to update sharing permission');
      }
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
          <DialogTitle>Share Calendar</DialogTitle>
          <DialogDescription>
            {calendar ? 
              `Share "${calendar.name}" with others. They will be able to see or edit this calendar based on the permissions you set.` :
              'Select a calendar to share'
            }
          </DialogDescription>
        </DialogHeader>

        {calendar && (
          <>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="permission" className="text-right">
                  Permission
                </Label>
                <Select
                  value={permission}
                  onValueChange={(value: 'read' | 'write') => setPermission(value)}
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select permission" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">View only</SelectItem>
                    <SelectItem value="write">Can edit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* CalDAV server sync option */}
              {calendar?.url && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="syncServer" className="text-right flex items-center gap-1">
                    <Server className="h-4 w-4" />
                    <span>CalDAV</span>
                  </Label>
                  <div className="flex items-center space-x-2 col-span-3">
                    <Switch
                      id="syncServer"
                      checked={syncWithServer}
                      onCheckedChange={setSyncWithServer}
                    />
                    <Label htmlFor="syncServer" className="cursor-pointer text-sm text-muted-foreground">
                      {syncWithServer ? 'Synchronize with CalDAV server' : 'Store sharing locally only'}
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

            {/* Existing shares */}
            {shares.length > 0 && (
              <div className="border-t pt-4 mt-4">
                <h3 className="font-medium mb-2">Shared with</h3>
                <div className="space-y-2">
                  {shares.map(share => (
                    <div key={share.id} className="flex items-center justify-between p-2 bg-secondary/30 rounded-md">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{share.username || share.email}</span>
                        <Badge variant={share.permission === 'write' ? 'default' : 'secondary'} className="mt-1 w-fit">
                          {share.permission === 'write' ? 'Can edit' : 'View only'}
                        </Badge>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Select
                          value={share.permission}
                          onValueChange={(value: 'read' | 'write') => 
                            handleUpdatePermission(share.id, value)
                          }
                        >
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read">View only</SelectItem>
                            <SelectItem value="write">Can edit</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleRemoveShare(share.id)}
                          className="h-8 w-8 text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <DialogFooter className="sm:justify-start">
          <Button 
            type="button" 
            variant="secondary" 
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ShareCalendarModal;