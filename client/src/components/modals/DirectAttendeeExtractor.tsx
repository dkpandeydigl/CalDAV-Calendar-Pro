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
  rawData: string | object | null | undefined;
  showMoreCount?: number; // Number of attendees to show before "more"
  isPreview?: boolean; // If true, only show limited attendees with count indicator
  fallbackEmail?: string; // Fallback email to use when no valid email is found
}

const DirectAttendeeExtractor: React.FC<DirectAttendeeExtractorProps> = ({ 
  rawData,
  showMoreCount = 2,
  isPreview = true,
  fallbackEmail = ""
}) => {
  // Convert rawData to string if it's an object
  let rawDataString: string | null | undefined = null;
  
  if (rawData === null || rawData === undefined) {
    rawDataString = null;
  } else if (typeof rawData === 'string') {
    rawDataString = rawData;
  } else {
    // It's an object, try to stringify it
    try {
      rawDataString = JSON.stringify(rawData);
      console.log('ATTENDEE DEBUG: Converted object rawData to string of length', rawDataString.length);
    } catch (e) {
      console.error('ATTENDEE DEBUG: Failed to stringify rawData:', e);
      rawDataString = null;
    }
  }
  
  console.log('ATTENDEE DEBUG: DirectAttendeeExtractor component rendering with:', {
    rawDataType: rawData ? typeof rawData : 'null/undefined',
    rawDataStringLength: rawDataString ? rawDataString.length : 0,
    fallbackEmail: fallbackEmail || 'none provided',
    isPreview,
    showMoreCount
  });
  
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  
  // Try to extract attendees from rawData object directly if it has attendees property
  useEffect(() => {
    // First try to get attendees directly from the object if available
    if (rawData && typeof rawData === 'object' && 'attendees' in rawData) {
      try {
        const objAttendees = (rawData as any).attendees;
        if (Array.isArray(objAttendees) && objAttendees.length > 0) {
          console.log('ATTENDEE DEBUG: Found attendees array directly in object:', objAttendees);
          
          const validAttendees = objAttendees
            .filter(att => att && typeof att === 'object' && 'email' in att && att.email)
            .map((att, index) => ({
              id: att.id || `attendee-obj-${index}-${Date.now()}`,
              email: att.email,
              name: att.name || att.email.split('@')[0],
              role: att.role || 'Attendee',
              status: att.status || 'Needs Action'
            }));
          
          if (validAttendees.length > 0) {
            console.log(`ATTENDEE DEBUG: Successfully extracted ${validAttendees.length} attendees from object`);
            setAttendees(validAttendees);
            return; // Exit early if we found attendees
          }
        }
      } catch (e) {
        console.error('ATTENDEE DEBUG: Error extracting attendees from object:', e);
      }
    }
    
    // If no attendees found in object or it's not an object, proceed with raw string processing
    if (!rawDataString) {
      console.log('ATTENDEE DEBUG: No raw data string available');
      return;
    }
    
    try {
      // First log some raw data for debugging
      console.log('ATTENDEE DEBUG: Searching raw data of length', rawDataString.length);
      console.log('ATTENDEE DEBUG: First 100 chars of raw data:', rawDataString.substring(0, 100));
      
      // STEP 1: Unfold the iCalendar data (RFC 5545 format)
      // This is critical for handling folded lines with CRLF + space continuations
      const unfoldedData = rawDataString.replace(/\r?\n[ \t]/g, '');
      console.log('ATTENDEE DEBUG: Unfolded data example:', unfoldedData.substring(0, 200));
      
      // STEP 2: Use a direct regex approach to find all ATTENDEE lines that aren't resources
      // Improved regex for more reliable email extraction - handles embedded line breaks and tags
      const attendeeRegex = /ATTENDEE(?!.*CUTYPE=RESOURCE).*?:.*?mailto:([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/g;
      const extractedAttendees: Attendee[] = [];
      let regexMatch;
      
      // Track which method was successful
      let extractionMethod = "none";
      
      // Helper function to clean email addresses
      const cleanEmailAddress = (email: string): string => {
        if (!email) return '';
        
        // Clean email if it contains embedded ICS tags or line breaks
        if (email.includes('\r\n') || email.includes('END:') || email.includes('VCALENDAR')) {
          // Extract just the valid email portion
          const emailCleanRegex = /([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/;
          const cleanedEmail = email.match(emailCleanRegex);
          
          if (cleanedEmail && cleanedEmail[1]) {
            console.log('ATTENDEE DEBUG: Cleaned malformed email from:', email, 'to:', cleanedEmail[1]);
            return cleanedEmail[1];
          }
          
          // If regex didn't match, just take everything before the first line break
          const firstPartEmail = email.split('\r\n')[0];
          console.log('ATTENDEE DEBUG: Cleaned malformed email using split from:', email, 'to:', firstPartEmail);
          return firstPartEmail;
        }
        
        return email;
      };
      
      // Try direct regex first
      while ((regexMatch = attendeeRegex.exec(unfoldedData)) !== null) {
        const fullLine = regexMatch[0];
        let email = regexMatch[1].trim();
        
        // Clean the email if it has malformed data
        email = cleanEmailAddress(email);
        
        // Extract attendee name from CN if available
        const cnMatch = fullLine.match(/CN=([^;:]+)/);
        const name = cnMatch ? cnMatch[1].trim() : email.split('@')[0];
        
        // Extract attendee role
        const roleMatch = fullLine.match(/ROLE=([^;:]+)/);
        const role = roleMatch ? roleMatch[1].trim() : 'Attendee';
        
        // Extract participation status
        const statusMatch = fullLine.match(/PARTSTAT=([^;:]+)/);
        const status = statusMatch ? statusMatch[1].replace(/-/g, ' ').trim() : 'Needs Action';
        
        console.log(`ATTENDEE DEBUG: Extracted via regex: ${name} <${email}>, role: ${role}`);
        
        // Skip adding if this is a resource email (resources are extracted separately)
        if (fullLine.includes('CUTYPE=RESOURCE')) {
          console.log(`ATTENDEE DEBUG: Skipping resource email: ${email}`);
          continue;
        }
        
        // Skip if email is malformed or empty after cleaning
        if (!email || email.length < 3 || !email.includes('@')) {
          console.log(`ATTENDEE DEBUG: Skipping invalid email: ${email}`);
          continue;
        }
        
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
            
            let email = emailMatch[1].trim();
            
            // Clean the email if it has malformed data
            email = cleanEmailAddress(email);
            
            // Skip if email is malformed or empty after cleaning
            if (!email || email.length < 3 || !email.includes('@')) {
              console.log(`ATTENDEE DEBUG: Skipping invalid email: ${email}`);
              return null;
            }
            
            // Extract other attendee info if available
            const cnMatch = line.match(/CN=([^;:]+)/);
            const name = cnMatch ? cnMatch[1].trim() : email.split('@')[0];
            
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
              let email = mailtoMatch[1].trim();
              
              // Clean the email if it has malformed data
              email = cleanEmailAddress(email);
              
              // Skip if email is malformed or empty after cleaning
              if (!email || email.length < 3 || !email.includes('@')) {
                console.log(`ATTENDEE DEBUG: Skipping invalid email from mailto search: ${email}`);
                continue;
              }
              
              // Skip adding if this looks like a resource email
              const fullLine = mailtoMatch[0];
              if (fullLine.includes('CUTYPE=RESOURCE')) {
                console.log(`ATTENDEE DEBUG: Skipping resource email from mailto search: ${email}`);
                continue;
              }
              
              console.log(`ATTENDEE DEBUG: Found valid email via mailto search: ${email}`);
              
              mailtoMatches.push({
                id: `attendee-mailto-${mailtoMatches.length}-${Date.now()}`,
                email,
                name: email.split('@')[0],
                role: 'Attendee',
                status: 'Unknown'
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
  }, [rawData, rawDataString]);
  
  // Handle fallback email when no attendees found
  useEffect(() => {
    if (attendees.length === 0 && fallbackEmail && fallbackEmail.includes('@')) {
      console.log('ATTENDEE DEBUG: Using fallback email:', fallbackEmail);
      // Set a single fallback attendee
      setAttendees([{
        id: `fallback-attendee-${Date.now()}`,
        email: fallbackEmail,
        name: fallbackEmail.split('@')[0],
        role: 'Attendee',
        status: 'Needs Action'
      }]);
    }
  }, [attendees.length, fallbackEmail]);
  
  // Don't display anything if no attendees found after fallback
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
  
  const [showAllAttendees, setShowAllAttendees] = useState(false);
  const displayCount = isPreview ? 1 : (showAllAttendees ? attendees.length : Math.min(2, attendees.length));
  
  return (
    <div>
      <div className="text-sm font-medium mb-1">
        <span>Attendees ({attendees.length})</span>
      </div>
      <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
        <ul className="space-y-1">
          {attendees
            .slice(0, displayCount) // Show limited attendees or all if viewing all
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
          
          {/* Show "View All" button if there are more than 2 attendees in detail mode */}
          {!isPreview && attendees.length > 2 && !showAllAttendees && (
            <li className="text-center mt-2">
              <button 
                onClick={() => setShowAllAttendees(true)}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
              >
                Show all {attendees.length} attendees
              </button>
            </li>
          )}
          
          {/* Show "Show Less" button when viewing all attendees */}
          {!isPreview && showAllAttendees && attendees.length > 2 && (
            <li className="text-center mt-2">
              <button 
                onClick={() => setShowAllAttendees(false)}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center w-full"
              >
                Show less
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default DirectAttendeeExtractor;