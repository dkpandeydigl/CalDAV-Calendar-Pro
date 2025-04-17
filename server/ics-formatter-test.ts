/**
 * ICS Formatter Test Utility
 * 
 * Service for testing ICS formatting fixes in the email service
 */

import { emailService } from './email-service';

// Interface for the formatted ICS test result
export interface IcsFormattingTestResult {
  original: string;
  processed: string;
  fixes: string[];
  sequenceFixed: boolean;
  lineBreaksFixed: boolean;
  singleLineFixed: boolean;
}

/**
 * Test the processIcsForAttachment function in the email service
 * This helps diagnose formatting issues before sending real emails
 * 
 * @param icsData The ICS data to test formatting on
 * @returns A test result object with before/after comparisons
 */
export function testIcsFormatting(icsData: string): IcsFormattingTestResult {
  // Store the original ICS data
  const original = icsData;
  
  // Process the ICS data using the email service helper
  const processed = emailService.processIcsForAttachment(icsData);
  
  // Analyze what fixes were applied
  const fixes: string[] = [];
  
  // Check for sequence fix
  const sequenceFixed = original.includes('SEQUENCE:') && 
                        original.match(/SEQUENCE:(\d+)([^\r\n]*)/i)?.[2]?.includes('mailto:') &&
                        !processed.match(/SEQUENCE:(\d+)([^\r\n]*)/i)?.[2]?.includes('mailto:');
  
  if (sequenceFixed) {
    fixes.push('Fixed corrupt SEQUENCE field with mailto: appended');
  }
  
  // Check for literal \r\n fix
  const lineBreaksFixed = original.includes('\\r\\n') && !processed.includes('\\r\\n');
  
  if (lineBreaksFixed) {
    fixes.push('Converted literal \\r\\n strings to actual line breaks');
  }
  
  // Check for single line fix
  const originalHasLineBreaks = original.includes('\r\n') || original.includes('\n');
  const processedHasLineBreaks = processed.includes('\r\n') || processed.includes('\n');
  const singleLineFixed = !originalHasLineBreaks && processedHasLineBreaks;
  
  if (singleLineFixed) {
    fixes.push('Reformatted single-line ICS data into proper multi-line format');
  }
  
  return {
    original,
    processed,
    fixes,
    sequenceFixed,
    lineBreaksFixed,
    singleLineFixed
  };
}