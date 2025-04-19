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
import { CalendarDays, CornerDownRight, CornerRightUp, Repeat } from 'lucide-react';
import { format } from 'date-fns';
import { CalendarEvent } from '@shared/schema';

export type RecurringEditMode = 'single' | 'all' | 'cancel';

interface RecurringEventEditModalProps {
  open: boolean;
  event: CalendarEvent | null;
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
  onConfirm,
}) => {
  if (!event) {
    return null;
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

  // Format the recurrence rule into a more readable format
  const formatRecurrenceRule = (rule: string | null | undefined): string => {
    if (!rule) return 'Unknown recurrence';
    
    const ruleText: string[] = [];
    
    // Basic mapping for frequency
    if (rule.includes('FREQ=DAILY')) {
      ruleText.push('Daily');
    } else if (rule.includes('FREQ=WEEKLY')) {
      ruleText.push('Weekly');
    } else if (rule.includes('FREQ=MONTHLY')) {
      ruleText.push('Monthly');
    } else if (rule.includes('FREQ=YEARLY')) {
      ruleText.push('Yearly');
    } else {
      ruleText.push('Custom');
    }
    
    // Check for interval
    const intervalMatch = rule.match(/INTERVAL=(\d+)/);
    if (intervalMatch && intervalMatch[1] !== '1') {
      ruleText.push(`every ${intervalMatch[1]} ${ruleText[0].toLowerCase()}`);
    }
    
    // Check for count
    const countMatch = rule.match(/COUNT=(\d+)/);
    if (countMatch) {
      ruleText.push(`for ${countMatch[1]} occurrences`);
    }
    
    // Check for until date
    const untilMatch = rule.match(/UNTIL=(\d{8}T\d{6}Z)/);
    if (untilMatch) {
      try {
        const year = untilMatch[1].substring(0, 4);
        const month = untilMatch[1].substring(4, 6);
        const day = untilMatch[1].substring(6, 8);
        const untilDate = new Date(`${year}-${month}-${day}`);
        ruleText.push(`until ${format(untilDate, 'MMM d, yyyy')}`);
      } catch (e) {
        // If date parsing fails, just show the raw date
        ruleText.push(`until end date`);
      }
    }
    
    // Check for BYDAY in weekly recurrences
    if (rule.includes('FREQ=WEEKLY') && rule.includes('BYDAY=')) {
      const byDayMatch = rule.match(/BYDAY=([A-Z,]+)/);
      if (byDayMatch) {
        const days = byDayMatch[1].split(',');
        const dayNames: { [key: string]: string } = {
          MO: 'Monday',
          TU: 'Tuesday',
          WE: 'Wednesday',
          TH: 'Thursday',
          FR: 'Friday',
          SA: 'Saturday',
          SU: 'Sunday'
        };
        
        const readableDays = days.map(day => dayNames[day] || day).join(', ');
        ruleText.push(`on ${readableDays}`);
      }
    }
    
    return ruleText.join(' ');
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" />
            Edit Recurring Event
          </DialogTitle>
          <DialogDescription>
            This is a recurring event. How would you like to edit it?
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-6 space-y-4">
          <div className="bg-muted/50 p-3 rounded-md">
            <h3 className="font-medium text-lg truncate">{event.title}</h3>
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <CalendarDays className="h-4 w-4" />
              <span>{format(startDate, 'MMMM d, yyyy')}</span>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <Repeat className="h-4 w-4" />
              <span>{formatRecurrenceRule(event.recurrenceRule)}</span>
            </div>
          </div>
          
          <div className="space-y-2">
            <Button 
              variant="outline" 
              className="w-full justify-start h-auto py-3 border-primary/20 flex items-start gap-3"
              onClick={() => onConfirm('single')}
            >
              <CornerDownRight className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-left">
                <div className="font-medium">Edit only this occurrence</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  Changes will only affect this specific date
                </div>
              </div>
            </Button>
            
            <Button 
              variant="outline" 
              className="w-full justify-start h-auto py-3 border-primary/20 flex items-start gap-3"
              onClick={() => onConfirm('all')}
            >
              <CornerRightUp className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-left">
                <div className="font-medium">Edit all occurrences</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  Changes will affect all events in this series
                </div>
              </div>
            </Button>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onConfirm('cancel')}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecurringEventEditModal;