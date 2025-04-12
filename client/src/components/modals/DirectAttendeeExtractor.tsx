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
  isPreview?: boolean; // If true, only show limited attendees with count indicator
}

const DirectAttendeeExtractor: React.FC<DirectAttendeeExtractorProps> = ({ 
  rawData,
  showMoreCount = 2,
  isPreview = true
}) => {
  console.log('ATTENDEE DEBUG: DirectAttendeeExtractor component rendering with rawData:', 
              rawData ? `string of length ${rawData.length}` : 'null/undefined');
  
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
      
      // STEP 1: Unfold the iCalendar data (RFC 5545 format)
      // This is critical for handling folded lines with CRLF + space continuations
      const unfoldedData = rawData.replace(/\r?\n[ \t]/g, '');
      console.log('ATTENDEE DEBUG: Unfolded data example:', unfoldedData.substring(0, 200));
      
      // Check also for description that might have attendee information
      const descriptionMatch = unfoldedData.match(/DESCRIPTION:(.+?)(?=\r?\n[A-Z])/s);
      const descriptionText = descriptionMatch ? descriptionMatch[1] : '';
      
      // Extract potential emails from description
      const emailsFromDescription: Record<string, string> = {};
      if (descriptionText) {
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
        let emailMatch;
        while ((emailMatch = emailRegex.exec(descriptionText)) !== null) {
          const email = emailMatch[1].trim();
          // Use the email as both key and initial name
          emailsFromDescription[email] = email.split('@')[0];
        }
      }
      
      // STEP 2: Use a direct regex approach to find all ATTENDEE lines that aren't resources
      const attendeeRegex = /ATTENDEE(?!.*CUTYPE=RESOURCE).*?:.*?mailto:([^\s;>,\n\r]+)/g;
      const extractedAttendees: Attendee[] = [];
      let regexMatch;
      
      // Track which method was successful
      let extractionMethod = "none";
      
      // Try direct regex first
      while ((regexMatch = attendeeRegex.exec(unfoldedData)) !== null) {
        const fullLine = regexMatch[0];
        const email = regexMatch[1].trim();
        
        // Extract attendee name from CN if available
        const cnMatch = fullLine.match(/CN=([^;:]+)/);
        let name = cnMatch ? cnMatch[1].trim() : '';
        
        // If no name found, try to get it from the description or use email username
        if (!name || name === '') {
          name = emailsFromDescription[email] || email.split('@')[0];
        }
        
        // Format name - capitalize first letter of each part
        name = name.split(/[\s._-]+/).map(part => 
          part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        ).join(' ');
        
        // Extract attendee role
        const roleMatch = fullLine.match(/ROLE=([^;:]+)/);
        const role = roleMatch ? roleMatch[1].trim() : 'Attendee';
        
        // Extract participation status
        const statusMatch = fullLine.match(/PARTSTAT=([^;:]+)/);
        const status = statusMatch ? statusMatch[1].replace(/-/g, ' ').trim() : 'Needs Action';
        
        console.log(`ATTENDEE DEBUG: Extracted via regex: ${name} <${email}>, role: ${role}`);
        
        extractedAttendees.push({
          id: `attendee-regex-${extractedAttendees.length}-${Date.now()}`,
          email,
          name,
          role,
          status
        });
      }
      
      // If we found attendees via regex, use them
      if (extractedAttendees.length > 0) {
        console.log(`ATTENDEE DEBUG: Successfully extracted ${extractedAttendees.length} attendees via regex`);
        extractionMethod = "regex";
        setAttendees(extractedAttendees);
      } else {
        // STEP 3: If regex failed, try with simple line splitting
        console.log('ATTENDEE DEBUG: Regex approach failed, trying line-based approach');
        
        // Get all lines and find those with ATTENDEE but not CUTYPE=RESOURCE
        const lines = unfoldedData.split(/\r?\n/);
        const attendeeLines = lines.filter(line => 
          line.includes('ATTENDEE') && 
          !line.includes('CUTYPE=RESOURCE')
        );
        
        if (attendeeLines.length > 0) {
          console.log(`ATTENDEE DEBUG: Found ${attendeeLines.length} potential attendee lines`);
          
          // Process each attendee line
          const lineBasedAttendees = attendeeLines.map((line, index) => {
            // Look for email in mailto: format
            const emailMatch = line.match(/mailto:([^\s>\n\r;]+)/);
            if (!emailMatch) {
              console.log('ATTENDEE DEBUG: No email found in line:', line);
              return null;
            }
            
            const email = emailMatch[1].trim();
            
            // Extract other attendee info if available
            const cnMatch = line.match(/CN=([^;:]+)/);
            let name = cnMatch ? cnMatch[1].trim() : '';
            
            // If no name found, try to get it from the description or use email username
            if (!name || name === '') {
              name = emailsFromDescription[email] || email.split('@')[0];
            }
            
            // Format name - capitalize first letter of each part
            name = name.split(/[\s._-]+/).map(part => 
              part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
            ).join(' ');
            
            const roleMatch = line.match(/ROLE=([^;:]+)/);
            const role = roleMatch ? roleMatch[1].trim() : 'Attendee';
            
            const statusMatch = line.match(/PARTSTAT=([^;:]+)/);
            const status = statusMatch ? statusMatch[1].replace(/-/g, ' ').trim() : 'Needs Action';
            
            console.log(`ATTENDEE DEBUG: Line-based extraction: ${name} <${email}>, role: ${role}`);
            
            return {
              id: `attendee-line-${index}-${Date.now()}`,
              email,
              name,
              role,
              status
            };
          });
          
          // Filter out any null entries and set the attendees
          const validAttendees = lineBasedAttendees.filter(a => a !== null) as Attendee[];
          
          if (validAttendees.length > 0) {
            console.log(`ATTENDEE DEBUG: Extracted ${validAttendees.length} attendees via line-based approach`);
            extractionMethod = "line-based";
            setAttendees(validAttendees);
          } else {
            // STEP 4: Final attempt - try searching for "mailto:" directly
            console.log('ATTENDEE DEBUG: Line-based approach failed, trying mailto search');
            
            // Look for all mailto: patterns in ATTENDEE sections
            const mailtoRegex = /ATTENDEE[^:]*:[^:]*mailto:([^\s;>,\n\r]+)/g;
            const mailtoMatches: Attendee[] = [];
            let mailtoMatch;
            
            while ((mailtoMatch = mailtoRegex.exec(unfoldedData)) !== null) {
              const email = mailtoMatch[1].trim();
              console.log(`ATTENDEE DEBUG: Found email via mailto search: ${email}`);
              
              // Get name either from description or email
              let name = emailsFromDescription[email] || email.split('@')[0];
              
              // Format name - capitalize first letter of each part
              name = name.split(/[\s._-]+/).map(part => 
                part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
              ).join(' ');
              
              mailtoMatches.push({
                id: `attendee-mailto-${mailtoMatches.length}-${Date.now()}`,
                email,
                name,
                role: 'Attendee',
                status: 'Needs Action'
              });
            }
            
            if (mailtoMatches.length > 0) {
              console.log(`ATTENDEE DEBUG: Found ${mailtoMatches.length} attendees via mailto search`);
              extractionMethod = "mailto-search";
              setAttendees(mailtoMatches);
            } else {
              console.log('ATTENDEE DEBUG: All extraction methods failed');
            }
          }
        } else {
          console.log('ATTENDEE DEBUG: No attendee lines found');
        }
      }
      
      console.log(`ATTENDEE DEBUG: Extraction complete. Method: ${extractionMethod}, Count: ${attendees.length}`);
    } catch (error) {
      console.error('ATTENDEE DEBUG: Error extracting attendees:', error);
    }
  }, [rawData]);
  
  // Don't display anything if no attendees found
  if (attendees.length === 0) {
    console.log('ATTENDEE DEBUG: No attendees found, component will not render');
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
        <ul className="space-y-1">
          {attendees
            .slice(0, isPreview ? 1 : attendees.length) // Show one attendee in preview mode, all in detail mode
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
          
          {/* Show "more attendees" indicator if needed - only in preview mode */}
          {isPreview && attendees.length > 1 && (
            <li className="text-xs text-center py-1">
              <span className="bg-slate-200 px-2 py-0.5 rounded-full text-slate-500 inline-flex items-center">
                <Users className="h-3 w-3 mr-1" />
                + {attendees.length - 1} more attendee{attendees.length - 1 > 1 ? 's' : ''}
              </span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default DirectAttendeeExtractor;