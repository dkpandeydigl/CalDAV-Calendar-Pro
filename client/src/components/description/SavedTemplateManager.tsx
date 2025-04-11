import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  saveCustomTemplate, 
  loadCustomTemplates, 
  deleteCustomTemplate,
  type DescriptionTemplate 
} from './templates';
import { Plus, Edit, Trash, Save, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

interface SavedTemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (template: DescriptionTemplate) => void;
}

const SavedTemplateManager: React.FC<SavedTemplateManagerProps> = ({ 
  open, 
  onOpenChange,
  onSelectTemplate
}) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [currentTemplate, setCurrentTemplate] = useState<DescriptionTemplate>({
    id: '',
    name: '',
    content: ''
  });
  
  // Load templates when dialog opens
  useEffect(() => {
    if (open) {
      refreshTemplates();
    }
  }, [open]);
  
  const refreshTemplates = () => {
    const savedTemplates = loadCustomTemplates();
    setTemplates(savedTemplates);
  };
  
  const handleCreateNew = () => {
    setCurrentTemplate({
      id: `template-${Date.now()}`,
      name: '',
      content: ''
    });
    setEditMode(true);
  };
  
  const handleEdit = (template: DescriptionTemplate) => {
    setCurrentTemplate({ ...template });
    setEditMode(true);
  };
  
  const handleDelete = (templateId: string) => {
    deleteCustomTemplate(templateId);
    refreshTemplates();
    toast({
      title: 'Template deleted',
      description: 'The template has been removed successfully.'
    });
  };
  
  const handleSave = () => {
    // Validate template
    if (!currentTemplate.name.trim()) {
      toast({
        title: 'Missing name',
        description: 'Please provide a name for your template.',
        variant: 'destructive'
      });
      return;
    }
    
    if (!currentTemplate.content.trim()) {
      toast({
        title: 'Missing content',
        description: 'Please provide content for your template.',
        variant: 'destructive'
      });
      return;
    }
    
    // Save template
    saveCustomTemplate(currentTemplate);
    refreshTemplates();
    
    // Exit edit mode
    setEditMode(false);
    
    toast({
      title: 'Template saved',
      description: 'Your template has been saved successfully.'
    });
  };
  
  const handleSelectTemplate = (template: DescriptionTemplate) => {
    onSelectTemplate(template);
  };
  
  const handleCancel = () => {
    setEditMode(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] sm:max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {editMode ? 'Edit Template' : 'Manage Description Templates'}
          </DialogTitle>
        </DialogHeader>
        
        {editMode ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                value={currentTemplate.name}
                onChange={(e) => setCurrentTemplate({ ...currentTemplate, name: e.target.value })}
                placeholder="Enter a descriptive name..."
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="template-content">Template Content</Label>
              <div className="text-xs text-muted-foreground mb-2">
                Use template tags like: <code>{"{{title}}"}</code>, <code>{"{{date}}"}</code>, <code>{"{{location}}"}</code>, <code>{"{{startTime}}"}</code>, <code>{"{{endTime}}"}</code>, and <code>{"{{attendees}}"}</code> that will be replaced with actual event data.
              </div>
              <Textarea
                id="template-content"
                value={currentTemplate.content}
                onChange={(e) => setCurrentTemplate({ ...currentTemplate, content: e.target.value })}
                placeholder="Enter template content with optional template tags..."
                rows={12}
              />
            </div>
            
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button onClick={handleSave}>
                <Save className="h-4 w-4 mr-2" />
                Save Template
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs defaultValue="my-templates" className="flex-1 flex flex-col">
            <TabsList>
              <TabsTrigger value="my-templates">My Templates</TabsTrigger>
            </TabsList>
            
            <TabsContent value="my-templates" className="flex-1 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <div className="text-sm text-muted-foreground">
                  Your saved templates
                </div>
                <Button size="sm" onClick={handleCreateNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Template
                </Button>
              </div>
              
              {templates.length === 0 ? (
                <Alert className="bg-muted">
                  <AlertDescription>
                    You don't have any saved templates yet. Click "New Template" to create one.
                  </AlertDescription>
                </Alert>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pr-4">
                    {templates.map((template) => (
                      <Card key={template.id}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{template.name}</CardTitle>
                          <CardDescription className="text-xs truncate">
                            {template.content.substring(0, 100)}
                            {template.content.length > 100 ? '...' : ''}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pb-0">
                          <div className="relative h-20 overflow-hidden text-xs text-muted-foreground border rounded-md p-2">
                            <ScrollArea className="h-full">
                              {template.content}
                            </ScrollArea>
                            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
                          </div>
                        </CardContent>
                        <CardFooter className="justify-between pt-4">
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => handleSelectTemplate(template)}>
                            Use Template
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(template)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(template.id)}>
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SavedTemplateManager;