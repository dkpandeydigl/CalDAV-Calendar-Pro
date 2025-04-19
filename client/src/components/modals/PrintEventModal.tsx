import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { PrinterIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { sanitizeAndFormatICS } from '@shared/ics-formatter';

// Types
interface PrintEventModalProps {
  open: boolean;
  event: Event | null;
  onClose: () => void;
}

/**
 * Print-friendly modal for events
 * RFC 5545 compliant with proper formatting for all required fields
 */
const PrintEventModal: React.FC<PrintEventModalProps> = ({ 
  open, 
  event,
  onClose
}) => {
  const { toast } = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  // If event is null, show an error state
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Unable to load event for printing.</p>
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
  let endDate: Date;
  
  try {
    startDate = new Date(event.startDate);
    endDate = new Date(event.endDate);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error(`Invalid event dates for "${event.title}"`);
      startDate = new Date();
      endDate = new Date();
      endDate.setHours(endDate.getHours() + 1);
    }
  } catch (error) {
    console.error(`Error parsing dates for event "${event.title}":`, error);
    startDate = new Date();
    endDate = new Date();
    endDate.setHours(endDate.getHours() + 1);
  }

  // Function to handle printing the event
  const handlePrint = () => {
    setIsPrinting(true);
    
    try {
      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      
      if (!printWindow) {
        toast({
          title: "Error",
          description: "Unable to open print window. Please check your browser settings.",
          variant: "destructive"
        });
        setIsPrinting(false);
        return;
      }
      
      // Get attendees and resources
      let attendees: any[] = [];
      let resources: any[] = [];
      
      try {
        if (event.attendees) {
          if (typeof event.attendees === 'string') {
            attendees = JSON.parse(event.attendees);
          } else if (Array.isArray(event.attendees)) {
            attendees = event.attendees;
          }
        }
        
        if (event.resources) {
          if (typeof event.resources === 'string') {
            resources = JSON.parse(event.resources);
          } else if (Array.isArray(event.resources)) {
            resources = event.resources;
          }
        }
      } catch (error) {
        console.error('Error parsing attendees or resources:', error);
      }
      
      // Generate formatted ICS representation for reference
      let icsRepresentation = '';
      
      if (event.rawData) {
        const rawData = typeof event.rawData === 'string' 
          ? event.rawData 
          : JSON.stringify(event.rawData);
          
        icsRepresentation = sanitizeAndFormatICS(rawData);
      }

      // Format date/time strings
      const formatDateForPrint = (date: Date) => {
        return format(date, 'EEEE, MMMM d, yyyy');
      };
      
      const formatTimeForPrint = (date: Date) => {
        return format(date, 'h:mm a');
      };
      
      // Format date/time range
      const formatDateTimeRange = () => {
        const sameDay = startDate.toDateString() === endDate.toDateString();
        
        if (event.allDay) {
          if (sameDay) {
            return `${formatDateForPrint(startDate)} (All day)`;
          } else {
            return `${formatDateForPrint(startDate)} - ${formatDateForPrint(endDate)} (All day)`;
          }
        } else {
          if (sameDay) {
            return `${formatDateForPrint(startDate)}, ${formatTimeForPrint(startDate)} - ${formatTimeForPrint(endDate)}`;
          } else {
            return `${formatDateForPrint(startDate)}, ${formatTimeForPrint(startDate)} - ${formatDateForPrint(endDate)}, ${formatTimeForPrint(endDate)}`;
          }
        }
      };
      
      // Get recurrence rule display text
      const getRecurrenceText = () => {
        if (!event.recurrenceRule) return null;
        
        let recurrenceText = 'Repeats: ';
        
        if (event.recurrenceRule.includes('FREQ=DAILY')) {
          recurrenceText += 'Daily';
        } else if (event.recurrenceRule.includes('FREQ=WEEKLY')) {
          recurrenceText += 'Weekly';
        } else if (event.recurrenceRule.includes('FREQ=MONTHLY')) {
          recurrenceText += 'Monthly';
        } else if (event.recurrenceRule.includes('FREQ=YEARLY')) {
          recurrenceText += 'Yearly';
        } else {
          recurrenceText += 'Custom';
        }
        
        // Check for UNTIL or COUNT
        if (event.recurrenceRule.includes('UNTIL=')) {
          const untilMatch = event.recurrenceRule.match(/UNTIL=([^;]+)/);
          if (untilMatch && untilMatch[1]) {
            try {
              // Parse YYYYMMDD or YYYYMMDDTHHMMSSZ format
              const untilStr = untilMatch[1].replace(/[TZ]/g, '');
              const year = untilStr.slice(0, 4);
              const month = untilStr.slice(4, 6);
              const day = untilStr.slice(6, 8);
              recurrenceText += ` until ${month}/${day}/${year}`;
            } catch (e) {
              recurrenceText += ' with end date';
            }
          }
        } else if (event.recurrenceRule.includes('COUNT=')) {
          const countMatch = event.recurrenceRule.match(/COUNT=([0-9]+)/);
          if (countMatch && countMatch[1]) {
            recurrenceText += ` for ${countMatch[1]} occurrences`;
          }
        }
        
        return recurrenceText;
      };
      
      // Function to build the HTML content
      const buildPrintableHtml = () => {
        // CSS styles for the print layout
        const styles = `
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            color: #333;
          }
          .print-container {
            max-width: 800px;
            margin: 0 auto;
            border: 1px solid #eee;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .print-header {
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 15px;
            margin-bottom: 15px;
          }
          .event-title {
            font-size: 24px;
            font-weight: bold;
            color: #1a1a1a;
            margin-bottom: 5px;
          }
          .event-date {
            font-size: 16px;
            color: #666;
            margin-bottom: 20px;
          }
          .event-section {
            margin-bottom: 20px;
          }
          .section-title {
            font-size: 14px;
            text-transform: uppercase;
            color: #888;
            margin-bottom: 5px;
            letter-spacing: 0.5px;
          }
          .section-content {
            font-size: 15px;
            line-height: 1.5;
          }
          .event-description {
            white-space: pre-wrap;
            line-height: 1.5;
          }
          .metadata {
            font-size: 12px;
            color: #999;
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #eee;
          }
          .attendee-list, .resource-list {
            list-style-type: none;
            padding-left: 0;
          }
          .attendee-item, .resource-item {
            margin-bottom: 8px;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 12px;
            color: #999;
          }
          @media print {
            .no-print {
              display: none;
            }
            body {
              padding: 0;
            }
            .print-container {
              box-shadow: none;
              border: none;
            }
          }
        `;
        
        return `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Print: ${event.title}</title>
            <style>${styles}</style>
          </head>
          <body>
            <div class="print-container">
              <div class="print-header">
                <h1 class="event-title">${event.title}</h1>
                <div class="event-date">${formatDateTimeRange()}</div>
              </div>
              
              ${event.location ? `
              <div class="event-section">
                <div class="section-title">Location</div>
                <div class="section-content">${event.location}</div>
              </div>
              ` : ''}
              
              ${event.description ? `
              <div class="event-section">
                <div class="section-title">Description</div>
                <div class="section-content event-description">${event.description}</div>
              </div>
              ` : ''}
              
              ${event.recurrenceRule ? `
              <div class="event-section">
                <div class="section-title">Recurrence</div>
                <div class="section-content">${getRecurrenceText()}</div>
              </div>
              ` : ''}
              
              ${attendees.length > 0 ? `
              <div class="event-section">
                <div class="section-title">Attendees (${attendees.length})</div>
                <ul class="attendee-list section-content">
                  ${attendees.map((attendee) => {
                    const name = attendee.name || attendee.email || 'Unnamed Attendee';
                    const email = attendee.email || '';
                    const status = attendee.partstat || attendee.status || 'No response';
                    return `
                    <li class="attendee-item">
                      <strong>${name}</strong> ${email ? `(${email})` : ''} - ${status}
                    </li>`;
                  }).join('')}
                </ul>
              </div>
              ` : ''}
              
              ${resources.length > 0 ? `
              <div class="event-section">
                <div class="section-title">Resources (${resources.length})</div>
                <ul class="resource-list section-content">
                  ${resources.map((resource) => {
                    const name = resource.name || resource.email || 'Unnamed Resource';
                    const type = resource.type || resource.subType || 'Resource';
                    return `<li class="resource-item"><strong>${name}</strong> (${type})</li>`;
                  }).join('')}
                </ul>
              </div>
              ` : ''}
              
              <div class="metadata">
                <div>Organizer: ${event.organizer?.name || event.organizer?.email || 'Unknown'}</div>
                <div>Calendar ID: ${event.calendarId}</div>
                <div>Event UID: ${event.uid}</div>
                <div>Created: ${event.createdAt ? new Date(event.createdAt).toLocaleString() : 'Unknown'}</div>
                ${event.lastModifiedAt ? `<div>Last Modified: ${new Date(event.lastModifiedAt).toLocaleString()}</div>` : ''}
              </div>
              
              <div class="footer">
                Printed on ${new Date().toLocaleString()} via Calendar App
              </div>
              
              <div class="no-print" style="margin-top: 30px; text-align: center;">
                <button onclick="window.print();" style="padding: 10px 20px; background: #4a86e8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                  Print this page
                </button>
                <button onclick="window.close();" style="padding: 10px 20px; margin-left: 10px; background: #f1f1f1; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                  Close
                </button>
              </div>
            </div>
            
            <script>
              // Auto-trigger print dialog after a short delay
              setTimeout(() => {
                window.print();
              }, 500);
            </script>
          </body>
          </html>
        `;
      };

      // Write the HTML content to the new window
      printWindow.document.open();
      printWindow.document.write(buildPrintableHtml());
      printWindow.document.close();
      
      printWindow.onload = () => {
        setIsPrinting(false);
      };
      
      // Handle errors
      printWindow.onerror = () => {
        setIsPrinting(false);
        toast({
          title: "Error",
          description: "Failed to prepare print view.",
          variant: "destructive"
        });
      };
    } catch (error) {
      console.error('Error generating print view:', error);
      setIsPrinting(false);
      toast({
        title: "Error",
        description: "Failed to generate print view: " + (error as Error).message,
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Print Event</DialogTitle>
          <DialogDescription>
            Print a detailed view of "{event.title}"
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <p>
            Prepare a printer-friendly version of this event with complete details including:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Full event title, location, and time</li>
            <li>Complete description</li>
            <li>All attendees and their statuses</li>
            <li>Resources booked for this event</li>
            <li>Recurrence rules and patterns</li>
            <li>Calendar and event metadata</li>
          </ul>
          
          <div className="flex items-center mt-4 text-amber-600 p-3 bg-amber-50 rounded-md">
            <div className="mr-2">ℹ️</div>
            <div className="text-sm">
              A new window will open with the printable view. Use your browser's print function or the print button to print the document.
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPrinting}>
            Cancel
          </Button>
          <Button 
            onClick={handlePrint} 
            disabled={isPrinting}
            className="flex items-center gap-1"
          >
            {isPrinting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <PrinterIcon className="h-4 w-4 mr-1" />
                Print Event
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PrintEventModal;