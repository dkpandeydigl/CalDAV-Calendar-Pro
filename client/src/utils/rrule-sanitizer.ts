import { CalendarEvent } from '@shared/schema';

// Types for recurrence
export type RecurrencePattern = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
export type RecurrenceEndType = 'Never' | 'After' | 'On';

export interface RecurrenceConfig {
  pattern: RecurrencePattern;
  interval: number;
  weekdays?: string[]; // For weekly: ['Monday', 'Wednesday', etc.]
  dayOfMonth?: number; // For monthly/yearly
  monthOfYear?: number; // For yearly
  endType: RecurrenceEndType;
  occurrences?: number; // For 'After'
  endDate?: Date; // For 'On'
}

/**
 * Parse a RRULE string into a structured RecurrenceConfig object
 * Implements RFC 5545 parsing for recurrence rules
 * 
 * @param rruleString - The RRULE string from an ICS file
 * @returns Object containing the parsed recurrence settings
 */
export function useRRuleFromString(rruleString: string): { parsedRecurrence: RecurrenceConfig } {
  // Default recurrence configuration
  const parsedRecurrence: RecurrenceConfig = {
    pattern: 'None',
    interval: 1,
    endType: 'Never',
  };
  
  if (!rruleString) {
    return { parsedRecurrence };
  }
  
  try {
    // Remove 'RRULE:' prefix if present
    const rrule = rruleString.startsWith('RRULE:') ? rruleString.substring(6) : rruleString;
    
    // Split into components
    const components = rrule.split(';').reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);
    
    // Parse frequency
    if (components.FREQ) {
      switch (components.FREQ) {
        case 'DAILY':
          parsedRecurrence.pattern = 'Daily';
          break;
        case 'WEEKLY':
          parsedRecurrence.pattern = 'Weekly';
          break;
        case 'MONTHLY':
          parsedRecurrence.pattern = 'Monthly';
          break;
        case 'YEARLY':
          parsedRecurrence.pattern = 'Yearly';
          break;
        default:
          console.warn(`Unknown frequency in RRULE: ${components.FREQ}`);
      }
    }
    
    // Parse interval
    if (components.INTERVAL) {
      const interval = parseInt(components.INTERVAL, 10);
      if (!isNaN(interval) && interval > 0) {
        parsedRecurrence.interval = interval;
      }
    }
    
    // Parse weekdays for weekly recurrence
    if (components.BYDAY && parsedRecurrence.pattern === 'Weekly') {
      const dayMap: Record<string, string> = {
        'SU': 'Sunday',
        'MO': 'Monday',
        'TU': 'Tuesday',
        'WE': 'Wednesday',
        'TH': 'Thursday',
        'FR': 'Friday',
        'SA': 'Saturday'
      };
      
      const days = components.BYDAY.split(',');
      parsedRecurrence.weekdays = days
        .map(day => dayMap[day])
        .filter(Boolean);
    }
    
    // Parse monthly recurrence
    if (components.BYMONTHDAY && parsedRecurrence.pattern === 'Monthly') {
      parsedRecurrence.dayOfMonth = parseInt(components.BYMONTHDAY, 10);
    }
    
    // Parse end rules
    if (components.COUNT) {
      parsedRecurrence.endType = 'After';
      parsedRecurrence.occurrences = parseInt(components.COUNT, 10);
    } else if (components.UNTIL) {
      parsedRecurrence.endType = 'On';
      
      // Parse the UNTIL date (format: 20230822T235959Z)
      try {
        // Extract date part (remove time component)
        const dateStr = components.UNTIL.substring(0, 8);
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10) - 1; // JS months are 0-based
        const day = parseInt(dateStr.substring(6, 8), 10);
        
        const endDate = new Date(Date.UTC(year, month, day));
        if (isNaN(endDate.getTime())) {
          throw new Error(`Invalid UNTIL date: ${components.UNTIL}`);
        }
        
        parsedRecurrence.endDate = endDate;
      } catch (error) {
        console.error('Error parsing UNTIL date:', error);
      }
    }
    
  } catch (error) {
    console.error('Error parsing RRULE:', error, rruleString);
  }
  
  return { parsedRecurrence };
}

/**
 * Clean and sanitize RRULE data from an event
 * Helps ensure RFC 5545 compliance
 * 
 * @param event - The calendar event containing recurrence data
 * @returns Sanitized RRULE string
 */
export function sanitizeRRULE(rruleString: string): string {
  if (!rruleString) return '';
  
  console.log(`Sanitizing RRULE: ${rruleString}`);
  
  try {
    // Check for JSON-like structure accidentally stored as RRULE
    if (rruleString.includes('originalData') || 
        rruleString.includes('mailto:') || 
        rruleString.includes(':')) {
      console.log('Found mailto: or colon in RRULE - cleaning it properly');
      
      // If it contains a colon, only keep the part after RRULE:
      if (rruleString.includes('RRULE:')) {
        const parts = rruleString.split('RRULE:');
        if (parts.length > 1) {
          return parts[1];
        }
      }
      
      // If it looks like JSON, try extracting RRULE from it
      if (rruleString.startsWith('{') || rruleString.includes('originalData')) {
        console.log(`Split RRULE at colon, keeping only: ${rruleString.split(':')[0]}`);
        
        try {
          // Try parsing as JSON
          const jsonData = JSON.parse(rruleString);
          if (jsonData.rrule) {
            return jsonData.rrule;
          }
        } catch (e) {
          console.log(`Could not sanitize RRULE: ${rruleString}, returning empty string`);
          return '';
        }
      }
    }
    
    // Return valid RRULE strings as-is
    if (rruleString.startsWith('FREQ=') || 
        rruleString.startsWith('RRULE:FREQ=')) {
      return rruleString;
    }
    
  } catch (error) {
    console.error('Error sanitizing RRULE:', error);
    return '';
  }
  
  return rruleString;
}

/**
 * Extracts recurrence rule from raw ICS data if available
 */
export function extractRRULEFromRawData(event: CalendarEvent): string {
  if (!event.rawData) return '';
  
  try {
    // If rawData is a string containing ICS data
    if (typeof event.rawData === 'string' && event.rawData.includes('RRULE:')) {
      const lines = event.rawData.split('\n');
      
      // Find the RRULE line
      for (const line of lines) {
        if (line.trim().startsWith('RRULE:')) {
          return line.trim().substring(6); // Remove the 'RRULE:' prefix
        }
      }
    }
    
    // If rawData is an object that might contain RRULE
    if (typeof event.rawData === 'object' && event.rawData !== null) {
      const data = event.rawData as any;
      
      // Check various possible paths for RRULE
      if (data.rrule) return data.rrule;
      if (data.recurrenceRule) return data.recurrenceRule;
      if (data.properties?.rrule?.value) return data.properties.rrule.value;
    }
  } catch (error) {
    console.error('Error extracting RRULE from raw data:', error);
  }
  
  return '';
}

export const parseRRULE = parseRRULEFromEvent;

export function parseRRULEFromEvent(event: CalendarEvent): RecurrenceConfig {
  if (!event.recurrenceRule) {
    return {
      pattern: 'None',
      interval: 1,
      endType: 'Never'
    };
  }
  
  // First sanitize the RRULE
  const sanitizedRule = sanitizeRRULE(event.recurrenceRule);
  console.log(`Extracted RRULE from raw ICS data: ${sanitizedRule}`);
  
  // If sanitized rule couldn't be properly extracted, try getting it from raw data
  const finalRule = sanitizedRule || extractRRULEFromRawData(event);
  
  // Parse the rule
  const { parsedRecurrence } = useRRuleFromString(finalRule);
  return parsedRecurrence;
}