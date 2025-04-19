import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Event } from '@shared/schema';
import { Repeat, CalendarDays, CalendarClock } from 'lucide-react';

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
  onConfirm,
}) => {
  if (!event) return null;

  const isRecurring = event.recurrenceRule || (event.rawData && typeof event.rawData === 'string' && event.rawData.includes('RRULE:'));

  // Only show when it's actually a recurring event
  if (!isRecurring) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" />
            <span>Edit Recurring Event</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-6 space-y-1">
          <p className="text-sm text-muted-foreground mb-4">
            This is a recurring event. How would you like to modify it?
          </p>

          <div className="space-y-4">
            <Button
              className="w-full justify-start text-left"
              variant="outline"
              onClick={() => onConfirm('single')}
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              <div className="flex flex-col items-start">
                <span>Edit only this occurrence</span>
                <span className="text-xs text-muted-foreground">
                  Other occurrences of this event will remain unchanged
                </span>
              </div>
            </Button>

            <Button
              className="w-full justify-start text-left"
              variant="outline"
              onClick={() => onConfirm('all')}
            >
              <CalendarClock className="h-4 w-4 mr-2" />
              <div className="flex flex-col items-start">
                <span>Edit all occurrences</span>
                <span className="text-xs text-muted-foreground">
                  Changes will apply to all occurrences of this event
                </span>
              </div>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onConfirm('cancel')}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecurringEventEditModal;