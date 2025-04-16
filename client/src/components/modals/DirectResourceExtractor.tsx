import React, { useEffect, useState } from 'react';
import { Laptop, ProjectorIcon, Wrench, DoorClosed, Phone, VideoIcon, Monitor, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Resource {
  id: string;
  name: string;
  email: string;
  type?: string;
}

interface DirectResourceExtractorProps {
  rawData: string | null | undefined;
  isPreview?: boolean; // If true, only show one resource with count indicator
  onDelete?: (resource: Resource) => void; // Optional callback for delete action
  onEdit?: (resource: Resource, updatedResource: Resource) => void; // Optional callback for edit action
}

const DirectResourceExtractor: React.FC<DirectResourceExtractorProps> = ({ 
  rawData, 
  isPreview = true,
  onDelete,
  onEdit
}) => {
  const [resources, setResources] = useState<Resource[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [currentResource, setCurrentResource] = useState<Resource | null>(null);
  
  useEffect(() => {
    if (!rawData) {
      console.log('RESOURCE DEBUG: No raw data available');
      return;
    }
    
    try {
      // Clean the raw data from potential embedded END:VEVENT/VCALENDAR tags before extraction
      const cleanedRawData = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
      
      // Use a pattern to directly extract resource information from raw iCalendar data
      // Improved regex to handle ICS formatting issues - ensures we capture only email portion
      const resourceRegex = /ATTENDEE[^:]*?CUTYPE=RESOURCE[^:]*?:[^:]*?mailto:([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/g;
      const matches = Array.from(cleanedRawData.matchAll(resourceRegex));
      
      if (matches && matches.length > 0) {
        console.log(`RESOURCE DEBUG: Found ${matches.length} resources directly in raw data`);
        
        // Create a map to track unique resources by email to avoid duplication
        const uniqueResourcesMap = new Map();
        
        // Extract resource information from each match
        matches.forEach((match, index) => {
          const fullLine = match[0]; // The complete ATTENDEE line 
          let email = match[1]; // The captured email group
          
          // Clean the email from any embedded iCalendar tags
          if (email.includes('\r\n') || email.includes('END:')) {
            // Extract just the valid email portion
            const emailCleanRegex = /([^@\s\r\n]+@[^@\s\r\n\\\.,;]+(?:\.[^@\s\r\n\\\.,;]+)+)/;
            const cleanedEmail = email.match(emailCleanRegex);
            email = cleanedEmail ? cleanedEmail[1] : email.split('\r\n')[0];
            console.log('RESOURCE DEBUG: Cleaned malformed email -', email);
          }
          
          // Skip if already processed this email to avoid duplication
          if (uniqueResourcesMap.has(email.toLowerCase())) {
            return;
          }
          
          // Extract resource name from CN
          const cnMatch = fullLine.match(/CN=([^;:]+)/);
          const name = cnMatch ? cnMatch[1].trim() : `Resource ${index + 1}`;
          
          // Extract resource type
          const typeMatch = fullLine.match(/X-RESOURCE-TYPE=([^;:]+)/);
          const resourceType = typeMatch ? typeMatch[1].trim() : '';
          
          // Add to unique resources map
          uniqueResourcesMap.set(email.toLowerCase(), {
            id: `resource-${index}-${Date.now()}`,
            email,
            name,
            type: resourceType
          });
        });
        
        // Convert map values to array
        const directResources = Array.from(uniqueResourcesMap.values());
        
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

  // Function to determine which icon to use based on resource type
  const getResourceIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('room') || lowerType.includes('hall')) {
      return <DoorClosed className="h-4 w-4 text-purple-500" />;
    } else if (lowerType.includes('projector')) {
      return <ProjectorIcon className="h-4 w-4 text-blue-500" />;
    } else if (lowerType.includes('laptop') || lowerType.includes('computer')) {
      return <Laptop className="h-4 w-4 text-indigo-500" />;
    } else if (lowerType.includes('phone') || lowerType.includes('call')) {
      return <Phone className="h-4 w-4 text-green-500" />;
    } else if (lowerType.includes('video') || lowerType.includes('conference')) {
      return <VideoIcon className="h-4 w-4 text-red-500" />;
    } else if (lowerType.includes('screen') || lowerType.includes('display')) {
      return <Monitor className="h-4 w-4 text-yellow-500" />;
    } else {
      return <Wrench className="h-4 w-4 text-gray-500" />;
    }
  };
  
  // Handle edit resource
  const handleEditResource = (resource: Resource) => {
    setCurrentResource(resource);
    setIsEditDialogOpen(true);
  };

  // Handle delete resource
  const handleDeleteResource = (resource: Resource) => {
    if (onDelete) {
      onDelete(resource);
    }
  };

  // Handle edit resource submit
  const handleEditResourceSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!currentResource) return;
    
    const formData = new FormData(e.currentTarget);
    const updatedResource: Resource = {
      ...currentResource,
      name: formData.get('name') as string || currentResource.name,
      email: formData.get('email') as string || currentResource.email,
      type: formData.get('type') as string || currentResource.type,
    };
    
    if (onEdit) {
      onEdit(currentResource, updatedResource);
    }
    
    setIsEditDialogOpen(false);
  };

  return (
    <div>
      <div className="text-sm font-medium mb-1">
        <span>Resources ({resources.length})</span>
      </div>
      <div className="text-sm p-3 bg-neutral-50 rounded-md shadow-inner border border-neutral-200">
        <ul className="space-y-1 pr-2">
          {resources.slice(0, isPreview ? 1 : resources.length).map((resource, index) => (
            <li key={`resource-${index}`} className="flex items-start mb-2 justify-between group">
              <div className="flex">
                <div className="mt-1 mr-3">
                  {getResourceIcon(resource.type || '')}
                </div>
                <div>
                  <div className="font-medium">{resource.name}</div>
                  <div className="text-xs text-gray-600">
                    Type: {resource.type ? resource.type.trim() : 'Unknown'}
                  </div>
                  <div className="text-xs text-gray-600">
                    Admin: {resource.email}
                  </div>
                </div>
              </div>
              
              {!isPreview && onEdit && onDelete && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleEditResource(resource)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit resource</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDeleteResource(resource)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove resource</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </li>
          ))}
          
          {/* Show "more resources" indicator if needed - only in preview mode */}
          {isPreview && resources.length > 1 && (
            <li className="text-xs text-center py-1">
              <span className="bg-slate-200 px-2 py-0.5 rounded-full text-slate-500 inline-flex items-center">
                <Wrench className="h-3 w-3 mr-1" />
                + {resources.length - 1} more resource{resources.length - 1 > 1 ? 's' : ''}
              </span>
            </li>
          )}
        </ul>
      </div>
      
      {/* Edit Resource Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Resource</DialogTitle>
            <DialogDescription>
              Update the details of this resource.
            </DialogDescription>
          </DialogHeader>
          
          {currentResource && (
            <form onSubmit={handleEditResourceSubmit}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Resource Name</Label>
                  <Input
                    id="edit-name"
                    name="name"
                    defaultValue={currentResource.name}
                    required
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-type">Resource Type</Label>
                  <Input
                    id="edit-type"
                    name="type"
                    defaultValue={currentResource.type}
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">Administrator Email</Label>
                  <Input
                    id="edit-email"
                    name="email"
                    type="email"
                    defaultValue={currentResource.email}
                    required
                  />
                </div>
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Update Resource
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DirectResourceExtractor;