import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useCalendars } from "@/hooks/useCalendars";
import { format } from "date-fns";

interface BulkDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BulkDeleteModal({ isOpen, onClose }: BulkDeleteModalProps) {
  // Get calendars and events
  const { calendars } = useCalendars();
  const { bulkDeleteEvents } = useCalendarEvents();
  
  // State variables for filter options
  const [selectedCalendars, setSelectedCalendars] = useState<number[]>([]);
  const [deleteFrom, setDeleteFrom] = useState<"local" | "server" | "both">("both");
  const [deleteScope, setDeleteScope] = useState<"all" | "filtered">("all");
  const [dateFilterType, setDateFilterType] = useState<"year" | "month" | "day">("month");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedCalendars(calendars.map(cal => cal.id));
      setDeleteFrom("both");
      setDeleteScope("all");
      setDateFilterType("month");
      setSelectedDate(new Date());
      setIsConfirming(false);
      setIsSubmitting(false);
    }
  }, [isOpen, calendars]);

  // Get available years (current year and 4 years before/after)
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from({ length: 9 }, (_, i) => currentYear - 4 + i);

  // Prepare confirmation message
  const getConfirmationMessage = () => {
    const calendarNames = selectedCalendars
      .map(id => calendars.find(cal => cal.id === id)?.name)
      .filter(Boolean)
      .join(", ");

    let scopeMessage = "";
    if (deleteScope === "all") {
      scopeMessage = "all events";
    } else {
      if (dateFilterType === "year" && selectedDate) {
        scopeMessage = `events from ${selectedDate.getFullYear()}`;
      } else if (dateFilterType === "month" && selectedDate) {
        scopeMessage = `events from ${format(selectedDate, "MMMM yyyy")}`;
      } else if (dateFilterType === "day" && selectedDate) {
        scopeMessage = `events on ${format(selectedDate, "MMMM d, yyyy")}`;
      }
    }

    let locationMessage = "";
    if (deleteFrom === "local") {
      locationMessage = "locally only";
    } else if (deleteFrom === "server") {
      locationMessage = "from the server only";
    } else {
      locationMessage = "both locally and from the server";
    }

    return `Are you sure you want to delete ${scopeMessage} from ${calendarNames} ${locationMessage}?`;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    if (!selectedCalendars.length) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: any = {
        calendarIds: selectedCalendars,
        deleteFrom,
        deleteScope
      };

      // Add date filters based on selection
      if (deleteScope === "filtered" && selectedDate) {
        if (dateFilterType === "year" || dateFilterType === "month" || dateFilterType === "day") {
          payload.year = selectedDate.getFullYear();
        }
        
        if (dateFilterType === "month" || dateFilterType === "day") {
          payload.month = selectedDate.getMonth() + 1; // JavaScript months are 0-indexed
        }
        
        if (dateFilterType === "day") {
          payload.day = selectedDate.getDate();
        }
      }
      
      await bulkDeleteEvents(payload);
      onClose();
    } catch (error) {
      console.error("Error deleting events:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calendar picker for date selection
  const renderDatePicker = () => {
    if (dateFilterType === "year") {
      return (
        <div className="grid gap-2">
          <Label>Select Year</Label>
          <Select 
            value={selectedDate ? selectedDate.getFullYear().toString() : currentYear.toString()}
            onValueChange={(value) => {
              const newDate = new Date();
              newDate.setFullYear(parseInt(value));
              setSelectedDate(newDate);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Year" />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map(year => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    } else if (dateFilterType === "month" || dateFilterType === "day") {
      return (
        <div className="grid gap-2">
          <Label>Select {dateFilterType === "month" ? "Month" : "Date"}</Label>
          <Calendar
            mode={dateFilterType === "month" ? "month" : "single"}
            selected={selectedDate}
            onSelect={setSelectedDate}
            className="rounded-md border"
          />
        </div>
      );
    }
    
    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Delete Events</DialogTitle>
          <DialogDescription>
            Delete multiple events based on criteria you select.
          </DialogDescription>
        </DialogHeader>

        {isConfirming ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning: This action cannot be undone</AlertTitle>
              <AlertDescription>
                {getConfirmationMessage()}
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {/* Calendar Selection */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Select Calendars</h3>
              <div className="grid gap-2">
                {calendars.map(calendar => (
                  <div key={calendar.id} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`calendar-${calendar.id}`}
                      checked={selectedCalendars.includes(calendar.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedCalendars([...selectedCalendars, calendar.id]);
                        } else {
                          setSelectedCalendars(selectedCalendars.filter(id => id !== calendar.id));
                        }
                      }}
                    />
                    <label 
                      htmlFor={`calendar-${calendar.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center"
                    >
                      <div 
                        className="w-3 h-3 rounded-full mr-2" 
                        style={{ backgroundColor: calendar.color }}
                      ></div>
                      {calendar.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Delete Location */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Where to Delete From</h3>
              <RadioGroup 
                value={deleteFrom}
                onValueChange={(value: "local" | "server" | "both") => setDeleteFrom(value)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="local" id="delete-local" />
                  <Label htmlFor="delete-local">Local Only</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="server" id="delete-server" />
                  <Label htmlFor="delete-server">Server Only</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="both" id="delete-both" />
                  <Label htmlFor="delete-both">Both Local and Server</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Delete Scope */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Which Events to Delete</h3>
              <RadioGroup 
                value={deleteScope}
                onValueChange={(value: "all" | "filtered") => setDeleteScope(value)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="delete-all" />
                  <Label htmlFor="delete-all">All Events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="filtered" id="delete-filtered" />
                  <Label htmlFor="delete-filtered">Filter by Date</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Date Filters */}
            {deleteScope === "filtered" && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Date Filter</h3>
                <RadioGroup 
                  value={dateFilterType}
                  onValueChange={(value: "year" | "month" | "day") => setDateFilterType(value)}
                  className="flex space-x-4"
                >
                  <div className="flex items-center space-x-1">
                    <RadioGroupItem value="year" id="filter-year" />
                    <Label htmlFor="filter-year">Year</Label>
                  </div>
                  <div className="flex items-center space-x-1">
                    <RadioGroupItem value="month" id="filter-month" />
                    <Label htmlFor="filter-month">Month</Label>
                  </div>
                  <div className="flex items-center space-x-1">
                    <RadioGroupItem value="day" id="filter-day" />
                    <Label htmlFor="filter-day">Day</Label>
                  </div>
                </RadioGroup>
                
                {renderDatePicker()}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={onClose} 
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleSubmit} 
            disabled={isSubmitting || !selectedCalendars.length}
          >
            {isConfirming 
              ? (isSubmitting ? "Deleting..." : "Confirm Delete") 
              : "Delete Events"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}