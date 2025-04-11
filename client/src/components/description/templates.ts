/**
 * Template system for description editor
 * This file contains predefined templates and functions to manage custom templates
 */

export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
}

// Local storage key for saved templates
const SAVED_TEMPLATES_KEY = 'caldav-saved-templates';

// Predefined templates with special template tags
export const PREDEFINED_TEMPLATES: DescriptionTemplate[] = [
  { 
    id: 'meeting', 
    name: 'Meeting Agenda', 
    content: `# Meeting: {{title}}

## Agenda
1. Welcome and Introduction
2. Discussion Items
   - {{item1}}
   - {{item2}}
3. Action Items
4. Next Steps

**Location:** {{location}}
**Date:** {{date}}
**Time:** {{startTime}} - {{endTime}}

## Attendees
{{attendees}}` 
  },
  { 
    id: 'project-review', 
    name: 'Project Review', 
    content: `# Project Review: {{title}}

## Project Overview
Brief description of the project status.

## Accomplishments
- Key milestone 1
- Key milestone 2

## Challenges
- Current blockers
- Potential risks

## Timeline Review
- Current phase: {{currentPhase}}
- Next milestone: {{nextMilestone}}

**Meeting Date:** {{date}}` 
  },
  { 
    id: 'training', 
    name: 'Training Session', 
    content: `# Training: {{title}}

## Session Objectives
- Understand key concepts
- Learn practical applications
- Demonstrate proficiency

## Materials Required
- {{material1}}
- {{material2}}

## Agenda
1. Introduction ({{startTime}} - {{sessionBreak}})
2. Core Content ({{sessionBreak}} - {{sessionEnd}})
3. Q&A ({{sessionEnd}} - {{endTime}})

**Trainer:** {{trainer}}
**Location:** {{location}}` 
  },
  {
    id: 'resource-booking',
    name: 'Resource Booking',
    content: `# Resource Booking: {{title}}

## Resources Required
- {{resourceName}}
- Capacity: {{resourceCapacity}}

## Booking Details
- Date: {{date}}
- Time: {{startTime}} - {{endTime}}
- Location: {{location}}

## Purpose
Brief description of how the resource will be used.

## Special Requirements
- {{requirement1}}
- {{requirement2}}`
  }
];

/**
 * Load custom templates from local storage
 */
export function loadCustomTemplates(): DescriptionTemplate[] {
  try {
    const savedTemplates = localStorage.getItem(SAVED_TEMPLATES_KEY);
    if (savedTemplates) {
      return JSON.parse(savedTemplates);
    }
  } catch (error) {
    console.error('Error loading saved templates:', error);
  }
  return [];
}

/**
 * Save a custom template to local storage
 */
export function saveCustomTemplate(template: DescriptionTemplate): boolean {
  try {
    const templates = loadCustomTemplates();
    
    // Check if template with this ID already exists
    const existingIndex = templates.findIndex(t => t.id === template.id);
    
    if (existingIndex >= 0) {
      // Update existing template
      templates[existingIndex] = template;
    } else {
      // Add new template
      templates.push({
        ...template,
        id: template.id || `template-${Date.now()}`
      });
    }
    
    localStorage.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(templates));
    return true;
  } catch (error) {
    console.error('Error saving template:', error);
    return false;
  }
}

/**
 * Delete a custom template from local storage
 */
export function deleteCustomTemplate(templateId: string): boolean {
  try {
    const templates = loadCustomTemplates();
    const filteredTemplates = templates.filter(t => t.id !== templateId);
    
    if (templates.length === filteredTemplates.length) {
      return false; // Template not found
    }
    
    localStorage.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(filteredTemplates));
    return true;
  } catch (error) {
    console.error('Error deleting template:', error);
    return false;
  }
}

/**
 * Process template tags in a template with actual event data
 */
export function processTemplateTags(template: string, eventData: any): string {
  if (!template) return '';
  
  const replacements: Record<string, string> = {
    '{{title}}': eventData.title || '',
    '{{location}}': eventData.location || '',
    '{{date}}': eventData.startDate ? new Date(eventData.startDate).toLocaleDateString() : '',
    '{{startTime}}': eventData.startDate ? new Date(eventData.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    '{{endTime}}': eventData.endDate ? new Date(eventData.endDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
  };
  
  // Add attendee list if available
  if (eventData.attendees && Array.isArray(eventData.attendees)) {
    let attendeeList = '';
    eventData.attendees.forEach((attendee: any) => {
      const name = attendee.name || '';
      const email = attendee.email || '';
      const displayName = name ? `${name} (${email})` : email;
      attendeeList += `- ${displayName}\n`;
    });
    replacements['{{attendees}}'] = attendeeList;
  }
  
  // Add resource information if available
  if (eventData.resources && Array.isArray(eventData.resources) && eventData.resources.length > 0) {
    const resource = eventData.resources[0];
    replacements['{{resourceName}}'] = resource.name || '';
    replacements['{{resourceCapacity}}'] = resource.capacity ? resource.capacity.toString() : '';
  }
  
  // Process the template string
  return template.replace(/\{\{(\w+)\}\}/g, (match, tag) => {
    return replacements[match] !== undefined ? replacements[match] : match;
  });
}