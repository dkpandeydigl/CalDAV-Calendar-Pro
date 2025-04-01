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

interface CalendarSidebarProps {
  visible: boolean;
  onCreateEvent: () => void;
  onOpenServerSettings: () => void;
}

const CalendarSidebar: React.FC<CalendarSidebarProps> = ({ 
  visible, 
  onCreateEvent,
  onOpenServerSettings
}) => {
  const { calendars, updateCalendar } = useCalendars();
  const { serverConnection, syncWithServer, isSyncing } = useServerConnection();
  const { 
    selectedTimezone, 
    setSelectedTimezone, 
    saveTimezonePreference,
    isSavingTimezone 
  } = useCalendarContext();
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState('#0078d4');

  const timezones = getTimezones();

  const handleCalendarToggle = (id: number, checked: boolean) => {
    updateCalendar({ id, data: { enabled: checked } });
  };

  return (
    <aside 
      className={`w-64 bg-white shadow-md flex-shrink-0 transition-all duration-300 ${visible ? 'block' : 'hidden lg:block'}`}
    >
      <div className="p-4">
        <div className="mb-6">
          <Button 
            className="w-full justify-between" 
            onClick={onCreateEvent}
          >
            <span>Create Event</span>
            <span className="material-icons text-sm">add</span>
          </Button>
        </div>
        
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Calendars</h3>
          {calendars.map(calendar => (
            <div className="flex items-center mb-2" key={calendar.id}>
              <Checkbox 
                id={`cal-${calendar.id}`} 
                checked={calendar.enabled ?? true}
                onCheckedChange={(checked) => handleCalendarToggle(calendar.id, checked as boolean)}
                className="h-4 w-4"
                style={{ backgroundColor: calendar.enabled ?? true ? calendar.color : undefined }}
              />
              <Label htmlFor={`cal-${calendar.id}`} className="ml-2 text-sm text-neutral-800">
                {calendar.name}
              </Label>
            </div>
          ))}
          
          {showAddCalendar ? (
            <div className="mt-2">
              <div className="mb-2">
                <Label htmlFor="newCalendarName" className="sr-only">
                  Calendar Name
                </Label>
                <input
                  id="newCalendarName"
                  type="text"
                  placeholder="Calendar name"
                  className="block w-full px-3 py-2 text-sm border border-neutral-200 rounded-md bg-white focus:outline-none focus:ring-primary focus:border-primary"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                />
              </div>
              <div className="mb-2 flex items-center">
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
              <div className="flex mt-2">
                <Button
                  size="sm"
                  variant="default"
                  className="mr-2"
                  disabled={!newCalendarName.trim()}
                  onClick={() => {
                    // Handle add calendar logic here
                    setShowAddCalendar(false);
                    setNewCalendarName('');
                  }}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddCalendar(false);
                    setNewCalendarName('');
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
              <span className="material-icons text-sm mr-1">add</span>
              <span>Add Calendar</span>
            </Button>
          )}
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
