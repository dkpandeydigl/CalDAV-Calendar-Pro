import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DatePicker } from "../ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Download, Calendar as CalendarIcon, Filter } from "lucide-react";
import { Calendar } from "@shared/schema";
import { useCalendars } from "@/hooks/useCalendars";
import { useSharedCalendars } from "@/hooks/useSharedCalendars";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ExportCalendarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ExportCalendarModal({
  open,
  onOpenChange,
}: ExportCalendarModalProps) {
  const { toast } = useToast();
  const { calendars } = useCalendars();
  const { sharedCalendars } = useSharedCalendars();
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<number[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const queryClient = useQueryClient();
  const currentUser = queryClient.getQueryData<any>(['/api/user']);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      // Select all calendars by default
      setSelectedCalendarIds([
        ...calendars.map(cal => cal.id),
        ...sharedCalendars.map(cal => cal.id)
      ]);
      setShowDateFilter(false);
      setStartDate(undefined);
      setEndDate(undefined);
    }
  }, [open, calendars, sharedCalendars]);

  const handleSelectAllCalendars = () => {
    setSelectedCalendarIds([
      ...calendars.map(cal => cal.id),
      ...sharedCalendars.map(cal => cal.id)
    ]);
  };

  const handleDeselectAllCalendars = () => {
    setSelectedCalendarIds([]);
  };

  const handleToggleCalendar = (calendarId: number) => {
    setSelectedCalendarIds(prev => 
      prev.includes(calendarId)
        ? prev.filter(id => id !== calendarId)
        : [...prev, calendarId]
    );
  };

  const handleExport = async () => {
    if (selectedCalendarIds.length === 0) {
      toast({
        title: "No calendars selected",
        description: "Please select at least one calendar to export",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExporting(true);
      
      console.log('Starting export process for calendars:', selectedCalendarIds);
      
      // First try the debug endpoint to diagnose issues
      console.log('Checking calendar IDs using debug endpoint');
      const debugResponse = await fetch(`/api/debug-export?ids=${selectedCalendarIds.join(',')}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const debugData = await debugResponse.json();
      console.log('Debug data:', debugData);
      
      // Create a hidden form to submit the export request
      console.log('Creating form-based export request');
      const form = document.createElement('form');
      form.method = 'GET';
      form.action = '/api/calendars/export';
      form.target = '_blank';
      
      // Add calendar IDs as a hidden input
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'ids';
      input.value = selectedCalendarIds.join(',');
      form.appendChild(input);
      
      // Add date filters if needed
      if (showDateFilter && startDate && endDate) {
        const startInput = document.createElement('input');
        startInput.type = 'hidden';
        startInput.name = 'startDate';
        startInput.value = startDate.toISOString();
        form.appendChild(startInput);
        
        const endInput = document.createElement('input');
        endInput.type = 'hidden';
        endInput.name = 'endDate';
        endInput.value = endDate.toISOString();
        form.appendChild(endInput);
      }
      
      // Submit the form
      document.body.appendChild(form);
      
      // Before submitting, validate that session is valid
      const validateSession = await fetch('/api/user', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!validateSession.ok) {
        console.error('Session validation failed:', await validateSession.text());
        throw new Error('Authentication error - please refresh the page and try again');
      }
      
      // Submit the form to trigger download
      form.submit();
      
      // Remove the form afterward
      setTimeout(() => {
        document.body.removeChild(form);
      }, 100);
      
      // Show success message
      toast({
        title: "Export started",
        description: "Your calendar export should download shortly",
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "An error occurred while exporting calendars",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Combined list of all calendars (own + shared)
  const allCalendars = [
    ...calendars.map(cal => ({
      ...cal,
      isOwned: true,
      ownerName: "My Calendars",
    })),
    ...sharedCalendars.map(cal => ({
      ...cal,
      isOwned: false,
      ownerName: cal.ownerEmail || "Shared Calendar",
    }))
  ];

  // Group calendars by owner
  const calendarsByOwner = allCalendars.reduce((acc, calendar) => {
    const ownerKey = calendar.isOwned ? "my-calendars" : `shared-${calendar.userId}`;
    const ownerName = calendar.isOwned ? "My Calendars" : calendar.ownerName;
    
    if (!acc[ownerKey]) {
      acc[ownerKey] = {
        name: ownerName,
        isOwned: calendar.isOwned,
        calendars: []
      };
    }
    
    acc[ownerKey].calendars.push(calendar);
    return acc;
  }, {} as Record<string, { name: string; isOwned: boolean; calendars: Array<Calendar & { isOwned: boolean; ownerName: string }> }>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Calendar
          </DialogTitle>
          <DialogDescription>
            Export one or more calendars to an iCalendar (.ics) file that can be imported into other calendar applications.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col space-y-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              <span className="font-semibold text-sm">Select Calendars</span>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSelectAllCalendars} 
                className="text-xs h-7"
              >
                Select All
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDeselectAllCalendars}
                className="text-xs h-7"
              >
                Deselect All
              </Button>
            </div>
          </div>

          <ScrollArea className="h-64 border rounded-md p-2">
            {Object.entries(calendarsByOwner).map(([ownerKey, group]) => (
              <div key={ownerKey} className="mb-4">
                <div className="flex items-center mb-2">
                  <h3 className="text-sm font-medium text-neutral-700">{group.name}</h3>
                  {group.isOwned && (
                    <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                  )}
                </div>
                
                <div className="space-y-2 pl-2">
                  {group.calendars.map(calendar => (
                    <div key={calendar.id} className="flex items-center">
                      <Checkbox
                        id={`export-calendar-${calendar.id}`}
                        checked={selectedCalendarIds.includes(calendar.id)}
                        onCheckedChange={() => handleToggleCalendar(calendar.id)}
                        className="mr-2"
                      />
                      <Label
                        htmlFor={`export-calendar-${calendar.id}`}
                        className="flex items-center cursor-pointer"
                      >
                        <div 
                          className="w-3 h-3 rounded-full mr-2" 
                          style={{ background: calendar.color || '#3B82F6' }}
                        />
                        <span className="text-sm">{calendar.name}</span>
                        {calendar.isPrimary && (
                          <Badge variant="outline" className="ml-2 text-xs">Primary</Badge>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </ScrollArea>

          <div>
            <div className="flex items-center">
              <Checkbox
                id="filter-by-date"
                checked={showDateFilter}
                onCheckedChange={(checked) => setShowDateFilter(checked as boolean)}
                className="mr-2"
              />
              <Label 
                htmlFor="filter-by-date" 
                className="flex items-center cursor-pointer text-sm"
              >
                <Filter className="h-4 w-4 mr-1 text-muted-foreground" />
                Filter events by date range
              </Label>
            </div>

            {showDateFilter && (
              <div className="grid grid-cols-2 gap-4 mt-2 pl-6">
                <div>
                  <Label htmlFor="start-date" className="text-sm">Start Date</Label>
                  <DatePicker
                    selected={startDate}
                    onSelect={setStartDate}
                    disabled={!showDateFilter}
                  />
                </div>
                <div>
                  <Label htmlFor="end-date" className="text-sm">End Date</Label>
                  <DatePicker
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={!showDateFilter || !startDate}
                    minDate={startDate}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedCalendarIds.length === 0 || (showDateFilter && (!startDate || !endDate))}
            className="flex items-center gap-1"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export {selectedCalendarIds.length} {selectedCalendarIds.length === 1 ? 'Calendar' : 'Calendars'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}