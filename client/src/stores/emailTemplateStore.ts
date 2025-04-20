import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Interface for email template
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  content: string;
  lastModified: Date;
}

// Interface for the email template store state
interface EmailTemplateState {
  templates: EmailTemplate[];
  addTemplate: (template: Omit<EmailTemplate, 'id' | 'lastModified'>) => void;
  updateTemplate: (id: string, template: Partial<Omit<EmailTemplate, 'id' | 'lastModified'>>) => void;
  deleteTemplate: (id: string) => void;
  getTemplateById: (id: string) => EmailTemplate | undefined;
}

// Create the store with persistence
export const useEmailTemplateStore = create<EmailTemplateState>()(
  persist(
    (set, get) => ({
      templates: [
        {
          id: 'default-meeting',
          name: 'Default Meeting',
          subject: 'Meeting Invitation: {{title}}',
          content: `Dear {{attendeeName}},

I'm pleased to invite you to attend the following meeting:

Title: {{title}}
Date: {{startDate}}
Time: {{startTime}} - {{endTime}}
Location: {{location}}

Please let me know if you'll be able to attend.

Best regards,
{{organizerName}}`,
          lastModified: new Date()
        },
        {
          id: 'follow-up',
          name: 'Follow-up Meeting',
          subject: 'Follow-up: {{title}}',
          content: `Hello {{attendeeName}},

Following our previous discussion, I'd like to schedule a follow-up meeting:

Title: {{title}}
Date: {{startDate}}
Time: {{startTime}} - {{endTime}}
Location: {{location}}

Agenda:
- Review action items from previous meeting
- Discuss progress and next steps
- Any other business

Please confirm your availability.

Thank you,
{{organizerName}}`,
          lastModified: new Date()
        }
      ],
      
      // Add a new template
      addTemplate: (template) => set((state) => {
        const newTemplate: EmailTemplate = {
          ...template,
          id: `template-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          lastModified: new Date()
        };
        
        return { templates: [...state.templates, newTemplate] };
      }),
      
      // Update an existing template
      updateTemplate: (id, templateUpdate) => set((state) => {
        const templates = state.templates.map(template => {
          if (template.id === id) {
            return {
              ...template,
              ...templateUpdate,
              lastModified: new Date()
            };
          }
          return template;
        });
        
        return { templates };
      }),
      
      // Delete a template
      deleteTemplate: (id) => set((state) => ({
        templates: state.templates.filter(template => template.id !== id)
      })),
      
      // Get a template by ID
      getTemplateById: (id) => {
        const { templates } = get();
        return templates.find(template => template.id === id);
      }
    }),
    {
      name: 'email-templates-storage',
      version: 1
    }
  )
);

export default useEmailTemplateStore;