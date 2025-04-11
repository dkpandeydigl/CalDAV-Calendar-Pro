import React, { useEffect, useState } from 'react';
import { User, Mail, UserPlus, Users } from 'lucide-react';

interface Attendee {
  id: string;
  name?: string;
  email: string;
  role?: string;
  status?: string;
}

interface DirectAttendeeExtractorProps {
  rawData: string | null | undefined;
  showMoreCount?: number; // Number of attendees to show before "more"
}

const DirectAttendeeExtractor: React.FC<DirectAttendeeExtractorProps> = ({ 
  rawData,
  showMoreCount = 2
}) => {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  
  useEffect(() => {
    if (!rawData) {
      console.log('ATTENDEE DEBUG: No raw data available');
      return;
    }
    
    try {
      // Use a pattern to directly extract attendee information from raw iCalendar data
      // Exclude resource attendees (CUTYPE=RESOURCE)
      const attendeeRegex = /ATTENDEE(?!.*CUTYPE=RESOURCE)[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
      const matches = Array.from(rawData.matchAll(attendeeRegex));
      
      if (matches && matches.length > 0) {
        console.log(`ATTENDEE DEBUG: Found ${matches.length} attendees directly in raw data`);
        
        // Extract attendee information from each match
        const directAttendees = matches.map((match, index) => {
          const fullLine = match[0]; // The complete ATTENDEE line
          const email = match[1].trim(); // The captured email group
          
          // Extract attendee name from CN if available
          const cnMatch = fullLine.match(/CN=([^;:]+)/);
          const name = cnMatch ? cnMatch[1].trim() : email.split('@')[0];
          
          // Extract attendee role
          const roleMatch = fullLine.match(/ROLE=([^;:]+)/);
          const role = roleMatch ? roleMatch[1].trim() : 'Attendee';
          
          // Extract participation status
          const statusMatch = fullLine.match(/PARTSTAT=([^;:]+)/);
          const status = statusMatch ? statusMatch[1].replace(/-/g, ' ').trim() : 'Needs Action';
          
          return {
            id: `attendee-${index}-${Date.now()}`,
            email,
            name,
            role,
            status
          };
        });
        
        console.log('ATTENDEE DEBUG: Extracted attendees:', directAttendees);
        setAttendees(directAttendees);
      } else {
        console.log('ATTENDEE DEBUG: No attendees found in raw data');
      }
    } catch (error) {
      console.error('ATTENDEE DEBUG: Error extracting attendees:', error);
    }
  }, [rawData]);
  
  if (attendees.length === 0) {
    return null;
  }

  // Function to determine which icon to use based on attendee role
  const getAttendeeIcon = (role: string) => {
    const lowerRole = role.toLowerCase();
    if (lowerRole.includes('chair') || lowerRole.includes('organizer')) {
      return <UserPlus className="h-4 w-4 text-blue-500" />;
    } else if (lowerRole.includes('req') || lowerRole.includes('mandatory')) {
      return <User className="h-4 w-4 text-red-500" />;
    } else {
      return <User className="h-4 w-4 text-gray-500" />;
    }
  };

  // Determine role display format  
  const getRoleDisplay = (role: string) => {
    if (role === 'REQ-PARTICIPANT') return 'Required';
    if (role === 'OPT-PARTICIPANT') return 'Optional';
    if (role === 'NON-PARTICIPANT') return 'Non-Participant';
    if (role === 'CHAIR') return 'Chair';
    return role;
  };
  
  return (
    <div>
      <div className="text-sm font-medium mb-1">
        <span>Attendees ({attendees.length})</span>
      </div>
      <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
        <ul className="space-y-1 max-h-[10em] overflow-y-auto pr-2">
          {attendees
            .slice(0, showMoreCount)
            .map((attendee, index) => (
              <li key={`attendee-${index}`} className="flex items-start mb-2">
                <div className="mt-1 mr-3">
                  {getAttendeeIcon(attendee.role || '')}
                </div>
                <div>
                  <div className="font-medium">
                    {attendee.name || attendee.email.split('@')[0]}
                  </div>
                  <div className="text-xs text-gray-600">
                    {attendee.email}
                  </div>
                  {attendee.role && (
                    <div className="text-xs mt-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        attendee.role.toLowerCase() === 'chair' ? 'bg-blue-100 text-blue-800' :
                        attendee.role.toLowerCase().includes('req') ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {getRoleDisplay(attendee.role)}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          
          {/* Show "more attendees" indicator if needed */}
          {attendees.length > showMoreCount && (
            <li className="text-xs text-center py-1">
              <span className="bg-slate-200 px-2 py-0.5 rounded-full text-slate-500 inline-flex items-center">
                <Users className="h-3 w-3 mr-1" />
                + {attendees.length - showMoreCount} more attendee{attendees.length - showMoreCount > 1 ? 's' : ''}
              </span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default DirectAttendeeExtractor;