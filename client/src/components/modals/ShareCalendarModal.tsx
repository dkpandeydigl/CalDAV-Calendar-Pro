import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Calendar, CalendarSharing } from '@shared/schema';
import { apiRequest } from '@/lib/apiRequest';
import { useCalendars } from '@/hooks/useCalendars';
import { queryClient } from '@/lib/queryClient';
import { CalendarIcon, Check, MoreHorizontal, PlusCircle, Server, Trash, UserPlus, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ShareCalendarModalProps {
  open: boolean;
  onClose: () => void;
  calendar: Calendar | null | undefined; // For backward compatibility, now supports multiple calendars
}

interface SelectedCalendarInfo {
  calendar: Calendar;
  shares: CalendarSharing[];
  loading: boolean;
}

export function ShareCalendarModal({ open, onClose, calendar: initialCalendar }: ShareCalendarModalProps) {
  const { calendars: userCalendars } = useCalendars();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCalendars, setSelectedCalendars] = useState<SelectedCalendarInfo[]>([]);
  const [syncWithServer, setSyncWithServer] = useState(true);
  const [isMultiSelectionMode, setIsMultiSelectionMode] = useState(false);
  const { toast } = useToast();

  // Initialize with the initial calendar (for backward compatibility) or all user calendars
  // We use a ref to track initialization to prevent re-running the initialization logic
  const hasInitialized = React.useRef(false);
  
  // Use refs to track loading state to prevent circular dependencies
  const loadingCalendarIds = React.useRef(new Set<number>());
  const fetchedCalendarIds = React.useRef(new Set<number>());
  const calendarsToFetch = React.useRef<number[]>([]);
  const authLoadingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Effect for initializing the modal
  useEffect(() => {
    // Clear selections and reset initialization state when the modal is closed
    if (!open) {
      setSelectedCalendars([]);
      setIsMultiSelectionMode(false);
      hasInitialized.current = false;
      return;
    }

    // Only initialize when not already initialized and necessary data is available
    if (!hasInitialized.current) {
      // Mark as initialized to prevent re-running
      hasInitialized.current = true;
      
      // If an initial calendar is provided (backward compatibility), add it only
      if (initialCalendar) {
        setSelectedCalendars([{ 
          calendar: initialCalendar, 
          shares: [],
          loading: true
        }]);
        setIsMultiSelectionMode(false);
        
        // Schedule request after state update completes
        const calendarId = initialCalendar.id;
        setTimeout(() => {
          if (open) { // Verify still open
            requestSharesFetch(calendarId);
          }
        }, 0);
      } else if (userCalendars && userCalendars.length > 0) {
        // Multi-selection mode with auto-selected calendars
        setIsMultiSelectionMode(true);
        
        setSelectedCalendars(
          userCalendars.map(calendar => ({
            calendar,
            shares: [],
            loading: true
          }))
        );
        
        const calendarIds = userCalendars.map(cal => cal.id);
        
        setTimeout(() => {
          if (open) { // Verify still open
            calendarIds.forEach(id => {
              requestSharesFetch(id);
            });
          }
        }, 0);
      }
    }
  }, [initialCalendar, open, userCalendars]);
  
  // Timeout effect to handle long-running loading states
  useEffect(() => {
    if (!open) {
      // Reset everything when modal closes
      loadingCalendarIds.current.clear();
      fetchedCalendarIds.current.clear();
      calendarsToFetch.current = [];
      
      if (authLoadingTimeoutRef.current) {
        clearTimeout(authLoadingTimeoutRef.current);
        authLoadingTimeoutRef.current = null;
      }
      return;
    }
    
    // Setup timeout for loading
    if (!authLoadingTimeoutRef.current) {
      authLoadingTimeoutRef.current = setTimeout(() => {
        console.log("Auth loading timeout - forcing UI to proceed with available permissions");
        
        // Force update loading states
        setSelectedCalendars(prev => 
          prev.map(item => item.loading ? { ...item, loading: false } : item)
        );
        
        loadingCalendarIds.current.clear();
        authLoadingTimeoutRef.current = null;
      }, 2000); // 2 second timeout
    }
    
    return () => {
      if (authLoadingTimeoutRef.current) {
        clearTimeout(authLoadingTimeoutRef.current);
        authLoadingTimeoutRef.current = null;
      }
    };
  }, [open]);

  // Function to fetch calendar shares
  const fetchShares = async (calendarId: number) => {
    if (!open) return;
    
    try {
      fetchedCalendarIds.current.add(calendarId);
      
      const response = await apiRequest('GET', `/api/calendars/${calendarId}/shares`);
      if (response.ok) {
        const data = await response.json();
        
        if (open) {
          setSelectedCalendars(prev => 
            prev.map(item => 
              item.calendar.id === calendarId 
                ? { ...item, shares: data, loading: false } 
                : item
            )
          );
        }
      } else {
        throw new Error(`Failed to fetch shares for calendar ${calendarId}`);
      }
    } catch (error) {
      console.error(`Error fetching calendar shares for calendar ${calendarId}:`, error);
      
      if (open) {
        toast({
          title: 'Error',
          description: 'Failed to load calendar sharing information',
          variant: 'destructive',
        });
        
        setSelectedCalendars(prev => prev.map(item => 
          item.calendar.id === calendarId 
            ? { ...item, loading: false } 
            : item
        ));
      }
    } finally {
      loadingCalendarIds.current.delete(calendarId);
    }
  };

  // Request a fetch of calendar shares
  const requestSharesFetch = (calendarId: number) => {
    if (!fetchedCalendarIds.current.has(calendarId) && 
        !loadingCalendarIds.current.has(calendarId)) {
      
      loadingCalendarIds.current.add(calendarId);
      
      setTimeout(() => {
        if (open && loadingCalendarIds.current.has(calendarId)) {
          fetchShares(calendarId);
        }
      }, 10);
    }
  };

  // Toggle calendar selection
  const toggleCalendarSelection = (calendar: Calendar) => {
    setSelectedCalendars(prev => {
      const isSelected = prev.some(item => item.calendar.id === calendar.id);
      
      if (isSelected) {
        return prev.filter(item => item.calendar.id !== calendar.id);
      } else {
        const result = [...prev, { calendar, shares: [], loading: true }];
        
        setTimeout(() => {
          if (open) requestSharesFetch(calendar.id);
        }, 0);
        
        return result;
      }
    });
  };

  // Handle share calendar action
  const handleShareCalendars = async () => {
    if (selectedCalendars.length === 0 || !email) return;

    setIsSubmitting(true);
    
    try {
      const successfulShares = [];
      const failedShares = [];
      
      for (const { calendar } of selectedCalendars) {
        try {
          const apiUrl = calendar.url && syncWithServer
            ? `/api/calendars/${calendar.id}/shares?syncWithServer=true`
            : `/api/calendars/${calendar.id}/shares`;
            
          const response = await apiRequest('POST', apiUrl, {
            sharedWithEmail: email,
            permissionLevel: permission === 'read' ? 'view' : 'edit'
          });

          if (response.ok) {
            successfulShares.push(calendar.name);
            fetchShares(calendar.id);
          } else {
            const errorData = await response.json();
            throw new Error(errorData.message || `Failed to share calendar "${calendar.name}"`);
          }
        } catch (error: any) {
          failedShares.push({ name: calendar.name, error: error.message });
        }
      }
      
      if (successfulShares.length > 0) {
        toast({
          title: 'Calendars Shared',
          description: `Successfully shared ${successfulShares.length} calendar(s) with ${email}${syncWithServer ? ' and synchronized with CalDAV server' : ''}`
        });
      }
      
      if (failedShares.length > 0) {
        toast({
          title: 'Some Calendars Failed to Share',
          description: `Failed to share ${failedShares.length} calendar(s). Please try again.`,
          variant: 'destructive'
        });
      }
      
      setEmail('');
      queryClient.invalidateQueries({queryKey: ['/api/calendars']});
      
    } catch (error: any) {
      toast({
        title: 'Sharing Failed',
        description: error.message || 'Could not share calendars',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove sharing
  const handleRemoveShare = async (calendarId: number, shareId: number) => {
    const calendarInfo = selectedCalendars.find(c => c.calendar.id === calendarId);
    if (!calendarInfo) return;

    try {
      const apiUrl = calendarInfo.calendar.url && syncWithServer
        ? `/api/calendars/shares/${shareId}?syncWithServer=true`
        : `/api/calendars/shares/${shareId}`;
          
      const response = await apiRequest('DELETE', apiUrl);

      if (response.ok) {
        toast({
          title: 'Sharing Removed',
          description: `Calendar sharing has been removed${syncWithServer && calendarInfo.calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        
        setSelectedCalendars(prev => prev.map(item => 
          item.calendar.id === calendarId 
            ? { ...item, shares: item.shares.filter(share => share.id !== shareId) } 
            : item
        ));
        
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

  // Update permission for sharing
  const handleUpdatePermission = async (calendarId: number, shareId: number, newPermission: 'read' | 'write') => {
    const calendarInfo = selectedCalendars.find(c => c.calendar.id === calendarId);
    if (!calendarInfo) return;

    try {
      const apiUrl = calendarInfo.calendar.url && syncWithServer
        ? `/api/calendars/shares/${shareId}?syncWithServer=true`
        : `/api/calendars/shares/${shareId}`;
          
      const response = await apiRequest('PATCH', apiUrl, {
        permissionLevel: newPermission === 'read' ? 'view' : 'edit'
      });

      if (response.ok) {
        toast({
          title: 'Permission Updated',
          description: `Calendar sharing permission has been updated${syncWithServer && calendarInfo.calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        
        setSelectedCalendars(prev => prev.map(item => 
          item.calendar.id === calendarId 
            ? { 
                ...item, 
                shares: item.shares.map(share => 
                  share.id === shareId ? {...share, permission: newPermission} : share
                ) 
              } 
            : item
        ));
        
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

  // Dialog title
  const getDialogTitle = () => {
    if (selectedCalendars.length === 0) {
      return 'Share Calendars';
    } else if (selectedCalendars.length === 1) {
      return `Share "${selectedCalendars[0].calendar.name}"`;
    } else {
      return `Share ${selectedCalendars.length} Calendars`;
    }
  };

  // Dialog description
  const getDialogDescription = () => {
    if (isMultiSelectionMode) {
      if (selectedCalendars.length === 0) {
        return 'Select one or more calendars to share with others.';
      } else {
        return `Share ${selectedCalendars.length} selected calendar(s) with others. Recipients will be able to see or edit these calendars based on the permissions you set.`;
      }
    } else if (selectedCalendars.length === 1) {
      return `Share "${selectedCalendars[0].calendar.name}" with others. They will be able to see or edit this calendar based on the permissions you set.`;
    } else {
      return 'Select a calendar to share';
    }
  };

  const canShareWithServer = selectedCalendars.some(c => c.calendar.url);

  // Clean up handler
  const handleClose = () => {
    fetchedCalendarIds.current.clear();
    loadingCalendarIds.current.clear();
    calendarsToFetch.current = [];
    
    if (authLoadingTimeoutRef.current) {
      clearTimeout(authLoadingTimeoutRef.current);
      authLoadingTimeoutRef.current = null;
    }
    
    onClose();
  };
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {/* Calendar Selection Section - Always shown in multi-selection mode */}
          {isMultiSelectionMode && (
            <div className="border rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <CalendarIcon className="h-5 w-5 mr-2 text-primary" />
                  <h3 className="font-medium">Your Calendars</h3>
                </div>
                <div className="text-xs bg-muted px-2 py-1 rounded-full">
                  {selectedCalendars.length} selected
                </div>
              </div>
              
              <ScrollArea className="h-56 rounded-md mb-3">
                <div className="space-y-2">
                  {userCalendars
                    // Display all available calendars
                    .map(calendar => (
                      <div 
                        key={calendar.id} 
                        className="flex items-center hover:bg-muted rounded-md cursor-pointer transition-colors mb-1"
                        onClick={() => toggleCalendarSelection(calendar)}
                      >
                        <Checkbox 
                          id={`calendar-${calendar.id}`}
                          checked={selectedCalendars.some(c => c.calendar.id === calendar.id)}
                          onCheckedChange={() => toggleCalendarSelection(calendar)}
                          className="ml-2 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                        />
                        <div className="flex items-center flex-1 p-1.5 pl-2">
                          <span 
                            className="w-4 h-4 rounded-full mr-2 flex-shrink-0 border border-gray-200"
                            style={{ backgroundColor: calendar.color }}
                          ></span>
                          <Label 
                            htmlFor={`calendar-${calendar.id}`}
                            className="cursor-pointer text-sm font-medium"
                          >
                            {calendar.name}
                            {calendar.isPrimary && (
                              <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Primary</span>
                            )}
                          </Label>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </ScrollArea>
              
              <div className="flex justify-between border-t pt-3">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-3 gap-1"
                  onClick={() => {
                    // Select all calendars
                    const allCalendars = userCalendars || [];
                    
                    setSelectedCalendars(
                      allCalendars.map(calendar => ({
                        calendar,
                        shares: [],
                        loading: true
                      }))
                    );
                    
                    // Request fetches for all calendars after state update
                    setTimeout(() => {
                      if (open) {
                        allCalendars.forEach(calendar => {
                          requestSharesFetch(calendar.id);
                        });
                      }
                    }, 0);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  Select All
                </Button>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 px-3 gap-1"
                  onClick={() => setSelectedCalendars([])}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear All
                </Button>
              </div>
            </div>
          )}

          {selectedCalendars.length > 0 && (
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
                    <SelectTrigger type="button" className="col-span-3">
                      <SelectValue placeholder="Select permission" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">View only</SelectItem>
                      <SelectItem value="write">Can edit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* CalDAV server sync option - only show if at least one calendar has a URL */}
                {canShareWithServer && (
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
                onClick={handleShareCalendars} 
                disabled={!email || isSubmitting || selectedCalendars.length === 0}
                className="w-full"
              >
                {isSubmitting ? 'Sharing...' : `Share ${selectedCalendars.length === 1 ? 'Calendar' : 'Calendars'}`}
              </Button>

              {/* Render shared with section for each calendar */}
              {selectedCalendars.map(({ calendar, shares, loading }) => (
                <div key={calendar.id} className="mt-6 border-t pt-4">
                  <div className="flex items-center mb-3">
                    <span 
                      className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                      style={{ backgroundColor: calendar.color }}
                    ></span>
                    <h3 className="font-medium">{calendar.name} - Shared with</h3>
                  </div>
                  
                  {loading ? (
                    <div className="text-center py-3 text-sm text-muted-foreground">
                      Loading shares...
                    </div>
                  ) : shares.length === 0 ? (
                    <div className="text-center py-3 text-sm text-muted-foreground">
                      Not shared with anyone yet
                    </div>
                  ) : (
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
                                  calendar.id, 
                                  share.id, 
                                  share.permissionLevel === 'view' ? 'write' : 'read'
                                )}
                              >
                                Change to {share.permissionLevel === 'view' ? 'Can edit' : 'View only'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRemoveShare(calendar.id, share.id)}
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
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        
        <DialogFooter className="flex-shrink-0">
          <Button 
            type="button" 
            variant="secondary" 
            onClick={handleClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ShareCalendarModal;