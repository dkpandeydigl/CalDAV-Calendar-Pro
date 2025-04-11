// Predefined templates for event descriptions

export type DescriptionTemplate = {
  id: string;
  name: string;
  content: string;
};

export const PREDEFINED_TEMPLATES: DescriptionTemplate[] = [
  {
    id: 'standard-meeting',
    name: 'Standard Meeting',
    content: `<p>Hello {{attendee_name}},</p>
<p>You are invited to a meeting organized by {{organizer_name}}.</p>
<p><strong>Date:</strong> {{event_date}}<br>
<strong>Time:</strong> {{start_time}}<br>
<strong>Location:</strong> {{location}}</p>
<p>If joining online, please use this link: {{meeting_link}}</p>
<p>Please come prepared with any questions or materials.</p>
<p>Regards,<br>
{{organizer_name}}</p>`
  },
  {
    id: 'quick-sync',
    name: 'Quick Sync',
    content: `<p>Hi {{attendee_name}},</p>
<p>Let's have a quick sync on {{event_date}} at {{start_time}}.</p>
<p>{{meeting_link}}</p>
<p>-{{organizer_name}}</p>`
  },
  {
    id: 'team-update',
    name: 'Team Update',
    content: `<p>Team,</p>
<p>We'll be having our regular team update on {{event_date}} at {{start_time}} in {{location}}.</p>
<p>Please prepare a 2-minute update on your current projects.</p>
<p>Regards,<br>
{{organizer_name}}</p>`
  },
  {
    id: 'project-review',
    name: 'Project Review',
    content: `<p>Dear {{attendee_name}},</p>
<p>This is a project review meeting scheduled for {{event_date}} at {{start_time}} in {{location}}.</p>
<p>Agenda:</p>
<ul>
  <li>Project status updates</li>
  <li>Key milestones review</li>
  <li>Discussion of blockers</li>
  <li>Next steps planning</li>
</ul>
<p>Please bring your latest progress report.</p>
<p>Regards,<br>
{{organizer_name}}</p>`
  },
  {
    id: 'interview',
    name: 'Interview',
    content: `<p>Dear {{attendee_name}},</p>
<p>We're pleased to invite you for an interview on {{event_date}} at {{start_time}}.</p>
<p><strong>Location:</strong> {{location}}</p>
<p>Please plan for approximately 60 minutes. The interview will include a discussion about your experience, skills, and a brief technical assessment.</p>
<p>If you need to join remotely, please use this link: {{meeting_link}}</p>
<p>Looking forward to speaking with you!</p>
<p>Best regards,<br>
{{organizer_name}}</p>`
  }
];

export const PLACEHOLDER_DATA = {
  attendee_name: "D K Pandey",
  organizer_name: "Ajay Data",
  event_date: "Apr 12, 2025",
  start_time: "10:00 AM",
  location: "Board Room",
  meeting_link: "https://meet.link/xyz"
};

export interface TagInfo {
  name: string;
  description: string;
}

export const AVAILABLE_TAGS: TagInfo[] = [
  { name: 'attendee_name', description: 'Name of the attendee' },
  { name: 'organizer_name', description: 'Name of the event organizer' },
  { name: 'event_date', description: 'Date of the event' },
  { name: 'start_time', description: 'Start time of the event' },
  { name: 'location', description: 'Location of the event' },
  { name: 'meeting_link', description: 'Online meeting link' },
];

// Helper to replace template tags with actual values
export function replaceTemplateTags(html: string, data: Record<string, string>): string {
  let result = html;
  
  Object.entries(data).forEach(([key, value]) => {
    const tagRegex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(tagRegex, value || `<span class="tag-missing">{{${key}}}</span>`);
  });
  
  // Highlight any remaining tags that weren't replaced
  const remainingTagsRegex = /\{\{([a-z_]+)\}\}/g;
  result = result.replace(remainingTagsRegex, '<span class="tag-missing">{{$1}}</span>');
  
  return result;
}

// Utility to load templates from localStorage
export function loadCustomTemplates(): DescriptionTemplate[] {
  try {
    const saved = localStorage.getItem('custom_description_templates');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Error loading custom templates:', e);
    return [];
  }
}

// Utility to save template to localStorage
export function saveCustomTemplate(template: DescriptionTemplate): void {
  try {
    const existing = loadCustomTemplates();
    const updated = [...existing.filter(t => t.id !== template.id), template];
    localStorage.setItem('custom_description_templates', JSON.stringify(updated));
  } catch (e) {
    console.error('Error saving custom template:', e);
  }
}

// Helper to generate a unique ID for new templates
export function generateTemplateId(): string {
  return `template-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}