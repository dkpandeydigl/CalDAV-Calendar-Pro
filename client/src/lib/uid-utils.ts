import { createId } from '@paralleldrive/cuid2';

/**
 * Generates a RFC 5545 compliant unique identifier (UID) for calendar events
 * Format: {timestamp}-{random}@{domain}
 * The domain part is required by the RFC to ensure uniqueness across different systems
 */
export function generateUID(domain = 'calendar.replit.app'): string {
  const timestamp = Date.now();
  const random = createId();
  return `${timestamp}-${random}@${domain}`;
}