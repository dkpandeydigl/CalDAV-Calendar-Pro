/**
 * WebSocket Notification Service
 * 
 * This service provides TypeScript types and utility functions for
 * the WebSocket notification system.
 */

/**
 * Interface for WebSocket notifications
 */
export interface WebSocketNotification {
  type: 'event' | 'calendar' | 'system' | 'resource' | 'attendee' | 'email';
  action: 'created' | 'updated' | 'deleted' | 'status-change' | 'error' | 'info';
  timestamp: number;
  data: any;
  sourceUserId?: number | null; // The user who triggered the notification
}

/**
 * Formats and validates a WebSocket notification
 * 
 * @param type The notification type
 * @param action The action performed
 * @param data The notification data
 * @param sourceUserId The user ID that triggered the notification (optional)
 * @returns A properly formatted WebSocketNotification
 */
export function createNotification(
  type: WebSocketNotification['type'],
  action: WebSocketNotification['action'],
  data: any,
  sourceUserId?: number | null
): WebSocketNotification {
  return {
    type,
    action,
    data,
    timestamp: Date.now(),
    sourceUserId
  };
}

/**
 * Formats a timestamp from a WebSocketNotification to a human-readable string
 * 
 * @param timestamp The timestamp to format (in milliseconds)
 * @returns A formatted date/time string
 */
export function formatNotificationTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Get a human-readable title for a notification type
 * 
 * @param type The notification type
 * @returns A friendly name for the notification type
 */
export function getNotificationTypeName(type: WebSocketNotification['type']): string {
  switch (type) {
    case 'event': return 'Event';
    case 'calendar': return 'Calendar';
    case 'system': return 'System';
    case 'resource': return 'Resource';
    case 'attendee': return 'Attendee';
    case 'email': return 'Email';
    default: return 'Notification';
  }
}

/**
 * Get a human-readable description for a notification action
 * 
 * @param action The notification action
 * @returns A friendly description of the action
 */
export function getNotificationActionName(action: WebSocketNotification['action']): string {
  switch (action) {
    case 'created': return 'Created';
    case 'updated': return 'Updated';
    case 'deleted': return 'Deleted';
    case 'status-change': return 'Status Changed';
    case 'error': return 'Error';
    case 'info': return 'Information';
    default: return 'Action';
  }
}

/**
 * Get a standard summary for a notification
 * 
 * @param notification The WebSocketNotification
 * @returns A formatted summary string
 */
export function getNotificationSummary(notification: WebSocketNotification): string {
  const typeName = getNotificationTypeName(notification.type);
  const actionName = getNotificationActionName(notification.action);
  
  return `${typeName} ${actionName}`;
}