/**
 * Utility for sanitizing and fixing malformed RRULE values
 * This handles common problems found in iCalendar data
 */

/**
 * Sanitize a recurrence rule string by removing any non-standard or corrupted parts
 * This is especially useful for fixing rules with embedded mailto: addresses or other invalid content
 * 
 * @param rrule The recurrence rule string to sanitize
 * @returns A cleaned, valid recurrence rule string
 */
export function sanitizeRRULE(rrule: string | null | undefined): string {
  if (!rrule) return '';
  
  // Log the original rule for debugging
  console.log(`Sanitizing RRULE: ${rrule}`);
  
  // Remove 'RRULE:' prefix if present
  if (rrule.startsWith('RRULE:')) {
    rrule = rrule.substring(6);
  }
  
  // Split at the first colon to remove any mailto: parts
  // For example "FREQ=DAILY;COUNT=2:mailto:someone@example.com" -> "FREQ=DAILY;COUNT=2"
  if (rrule.includes(':')) {
    const colonIndex = rrule.indexOf(':');
    rrule = rrule.substring(0, colonIndex);
    console.log(`Split RRULE at colon, keeping only: ${rrule}`);
  }
  
  // Handle cases where email addresses are directly appended to the recurrence rule
  // For example "FREQ=DAILY;COUNT=2mailto:someone@example.com" -> "FREQ=DAILY;COUNT=2"
  if (rrule.includes('mailto')) {
    const mailtoIndex = rrule.indexOf('mailto');
    if (mailtoIndex > 0) {
      rrule = rrule.substring(0, mailtoIndex);
      console.log(`Removed mailto part from RRULE: ${rrule}`);
    }
  }
  
  // Filter the rule parts to keep only valid RRULE parameters
  const validParams = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 
                      'BYMONTH', 'WKST', 'BYSETPOS', 'BYHOUR', 'BYMINUTE', 'BYSECOND',
                      'BYWEEKNO', 'BYYEARDAY'];
  
  const parts = rrule.split(';');
  const validParts = parts.filter(part => {
    if (!part.includes('=')) return false;
    const paramName = part.split('=')[0];
    return validParams.includes(paramName);
  });
  
  // If we have valid parts, join them
  if (validParts.length > 0) {
    const sanitizedRule = validParts.join(';');
    console.log(`Sanitized RRULE: ${sanitizedRule}`);
    return sanitizedRule;
  }
  
  // Extract just FREQ as a last resort
  const freqMatch = rrule.match(/FREQ=([^;]+)/i);
  if (freqMatch) {
    console.log(`Extracted only FREQ from RRULE: FREQ=${freqMatch[1]}`);
    return `FREQ=${freqMatch[1]}`;
  }
  
  // If all else fails, return an empty string
  return '';
}

/**
 * Parse a recurrence rule string into a structured object
 * This handles sanitizing the rule first to ensure it's valid
 * 
 * @param rrule The recurrence rule string to parse
 * @returns A structured recurrence object
 */
export function parseRRULE(rrule: string | null | undefined): any {
  if (!rrule) return null;
  
  // Sanitize the rule first
  const sanitizedRule = sanitizeRRULE(rrule);
  if (!sanitizedRule) return null;
  
  // Create a default recurrence object
  const recurrenceData: any = {
    pattern: 'Daily', // Default to daily
    interval: 1,
    weekdays: [],
    endType: 'Never',
    occurrences: 10, // Default to 10 occurrences
    originalRrule: sanitizedRule
  };
  
  try {
    // Extract frequency
    const freqMatch = sanitizedRule.match(/FREQ=([^;]+)/);
    if (freqMatch && freqMatch[1]) {
      const freq = freqMatch[1];
      if (freq === 'DAILY') recurrenceData.pattern = 'Daily';
      else if (freq === 'WEEKLY') recurrenceData.pattern = 'Weekly';
      else if (freq === 'MONTHLY') recurrenceData.pattern = 'Monthly';
      else if (freq === 'YEARLY') recurrenceData.pattern = 'Yearly';
      console.log(`Extracted FREQ=${freq}, setting pattern to ${recurrenceData.pattern}`);
    }
    
    // Extract interval
    const intervalMatch = sanitizedRule.match(/INTERVAL=(\d+)/);
    if (intervalMatch && intervalMatch[1]) {
      recurrenceData.interval = parseInt(intervalMatch[1], 10) || 1;
      console.log(`Extracted INTERVAL=${recurrenceData.interval}`);
    }
    
    // Extract count
    const countMatch = sanitizedRule.match(/COUNT=(\d+)/);
    if (countMatch && countMatch[1]) {
      recurrenceData.occurrences = parseInt(countMatch[1], 10) || 10;
      recurrenceData.endType = 'After';
      console.log(`Extracted COUNT=${recurrenceData.occurrences}, setting endType to After`);
    }
    
    // Extract until
    const untilMatch = sanitizedRule.match(/UNTIL=([^;]+)/);
    if (untilMatch && untilMatch[1]) {
      try {
        // Parse iCalendar date format like 20250428T235959Z
        const untilStr = untilMatch[1];
        const year = parseInt(untilStr.substring(0, 4), 10);
        const month = parseInt(untilStr.substring(4, 6), 10) - 1; // JS months are 0-based
        const day = parseInt(untilStr.substring(6, 8), 10);
        
        let hour = 0, minute = 0, second = 0;
        if (untilStr.includes('T')) {
          const timeStr = untilStr.substring(untilStr.indexOf('T') + 1);
          hour = parseInt(timeStr.substring(0, 2), 10) || 0;
          minute = parseInt(timeStr.substring(2, 4), 10) || 0;
          second = parseInt(timeStr.substring(4, 6), 10) || 0;
        }
        
        const untilDate = new Date(Date.UTC(year, month, day, hour, minute, second));
        
        // Set the until date and end type
        recurrenceData.endDate = untilDate.toISOString();
        recurrenceData.endType = 'On';
        console.log(`Extracted UNTIL=${untilDate.toISOString()}, setting endType to On`);
      } catch (dateError) {
        console.error('Error parsing UNTIL date:', dateError);
      }
    }
    
    // Extract BYDAY for weekly recurrences
    if (recurrenceData.pattern === 'Weekly') {
      const bydayMatch = sanitizedRule.match(/BYDAY=([^;]+)/);
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
        
        recurrenceData.weekdays = days.map((day: string) => dayMap[day] || day);
        console.log(`Extracted BYDAY=${bydayMatch[1]}, mapped to weekdays:`, recurrenceData.weekdays);
      }
    }
    
    return recurrenceData;
  } catch (error) {
    console.error('Error parsing recurrence rule:', error);
    return null;
  }
}

/**
 * Format a recurrence object into a valid iCalendar RRULE string
 * 
 * @param recurrence The recurrence object to format
 * @returns A valid iCalendar RRULE string
 */
export function formatToRRULE(recurrence: any): string {
  if (!recurrence) return '';
  
  try {
    // Start with the frequency
    let rule = 'FREQ=';
    switch (recurrence.pattern) {
      case 'Daily': rule += 'DAILY'; break;
      case 'Weekly': rule += 'WEEKLY'; break;
      case 'Monthly': rule += 'MONTHLY'; break;
      case 'Yearly': rule += 'YEARLY'; break;
      default: rule += 'DAILY'; // Default to daily
    }
    
    // Add interval if not 1
    if (recurrence.interval && recurrence.interval !== 1) {
      rule += `;INTERVAL=${recurrence.interval}`;
    }
    
    // Add count or until based on end type
    if (recurrence.endType === 'After' && recurrence.occurrences) {
      rule += `;COUNT=${recurrence.occurrences}`;
    } else if (recurrence.endType === 'On' && recurrence.endDate) {
      try {
        // Format the date for UNTIL parameter
        const date = new Date(recurrence.endDate);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        
        rule += `;UNTIL=${year}${month}${day}T${hours}${minutes}${seconds}Z`;
      } catch (dateError) {
        console.error('Error formatting UNTIL date:', dateError);
      }
    }
    
    // Add BYDAY for weekly recurrences
    if (recurrence.pattern === 'Weekly' && recurrence.weekdays && recurrence.weekdays.length > 0) {
      const dayMap: Record<string, string> = {
        'Sunday': 'SU',
        'Monday': 'MO',
        'Tuesday': 'TU',
        'Wednesday': 'WE',
        'Thursday': 'TH',
        'Friday': 'FR',
        'Saturday': 'SA'
      };
      
      const bydays = recurrence.weekdays.map((day: string) => dayMap[day] || day);
      if (bydays.length > 0) {
        rule += `;BYDAY=${bydays.join(',')}`;
      }
    }
    
    return rule;
  } catch (error) {
    console.error('Error formatting recurrence rule:', error);
    return '';
  }
}