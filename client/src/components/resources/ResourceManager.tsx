import React, { useState } from 'react';
import { PlusCircle, Trash2, Edit, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface Resource {
  id: string;
  subType: string;       // Conference Room, Projector, etc.
  capacity?: number;     // Optional capacity (e.g., 10 people)
  adminEmail: string;    // Email of resource administrator
  adminName?: string;    // Name of resource administrator
  remarks?: string;      // Optional remarks or notes
}

interface ResourceManagerProps {
  resources: Resource[];
  onResourcesChange: (resources: Resource[]) => void;
}

export default function ResourceManager({ resources, onResourcesChange }: ResourceManagerProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [currentResource, setCurrentResource] = useState<Resource | null>(null);
  
  function handleAddResource() {
    setCurrentResource(null);
    setIsAddDialogOpen(true);
  }
  
  function handleEditResource(resource: Resource) {
    setCurrentResource(resource);
    setIsEditDialogOpen(true);
  }
  
  function handleRemoveResource(resourceId: string) {
    const updatedResources = resources.filter(r => r.id !== resourceId);
    onResourcesChange(updatedResources);
  }
  
  function handleFormSubmit(formData: FormData, isEditing: boolean) {
    if (isEditing && currentResource) {
      // Edit existing resource
      const updatedResources = resources.map(r => {
        if (r.id === currentResource.id) {
          return {
            ...r,
            subType: formData.get('subType') as string,
            capacity: formData.get('capacity') ? parseInt(formData.get('capacity') as string, 10) : undefined,
            adminEmail: formData.get('adminEmail') as string,
            adminName: formData.get('adminName') as string || undefined,
            remarks: formData.get('remarks') as string || undefined,
          };
        }
        return r;
      });
      onResourcesChange(updatedResources);
      setIsEditDialogOpen(false);
    } else {
      // Add new resource
      const resource: Resource = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        subType: formData.get('subType') as string,
        capacity: formData.get('capacity') ? parseInt(formData.get('capacity') as string, 10) : undefined,
        adminEmail: formData.get('adminEmail') as string,
        adminName: formData.get('adminName') as string || undefined,
        remarks: formData.get('remarks') as string || undefined,
      };
      onResourcesChange([...resources, resource]);
      setIsAddDialogOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Resources</h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleAddResource}
          className="flex items-center gap-1"
        >
          <PlusCircle className="h-4 w-4" />
          <span>Add Resource</span>
        </Button>
      </div>
      
      {resources.length === 0 ? (
        <div className="text-center p-6 border border-dashed rounded-lg text-muted-foreground">
          No resources added. Click "Add Resource" to book conference rooms, projectors, or other resources.
        </div>
      ) : (
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {resources.map((resource) => (
              <Card key={resource.id} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-medium">
                        {resource.subType}
                      </Badge>
                      {resource.capacity && (
                        <Badge variant="outline">
                          Capacity: {resource.capacity}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
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
                              onClick={() => handleRemoveResource(resource.id)}
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
                  </div>
                  
                  <div className="mt-2 text-sm">
                    <div className="flex items-center text-muted-foreground">
                      <span>Administrator: {resource.adminName || resource.adminEmail}</span>
                      {resource.remarks && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                                <Info className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <p className="whitespace-pre-line">{resource.remarks}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
      
      {/* Add Resource Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Resource</DialogTitle>
            <DialogDescription>
              Enter the details of the resource you want to book for this event.
            </DialogDescription>
          </DialogHeader>
          
          <form action={(formData) => handleFormSubmit(formData, false)}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="subType">Resource Type*</Label>
                <Input
                  id="subType"
                  name="subType"
                  placeholder="Conference Room, Projector, etc."
                  required
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="capacity">Capacity</Label>
                <Input
                  id="capacity"
                  name="capacity"
                  type="number"
                  placeholder="10"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="adminEmail">Administrator Email*</Label>
                <Input
                  id="adminEmail"
                  name="adminEmail"
                  type="email"
                  placeholder="admin@example.com"
                  required
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="adminName">Administrator Name</Label>
                <Input
                  id="adminName"
                  name="adminName"
                  placeholder="John Doe"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="remarks">Notes/Remarks</Label>
                <Textarea
                  id="remarks"
                  name="remarks"
                  placeholder="Any special requirements or notes about this resource..."
                  rows={3}
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Resource</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
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
            <form action={(formData) => handleFormSubmit(formData, true)}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-subType">Resource Type*</Label>
                  <Input
                    id="edit-subType"
                    name="subType"
                    defaultValue={currentResource.subType}
                    required
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-capacity">Capacity</Label>
                  <Input
                    id="edit-capacity"
                    name="capacity"
                    type="number"
                    defaultValue={currentResource.capacity}
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-adminEmail">Administrator Email*</Label>
                  <Input
                    id="edit-adminEmail"
                    name="adminEmail"
                    type="email"
                    defaultValue={currentResource.adminEmail}
                    required
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-adminName">Administrator Name</Label>
                  <Input
                    id="edit-adminName"
                    name="adminName"
                    defaultValue={currentResource.adminName}
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="edit-remarks">Notes/Remarks</Label>
                  <Textarea
                    id="edit-remarks"
                    name="remarks"
                    defaultValue={currentResource.remarks}
                    rows={3}
                  />
                </div>
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Update Resource</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}