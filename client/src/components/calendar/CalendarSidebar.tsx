import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCalendars } from '@/hooks/useCalendars';
import { useServerConnection } from '@/hooks/useServerConnection';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { getTimezones } from '@/lib/date-utils';
import { formatFullDate } from '@/lib/date-utils';
import { 
  Edit, 
  Trash2, 
  MoreVertical,
  Calendar as CalendarIcon 
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Calendar } from '@shared/schema';

interface CalendarSidebarProps {
  visible: boolean;
  onCreateEvent: () => void;
  onOpenServerSettings: () => void;
  onOpenSyncSettings?: () => void;
}

const CalendarSidebar: React.FC<CalendarSidebarProps> = ({ 
  visible, 
  onCreateEvent,
  onOpenServerSettings,
  onOpenSyncSettings
}) => {
  const { calendars, createCalendar, updateCalendar, deleteCalendar } = useCalendars();
  const { serverConnection, syncWithServer, isSyncing } = useServerConnection();
  const { 
    selectedTimezone, 
    setSelectedTimezone, 
    saveTimezonePreference,
    isSavingTimezone 
  } = useCalendarContext();
  
  // Calendar creation state
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState('#0078d4');
  const [calendarNameError, setCalendarNameError] = useState('');
  
  // Calendar editing state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null);
  const [editCalendarName, setEditCalendarName] = useState('');
  const [editCalendarColor, setEditCalendarColor] = useState('');
  const [editCalendarNameError, setEditCalendarNameError] = useState('');
  
  // Calendar deletion state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingCalendar, setDeletingCalendar] = useState<Calendar | null>(null);

  const timezones = getTimezones();

  const handleCalendarToggle = (id: number, checked: boolean) => {
    updateCalendar({ id, data: { enabled: checked } });
  };
  
  // Calendar name validation
  const validateCalendarName = (name: string): boolean => {
    if (!name.trim()) {
      setCalendarNameError('Calendar name is required');
      return false;
    }
    
    // Validate against allowed characters (letters, digits, underscore, hyphen, period)
    const regex = /^[A-Za-z0-9_\-\.]+$/;
    if (!regex.test(name)) {
      setCalendarNameError('Only letters, digits, underscore, hyphen, and period are allowed');
      return false;
    }
    
    setCalendarNameError('');
    return true;
  };
  
  // Create calendar
  const handleCreateCalendar = () => {
    if (!validateCalendarName(newCalendarName)) return;
    
    createCalendar({
      name: newCalendarName.trim(),
      color: newCalendarColor,
      enabled: true,
      isLocal: true,
      isPrimary: false,
      url: null,
      syncToken: null,
      description: null
    });
    
    setShowAddCalendar(false);
    setNewCalendarName('');
    setNewCalendarColor('#0078d4');
  };
  
  // Open edit dialog
  const handleOpenEditDialog = (calendar: Calendar) => {
    setEditingCalendar(calendar);
    setEditCalendarName(calendar.name);
    setEditCalendarColor(calendar.color);
    setEditCalendarNameError('');
    setIsEditDialogOpen(true);
  };
  
  // Update calendar
  const handleUpdateCalendar = () => {
    if (!editingCalendar) return;
    
    // Validate calendar name
    if (!editCalendarName.trim()) {
      setEditCalendarNameError('Calendar name is required');
      return;
    }
    
    // Validate against allowed characters (letters, digits, underscore, hyphen, period)
    const regex = /^[A-Za-z0-9_\-\.]+$/;
    if (!regex.test(editCalendarName)) {
      setEditCalendarNameError('Only letters, digits, underscore, hyphen, and period are allowed');
      return;
    }
    
    updateCalendar({
      id: editingCalendar.id,
      data: {
        name: editCalendarName.trim(),
        color: editCalendarColor
      }
    });
    
    setIsEditDialogOpen(false);
    setEditingCalendar(null);
  };
  
  // Open delete dialog
  const handleOpenDeleteDialog = (calendar: Calendar) => {
    setDeletingCalendar(calendar);
    setIsDeleteDialogOpen(true);
  };
  
  // Delete calendar
  const handleDeleteCalendar = () => {
    if (!deletingCalendar) return;
    
    deleteCalendar(deletingCalendar.id);
    setIsDeleteDialogOpen(false);
    setDeletingCalendar(null);
  };

  return (
    <aside 
      className={`w-64 bg-white shadow-md flex-shrink-0 transition-all duration-300 ${visible ? 'block' : 'hidden lg:block'}`}
    >
      <div className="p-4">
        <div className="mb-6">
          <Button 
            className="w-full" 
            onClick={onCreateEvent}
          >
            Create Event
          </Button>
        </div>
        
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Calendars</h3>
          {calendars.map(calendar => (
            <div className="flex items-center justify-between mb-2" key={calendar.id}>
              <div className="flex items-center flex-1">
                <Checkbox 
                  id={`cal-${calendar.id}`} 
                  checked={calendar.enabled ?? true}
                  onCheckedChange={(checked) => handleCalendarToggle(calendar.id, checked as boolean)}
                  className="h-4 w-4"
                  style={{ backgroundColor: calendar.enabled ?? true ? calendar.color : undefined }}
                />
                <Label htmlFor={`cal-${calendar.id}`} className="ml-2 text-sm text-neutral-800 truncate">
                  {calendar.name}
                </Label>
              </div>
              
              {/* Edit and delete buttons for non-primary calendars */}
              {!calendar.isPrimary && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center justify-start px-3 py-2 rounded-none"
                        onClick={() => handleOpenEditDialog(calendar)}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        <span>Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center justify-start px-3 py-2 text-destructive rounded-none"
                        onClick={() => handleOpenDeleteDialog(calendar)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        <span>Delete</span>
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          ))}
          
          {showAddCalendar ? (
            <div className="mt-2">
              <div className="mb-1">
                <Label htmlFor="newCalendarName" className="text-sm">
                  Calendar Name
                </Label>
                <Input
                  id="newCalendarName"
                  type="text"
                  placeholder="Calendar name"
                  className="mt-1"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                />
                {calendarNameError && (
                  <p className="text-xs text-destructive mt-1">{calendarNameError}</p>
                )}
                <div className="text-xs text-neutral-500 mt-1">
                  Note: Allowed Characters- [Letters, digits, _, -, and .]
                </div>
              </div>
              <div className="mb-2 flex items-center mt-3">
                <Label htmlFor="newCalendarColor" className="text-sm mr-2">
                  Color
                </Label>
                <input
                  id="newCalendarColor"
                  type="color"
                  className="h-8 w-8 rounded cursor-pointer"
                  value={newCalendarColor}
                  onChange={(e) => setNewCalendarColor(e.target.value)}
                />
              </div>
              <div className="flex mt-3">
                <Button
                  size="sm"
                  variant="default"
                  className="mr-2"
                  disabled={!newCalendarName.trim()}
                  onClick={handleCreateCalendar}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddCalendar(false);
                    setNewCalendarName('');
                    setCalendarNameError('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button 
              variant="link" 
              size="sm" 
              className="mt-2 text-primary hover:text-primary/80 p-0 h-auto font-normal"
              onClick={() => setShowAddCalendar(true)}
            >
              <CalendarIcon className="h-3 w-3 mr-1" />
              Add Calendar
            </Button>
          )}
          
          {/* Edit Calendar Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Calendar</DialogTitle>
                <DialogDescription>
                  Update your calendar settings.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="editCalendarName">Calendar Name</Label>
                  <Input
                    id="editCalendarName"
                    value={editCalendarName}
                    onChange={(e) => setEditCalendarName(e.target.value)}
                  />
                  {editCalendarNameError && (
                    <p className="text-xs text-destructive">{editCalendarNameError}</p>
                  )}
                  <div className="text-xs text-neutral-500">
                    Note: Allowed Characters- [Letters, digits, _, -, and .]
                  </div>
                </div>
                
                <div className="flex items-center">
                  <Label htmlFor="editCalendarColor" className="mr-2">Color</Label>
                  <input
                    id="editCalendarColor"
                    type="color"
                    className="h-8 w-8 rounded cursor-pointer"
                    value={editCalendarColor}
                    onChange={(e) => setEditCalendarColor(e.target.value)}
                  />
                </div>
              </div>
              
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleUpdateCalendar}>Save Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          {/* Delete Calendar Dialog */}
          <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Calendar</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the calendar "{deletingCalendar?.name}" and ALL its events from both local storage and the server. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteCalendar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Timezone</h3>
          <div className="space-y-2">
            <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {timezones.map((timezone) => (
                  <SelectItem key={timezone.value} value={timezone.value}>
                    {timezone.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              size="sm" 
              className="w-full"
              onClick={() => saveTimezonePreference(selectedTimezone)}
              disabled={isSavingTimezone}
            >
              {isSavingTimezone ? 'Saving...' : 'Save Timezone Preference'}
            </Button>
          </div>
        </div>
        
        <div>
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">CalDAV Server</h3>
          <div className="bg-neutral-100 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Connection Status</span>
              <div className="flex items-center">
                <span className={`inline-flex rounded-full h-3 w-3 mr-1 ${serverConnection?.status === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              </div>
            </div>
            {serverConnection && (
              <>
                <div className="text-xs text-neutral-500 mb-2">
                  Server: {serverConnection.url}
                </div>
                {serverConnection.lastSync && (
                  <div className="text-xs text-neutral-500 mb-2">
                    Last Sync: {formatFullDate(serverConnection.lastSync)}
                  </div>
                )}
              </>
            )}
            <div className="flex">
              <Button 
                variant="link" 
                size="sm" 
                className="p-0 h-auto text-primary hover:text-primary/80 font-normal"
                onClick={onOpenServerSettings}
              >
                Server Settings
              </Button>
              
              {onOpenSyncSettings && (
                <Button 
                  variant="link" 
                  size="sm" 
                  className="p-0 h-auto text-primary hover:text-primary/80 font-normal ml-4"
                  onClick={onOpenSyncSettings}
                >
                  Sync Settings
                </Button>
              )}
              
              {serverConnection?.status === 'connected' && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 h-auto text-primary hover:text-primary/80 font-normal ml-4"
                  onClick={() => syncWithServer()}
                  disabled={isSyncing}
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default CalendarSidebar;
