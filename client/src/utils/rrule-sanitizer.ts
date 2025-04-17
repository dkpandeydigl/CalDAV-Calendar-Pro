/**
 * RRULE Sanitizer and Parser
 * 
 * Utilities for cleaning, validating, and parsing iCalendar recurrence rules
 * to ensure they're compliant with RFC 5545.
 */

// Types for parsed RRULE components
export interface ParsedRRULE {
  pattern: string;       // 'Daily', 'Weekly', 'Monthly', 'Yearly'
  interval: number;      // Repeat every X days/weeks/months/years
  weekdays?: string[];   // Array of weekday names for weekly patterns
  endType: string;       // 'After' (occurrence count) or 'Until' (specific date)
  occurrences?: number;  // Number of occurrences if endType is 'After'
  untilDate?: string;    // ISO string of end date if endType is 'Until'
  originalRrule?: string; // The original RRULE string for reference
}

/**
 * Sanitize an RRULE string to remove invalid or malformed parts
 * @param rrule The raw RRULE string to sanitize
 * @returns A cleaned RRULE string
 */
export function sanitizeRRULE(rrule: string): string {
  if (!rrule) return '';
  
  console.log('SANITIZER INPUT:', rrule);
  
  // Replace any instances of "mailto:" in the RRULE
  // This is a common issue when copy-pasting from email clients
  let cleaned = rrule.replace(/mailto:[^;,]+/g, '');
  
  // Fix double commas that might be left after removing mailto
  cleaned = cleaned.replace(/,,/g, ',');
  
  // Remove trailing commas from parameter values
  cleaned = cleaned.replace(/,;/g, ';');
  
  // Ensure there's no trailing semicolon
  cleaned = cleaned.replace(/;$/g, '');
  
  // Fix any incorrectly encoded characters
  cleaned = cleaned.replace(/%20/g, ' ');
  
  // Ensure FREQ parameter exists and is valid
  if (!cleaned.includes('FREQ=')) {
    // If no FREQ, default to DAILY
    cleaned = `FREQ=DAILY;${cleaned}`;
  }
  
  // Ensure FREQ value is valid
  const validFreqs = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
  const freqMatch = cleaned.match(/FREQ=([^;]+)/);
  if (freqMatch && !validFreqs.includes(freqMatch[1])) {
    // Replace invalid FREQ with DAILY
    cleaned = cleaned.replace(/FREQ=[^;]+/, 'FREQ=DAILY');
  }
  
  // Split into parameters for further cleaning
  const params = cleaned.split(';');
  const cleanedParams = params.map(param => {
    // Skip empty parameters
    if (!param.includes('=')) return null;
    
    const [name, value] = param.split('=');
    // Skip parameters with empty values
    if (!value) return null;
    
    // Special handling for specific parameters
    if (name === 'COUNT') {
      // Ensure COUNT is a valid number
      const count = parseInt(value, 10);
      if (isNaN(count) || count <= 0) return null;
      return `${name}=${count}`;
    }
    else if (name === 'INTERVAL') {
      // Ensure INTERVAL is a valid number
      const interval = parseInt(value, 10);
      if (isNaN(interval) || interval <= 0) return null;
      return `${name}=${interval}`;
    }
    else if (name === 'UNTIL') {
      // Validate date format at least roughly
      // Complete validation would be much more complex
      if (!value.match(/^\d{8}(T\d{6}Z?)?$/)) return null;
      return `${name}=${value}`;
    }
    
    // Return the original parameter if no special handling needed
    return param;
  }).filter(Boolean);
  
  // Rejoin parameters and return
  const result = cleanedParams.join(';');
  console.log('SANITIZER OUTPUT:', result);
  return result;
}

/**
 * Parse a sanitized RRULE string into a structured object
 * @param rrule The RRULE string to parse
 * @returns A structured object representing the recurrence rule
 */
export function parseRRULE(rrule: string): ParsedRRULE | null {
  if (!rrule) return null;
  
  // First sanitize the RRULE
  const sanitized = sanitizeRRULE(rrule);
  if (!sanitized) return null;
  
  console.log(`PARSER INPUT (after sanitization): ${sanitized}`);
  
  // Initialize with default values
  const recurrenceData: ParsedRRULE = {
    pattern: 'Daily', // Default to daily
    interval: 1,
    weekdays: [],
    endType: 'After',
    occurrences: 10, // Default to 10 occurrences
    originalRrule: rrule // Store the original for reference
  };
  
  try {
    // Extract frequency
    const freqMatch = sanitized.match(/FREQ=([^;]+)/);
    if (freqMatch && freqMatch[1]) {
      const freq = freqMatch[1];
      if (freq === 'DAILY') recurrenceData.pattern = 'Daily';
      else if (freq === 'WEEKLY') recurrenceData.pattern = 'Weekly';
      else if (freq === 'MONTHLY') recurrenceData.pattern = 'Monthly';
      else if (freq === 'YEARLY') recurrenceData.pattern = 'Yearly';
      console.log(`PARSER: Extracted FREQ=${freq}, setting pattern to ${recurrenceData.pattern}`);
    }
    
    // Extract interval
    const intervalMatch = sanitized.match(/INTERVAL=(\d+)/);
    if (intervalMatch && intervalMatch[1]) {
      recurrenceData.interval = parseInt(intervalMatch[1], 10) || 1;
      console.log(`PARSER: Extracted INTERVAL=${recurrenceData.interval}`);
    }
    
    // Extract count
    const countMatch = sanitized.match(/COUNT=(\d+)/);
    if (countMatch && countMatch[1]) {
      recurrenceData.occurrences = parseInt(countMatch[1], 10) || 10;
      recurrenceData.endType = 'After';
      console.log(`PARSER: Extracted COUNT=${recurrenceData.occurrences}, setting endType to ${recurrenceData.endType}`);
    }
    
    // Extract until
    const untilMatch = sanitized.match(/UNTIL=([^;]+)/);
    if (untilMatch && untilMatch[1]) {
      // Parse iCalendar date format like 20250428T235959Z
      const untilStr = untilMatch[1];
      let untilDate;
      
      if (untilStr.includes('T')) {
        // Date with time
        const year = parseInt(untilStr.substring(0, 4), 10);
        const month = parseInt(untilStr.substring(4, 6), 10) - 1; // Month is 0-indexed
        const day = parseInt(untilStr.substring(6, 8), 10);
        const hour = parseInt(untilStr.substring(9, 11), 10) || 0;
        const minute = parseInt(untilStr.substring(11, 13), 10) || 0;
        const second = parseInt(untilStr.substring(13, 15), 10) || 0;
        
        untilDate = new Date(Date.UTC(year, month, day, hour, minute, second));
      } else {
        // Date only - assume end of day
        const year = parseInt(untilStr.substring(0, 4), 10);
        const month = parseInt(untilStr.substring(4, 6), 10) - 1;
        const day = parseInt(untilStr.substring(6, 8), 10);
        
        untilDate = new Date(Date.UTC(year, month, day, 23, 59, 59));
      }
      
      recurrenceData.untilDate = untilDate.toISOString();
      recurrenceData.endType = 'Until';
      console.log(`PARSER: Extracted UNTIL=${untilStr}, parsed to ${recurrenceData.untilDate}, setting endType to ${recurrenceData.endType}`);
      
      // If we have both COUNT and UNTIL, prefer UNTIL as per RFC 5545
      if (countMatch) {
        console.log('PARSER: Both COUNT and UNTIL found, preferring UNTIL as per RFC 5545');
      }
    }
    
    // Extract BYDAY for weekly recurrences
    if (recurrenceData.pattern === 'Weekly') {
      const bydayMatch = sanitized.match(/BYDAY=([^;]+)/);
      if (bydayMatch && bydayMatch[1]) {
        const days = bydayMatch[1].split(',');
        const dayMap: Record<string, string> = {
          'SU': 'Sunday',
          'MO': 'Monday',
          'TU': 'Tuesday',
          'WE': 'Wednesday',
          'TH': 'Thursday',
          'FR': 'Friday',
          'SA': 'Saturday'
        };
        
        recurrenceData.weekdays = days.map(day => dayMap[day] || day);
        console.log(`PARSER: Extracted BYDAY=${bydayMatch[1]}, mapped to weekdays:`, recurrenceData.weekdays);
      }
    }
    
    return recurrenceData;
  } catch (error) {
    console.error('Error parsing RRULE:', error);
    return null;
  }
}

/**
 * Convert a ParsedRRULE object back to a valid RRULE string
 * @param parsed The parsed RRULE object
 * @returns A valid RRULE string
 */
export function formatToRRULE(parsed: ParsedRRULE): string {
  if (!parsed) return '';
  
  const parts: string[] = [];
  
  // Add FREQ
  let freq = 'DAILY';
  if (parsed.pattern === 'Daily') freq = 'DAILY';
  else if (parsed.pattern === 'Weekly') freq = 'WEEKLY';
  else if (parsed.pattern === 'Monthly') freq = 'MONTHLY';
  else if (parsed.pattern === 'Yearly') freq = 'YEARLY';
  parts.push(`FREQ=${freq}`);
  
  // Add INTERVAL if not 1
  if (parsed.interval && parsed.interval > 1) {
    parts.push(`INTERVAL=${parsed.interval}`);
  }
  
  // Add weekdays for weekly recurrence
  if (parsed.pattern === 'Weekly' && parsed.weekdays && parsed.weekdays.length > 0) {
    const dayMap: Record<string, string> = {
      'Sunday': 'SU',
      'Monday': 'MO',
      'Tuesday': 'TU',
      'Wednesday': 'WE',
      'Thursday': 'TH',
      'Friday': 'FR',
      'Saturday': 'SA'
    };
    
    const daysStr = parsed.weekdays
      .map(day => dayMap[day] || day)
      .join(',');
    
    if (daysStr) {
      parts.push(`BYDAY=${daysStr}`);
    }
  }
  
  // Add end condition
  if (parsed.endType === 'After' && parsed.occurrences) {
    parts.push(`COUNT=${parsed.occurrences}`);
  } else if (parsed.endType === 'Until' && parsed.untilDate) {
    // Convert ISO date to RRULE format (YYYYMMDDTHHMMSSZ)
    const date = new Date(parsed.untilDate);
    const untilStr = date.toISOString()
      .replace(/[-:]/g, '')  // Remove dashes and colons
      .replace(/\.\d{3}/, ''); // Remove milliseconds
    
    parts.push(`UNTIL=${untilStr}`);
  }
  
  return parts.join(';');
}