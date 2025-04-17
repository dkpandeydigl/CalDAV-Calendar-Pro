/**
 * ICS Formatter Test Utility
 * 
 * Service for testing ICS formatting fixes in the email service
 */

import { emailService } from './email-service';

/**
 * Result interface for ICS formatting tests
 */
export interface IcsFormattingTestResult {
  original: string;
  processed: string;
  fixes: string[];
  sequenceFixed: boolean;
  lineBreaksFixed: boolean;
  singleLineFixed: boolean;
  attendeeEmailsFixed: boolean;
  organizerEmailsFixed: boolean;
}

/**
 * Test the processIcsForAttachment function in the email service
 * This helps diagnose formatting issues before sending real emails
 * 
 * @param icsData The ICS data to test formatting on
 * @returns A test result object with before/after comparisons
 */
export function testIcsFormatting(icsData: string): IcsFormattingTestResult {
  const fixes: string[] = [];
  
  // Test for sequence issue
  const sequencePattern = /SEQUENCE:(\d+)mailto:/i;
  const hasSequenceIssue = sequencePattern.test(icsData);
  if (hasSequenceIssue) {
    fixes.push('Fixed corrupted SEQUENCE field with appended mailto values');
  }
  
  // Test for line break issues
  const literalLineBreakPattern = /\\r\\n/;
  const hasLiteralLineBreaks = literalLineBreakPattern.test(icsData);
  if (hasLiteralLineBreaks) {
    fixes.push('Converted literal \\r\\n characters to actual line breaks');
  }
  
  // Test if the file appears as a single line
  const isSingleLine = !icsData.includes('\r\n') && !icsData.includes('\n');
  if (isSingleLine) {
    fixes.push('Fixed ICS data that appeared as a single line without proper line breaks');
  }
  
  // Test for double colon in attendee emails
  const doubleColonAttendeePattern = /ATTENDEE[^:]*:mailto::/i;
  const hasDoubleColonAttendeeIssue = doubleColonAttendeePattern.test(icsData);
  if (hasDoubleColonAttendeeIssue) {
    fixes.push('Fixed double colon in ATTENDEE email addresses (mailto::)');
  }
  
  // Test for double colon in organizer emails
  const doubleColonOrganizerPattern = /ORGANIZER[^:]*:mailto::/i;
  const hasDoubleColonOrganizerIssue = doubleColonOrganizerPattern.test(icsData);
  if (hasDoubleColonOrganizerIssue === true) {
    fixes.push('Fixed double colon in ORGANIZER email address (mailto::)');
  }

  // Process the ICS data using the email service
  const processedIcsData = emailService.processIcsForAttachment(icsData);
  
  // Recheck for issues after processing
  const stillHasSequenceIssue = sequencePattern.test(processedIcsData);
  const stillHasLiteralLineBreaks = literalLineBreakPattern.test(processedIcsData);
  const stillIsSingleLine = !processedIcsData.includes('\r\n') && !processedIcsData.includes('\n');
  const stillHasDoubleColonAttendeeIssue = doubleColonAttendeePattern.test(processedIcsData);
  const stillHasDoubleColonOrganizerIssue = doubleColonOrganizerPattern.test(processedIcsData);
  
  // Return results
  return {
    original: icsData,
    processed: processedIcsData,
    fixes,
    sequenceFixed: hasSequenceIssue && !stillHasSequenceIssue,
    lineBreaksFixed: hasLiteralLineBreaks && !stillHasLiteralLineBreaks,
    singleLineFixed: isSingleLine && !stillIsSingleLine,
    attendeeEmailsFixed: hasDoubleColonAttendeeIssue && !stillHasDoubleColonAttendeeIssue,
    organizerEmailsFixed: hasDoubleColonOrganizerIssue && !stillHasDoubleColonOrganizerIssue,
  };
}