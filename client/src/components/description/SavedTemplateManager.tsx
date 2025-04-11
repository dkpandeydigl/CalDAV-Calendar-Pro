import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Cross2Icon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { 
  DescriptionTemplate, 
  loadCustomTemplates, 
  saveCustomTemplate, 
  generateTemplateId 
} from './templates';
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
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<DescriptionTemplate | null>(null);
  const { toast } = useToast();

  // Load templates on initial render
  useEffect(() => {
    if (open) {
      setTemplates(loadCustomTemplates());
    }
  }, [open]);

  // Start creating a new template
  const handleNewTemplate = () => {
    setCurrentTemplate({
      id: generateTemplateId(),
      name: '',
      content: ''
    });
    setIsEditMode(true);
  };

  // Start editing an existing template
  const handleEditTemplate = (template: DescriptionTemplate) => {
    setCurrentTemplate({ ...template });
    setIsEditMode(true);
  };

  // Save the current template
  const handleSaveTemplate = () => {
    if (!currentTemplate) return;
    
    if (!currentTemplate.name.trim()) {
      toast({
        title: 'Error',
        description: 'Template name cannot be empty',
        variant: 'destructive',
      });
      return;
    }

    saveCustomTemplate(currentTemplate);
    setTemplates(loadCustomTemplates());
    setIsEditMode(false);
    setCurrentTemplate(null);
    
    toast({
      title: 'Success',
      description: 'Template saved successfully',
    });
  };

  // Delete a template
  const handleDeleteTemplate = (templateId: string) => {
    const updatedTemplates = templates.filter(t => t.id !== templateId);
    localStorage.setItem('custom_description_templates', JSON.stringify(updatedTemplates));
    setTemplates(updatedTemplates);
    
    toast({
      title: 'Template deleted',
      description: 'The template has been removed',
    });
  };

  // Use a template
  const handleSelectTemplate = (template: DescriptionTemplate) => {
    onSelectTemplate(template);
    onOpenChange(false);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setCurrentTemplate(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditMode 
              ? (currentTemplate?.id.startsWith('template-') ? 'New Template' : 'Edit Template') 
              : 'Saved Templates'
            }
          </DialogTitle>
        </DialogHeader>
        
        {!isEditMode ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={handleNewTemplate} variant="outline" size="sm">
                <PlusIcon className="mr-2 h-4 w-4" />
                New Template
              </Button>
            </div>
            
            {templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No saved templates. Create one to get started.
              </div>
            ) : (
              <div className="grid gap-4">
                {templates.map(template => (
                  <div 
                    key={template.id}
                    className="flex items-center justify-between border rounded-md p-3"
                  >
                    <div className="flex-grow">
                      <h3 className="font-medium">{template.name}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {template.content.replace(/<[^>]*>/g, '').slice(0, 100)}
                        {template.content.length > 100 ? '...' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleSelectTemplate(template)}>
                        Use
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleEditTemplate(template)}>
                        <Pencil1Icon className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteTemplate(template.id)}>
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Template Name</Label>
                <Input
                  id="template-name"
                  value={currentTemplate?.name || ''}
                  onChange={e => setCurrentTemplate(prev => 
                    prev ? { ...prev, name: e.target.value } : null
                  )}
                  placeholder="Enter a name for this template"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="template-content">Template Content (HTML)</Label>
                <Textarea
                  id="template-content"
                  value={currentTemplate?.content || ''}
                  onChange={e => setCurrentTemplate(prev => 
                    prev ? { ...prev, content: e.target.value } : null
                  )}
                  placeholder="Enter the HTML content for this template"
                  className="min-h-[200px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Use tags like {{attendee_name}} that will be replaced with actual values.
                </p>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button onClick={handleSaveTemplate}>
                Save Template
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SavedTemplateManager;