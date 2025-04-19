import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, RepeatIcon, Copy } from 'lucide-react';
import { format } from 'date-fns';

export type RecurringEditMode = 'single' | 'all' | 'cancel';

interface RecurringEventEditModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
  onConfirm: (mode: RecurringEditMode) => void;
}

/**
 * Modal to provide RFC 5545 compliant edit options for recurring events
 * - 'Edit only this occurrence': Uses RECURRENCE-ID to modify a single instance
 * - 'Edit all occurrences': Modifies the master event (original VEVENT)
 */
const RecurringEventEditModal: React.FC<RecurringEventEditModalProps> = ({ 
  open, 
  event,
  onClose,
  onConfirm
}) => {
  // If event is null, show an error state
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Unable to load recurring event information.</p>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Parse dates safely
  let startDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    
    if (isNaN(startDate.getTime())) {
      console.error(`Invalid event date for "${event.title}"`);
      startDate = new Date();
    }
  } catch (error) {
    console.error(`Error parsing date for event "${event.title}":`, error);
    startDate = new Date();
  }

  // Convert date to display format
  const formattedDate = format(startDate, 'EEEE, MMMM d, yyyy');
  const formattedTime = format(startDate, 'h:mm a');

  // Extract recurring rule details for display
  const getRecurrencePattern = () => {
    if (!event.recurrenceRule) return 'No recurrence pattern found';
    
    if (event.recurrenceRule.includes('FREQ=DAILY')) {
      return 'Daily';
    } else if (event.recurrenceRule.includes('FREQ=WEEKLY')) {
      return 'Weekly';
    } else if (event.recurrenceRule.includes('FREQ=MONTHLY')) {
      return 'Monthly';
    } else if (event.recurrenceRule.includes('FREQ=YEARLY')) {
      return 'Yearly';
    } else {
      return 'Custom recurrence pattern';
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RepeatIcon className="h-5 w-5 text-blue-500" />
            Edit Recurring Event
          </DialogTitle>
          <DialogDescription>
            This is a repeating event. Choose which occurrences to modify.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <div className="mb-4 p-3 bg-blue-50 rounded-md">
            <h3 className="font-medium text-lg mb-1">{event.title}</h3>
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
              <Calendar className="h-4 w-4 mr-1 text-blue-500" />
              {formattedDate}
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 mr-1 text-blue-500" />
              {event.allDay ? 'All day' : formattedTime}
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <RepeatIcon className="h-4 w-4 mr-1 text-blue-500" />
              {getRecurrencePattern()}
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <Button 
              variant="outline" 
              className="w-full justify-start p-3 h-auto flex flex-col items-start"
              onClick={() => onConfirm('single')}
            >
              <div className="font-medium">Edit only this occurrence</div>
              <div className="text-sm text-muted-foreground mt-1 text-left">
                Changes will apply only to this specific instance of the event. All other occurrences will remain unchanged.
              </div>
            </Button>
            
            <Button 
              variant="outline" 
              className="w-full justify-start p-3 h-auto flex flex-col items-start"
              onClick={() => onConfirm('all')}
            >
              <div className="font-medium">Edit all occurrences</div>
              <div className="text-sm text-muted-foreground mt-1 text-left">
                Changes will apply to all instances of this recurring event, including past and future occurrences.
              </div>
            </Button>
            
            <Button 
              variant="outline" 
              className="w-full justify-start p-3 h-auto flex flex-col items-start"
              onClick={() => onConfirm('cancel')}
            >
              <div className="font-medium">Cancel</div>
              <div className="text-sm text-muted-foreground mt-1 text-left">
                Return to event details without making any changes.
              </div>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecurringEventEditModal;