import { ChangeEvent, FC, useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCalendars } from '@/hooks/useCalendars';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UploadCloud } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Calendar } from '@shared/schema';
import { format } from 'date-fns';

interface ImportCalendarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  selected: boolean;
}

export default function ImportCalendarModal({
  open,
  onOpenChange
}: ImportCalendarModalProps) {
  const { calendars } = useCalendars();
  const { toast } = useToast();

  // State for file input
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  
  // State for events parsed from the file
  const [parsedEvents, setParsedEvents] = useState<ICSEvent[]>([]);
  
  // State for calendar selection
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  
  // State for import process
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'select'>('upload');
  const [replaceExisting, setReplaceExisting] = useState(false);

  // Handle file selection
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith('.ics')) {
        setFile(selectedFile);
        setParseError(null);
      } else {
        toast({
          title: "Invalid file type",
          description: "Please select an .ics (iCalendar) file.",
          variant: "destructive"
        });
        e.target.value = '';
      }
    }
  };

  // Handle file upload and parsing
  const handleUploadAndParse = async () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a file to import.",
        variant: "destructive"
      });
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/calendars/parse-ics', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to parse calendar file');
      }

      const events: ICSEvent[] = await response.json();
      
      // Add selected flag to each event
      const eventsWithSelection = events.map(event => ({
        ...event,
        selected: true,
        startDate: new Date(event.startDate),
        endDate: new Date(event.endDate)
      }));

      setParsedEvents(eventsWithSelection);
      
      // Move to event selection step
      setImportStep('select');
      
      // Set default calendar if there are any calendars
      if (calendars.length > 0 && !selectedCalendarId) {
        const defaultCalendar = calendars.find(cal => cal.isPrimary) || calendars[0];
        setSelectedCalendarId(String(defaultCalendar.id));
      }
    } catch (error) {
      console.error('Error parsing calendar file:', error);
      setParseError(error instanceof Error ? error.message : 'Failed to parse calendar file');
      toast({
        title: "Error parsing file",
        description: error instanceof Error ? error.message : 'Failed to parse calendar file',
        variant: "destructive"
      });
    } finally {
      setIsParsing(false);
    }
  };

  // Toggle selection for an individual event
  const handleToggleEvent = (index: number) => {
    setParsedEvents(events => 
      events.map((event, i) => 
        i === index ? { ...event, selected: !event.selected } : event
      )
    );
  };

  // Toggle all events
  const handleToggleAll = (selected: boolean) => {
    setParsedEvents(events => 
      events.map(event => ({ ...event, selected }))
    );
  };

  // Import selected events
  const handleImport = async () => {
    if (!selectedCalendarId) {
      toast({
        title: "No calendar selected",
        description: "Please select a calendar to import events into.",
        variant: "destructive"
      });
      return;
    }

    const selectedEvents = parsedEvents.filter(event => event.selected);
    
    if (selectedEvents.length === 0) {
      toast({
        title: "No events selected",
        description: "Please select at least one event to import.",
        variant: "destructive"
      });
      return;
    }

    setIsImporting(true);

    try {
      const response = await apiRequest('POST', '/api/calendars/import-events', {
        calendarId: parseInt(selectedCalendarId),
        events: selectedEvents,
        replaceExisting: replaceExisting
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to import events');
      }

      const result = await response.json();
      
      toast({
        title: "Import successful",
        description: `Successfully imported ${result.imported} of ${result.total} events.`,
        variant: "default"
      });
      
      // Reset and close the modal
      resetAndClose();
    } catch (error) {
      console.error('Error importing events:', error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : 'Failed to import events',
        variant: "destructive"
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Reset state and close modal
  const resetAndClose = () => {
    setFile(null);
    setParsedEvents([]);
    setSelectedCalendarId('');
    setParseError(null);
    setImportStep('upload');
    setIsUploading(false);
    setIsParsing(false);
    setIsImporting(false);
    setReplaceExisting(false);
    onOpenChange(false);
  };

  // Format event date for display
  const formatEventDate = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      return `${format(start, 'MMM d, yyyy')}${
        format(start, 'MMM d, yyyy') !== format(new Date(end.getTime() - 1), 'MMM d, yyyy')
          ? ` - ${format(new Date(end.getTime() - 1), 'MMM d, yyyy')}`
          : ''
      } (All day)`;
    }
    
    return `${format(start, 'MMM d, yyyy h:mm a')} - ${
      format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')
        ? format(end, 'h:mm a')
        : format(end, 'MMM d, yyyy h:mm a')
    }`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Calendar</DialogTitle>
          <DialogDescription>
            Upload an .ics file to import events into your calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {importStep === 'upload' ? (
            <div className="py-4 flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-full max-w-md p-6 border-2 border-dashed border-neutral-300 rounded-lg text-center">
                <UploadCloud className="h-12 w-12 text-neutral-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 mb-2">Upload Calendar File</h3>
                <p className="text-sm text-neutral-500 mb-4">
                  Select an iCalendar (.ics) file to import events from
                </p>
                
                <div className="flex flex-col gap-4">
                  <input
                    type="file"
                    accept=".ics"
                    className="hidden"
                    id="calendar-file"
                    onChange={handleFileChange}
                  />
                  <label 
                    htmlFor="calendar-file" 
                    className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none cursor-pointer"
                  >
                    Choose File
                  </label>
                  
                  {file && (
                    <div className="text-sm text-neutral-800 bg-neutral-100 p-2 rounded">
                      Selected: {file.name}
                    </div>
                  )}
                  
                  {parseError && (
                    <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                      {parseError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <div className="mb-4">
                <Label htmlFor="calendar-select">Select calendar to import into:</Label>
                <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                  <SelectTrigger id="calendar-select" className="w-full">
                    <SelectValue placeholder="Select a calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {calendars.map((calendar: Calendar) => (
                      <SelectItem key={calendar.id} value={String(calendar.id)}>
                        <div className="flex items-center">
                          <span 
                            className="inline-block h-3 w-3 rounded-full mr-2" 
                            style={{ backgroundColor: calendar.color }} 
                          />
                          {calendar.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center space-x-2 mb-4">
                <Checkbox 
                  id="replace-existing"
                  checked={replaceExisting}
                  onCheckedChange={(checked) => setReplaceExisting(checked as boolean)}
                />
                <Label 
                  htmlFor="replace-existing"
                  className="cursor-pointer text-sm"
                >
                  Replace existing events with same UID
                </Label>
              </div>
              
              <div className="bg-white border rounded-md shadow-sm mb-4">
                <div className="p-3 border-b flex justify-between items-center bg-neutral-50">
                  <div className="text-sm font-medium">
                    {parsedEvents.length} events found in file
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleToggleAll(true)}
                    >
                      Select All
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleToggleAll(false)}
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>
                
                <div className="max-h-[300px] overflow-y-auto">
                  {parsedEvents.map((event, index) => (
                    <div 
                      key={index} 
                      className={`p-3 border-b flex items-start ${
                        event.selected ? 'bg-primary/5' : ''
                      }`}
                    >
                      <Checkbox 
                        id={`event-${index}`}
                        checked={event.selected}
                        onCheckedChange={() => handleToggleEvent(index)}
                        className="mt-1"
                      />
                      <div className="ml-3 flex-1">
                        <Label 
                          htmlFor={`event-${index}`}
                          className="font-medium cursor-pointer"
                        >
                          {event.summary || 'Untitled Event'}
                        </Label>
                        <div className="text-sm text-neutral-600 mt-1">
                          {formatEventDate(event.startDate, event.endDate, event.allDay)}
                        </div>
                        {event.location && (
                          <div className="text-sm text-neutral-500 mt-1">
                            Location: {event.location}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter className="flex justify-between">
          {importStep === 'upload' ? (
            <>
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleUploadAndParse} 
                disabled={!file || isParsing}
              >
                {isParsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setImportStep('upload')}>
                Back
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={isImporting || parsedEvents.filter(e => e.selected).length === 0}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Import ${parsedEvents.filter(e => e.selected).length} Events`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}