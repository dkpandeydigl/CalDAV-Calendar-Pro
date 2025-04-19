import React, { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Event } from '@shared/schema';
import { Printer, Calendar, MapPin, Clock, Users, Info, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { Separator } from '@/components/ui/separator';

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
  onClose,
}) => {
  const printContainerRef = useRef<HTMLDivElement>(null);
  const { selectedTimezone } = useCalendarContext();

  useEffect(() => {
    // Auto-focus the print container when opened
    if (open && printContainerRef.current) {
      printContainerRef.current.focus();
    }
  }, [open]);

  if (!event) return null;

  // Parse dates safely
  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);

  // Extract attendees
  const attendees = (() => {
    if (!event.attendees) return [];
    
    try {
      if (typeof event.attendees === 'string') {
        return JSON.parse(event.attendees);
      }
      return Array.isArray(event.attendees) ? event.attendees : [];
    } catch (e) {
      console.error('Failed to parse attendees', e);
      return [];
    }
  })();

  // Extract resources 
  const resources = (() => {
    if (!event.resources) return [];
    
    try {
      if (typeof event.resources === 'string') {
        return JSON.parse(event.resources);
      }
      return Array.isArray(event.resources) ? event.resources : [];
    } catch (e) {
      console.error('Failed to parse resources', e);
      return [];
    }
  })();

  const handlePrint = () => {
    const printContent = printContainerRef.current?.innerHTML || '';
    const printWindow = window.open('', '_blank');
    
    if (!printWindow) {
      alert('Please allow pop-ups to print this event');
      return;
    }
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print: ${event.title}</title>
          <style>
            body {
              font-family: 'Times New Roman', Times, serif;
              line-height: 1.5;
              color: #000;
              background: #fff;
              margin: 20px;
              padding: 20px;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 16px;
            }
            .event-detail {
              margin-bottom: 12px;
            }
            .event-label {
              font-weight: bold;
              margin-right: 8px;
            }
            .event-section {
              margin-bottom: 20px;
              break-inside: avoid;
            }
            .separator {
              border-top: 1px solid #ccc;
              margin: 16px 0;
            }
            .uid {
              font-family: monospace;
              font-size: 12px;
              color: #666;
              margin-top: 20px;
              word-break: break-all;
            }
            @media print {
              body {
                margin: 0;
                padding: 15px;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          ${printContent}
          <div class="no-print" style="margin-top: 30px; text-align: center;">
            <button onclick="window.print(); window.close();">Print</button>
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            <span>Print Event</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <div ref={printContainerRef} className="print-container space-y-6">
            <h1 className="text-2xl font-bold">{event.title}</h1>
            
            <div className="event-section">
              <div className="flex items-start gap-2 event-detail">
                <Clock className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                <div>
                  <div className="event-label">When</div>
                  <div>
                    {event.allDay ? (
                      <>
                        {format(startDate, 'PPPP')}
                        {startDate.toISOString().split('T')[0] !== endDate.toISOString().split('T')[0] && 
                          ` - ${format(endDate, 'PPPP')}`}
                        <span className="ml-2 text-sm text-muted-foreground">All day</span>
                      </>
                    ) : (
                      <>
                        {format(startDate, 'PPPP')} {format(startDate, 'p')} - 
                        {startDate.toISOString().split('T')[0] === endDate.toISOString().split('T')[0] 
                          ? format(endDate, ' p') 
                          : ` ${format(endDate, 'PPPP')} ${format(endDate, 'p')}`}
                      </>
                    )}
                    <div className="text-sm text-muted-foreground">
                      Timezone: {event.timezone || selectedTimezone}
                    </div>
                  </div>
                </div>
              </div>
              
              {event.location && (
                <div className="flex items-start gap-2 event-detail">
                  <MapPin className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div>
                    <div className="event-label">Where</div>
                    <div>{event.location}</div>
                  </div>
                </div>
              )}
            </div>
            
            <Separator className="separator" />
            
            {attendees.length > 0 && (
              <div className="event-section">
                <div className="flex items-start gap-2 event-detail">
                  <Users className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div>
                    <div className="event-label">Attendees</div>
                    <ul className="mt-1 space-y-1">
                      {attendees.map((attendee: any, index: number) => (
                        <li key={index} className="text-sm">
                          {attendee.name || attendee.email}
                          {attendee.response && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({attendee.response})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            {resources.length > 0 && (
              <div className="event-section">
                <div className="flex items-start gap-2 event-detail">
                  <Calendar className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div>
                    <div className="event-label">Resources</div>
                    <ul className="mt-1 space-y-1">
                      {resources.map((resource: any, index: number) => (
                        <li key={index} className="text-sm">
                          {resource.name} ({resource.subType || resource.type || 'Resource'})
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            {event.description && (
              <div className="event-section">
                <div className="flex items-start gap-2 event-detail">
                  <FileText className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div>
                    <div className="event-label">Description</div>
                    <div 
                      className="event-description mt-1 text-sm whitespace-pre-wrap" 
                      dangerouslySetInnerHTML={{ __html: event.description || '' }}
                    />
                  </div>
                </div>
              </div>
            )}
            
            <div className="event-section">
              <div className="flex items-start gap-2 event-detail">
                <Info className="h-5 w-5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">
                    Calendar: {event.calendarId}
                  </div>
                  <div className="uid text-xs text-muted-foreground">
                    UID: {event.uid || 'No UID available'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PrintEventModal;