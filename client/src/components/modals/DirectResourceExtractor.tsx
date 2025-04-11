import React, { useEffect, useState } from 'react';

interface Resource {
  id: string;
  name: string;
  email: string;
  type?: string;
}

interface DirectResourceExtractorProps {
  rawData: string | null | undefined;
}

const DirectResourceExtractor: React.FC<DirectResourceExtractorProps> = ({ rawData }) => {
  const [resources, setResources] = useState<Resource[]>([]);
  
  useEffect(() => {
    if (!rawData) {
      console.log('RESOURCE DEBUG: No raw data available');
      return;
    }
    
    try {
      // Use a pattern to directly extract resource information from raw iCalendar data
      const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g;
      const matches = Array.from(rawData.matchAll(resourceRegex));
      
      if (matches && matches.length > 0) {
        console.log(`RESOURCE DEBUG: Found ${matches.length} resources directly in raw data`);
        
        // Extract resource information from each match
        const directResources = matches.map((match, index) => {
          const fullLine = match[0]; // The complete ATTENDEE line 
          const email = match[1]; // The captured email group
          
          // Extract resource name from CN
          const cnMatch = fullLine.match(/CN=([^;:]+)/);
          const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
          
          // Extract resource type
          const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
          const resourceType = typeMatch ? typeMatch[1].trim() : '';
          
          return {
            id: `resource-${index}-${Date.now()}`,
            email,
            name,
            type: resourceType
          };
        });
        
        console.log('RESOURCE DEBUG: Extracted resources:', directResources);
        setResources(directResources);
      } else {
        console.log('RESOURCE DEBUG: No resources found in raw data');
      }
    } catch (error) {
      console.error('RESOURCE DEBUG: Error extracting resources:', error);
    }
  }, [rawData]);
  
  if (resources.length === 0) {
    return null;
  }
  
  return (
    <div>
      <div className="text-sm font-medium mb-1">
        <span>Resources ({resources.length})</span>
      </div>
      <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
        <ul className="space-y-1 max-h-[10em] overflow-y-auto pr-2">
          {resources.map((resource, index) => (
            <li key={`resource-${index}`} className="flex items-start">
              <span className="material-icons text-purple-500 mr-2 text-sm mt-0.5">meeting_room</span>
              <div>
                <div className="font-medium">
                  {resource.name || "Resource"}
                </div>
                {resource.type && (
                  <div className="text-xs text-muted-foreground">
                    Type: {resource.type}
                  </div>
                )}
                {resource.email && (
                  <div className="text-xs text-muted-foreground">
                    Admin: {resource.email}
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

export default DirectResourceExtractor;