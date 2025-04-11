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
      // First log some raw data for debugging
      console.log('ATTENDEE DEBUG: Searching raw data of length', rawData.length);
      console.log('ATTENDEE DEBUG: First 100 chars of raw data:', rawData.substring(0, 100));
      console.log('ATTENDEE DEBUG: Does data contain ATTENDEE?', rawData.includes('ATTENDEE'));
      
      // Use multiple patterns to try and extract attendees in different formats
      // Pattern 1: Standard format with CUTYPE checks
      const attendeeRegex1 = /ATTENDEE(?!.*CUTYPE=RESOURCE)[^:]*?:[^:\r\n]*mailto:([^\s>\r\n]+)/g;
      
      // Pattern 2: More flexible pattern for different formats
      const attendeeRegex2 = /ATTENDEE[^:]*?(?!CUTYPE=RESOURCE)[^:]*?:[^:\r\n]*mailto:([^\s>\r\n]+)/g;
      
      // Pattern 3: Most flexible pattern
      const attendeeRegex = /ATTENDEE(?!.*CUTYPE=RESOURCE).*?mailto:([^\s>\r\n]+)/g;
      
      // Use a more compatible approach with newer JavaScript engines
      const matches = [];
      let match;
      while ((match = attendeeRegex.exec(rawData)) !== null) {
        matches.push(match);
      }
      
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
          
          // Add individual attendee debug logging
          console.log(`ATTENDEE DEBUG - Extracted attendee: ${name}, email: ${email}, role: ${role}, status: ${status}`);
          
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
        console.log('ATTENDEE DEBUG: No attendees found with regex, trying fallback approach');
        
        // Fallback approach - split by lines and find ATTENDEE lines
        const lines = rawData.split(/\r?\n/);
        const attendeeLines = lines.filter(line => 
          line.includes('ATTENDEE') && 
          !line.includes('CUTYPE=RESOURCE') && 
          line.includes('mailto:')
        );
        
        if (attendeeLines.length > 0) {
          console.log(`ATTENDEE DEBUG: Found ${attendeeLines.length} attendee lines with fallback approach`);
          
          const fallbackAttendees = attendeeLines.map((line, index) => {
            // Extract email
            const emailMatch = line.match(/mailto:([^\s>\r\n]+)/);
            const email = emailMatch ? emailMatch[1].trim() : `unknown-${index}@example.com`;
            
            // Extract name
            const cnMatch = line.match(/CN=([^;:]+)/);
            const name = cnMatch ? cnMatch[1].trim() : email.split('@')[0];
            
            // Extract role
            const roleMatch = line.match(/ROLE=([^;:]+)/);
            const role = roleMatch ? roleMatch[1].trim() : 'Attendee';
            
            // Extract status
            const statusMatch = line.match(/PARTSTAT=([^;:]+)/);
            const status = statusMatch ? statusMatch[1].replace(/-/g, ' ').trim() : 'Needs Action';
            
            console.log(`ATTENDEE DEBUG - Fallback extracted attendee: ${name}, email: ${email}`);
            
            return {
              id: `attendee-fallback-${index}-${Date.now()}`,
              email,
              name,
              role,
              status
            };
          });
          
          console.log('ATTENDEE DEBUG: Extracted fallback attendees:', fallbackAttendees);
          setAttendees(fallbackAttendees);
        } else {
          console.log('ATTENDEE DEBUG: No attendees found in raw data with any method');
        }
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