import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Calendar, CalendarSharing } from '@shared/schema';
import { shareCalendar, getCalendarShares, removeCalendarSharing, updateSharingPermission } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { CalendarIcon, Users, UserPlus, Trash, MoreHorizontal, ShieldAlert, Info } from 'lucide-react';
import { useCalendars } from '@/hooks/useCalendars';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
          
          // Use the updated shareCalendar function that includes the user ID
          await shareCalendar(
            calendarId,
            email,
            permission,
            calendar.url ? syncWithServer : false
          );
          
          // If we got here, the share was successful
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

  // State for shared calendar management
  const [activeCalendarId, setActiveCalendarId] = useState<number | null>(null);
  const [calendarShares, setCalendarShares] = useState<{[calendarId: number]: CalendarSharing[]}>({});
  const [loadingShares, setLoadingShares] = useState<{[calendarId: number]: boolean}>({});
  
  // Function to load shares for a specific calendar
  const loadCalendarShares = async (calendarId: number) => {
    if (!calendarId) return;
    
    setLoadingShares(prev => ({ ...prev, [calendarId]: true }));
    
    try {
      const shares = await getCalendarShares(calendarId);
      setCalendarShares(prev => ({ ...prev, [calendarId]: shares }));
    } catch (error) {
      console.error(`Failed to load shares for calendar ID ${calendarId}:`, error);
      setCalendarShares(prev => ({ ...prev, [calendarId]: [] }));
    } finally {
      setLoadingShares(prev => ({ ...prev, [calendarId]: false }));
    }
  };
  
  // When a calendar is selected in the management tab, load its shares
  useEffect(() => {
    if (activeCalendarId) {
      loadCalendarShares(activeCalendarId);
    }
  }, [activeCalendarId]);
  
  // Handle removing a calendar share
  const handleRemoveShare = async (calendarId: number, shareId: number) => {
    const calendar = calendars.find(cal => cal.id === calendarId);
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
      setCalendarShares(prev => ({
        ...prev, 
        [calendarId]: prev[calendarId].filter(share => share.id !== shareId)
      }));
      
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
  
  // Handle updating a calendar share permission
  const handleUpdatePermission = async (calendarId: number, shareId: number, newPermission: 'view' | 'edit') => {
    const calendar = calendars.find(cal => cal.id === calendarId);
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
      setCalendarShares(prev => ({
        ...prev,
        [calendarId]: prev[calendarId].map(share => 
          share.id === shareId 
            ? { ...share, permissionLevel: newPermission } 
            : share
        )
      }));
      
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
          <DialogTitle>Share Multiple Calendars</DialogTitle>
          <DialogDescription>
            Share multiple calendars with a single user at once or manage existing shares.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="share" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="share">Share New</TabsTrigger>
            <TabsTrigger value="manage">Manage Shares</TabsTrigger>
          </TabsList>
          
          <TabsContent value="share" className="mt-4">
            <div className="grid gap-4 py-2">
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
              
              <Button 
                onClick={handleShareCalendars} 
                disabled={selectedCalendarIds.length === 0 || !email || isSubmitting}
                className="w-full mt-2"
              >
                {isSubmitting ? 'Sharing...' : `Share ${selectedCalendarIds.length} Calendar(s)`}
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="manage" className="mt-2">
            <div className="border rounded-md p-4 mb-4">
              <div className="flex items-center mb-3">
                <CalendarIcon className="h-5 w-5 mr-2 text-primary" />
                <h3 className="font-medium">Select a Calendar to Manage Shares</h3>
              </div>
              
              <ScrollArea className="h-36 rounded-md">
                <div className="space-y-2 p-1">
                  {calendars.map(calendar => (
                    <div 
                      key={calendar.id} 
                      className={`flex items-center hover:bg-muted rounded-md cursor-pointer transition-colors p-2 ${activeCalendarId === calendar.id ? 'bg-muted' : ''}`}
                      onClick={() => setActiveCalendarId(calendar.id)}
                    >
                      <div className="flex items-center flex-1">
                        <span 
                          className="w-3 h-3 rounded-full mr-2 flex-shrink-0 border border-gray-200"
                          style={{ backgroundColor: calendar.color }}
                        ></span>
                        <span className="text-sm">{calendar.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            
            {activeCalendarId ? (
              loadingShares[activeCalendarId] ? (
                <div className="flex justify-center items-center py-6">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
                </div>
              ) : calendarShares[activeCalendarId]?.length > 0 ? (
                <div>
                  <div className="flex items-center mb-3">
                    <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                    <h3 className="text-sm font-medium">
                      {calendarShares[activeCalendarId].length} Share(s) for {calendars.find(c => c.id === activeCalendarId)?.name}
                    </h3>
                  </div>
                  
                  <ScrollArea className="max-h-40">
                    <div className="space-y-2">
                      {calendarShares[activeCalendarId].map(share => (
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
                                  activeCalendarId,
                                  share.id, 
                                  share.permissionLevel === 'view' ? 'edit' : 'view'
                                )}
                              >
                                Change to {share.permissionLevel === 'view' ? 'Can edit' : 'View only'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRemoveShare(activeCalendarId, share.id)}
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
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Info className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">This calendar is not shared with anyone.</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Info className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">Select a calendar to manage its shares</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
        
        <DialogFooter className="mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MultiCalendarShareModal;