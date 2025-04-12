import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  ScrollArea 
} from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  HelpCircle, 
  MessageSquare
} from "lucide-react";

interface Attendee {
  id?: string | number;
  email: string;
  name?: string;
  status?: string;
  role?: string;
  comment?: string;
  proposedStart?: string | Date;
  proposedEnd?: string | Date;
  [key: string]: any;
}

interface AttendeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendees: Attendee[];
  title?: string;
  description?: string;
  selectedStatus?: string;
}

const AttendeeDialog: React.FC<AttendeeDialogProps> = ({
  open,
  onOpenChange,
  attendees,
  title = 'All Attendees',
  description = 'List of all attendees for this event',
  selectedStatus = 'all'
}) => {
  // Helper to normalize status from various formats
  const normalizeStatus = (status?: string): string => {
    if (!status) return 'needs-action';
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('accept')) return 'accepted';
    if (statusLower.includes('decline')) return 'declined';
    if (statusLower.includes('tentative')) return 'tentative';
    return 'needs-action';
  };
  
  // Clean up attendees data to ensure all have proper email and name
  const processedAttendees = attendees.map(attendee => {
    // Ensure email exists and is not null/undefined
    const email = attendee.email || '';
    
    // Get properly formatted name
    let name = attendee.name;
    if (!name && email) {
      name = email.split('@')[0];
      // Capitalize first letter of each word
      name = name.split('.').map(part => 
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');
    }
    
    // Normalize status
    const status = normalizeStatus(attendee.status);
    
    return {
      ...attendee,
      email,
      name,
      status
    };
  });

  // Get attendees filtered by status
  const getAttendeesByStatus = (status: string) => {
    if (status === 'all') {
      return processedAttendees;
    }
    
    if (status === 'needs-action') {
      return processedAttendees.filter(attendee => 
        normalizeStatus(attendee.status) === 'needs-action'
      );
    }
    
    return processedAttendees.filter(attendee => 
      normalizeStatus(attendee.status) === status
    );
  };
  
  // Helper to get status icon
  const getStatusIcon = (status?: string) => {
    const statusLower = normalizeStatus(status);
    
    if (statusLower === 'accepted') {
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    } else if (statusLower === 'declined') {
      return <XCircle className="h-4 w-4 text-red-600" />;
    } else if (statusLower === 'tentative') {
      return <HelpCircle className="h-4 w-4 text-amber-600" />;
    } else {
      return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };
  
  // Helper to get text status
  const getStatusText = (status?: string) => {
    const statusLower = normalizeStatus(status);
    
    if (statusLower === 'accepted') {
      return 'Accepted';
    } else if (statusLower === 'declined') {
      return 'Declined';
    } else if (statusLower === 'tentative') {
      return 'Tentative';
    } else {
      return 'No Response';
    }
  };
  
  // Helper to get status color class
  const getStatusColorClass = (status?: string) => {
    const statusLower = normalizeStatus(status);
    
    if (statusLower === 'accepted') {
      return 'bg-green-100 text-green-800 border-green-300';
    } else if (statusLower === 'declined') {
      return 'bg-red-100 text-red-800 border-red-300';
    } else if (statusLower === 'tentative') {
      return 'bg-amber-100 text-amber-800 border-amber-300';
    } else {
      return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };
  
  // Helper to get role badge
  const getRoleBadge = (role?: string) => {
    if (!role) return null;
    
    const roleLower = role.toLowerCase();
    
    if (roleLower === 'chair' || roleLower === 'chairman' || roleLower === 'organizer') {
      return <Badge variant="outline" className="ml-2 bg-blue-50 text-blue-700 border-blue-200">Organizer</Badge>;
    } else if (roleLower === 'req-participant' || roleLower.includes('required')) {
      return <Badge variant="outline" className="ml-2 bg-purple-50 text-purple-700 border-purple-200">Required</Badge>;
    } else if (roleLower === 'opt-participant' || roleLower.includes('optional')) {
      return <Badge variant="outline" className="ml-2 bg-teal-50 text-teal-700 border-teal-200">Optional</Badge>;
    } else if (roleLower === 'secretary') {
      return <Badge variant="outline" className="ml-2 bg-indigo-50 text-indigo-700 border-indigo-200">Secretary</Badge>;
    } else if (roleLower === 'member') {
      return <Badge variant="outline" className="ml-2 bg-violet-50 text-violet-700 border-violet-200">Member</Badge>;
    }
    
    return <Badge variant="outline" className="ml-2 bg-gray-50 text-gray-700 border-gray-200">{role}</Badge>;
  };

  // Filtered attendees based on selected status
  const displayedAttendees = getAttendeesByStatus(selectedStatus);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {selectedStatus === 'all' 
              ? title 
              : `${getStatusText(selectedStatus)} (${displayedAttendees.length})`
            }
          </DialogTitle>
          <DialogDescription>
            {selectedStatus === 'all' 
              ? description
              : `List of attendees who have ${getStatusText(selectedStatus).toLowerCase()} this event`
            }
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[300px] border rounded-md">
          <ul className="divide-y">
            {displayedAttendees.map((attendee, index) => (
              <li key={attendee.id || `${attendee.email}-${index}`} className="p-3 flex items-start">
                <div className="flex-shrink-0 mr-3 mt-1">
                  {getStatusIcon(attendee.status)}
                </div>
                <div className="flex-grow min-w-0">
                  <div className="flex items-center flex-wrap gap-1">
                    <span className="font-medium truncate">
                      {attendee.name || 'Unknown'}
                    </span>
                    {getRoleBadge(attendee.role)}
                    <Badge 
                      variant="outline" 
                      className={`ml-auto ${getStatusColorClass(attendee.status)}`}
                    >
                      {getStatusText(attendee.status)}
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {attendee.email || '(No email address)'}
                  </div>
                  
                  {/* Display comment if available */}
                  {attendee.comment && (
                    <div className="mt-2 text-sm flex items-start">
                      <MessageSquare className="h-4 w-4 text-gray-500 mr-1.5 mt-0.5 flex-shrink-0" />
                      <div className="prose prose-sm">
                        <Dialog>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Comment from {attendee.name || 'Unknown'}</DialogTitle>
                              <DialogDescription>
                                Response: <Badge 
                                  variant="outline" 
                                  className={getStatusColorClass(attendee.status)}
                                >
                                  {getStatusText(attendee.status)}
                                </Badge>
                              </DialogDescription>
                            </DialogHeader>
                            <div 
                              className="mt-4 prose prose-sm max-w-none" 
                              dangerouslySetInnerHTML={{ __html: attendee.comment }}
                            />
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
            {displayedAttendees.length === 0 && (
              <li className="p-3 text-center text-muted-foreground">
                No attendees found with {getStatusText(selectedStatus)} status
              </li>
            )}
          </ul>
        </ScrollArea>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AttendeeDialog;