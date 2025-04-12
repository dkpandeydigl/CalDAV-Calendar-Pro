import React from 'react';
import { CheckCircle, XCircle, HelpCircle, Clock, User, MessageSquare } from 'lucide-react';
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
  DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
  // Helper to get status icon
  const getStatusIcon = (status?: string) => {
    const statusLower = status?.toLowerCase() || 'needs-action';
    
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
    const statusLower = status?.toLowerCase() || 'needs-action';
    
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
    const statusLower = status?.toLowerCase() || 'needs-action';
    
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
    
    if (roleLower === 'chair' || roleLower === 'organizer') {
      return <Badge variant="outline" className="ml-2 bg-blue-50 text-blue-700 border-blue-200">Organizer</Badge>;
    } else if (roleLower === 'req-participant' || roleLower.includes('required')) {
      return <Badge variant="outline" className="ml-2 bg-purple-50 text-purple-700 border-purple-200">Required</Badge>;
    } else if (roleLower === 'opt-participant' || roleLower.includes('optional')) {
      return <Badge variant="outline" className="ml-2 bg-teal-50 text-teal-700 border-teal-200">Optional</Badge>;
    }
    
    return null;
  };
  
  // Helper to format date and time
  const formatDateTime = (date: string | Date) => {
    if (!date) return '';
    
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return `${formatDayOfWeekDate(dateObj)} at ${formatTime(dateObj)}`;
  };
  
  // Count of responses by type
  const countByStatus = attendees.reduce((acc, attendee) => {
    const status = (attendee.status || 'needs-action').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Main component render
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 mb-2">
        <Badge variant="outline" className="bg-green-50 border-green-200">
          <CheckCircle className="h-3 w-3 mr-1 text-green-600" />
          <span className="text-green-700">{countByStatus['accepted'] || 0} Accepted</span>
        </Badge>
        <Badge variant="outline" className="bg-red-50 border-red-200">
          <XCircle className="h-3 w-3 mr-1 text-red-600" />
          <span className="text-red-700">{countByStatus['declined'] || 0} Declined</span>
        </Badge>
        <Badge variant="outline" className="bg-amber-50 border-amber-200">
          <HelpCircle className="h-3 w-3 mr-1 text-amber-600" />
          <span className="text-amber-700">{countByStatus['tentative'] || 0} Tentative</span>
        </Badge>
        <Badge variant="outline" className="bg-gray-50 border-gray-200">
          <Clock className="h-3 w-3 mr-1 text-gray-600" />
          <span className="text-gray-700">
            {(countByStatus['needs-action'] || 0) + (countByStatus[''] || 0)} No Response
          </span>
        </Badge>
      </div>

      <div className="border rounded-md">
        <div className="bg-muted/30 p-2 border-b">
          <h3 className="font-medium">Attendees ({attendees.length})</h3>
        </div>
        <ul className="divide-y">
          {attendees.map((attendee, index) => (
            <li key={attendee.id || `${attendee.email}-${index}`} className="p-3 flex items-start">
              <div className="flex-shrink-0 mr-3 mt-1">
                {getStatusIcon(attendee.status)}
              </div>
              <div className="flex-grow min-w-0">
                <div className="flex items-center flex-wrap gap-1">
                  <span className="font-medium truncate">
                    {attendee.name || (attendee.email ? attendee.email.split('@')[0] : 'Unknown')}
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
                            View comment from {attendee.name || (attendee.email ? attendee.email.split('@')[0] : 'Unknown')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Comment from {attendee.name || (attendee.email ? attendee.email.split('@')[0] : 'Unknown')}</DialogTitle>
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
        </ul>
      </div>
    </div>
  );
};

export default AttendeeStatusDisplay;