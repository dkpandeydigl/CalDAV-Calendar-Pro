/**
 * Centralized ICS Generation Service
 * 
 * This service provides a single source of truth for generating ICS files
 * across the entire application. It ensures:
 * 
 * 1. Consistent ICS formatting for all use cases
 * 2. Proper UID preservation throughout the event lifecycle
 * 3. Method-specific formatting for different event states (CREATE/UPDATE/CANCEL)
 * 4. Sequence number handling for versioning
 */

import { sanitizeAndFormatICS } from './ics-formatter';
import { formatRFC5545Event } from './rfc5545-compliant-formatter';
import { centralUIDService } from '../server/central-uid-service';
import { EventInvitationData } from '../server/enhanced-email-service';

/**
 * Options for ICS generation
 */
export interface ICSGenerationOptions {
  // The RFC 5546 method to use (REQUEST for new/updates, CANCEL for cancellations)
  method?: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH';
  
  // The status of the event
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  
  // The sequence number for versioning (increases with each update)
  sequence?: number;
  
  // Whether to use strict RFC 5545 compliance
  strictMode?: boolean;
  
  // Whether to preserve raw content if available
  preserveRaw?: boolean;
}

/**
 * Generate an ICS file for an event that can be used for:
 * - Email attachments
 * - Direct downloads
 * - CalDAV synchronization
 * 
 * This is the ONLY place where ICS generation should happen to ensure
 * consistent UIDs and formatting across the entire application.
 * 
 * @param eventData The event data to format
 * @param rawICSData Optional raw ICS data to use as a base
 * @param options Formatting options
 * @returns Properly formatted ICS content as a string
 */
export function generateICS(
  eventData: EventInvitationData,
  rawICSData?: string | null,
  options: ICSGenerationOptions = {}
): string {
  // Default options
  const method = options.method || 'REQUEST';
  const status = options.status || 'CONFIRMED';
  const sequence = options.sequence !== undefined ? options.sequence : 0;
  const strictMode = options.strictMode !== undefined ? options.strictMode : true;
  const preserveRaw = options.preserveRaw !== undefined ? options.preserveRaw : true;
  
  // CRITICAL: Ensure the event has a valid UID
  if (!eventData.uid) {
    throw new Error('Event must have a UID to generate ICS content');
  }
  
  // Setting explicit method and status in the event data to ensure consistency
  const enrichedEventData = {
    ...eventData,
    method,
    status,
    sequence
  };

  // If we have raw ICS data and want to preserve it, sanitize and use it as a base
  if (rawICSData && preserveRaw) {
    console.log('Using and sanitizing existing raw ICS data');
    try {
      // We use the sanitizer to ensure compliance but preserve raw data structure
      return sanitizeAndFormatICS(rawICSData, {
        method,
        status,
        sequence,
        uid: eventData.uid // Force the correct UID
      });
    } catch (error) {
      console.error('Error formatting raw ICS data:', error);
      // Fall through to strict formatting on error
    }
  }
  
  // In most cases, we want to use the strict RFC 5545 compliant formatter
  if (strictMode || !rawICSData) {
    console.log('Using strict RFC 5545 compliant formatter');
    try {
      return formatRFC5545Event(enrichedEventData, {
        method,
        status,
        sequence
      });
    } catch (error) {
      console.error('Error using RFC 5545 compliant formatter, falling back to sanitizer:', error);
      // Fall through to basic sanitizer if strict formatter fails
    }
  }

  // If for some reason the strict formatter fails, use sanitizer as a fallback
  console.log('Using sanitizer for ICS generation');
  const template = rawICSData || '';
  return sanitizeAndFormatICS(template, {
    method,
    status,
    sequence,
    uid: eventData.uid,
    organizer: eventData.organizer
  });
}

/**
 * Generate ICS for a new event (first creation)
 */
export function generateNewEventICS(
  eventData: EventInvitationData, 
  rawICSData?: string | null
): string {
  return generateICS(eventData, rawICSData, {
    method: 'REQUEST',
    status: 'CONFIRMED',
    sequence: 0
  });
}

/**
 * Generate ICS for an updated event
 */
export function generateUpdatedEventICS(
  eventData: EventInvitationData, 
  rawICSData?: string | null,
  sequenceIncrement: number = 1
): string {
  // Ensure sequence increases for updates
  const newSequence = (eventData.sequence || 0) + sequenceIncrement;
  
  return generateICS(eventData, rawICSData, {
    method: 'REQUEST',
    status: 'CONFIRMED',
    sequence: newSequence
  });
}

/**
 * Generate ICS for a cancelled event
 */
export function generateCancelledEventICS(
  eventData: EventInvitationData, 
  rawICSData?: string | null,
  sequenceIncrement: number = 1
): string {
  // Ensure sequence increases for cancellations too
  const newSequence = (eventData.sequence || 0) + sequenceIncrement;
  
  return generateICS(eventData, rawICSData, {
    method: 'CANCEL',
    status: 'CANCELLED',
    sequence: newSequence
  });
}