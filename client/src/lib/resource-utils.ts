import { Resource } from '@/components/resources/ResourceManager';

/**
 * Enhanced resource extraction utility for event data
 * 
 * This function extracts resources from event data in a comprehensive way,
 * looking for resources in multiple potential locations:
 * 1. Explicit resources field (highest priority)
 * 2. Attendees field that contain resource markers
 * 3. Raw ICS data with CUTYPE=RESOURCE markers
 * 
 * @param event The event object to extract resources from
 * @returns Array of Resource objects
 */
export function extractResourcesFromEvent(event: any): Resource[] {
  try {
    // Create a Map to track resources by email for deduplication
    const resourceMap = new Map<string, Resource>();
    
    console.log('Extracting resources from event:', event.id, event.title);
    
    // STEP 1: Try to get resources from the event.resources field first (highest priority)
    if (event.resources) {
      let parsedResources: any[] = [];
      
      if (typeof event.resources === 'string') {
        try {
          parsedResources = JSON.parse(event.resources);
          console.log('Parsed resources from string JSON:', parsedResources);
        } catch (e) { 
          console.warn('Failed to parse resources JSON string:', e);
        }
      } else if (Array.isArray(event.resources)) {
        parsedResources = event.resources;
        console.log('Using existing resources array:', parsedResources);
      }
      
      // Add resources to our map for deduplication, preserving ALL properties
      if (Array.isArray(parsedResources) && parsedResources.length > 0) {
        parsedResources.forEach((resource, index) => {
          const email = resource.adminEmail || resource.email; 
          if (email) {
            // Store the complete resource object with all properties intact
            // Just ensure required fields are present
            const resourceWithId = {
              ...resource, // Keep all original properties
              id: resource.id || `resource-${index}-${Date.now()}`,
              name: resource.name || resource.adminName || 'Resource',
              adminEmail: email,
              subType: resource.subType || resource.type || '',
              capacity: resource.capacity || 1
            };
            
            resourceMap.set(email.toLowerCase(), resourceWithId);
            console.log(`Added resource from event.resources: ${email}`, resourceWithId);
          }
        });
      }
    }
    
    // STEP 2: Extract resources from attendees field if they exist and have CUTYPE=RESOURCE
    if (event.attendees) {
      try {
        // Parse attendees if it's a string
        const attendeesData = typeof event.attendees === 'string' 
          ? JSON.parse(event.attendees) 
          : event.attendees;
        
        // Find any attendees with CUTYPE=RESOURCE
        if (Array.isArray(attendeesData)) {
          attendeesData.forEach((attendee, index) => {
            if (attendee && attendee.params && attendee.params.CUTYPE === 'RESOURCE') {
              // Get email - it might be in val field or email field
              const email = attendee.val 
                ? attendee.val.replace('mailto:', '')
                : attendee.email;
              
              if (email && !resourceMap.has(email.toLowerCase())) {
                const name = attendee.params.CN || `Resource ${index + 1}`;
                const resourceType = attendee.params['X-RESOURCE-TYPE'] || 'Projector';
                
                resourceMap.set(email.toLowerCase(), {
                  id: `resource-${index}-${Date.now()}`,
                  name,
                  adminEmail: email,
                  subType: resourceType,
                  capacity: 1
                });
                
                console.log(`Added resource from attendees data: ${email} (${name})`);
              }
            }
          });
        }
      } catch (err) {
        console.warn('Error parsing attendees for resources:', err);
      }
    }
    
    // STEP 3: Now extract from VCALENDAR raw data as a final fallback
    if (event.rawData && typeof event.rawData === 'string') {
      const rawDataStr = event.rawData.toString();
      
      // Match any ATTENDEE lines containing CUTYPE=RESOURCE or similar patterns
      const resourcePatterns = [
        /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g,
        /ATTENDEE[^:]*?CUTYPE="RESOURCE"[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g,
        /ATTENDEE[^:]*?ROLE=NON-PARTICIPANT[^:]*?:[^:\r\n]*mailto:([^\s\r\n]+)/g
      ];
      
      let matches: RegExpMatchArray[] = [];
      
      // Try all patterns and collect matches
      resourcePatterns.forEach(pattern => {
        const patternMatches = Array.from(rawDataStr.matchAll(pattern));
        if (patternMatches.length > 0) {
          matches = [...matches, ...patternMatches];
        }
      });
      
      if (matches && matches.length > 0) {
        console.log(`Found ${matches.length} resource matches in raw data`);
        
        matches.forEach((match: RegExpMatchArray, index) => {
          const fullLine = match[0] || ''; // The complete ATTENDEE line 
          const email = match[1] || ''; // The captured email group
          
          // Skip if we already have this resource by email - PRESERVE EXISTING DATA
          if (email && !resourceMap.has(email.toLowerCase())) {
            // Extract resource name from CN
            const cnMatch = fullLine.match(/CN="?([^";:]+)"?/) || fullLine.match(/CN=([^;:]+)/);
            const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
            
            // Extract resource type
            const typeMatches = [
              fullLine.match(/X-RESOURCE-TYPE="?([^";:]+)"?/),
              fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/),
              fullLine.match(/RESOURCE-TYPE="?([^";:]+)"?/),
              fullLine.match(/RESOURCE-TYPE=([^;:]+)/)
            ].filter(Boolean);
            
            const resourceType = typeMatches.length > 0 ? typeMatches[0]![1].trim() : 'Projector';
            
            const newResource = {
              id: `resource-${index}-${Date.now()}`,
              name: name,
              adminEmail: email,
              subType: resourceType,
              capacity: 1
            };
            
            resourceMap.set(email.toLowerCase(), newResource);
            console.log(`Added resource from rawData: ${email}`, newResource);
          }
        });
      }
    }
    
    // Convert map back to array
    const result = Array.from(resourceMap.values());
    console.log(`Extracted ${result.length} total resources:`, result);
    return result;
  } catch (error) {
    console.error('Error extracting resources:', error);
    return [];
  }
}

/**
 * Format a resource for display
 * 
 * @param resource The resource object to format
 * @returns Formatted string representation
 */
export function formatResourceForDisplay(resource: Resource): string {
  const name = resource.name || 'Unnamed Resource';
  const type = resource.subType || 'Resource';
  return `${name} (${type})`;
}

/**
 * Simple function to check if an event contains resources
 */
export function eventHasResources(event: any): boolean {
  // If there's a resources field that's an array or string, check it first
  if (event.resources) {
    if (Array.isArray(event.resources) && event.resources.length > 0) {
      return true;
    }
    if (typeof event.resources === 'string' && event.resources.length > 5) {
      try {
        const parsed = JSON.parse(event.resources);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch (e) {
        // Not valid JSON, continue checking other options
      }
    }
  }
  
  // Check the rawData for CUTYPE=RESOURCE
  if (event.rawData && typeof event.rawData === 'string') {
    if (event.rawData.includes('CUTYPE=RESOURCE')) {
      return true;
    }
  }
  
  // Check attendees field for resources
  if (event.attendees) {
    if (typeof event.attendees === 'string') {
      if (event.attendees.includes('CUTYPE=RESOURCE') || event.attendees.includes('NON-PARTICIPANT')) {
        return true;
      }
    } else if (Array.isArray(event.attendees)) {
      return event.attendees.some((a: any) => 
        a && a.params && 
        (a.params.CUTYPE === 'RESOURCE' || a.params.ROLE === 'NON-PARTICIPANT')
      );
    }
  }
  
  return false;
}