import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@shared/schema";
import { Trash2, Server, PlusCircle, Calendar as CalendarIcon, Check, X } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Switch } from "@/components/ui/switch";
import { Checkbox } from '@/components/ui/checkbox';
import { useCalendars } from '@/hooks/useCalendars';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ShareCalendarModalProps {
  open: boolean;
  onClose: () => void;
  calendar: Calendar | null | undefined; // For backward compatibility, now supports multiple calendars
}

interface CalendarSharing {
  id: number;
  calendarId: number;
  userId: number | null;
  email: string;
  username: string | null;
  permission: 'read' | 'write';
}

// Extended interface to track selected calendars and their shares
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
  useEffect(() => {
    // Clear selections when the modal is closed
    if (!open) {
      setSelectedCalendars([]);
      setIsMultiSelectionMode(false);
      return;
    }

    // If an initial calendar is provided (backward compatibility), add it only
    if (initialCalendar) {
      setSelectedCalendars([{ 
        calendar: initialCalendar, 
        shares: [],
        loading: true
      }]);
      setIsMultiSelectionMode(false);
    } else {
      // Multi-selection mode - select all user calendars by default
      setIsMultiSelectionMode(true);
      // Get all user-owned calendars and select them all
      const userOwnedCalendars = userCalendars.filter(cal => 
        // Only include user's own calendars, not shared ones
        cal.userId === userCalendars.find(c => c.isPrimary)?.userId
      );
      
      // Pre-select all user calendars
      setSelectedCalendars(
        userOwnedCalendars.map(calendar => ({
          calendar,
          shares: [],
          loading: true
        }))
      );
    }
  }, [initialCalendar, open, userCalendars]);

  // Fetch shares for each selected calendar
  useEffect(() => {
    selectedCalendars.forEach(({ calendar, loading }) => {
      if (loading) {
        fetchShares(calendar.id);
      }
    });
  }, [selectedCalendars]);

  const fetchShares = async (calendarId: number) => {
    try {
      const response = await apiRequest('GET', `/api/calendars/${calendarId}/shares`);
      if (response.ok) {
        const data = await response.json();
        // Update the shares for this calendar
        setSelectedCalendars(prev => prev.map(item => 
          item.calendar.id === calendarId 
            ? { ...item, shares: data, loading: false } 
            : item
        ));
      } else {
        throw new Error(`Failed to fetch shares for calendar ${calendarId}`);
      }
    } catch (error) {
      console.error(`Error fetching calendar shares for calendar ${calendarId}:`, error);
      toast({
        title: 'Error',
        description: 'Failed to load calendar sharing information',
        variant: 'destructive',
      });
      // Mark as not loading even on error
      setSelectedCalendars(prev => prev.map(item => 
        item.calendar.id === calendarId 
          ? { ...item, loading: false } 
          : item
      ));
    }
  };

  // Toggle a calendar selection
  const toggleCalendarSelection = (calendar: Calendar) => {
    setSelectedCalendars(prev => {
      // Check if this calendar is already selected
      const isSelected = prev.some(item => item.calendar.id === calendar.id);
      
      if (isSelected) {
        // Remove it
        return prev.filter(item => item.calendar.id !== calendar.id);
      } else {
        // Add it
        return [...prev, { calendar, shares: [], loading: true }];
      }
    });
  };

  // Share selected calendars with the recipient
  const handleShareCalendars = async () => {
    if (selectedCalendars.length === 0 || !email) return;

    setIsSubmitting(true);
    
    try {
      // Track successful shares to show in toast
      const successfulShares = [];
      const failedShares = [];
      
      // Share each selected calendar
      for (const { calendar } of selectedCalendars) {
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
            successfulShares.push(calendar.name);
            // Refresh the shares list for this calendar
            fetchShares(calendar.id);
          } else {
            const errorData = await response.json();
            throw new Error(errorData.message || `Failed to share calendar "${calendar.name}"`);
          }
        } catch (error: any) {
          failedShares.push({ name: calendar.name, error: error.message });
        }
      }
      
      // Show toast with results
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
      
      // Clear email after sharing attempt (regardless of success)
      setEmail('');
      
      // Invalidate calendars query to refresh
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

  const handleRemoveShare = async (calendarId: number, shareId: number) => {
    const calendarInfo = selectedCalendars.find(c => c.calendar.id === calendarId);
    if (!calendarInfo) return;

    try {
      // Build the API URL with sync flag if enabled and calendar has a URL
      const apiUrl = calendarInfo.calendar.url && syncWithServer
        ? `/api/calendars/shares/${shareId}?syncWithServer=true`
        : `/api/calendars/shares/${shareId}`;
          
      const response = await apiRequest('DELETE', apiUrl);

      if (response.ok) {
        toast({
          title: 'Sharing Removed',
          description: `Calendar sharing has been removed${syncWithServer && calendarInfo.calendar.url ? ' and synchronized with CalDAV server' : ''}`
        });
        
        // Update the local state to remove this share
        setSelectedCalendars(prev => prev.map(item => 
          item.calendar.id === calendarId 
            ? { ...item, shares: item.shares.filter(share => share.id !== shareId) } 
            : item
        ));
        
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

  const handleUpdatePermission = async (calendarId: number, shareId: number, newPermission: 'read' | 'write') => {
    const calendarInfo = selectedCalendars.find(c => c.calendar.id === calendarId);
    if (!calendarInfo) return;

    try {
      // Build the API URL with sync flag if enabled and calendar has a URL
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
        
        // Update the local state with the new permission
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

  // Calculate title based on selected calendars
  const getDialogTitle = () => {
    if (selectedCalendars.length === 0) {
      return 'Share Calendars';
    } else if (selectedCalendars.length === 1) {
      return `Share "${selectedCalendars[0].calendar.name}"`;
    } else {
      return `Share ${selectedCalendars.length} Calendars`;
    }
  };

  // Description based on selection mode and selected calendars
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        {/* Calendar Selection Section - Always shown in multi-selection mode */}
        {isMultiSelectionMode && (
          <div className="border rounded-md p-2">
            <h3 className="font-medium text-sm mb-2 flex items-center justify-between">
              <div className="flex items-center">
                <CalendarIcon className="h-4 w-4 mr-1" />
                <span>Your Calendars</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedCalendars.length} selected
              </div>
            </h3>
            
            <ScrollArea className="h-48 rounded-md">
              <div className="space-y-2 pr-3">
                {userCalendars
                  // Only include user's own calendars, not shared ones
                  .filter(cal => cal.userId === userCalendars.find(c => c.isPrimary)?.userId)
                  .map(calendar => (
                    <div 
                      key={calendar.id} 
                      className="flex items-center space-x-2 py-1 px-1 hover:bg-gray-50 rounded"
                    >
                      <Checkbox 
                        id={`calendar-${calendar.id}`}
                        checked={selectedCalendars.some(c => c.calendar.id === calendar.id)}
                        onCheckedChange={() => toggleCalendarSelection(calendar)}
                      />
                      <div 
                        className="flex items-center cursor-pointer flex-1"
                        onClick={() => toggleCalendarSelection(calendar)}
                      >
                        <span 
                          className="w-4 h-4 rounded-full mr-2 flex-shrink-0"
                          style={{ backgroundColor: calendar.color }}
                        ></span>
                        <Label 
                          htmlFor={`calendar-${calendar.id}`}
                          className="cursor-pointer text-sm"
                        >
                          {calendar.name}
                          {calendar.isPrimary && (
                            <span className="ml-1 text-xs text-muted-foreground">(Primary)</span>
                          )}
                        </Label>
                      </div>
                    </div>
                  ))
                }
              </div>
            </ScrollArea>
            
            <div className="mt-2 flex justify-between">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 px-2 text-xs"
                onClick={() => {
                  // Select all user calendars
                  const userOwnedCalendars = userCalendars.filter(cal => 
                    cal.userId === userCalendars.find(c => c.isPrimary)?.userId
                  );
                  
                  setSelectedCalendars(
                    userOwnedCalendars.map(calendar => ({
                      calendar,
                      shares: [],
                      loading: true
                    }))
                  );
                }}
              >
                Select All
              </Button>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedCalendars([])}
              >
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
                  <SelectTrigger className="col-span-3">
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

            {/* Existing shares - Show in tabs or accordion for multiple calendars */}
            {selectedCalendars.map(({ calendar, shares, loading }) => (
              <div key={calendar.id} className="border-t pt-4 mt-4">
                <h3 className="font-medium mb-2 flex items-center">
                  <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: calendar.color }}></span>
                  {calendar.name} - Shared with
                  {loading && <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"></span>}
                </h3>
                
                {!loading && shares.length === 0 && (
                  <div className="text-sm text-muted-foreground italic p-2">
                    Not shared with anyone yet
                  </div>
                )}
                
                {!loading && shares.length > 0 && (
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
                              handleUpdatePermission(calendar.id, share.id, value)
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
                            onClick={() => handleRemoveShare(calendar.id, share.id)}
                            className="h-8 w-8 text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        <DialogFooter className="sm:justify-between">
          {/* Toggle multi-selection mode button */}
          {!isMultiSelectionMode && (
            <Button 
              type="button" 
              variant="outline" 
              size="sm"
              onClick={() => setIsMultiSelectionMode(true)}
              className="gap-1"
            >
              <PlusCircle className="h-4 w-4" />
              Add More Calendars
            </Button>
          )}
          
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