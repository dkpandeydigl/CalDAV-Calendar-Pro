import { Resource } from '@/components/resources/ResourceManager';

/**
 * Formats a resource for iCalendar according to RFC 5545
 * Creates an ATTENDEE line with CUTYPE=RESOURCE and custom X- parameters
 * @param resource The resource to format
 * @returns A properly formatted iCalendar ATTENDEE line for a resource
 */
export function formatResourceForICalendar(resource: Resource): string {
  let resourceLine = `ATTENDEE;CUTYPE=RESOURCE;CN=${resource.subType};ROLE=NON-PARTICIPANT;RSVP=FALSE`;
  
  // Add capacity if specified
  if (resource.capacity !== undefined) {
    resourceLine += `;X-CAPACITY=${resource.capacity}`;
  }
  
  // Add remarks if specified (properly escape for iCalendar format)
  if (resource.remarks) {
    // Escape special characters according to iCalendar spec
    const escapedRemarks = resource.remarks
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
    
    resourceLine += `;X-REMARKS="${escapedRemarks}"`;
  }
  
  // Add the email as mailto
  resourceLine += `:mailto:${resource.adminEmail}`;
  
  return resourceLine;
}

/**
 * Parses resources from an array of iCalendar ATTENDEE lines
 * Looks for lines with CUTYPE=RESOURCE
 * @param attendeeLines Array of ATTENDEE lines from iCalendar data
 * @returns Array of parsed Resource objects
 */
export function parseResourcesFromICalendar(attendeeLines: string[]): Resource[] {
  return attendeeLines
    .filter(line => line.includes('CUTYPE=RESOURCE'))
    .map(line => {
      // Create a new resource object
      const resource: Resource = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        subType: '',
        adminEmail: ''
      };
      
      // Extract CN (Common Name) for the subType
      const cnMatch = line.match(/CN=([^;:]+)/);
      if (cnMatch && cnMatch[1]) {
        resource.subType = cnMatch[1];
      }
      
      // Extract capacity if available
      const capacityMatch = line.match(/X-CAPACITY=([0-9]+)/);
      if (capacityMatch && capacityMatch[1]) {
        resource.capacity = parseInt(capacityMatch[1], 10);
      }
      
      // Extract remarks if available
      const remarksMatch = line.match(/X-REMARKS="([^"]+)"/);
      if (remarksMatch && remarksMatch[1]) {
        // Unescape special characters
        resource.remarks = remarksMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\\\/g, '\\');
      }
      
      // Extract email address
      const emailMatch = line.match(/mailto:([^:]+@[^:]+)$/);
      if (emailMatch && emailMatch[1]) {
        resource.adminEmail = emailMatch[1];
      }
      
      return resource;
    });
}

/**
 * Parses resources from an event object
 * Handles both string JSON or object arrays and can extract from rawData
 * @param event The event object containing resources
 * @returns Array of parsed Resource objects
 */
export function parseResourcesFromEvent(event: any): Resource[] {
  if (!event) return [];
  
  try {
    // First, try to parse from event.resources if it exists
    if (event.resources) {
      try {
        // If resources is a string, try to parse it as JSON
        const resourceData = typeof event.resources === 'string' 
          ? JSON.parse(event.resources) 
          : event.resources;
          
        // If it's an array, map it to our Resource format
        if (Array.isArray(resourceData) && resourceData.length > 0) {
          return resourceData.map(resource => {
            // Ensure resource has an ID
            if (!resource.id) {
              resource.id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
            }
            return resource;
          });
        }
      } catch (jsonError) {
        console.warn('Failed to parse JSON resources:', jsonError);
      }
    }
    
    // If we still don't have resources, try to extract from rawData
    if (event.rawData) {
      console.log('Attempting to extract resources from rawData');
      
      // Extract resource attendee lines (with CUTYPE=RESOURCE)
      const resourceMatches = typeof event.rawData === 'string'
        ? event.rawData.match(/ATTENDEE[^:]*CUTYPE=RESOURCE[^:\r\n]*:[^\r\n]+/g)
        : null;
        
      if (resourceMatches && resourceMatches.length > 0) {
        console.log(`Found ${resourceMatches.length} resource matches in raw data`);
        
        // Use our iCalendar parser
        return parseResourcesFromICalendar(resourceMatches);
      }
      
      // As a fallback, look for resources in attendees
      if (event.attendees && typeof event.attendees === 'string') {
        try {
          const attendeesData = JSON.parse(event.attendees);
          if (Array.isArray(attendeesData)) {
            const resourceAttendees = attendeesData.filter(attendee => 
              attendee && 
              attendee.params && 
              attendee.params.CUTYPE === 'RESOURCE'
            );
            
            if (resourceAttendees.length > 0) {
              console.log(`Found ${resourceAttendees.length} resources in attendees data`);
              
              return resourceAttendees.map((attendee, index) => {
                const resource: Resource = {
                  id: attendee.id || `resource-${index}-${Date.now()}`,
                  subType: (attendee.params.CN || attendee.params['X-RESOURCE-TYPE'] || 'Resource'),
                  adminEmail: attendee.val?.replace('mailto:', '') || ''
                };
                
                // Try to extract capacity
                if (attendee.params['X-CAPACITY']) {
                  resource.capacity = parseInt(attendee.params['X-CAPACITY'], 10);
                }
                
                // Try to extract remarks
                if (attendee.params['X-REMARKS']) {
                  resource.remarks = attendee.params['X-REMARKS'];
                }
                
                return resource;
              });
            }
          }
        } catch (attendeesError) {
          console.warn('Failed to extract resources from attendees:', attendeesError);
        }
      }
    }
  } catch (error) {
    console.error('Failed to parse resources:', error);
  }
  
  return [];
}