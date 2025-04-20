import React, { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  Users, 
  Printer, 
  FileText, 
  User,
  Repeat
} from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CalendarEvent } from '@shared/schema';

interface PrintEventModalProps {
  open: boolean;
  event: CalendarEvent | null;
  onClose: () => void;
}

/**
 * Print-friendly modal for events
 * RFC 5545 compliant with proper formatting for all required fields
 */
const PrintEventModal: React.FC<PrintEventModalProps> = ({ 
  open, 
  event,
  onClose,
}) => {
  const printContentRef = useRef<HTMLDivElement>(null);

  // If event is null, show an error state
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Unable to load event information for printing.</p>
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
      console.error(`Invalid event date for "${event.title}"`);
      startDate = new Date();
      endDate = new Date();
    }
  } catch (error) {
    console.error(`Error parsing date for event "${event.title}":`, error);
    startDate = new Date();
    endDate = new Date();
  }

  // Format for printing
  const formatDateForPrint = (date: Date) => {
    return format(date, 'EEEE, MMMM d, yyyy');
  };
  
  const formatTimeForPrint = (date: Date) => {
    return format(date, 'h:mm a');
  };

  // RFC 5545 compliant date/time formatting (for ICS files)
  const formatDateTimeForICS = (date: Date) => {
    return format(date, "yyyyMMdd'T'HHmmss'Z'");
  };

  // Handle printing
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    
    if (!printWindow) {
      console.error('Failed to open print window');
      return;
    }
    
    // Get the content we want to print
    const contentToPrint = printContentRef.current?.innerHTML || '';
    
    // Add RFC 5545 compliant ICS structure in a hidden div for potential saving
    const icsContent = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Replit Calendar App//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${event.uid || `event-${event.id}@calendar.replit.app`}
SUMMARY:${event.title}
DTSTAMP:${formatDateTimeForICS(new Date())}
DTSTART:${formatDateTimeForICS(startDate)}
DTEND:${formatDateTimeForICS(endDate)}
${event.location ? `LOCATION:${event.location}` : ''}
${event.description ? `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}` : ''}
${event.recurrenceRule ? `RRULE:${event.recurrenceRule}` : ''}
END:VEVENT
END:VCALENDAR
    `.trim();
    
    // Set up the print page with a custom stylesheet for printing
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print: ${event.title}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #333;
              line-height: 1.6;
              padding: 20px;
            }
            .print-container {
              max-width: 800px;
              margin: 0 auto;
              border: 1px solid #ddd;
              padding: 20px;
              border-radius: 8px;
            }
            .event-title {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 15px;
              color: #1a365d;
            }
            .info-row {
              display: flex;
              align-items: center;
              margin-bottom: 10px;
            }
            .info-row svg {
              margin-right: 10px;
              color: #4a5568;
            }
            .info-label {
              font-weight: bold;
              margin-right: 10px;
              min-width: 100px;
            }
            .separator {
              height: 1px;
              background-color: #e2e8f0;
              margin: 15px 0;
            }
            .badge {
              display: inline-block;
              background-color: #e2e8f0;
              padding: 3px 8px;
              border-radius: 4px;
              font-size: 12px;
              margin-right: 5px;
            }
            .description {
              white-space: pre-wrap;
              margin-top: 15px;
              padding: 10px;
              background-color: #f8f9fa;
              border-radius: 4px;
            }
            .attendees-list {
              margin-top: 10px;
            }
            .attendee-item {
              margin-bottom: 5px;
            }
            .attendee-status {
              font-style: italic;
              color: #718096;
            }
            .footer {
              margin-top: 30px;
              font-size: 12px;
              color: #718096;
              text-align: center;
            }
            .ics-data {
              display: none;
            }
            @media print {
              body {
                padding: 0;
              }
              .print-container {
                border: none;
                padding: 0;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            ${contentToPrint}
            <div class="footer">
              Printed from Calendar App • ${format(new Date(), 'PP')}
            </div>
          </div>
          <div class="ics-data" style="display:none">
            <pre>${icsContent}</pre>
          </div>
          <div class="no-print" style="text-align:center; margin-top:20px">
            <button onclick="window.print()">Print</button>
            <button onclick="window.close()">Close</button>
          </div>
          <script>
            // Auto-trigger print dialog after the page loads
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  // Format attendees with their status
  const formatAttendeeStatus = (status: string) => {
    switch(status?.toLowerCase()) {
      case 'accepted':
        return 'Accepted';
      case 'declined':
        return 'Declined';
      case 'tentative':
        return 'Tentative';
      case 'needs-action':
      case 'needsaction':
        return 'Pending';
      default:
        return 'Invited';
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Print Event</DialogTitle>
          <DialogDescription>
            Preview and print this event. All details will be properly formatted.
          </DialogDescription>
        </DialogHeader>
        
        <div ref={printContentRef} className="py-4">
          <div className="event-title">{event.title}</div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="info-row">
                <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                <span className="info-label">Date:</span>
                <span>
                  {formatDateForPrint(startDate)}
                  {!event.allDay && ` at ${formatTimeForPrint(startDate)}`}
                </span>
              </div>
              
              {!event.allDay && (
                <div className="info-row">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <span className="info-label">Duration:</span>
                  <span>
                    {`${formatTimeForPrint(startDate)} - ${formatTimeForPrint(endDate)}`}
                  </span>
                </div>
              )}
              
              {event.location && (
                <div className="info-row">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <span className="info-label">Location:</span>
                  <span>{event.location}</span>
                </div>
              )}
              
              {event.recurrenceRule && (
                <div className="info-row">
                  <Repeat className="h-5 w-5 text-muted-foreground" />
                  <span className="info-label">Repeats:</span>
                  <span>
                    {event.recurrenceRule.includes('FREQ=DAILY') && 'Daily'}
                    {event.recurrenceRule.includes('FREQ=WEEKLY') && 'Weekly'}
                    {event.recurrenceRule.includes('FREQ=MONTHLY') && 'Monthly'}
                    {event.recurrenceRule.includes('FREQ=YEARLY') && 'Yearly'}
                    {!event.recurrenceRule.includes('FREQ=') && 'Custom'}
                  </span>
                </div>
              )}
              
              {event.organizer && (
                <div className="info-row">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <span className="info-label">Organizer:</span>
                  <span>
                    {event.organizer.name || event.organizer.email}
                  </span>
                </div>
              )}
              
              <Separator className="my-4" />
              
              {/* Display metadata for RFC compliance */}
              <div className="text-xs text-muted-foreground">
                <div><strong>UID:</strong> {event.uid || `event-${event.id}@calendar.replit.app`}</div>
                <div><strong>Calendar:</strong> {event.calendarId}</div>
                <div><strong>Created:</strong> {event.createdAt ? format(new Date(event.createdAt), 'PP pp') : 'Unknown'}</div>
                <div><strong>Last Modified:</strong> {event.lastModifiedAt ? format(new Date(event.lastModifiedAt), 'PP pp') : 'Unknown'}</div>
              </div>
            </div>
            
            <div>
              {/* Attendees section */}
              {event.attendees && (
                <>
                  <div className="info-row">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">
                      Attendees ({Array.isArray(event.attendees) ? event.attendees.length : '1'})
                    </span>
                  </div>
                  
                  <div className="attendees-list">
                    {(() => {
                      // Handle different types of attendees data
                      if (Array.isArray(event.attendees)) {
                        return event.attendees.map((attendee, index) => (
                          <div key={index} className="attendee-item">
                            <span>{attendee.name || attendee.email}</span>
                            <span className="attendee-status"> • {formatAttendeeStatus(attendee.partstat || '')}</span>
                          </div>
                        ));
                      } else if (typeof event.attendees === 'object' && event.attendees !== null) {
                        // Single attendee as object
                        const attendee = event.attendees;
                        return (
                          <div className="attendee-item">
                            <span>{attendee.name || attendee.email}</span>
                            <span className="attendee-status"> • {formatAttendeeStatus(attendee.partstat || '')}</span>
                          </div>
                        );
                      } else if (typeof event.attendees === 'string') {
                        // String email
                        return (
                          <div className="attendee-item">
                            <span>{event.attendees}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  
                  <Separator className="my-4" />
                </>
              )}
              
              {/* Resources section */}
              {event.resources && (
                <>
                  <div className="info-row">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">
                      Resources ({Array.isArray(event.resources) ? event.resources.length : '1'})
                    </span>
                  </div>
                  
                  <div className="attendees-list">
                    {(() => {
                      // Handle different types of resources data
                      if (Array.isArray(event.resources)) {
                        return event.resources.map((resource, index) => (
                          <div key={index} className="attendee-item">
                            <span>{resource.name || resource.adminName || resource.email || resource.adminEmail}</span>
                          </div>
                        ));
                      } else if (typeof event.resources === 'object' && event.resources !== null) {
                        // Single resource as object
                        const resource = event.resources;
                        return (
                          <div className="attendee-item">
                            <span>{resource.name || resource.adminName || resource.email || resource.adminEmail}</span>
                          </div>
                        );
                      } else if (typeof event.resources === 'string') {
                        // String email or description
                        return (
                          <div className="attendee-item">
                            <span>{event.resources}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  
                  <Separator className="my-4" />
                </>
              )}
              
              {/* Description section */}
              {event.description && (
                <>
                  <div className="font-medium mb-2">Description</div>
                  <div className="description">
                    {event.description}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PrintEventModal;