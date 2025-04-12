import React, { useState } from 'react';
import { CheckCircle, XCircle, HelpCircle, Clock, User, MessageSquare, ChevronRight } from 'lucide-react';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { formatDayOfWeekDate, formatTime } from '@/lib/date-utils';
import { format } from 'date-fns';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

type Attendee = {
  id?: string;
  email: string;
  name?: string;
  role?: string;
  status?: string;
  comment?: string;
  proposedStart?: string | Date;
  proposedEnd?: string | Date;
}

interface AttendeeStatusDisplayProps {
  attendees: Attendee[];
  isOrganizer: boolean;
  onTimeProposalAccept?: (attendeeEmail: string, start: Date, end: Date) => void;
}

const AttendeeStatusDisplay: React.FC<AttendeeStatusDisplayProps> = ({
  attendees,
  isOrganizer,
  onTimeProposalAccept
}) => {
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  
  // Helper to get normalized status from various formats
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
  
  // Helper to get button hover class
  const getStatusButtonHoverClass = (status: string) => {
    if (status === 'accepted') {
      return 'hover:bg-green-50';
    } else if (status === 'declined') {
      return 'hover:bg-red-50'; 
    } else if (status === 'tentative') {
      return 'hover:bg-amber-50';
    } else {
      return 'hover:bg-gray-50';
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
  
  // Helper to format date and time
  const formatDateTime = (date: string | Date) => {
    if (!date) return '';
    
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return `${formatDayOfWeekDate(dateObj)} at ${formatTime(dateObj)}`;
  };
  
  // Get attendees filtered by status
  const getAttendeesByStatus = (status: string) => {
    if (status === 'needs-action') {
      return processedAttendees.filter(attendee => 
        normalizeStatus(attendee.status) === 'needs-action'
      );
    }
    return processedAttendees.filter(attendee => 
      normalizeStatus(attendee.status) === status
    );
  };
  
  // Count of responses by type
  const countByStatus = processedAttendees.reduce((acc, attendee) => {
    const status = normalizeStatus(attendee.status);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Show status dialog
  const openStatusDialog = (status: string) => {
    setSelectedStatus(status);
    setStatusDialogOpen(true);
  };
  
  // Display up to 4 attendees in the main view
  const displayedAttendees = processedAttendees.slice(0, 4);
  
  // Main component render
  return (
    <div className="space-y-4">
      <div className="w-full">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
          <div 
            className="flex items-center cursor-pointer" 
            onClick={() => openStatusDialog('accepted')}
          >
            <div className="mr-2 flex-shrink-0">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div className="text-green-700 font-medium">
              {countByStatus['accepted'] || 0} Accepted
            </div>
          </div>
          
          <div 
            className="flex items-center cursor-pointer" 
            onClick={() => openStatusDialog('declined')}
          >
            <div className="mr-2 flex-shrink-0">
              <div className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-600">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <div className="text-red-700 font-medium">
              {countByStatus['declined'] || 0} Declined
            </div>
          </div>
          
          <div 
            className="flex items-center cursor-pointer" 
            onClick={() => openStatusDialog('tentative')}
          >
            <div className="mr-2 flex-shrink-0">
              <div className="inline-flex items-center justify-center rounded-full border border-amber-500 w-5 h-5">
                <span className="text-amber-600 font-medium text-sm">?</span>
              </div>
            </div>
            <div className="text-amber-700 font-medium">
              {countByStatus['tentative'] || 0} Tentative
            </div>
          </div>
          
          <div 
            className="flex items-center cursor-pointer" 
            onClick={() => openStatusDialog('needs-action')}
          >
            <div className="mr-2 flex-shrink-0 opacity-0">
              <Clock className="h-5 w-5" />
            </div>
            <div className="text-gray-700 font-medium">
              No Response
            </div>
          </div>
        </div>
      </div>

      <div className="border rounded-md">
        <div className="bg-muted/30 p-2 border-b">
          <h3 className="font-medium">Attendee List</h3>
        </div>
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
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge 
                          variant="outline" 
                          className={`ml-auto ${getStatusColorClass(attendee.status)}`}
                        >
                          {getStatusText(attendee.status)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Response status: {getStatusText(attendee.status)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                        <DialogTrigger asChild>
                          <Button variant="link" className="p-0 h-auto text-xs">
                            View comment from {attendee.name || 'Unknown'}
                          </Button>
                        </DialogTrigger>
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
                
                {/* Display time proposal if available */}
                {attendee.proposedStart && attendee.proposedEnd && (
                  <div className="mt-2 text-sm flex items-start">
                    <Clock className="h-4 w-4 text-gray-500 mr-1.5 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-gray-700">Proposed time: </span>
                      <span>
                        {formatDateTime(attendee.proposedStart)} - {formatTime(new Date(attendee.proposedEnd))}
                      </span>
                      
                      {/* Accept button for organizer */}
                      {isOrganizer && onTimeProposalAccept && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-2 mt-1"
                          onClick={() => onTimeProposalAccept(
                            attendee.email,
                            new Date(attendee.proposedStart!),
                            new Date(attendee.proposedEnd!)
                          )}
                        >
                          Accept Proposal
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
          {processedAttendees.length > 4 && (
            <li className="p-2 bg-muted/20">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs flex justify-center items-center text-muted-foreground"
                onClick={() => openStatusDialog('all')}
              >
                Show all {processedAttendees.length} attendees
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </li>
          )}
        </ul>
      </div>
      
      {/* Status dialog for filtered attendees */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {selectedStatus === 'all' 
                ? 'All Attendees' 
                : `${getStatusText(selectedStatus || '')} (${
                    selectedStatus === 'all' 
                      ? processedAttendees.length 
                      : (getAttendeesByStatus(selectedStatus || '').length)
                  })`
              }
            </DialogTitle>
            <DialogDescription>
              {selectedStatus === 'all' 
                ? 'List of all attendees for this event'
                : `List of attendees who have ${getStatusText(selectedStatus || '').toLowerCase()} this event`
              }
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-[300px] border rounded-md">
            <ul className="divide-y">
              {(selectedStatus === 'all' ? processedAttendees : getAttendeesByStatus(selectedStatus || '')).map((attendee, index) => (
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
                            <DialogTrigger asChild>
                              <Button variant="link" className="p-0 h-auto text-xs">
                                View comment from {attendee.name || 'Unknown'}
                              </Button>
                            </DialogTrigger>
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
                    
                    {/* Display time proposal if available */}
                    {attendee.proposedStart && attendee.proposedEnd && (
                      <div className="mt-2 text-sm flex items-start">
                        <Clock className="h-4 w-4 text-gray-500 mr-1.5 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="text-gray-700">Proposed time: </span>
                          <span>
                            {formatDateTime(attendee.proposedStart)} - {formatTime(new Date(attendee.proposedEnd))}
                          </span>
                          
                          {/* Accept button for organizer */}
                          {isOrganizer && onTimeProposalAccept && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="ml-2 mt-1"
                              onClick={() => onTimeProposalAccept(
                                attendee.email,
                                new Date(attendee.proposedStart!),
                                new Date(attendee.proposedEnd!)
                              )}
                            >
                              Accept Proposal
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {(selectedStatus === 'all' ? processedAttendees : getAttendeesByStatus(selectedStatus || '')).length === 0 && (
                <li className="p-3 text-center text-muted-foreground">
                  No attendees found with {getStatusText(selectedStatus || '')} status
                </li>
              )}
            </ul>
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AttendeeStatusDisplay;