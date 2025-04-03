// CalDAV client implementation using tsdav library
import { DAVClient, DAVCalendarObject, DAVCalendar } from 'tsdav';
import { parseISO, format } from 'date-fns';

export interface CalDAVEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  timezone: string;
  recurrenceRule?: string;
  url?: string;
  etag?: string;
  data?: string; // Raw iCalendar data
}

export interface CalDAVCalendar {
  url: string;
  displayName: string;
  color?: string;
  syncToken?: string;
  events?: CalDAVEvent[];
  ctag?: string;
  sharedWith?: CalDAVSharing[];
}

export interface CalDAVAccount {
  serverUrl: string;
  username: string;
  password: string;
  calendars?: CalDAVCalendar[];
}

// Interface for sharing information
export interface CalDAVSharing {
  principalHref: string; // The user with whom the calendar is shared
  displayName?: string;  // Display name for the user
  email?: string;        // Email of the user
  access: 'read-only' | 'read-write'; // Access level
}

// Access control privilege constants
const ACL_PRIVILEGES = {
  READ: 'read',
  WRITE: 'write',
  READ_WRITE: 'read-write',
  READ_ONLY: 'read-only'
};

// Type for the response from calendar operations
interface CalendarObjectOperationResult {
  url: string;
  etag: string;
}

export class CalDAVClient {
  private account: CalDAVAccount;
  private davClient: DAVClient | null = null;

  constructor(account: CalDAVAccount) {
    this.account = account;
  }

  // Initialize the DAV client
  private async initClient(): Promise<DAVClient> {
    if (this.davClient) {
      return this.davClient;
    }

    this.davClient = new DAVClient({
      serverUrl: this.account.serverUrl,
      credentials: {
        username: this.account.username,
        password: this.account.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    await this.davClient.login();
    return this.davClient;
  }

  // Extract event details from an iCalendar object
  private extractEventFromCalendar(calObject: DAVCalendarObject): CalDAVEvent | null {
    if (!calObject.data) return null;

    try {
      // Parse the iCalendar data to extract event details
      const lines = calObject.data.split('\n');
      let uid = '';
      let summary = '';
      let description = '';
      let location = '';
      let dtstart = '';
      let dtend = '';
      let rrule = '';
      let isAllDay = false;
      let timezone = 'UTC';

      for (const line of lines) {
        if (line.startsWith('UID:')) {
          uid = line.substring(4).trim();
        } else if (line.startsWith('SUMMARY:')) {
          summary = line.substring(8).trim();
        } else if (line.startsWith('DESCRIPTION:')) {
          description = line.substring(12).trim();
        } else if (line.startsWith('LOCATION:')) {
          location = line.substring(9).trim();
        } else if (line.startsWith('DTSTART')) {
          dtstart = line.split(':')[1].trim();
          // Check if all-day event (date only, no time)
          isAllDay = dtstart.length === 8;
          
          if (line.includes('TZID=')) {
            timezone = line.split('TZID=')[1].split(':')[0].trim();
          }
        } else if (line.startsWith('DTEND')) {
          dtend = line.split(':')[1].trim();
        } else if (line.startsWith('RRULE:')) {
          rrule = line.substring(6).trim();
        }
      }

      // Parse start and end dates
      let start: Date;
      let end: Date;

      if (isAllDay) {
        // Format: YYYYMMDD for all-day events
        start = parseISO(`${dtstart.substring(0, 4)}-${dtstart.substring(4, 6)}-${dtstart.substring(6, 8)}`);
        end = parseISO(`${dtend.substring(0, 4)}-${dtend.substring(4, 6)}-${dtend.substring(6, 8)}`);
      } else {
        // Format: YYYYMMDDTHHMMSSZ for datetime
        if (dtstart.endsWith('Z')) {
          // UTC time
          start = parseISO(
            `${dtstart.substring(0, 4)}-${dtstart.substring(4, 6)}-${dtstart.substring(6, 8)}T` +
            `${dtstart.substring(9, 11)}:${dtstart.substring(11, 13)}:${dtstart.substring(13, 15)}Z`
          );
          end = parseISO(
            `${dtend.substring(0, 4)}-${dtend.substring(4, 6)}-${dtend.substring(6, 8)}T` +
            `${dtend.substring(9, 11)}:${dtend.substring(11, 13)}:${dtend.substring(13, 15)}Z`
          );
        } else {
          // Local time with timezone
          start = parseISO(
            `${dtstart.substring(0, 4)}-${dtstart.substring(4, 6)}-${dtstart.substring(6, 8)}T` +
            `${dtstart.substring(9, 11)}:${dtstart.substring(11, 13)}:${dtstart.substring(13, 15)}`
          );
          end = parseISO(
            `${dtend.substring(0, 4)}-${dtend.substring(4, 6)}-${dtend.substring(6, 8)}T` +
            `${dtend.substring(9, 11)}:${dtend.substring(11, 13)}:${dtend.substring(13, 15)}`
          );
        }
      }

      const event: CalDAVEvent = {
        uid,
        summary,
        description,
        location,
        start,
        end,
        allDay: isAllDay,
        timezone,
        url: calObject.url,
        etag: calObject.etag,
        data: calObject.data,
      };

      if (rrule) {
        event.recurrenceRule = rrule;
      }

      return event;
    } catch (error) {
      console.error('Error parsing calendar object:', error);
      return null;
    }
  }

  // Format a CalDAVEvent to iCalendar format
  private formatEventToICalendar(event: CalDAVEvent): string {
    const uid = event.uid || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const now = new Date();
    const dtstamp = format(now, "yyyyMMdd'T'HHmmss'Z'");
    
    let dtstart, dtend;
    
    if (event.allDay) {
      // Format for all-day events
      dtstart = format(event.start, 'yyyyMMdd');
      dtend = format(event.end, 'yyyyMMdd');
    } else {
      // Format for timed events
      if (event.timezone === 'UTC') {
        dtstart = format(event.start, "yyyyMMdd'T'HHmmss'Z'");
        dtend = format(event.end, "yyyyMMdd'T'HHmmss'Z'");
      } else {
        // With timezone
        dtstart = `;TZID=${event.timezone}:${format(event.start, "yyyyMMdd'T'HHmmss")}`;
        dtend = `;TZID=${event.timezone}:${format(event.end, "yyyyMMdd'T'HHmmss")}`;
      }
    }
    
    let icalContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Replit//CalDAV Calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      event.allDay ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART${dtstart}`,
      event.allDay ? `DTEND;VALUE=DATE:${dtend}` : `DTEND${dtend}`,
      `SUMMARY:${event.summary}`,
    ].join('\r\n');
    
    if (event.description) {
      icalContent += `\r\nDESCRIPTION:${event.description}`;
    }
    
    if (event.location) {
      icalContent += `\r\nLOCATION:${event.location}`;
    }
    
    if (event.recurrenceRule) {
      icalContent += `\r\nRRULE:${event.recurrenceRule}`;
    }
    
    icalContent += '\r\nEND:VEVENT\r\nEND:VCALENDAR';
    
    return icalContent;
  }

  // Discover calendars on the server
  async discoverCalendars(): Promise<CalDAVCalendar[]> {
    try {
      const client = await this.initClient();
      const calendars = await client.fetchCalendars();
      
      return calendars.map(cal => {
        // Extract properties from DAV calendar safely
        const displayName = typeof cal.displayName === 'string' 
          ? cal.displayName 
          : 'Unnamed Calendar';
          
        // Extract color or default to blue
        const color = typeof cal.resourcetype === 'object' && cal.resourcetype 
          ? '#0078d4' // Default blue
          : '#0078d4';
          
        return {
          url: cal.url,
          displayName,
          color,
          ctag: cal.ctag,
        };
      });
    } catch (error) {
      console.error("Error discovering calendars:", error);
      throw new Error("Failed to discover calendars on the server");
    }
  }

  // Fetch events from a calendar
  async fetchEvents(calendarUrl: string, timeMin?: Date, timeMax?: Date): Promise<CalDAVEvent[]> {
    try {
      const client = await this.initClient();
      
      const timeRange = timeMin && timeMax ? {
        timeRange: {
          start: timeMin.toISOString(),
          end: timeMax.toISOString(),
        }
      } : {};
      
      const calendarObjects = await client.fetchCalendarObjects({
        calendar: { url: calendarUrl },
        ...timeRange,
      });
      
      const events: CalDAVEvent[] = [];
      
      for (const calObject of calendarObjects) {
        const event = this.extractEventFromCalendar(calObject);
        if (event) {
          events.push(event);
        }
      }
      
      return events;
    } catch (error) {
      console.error("Error fetching events:", error);
      throw new Error("Failed to fetch events from the calendar");
    }
  }

  // Create a new event
  async createEvent(calendarUrl: string, event: Omit<CalDAVEvent, 'uid' | 'url' | 'etag'>): Promise<CalDAVEvent> {
    try {
      const client = await this.initClient();
      const icalData = this.formatEventToICalendar(event as CalDAVEvent);
      const uid = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
      
      const response = await client.createCalendarObject({
        calendar: { url: calendarUrl },
        filename: `${uid}.ics`,
        iCalString: icalData,
      });
      
      // Extract URL and ETag from response (simplified as tsdav types don't fully match)
      const result = response as unknown as CalendarObjectOperationResult;
      
      return {
        ...event,
        uid,
        url: result.url,
        etag: result.etag || '',
        data: icalData,
      };
    } catch (error) {
      console.error("Error creating event:", error);
      throw new Error("Failed to create event on the calendar");
    }
  }

  // Update an existing event
  async updateEvent(event: CalDAVEvent): Promise<CalDAVEvent> {
    try {
      if (!event.url || !event.etag) {
        throw new Error("Event URL and ETag are required for updates");
      }
      
      const client = await this.initClient();
      const icalData = this.formatEventToICalendar(event);
      
      const response = await client.updateCalendarObject({
        calendarObject: {
          url: event.url,
          etag: event.etag,
          data: icalData,
        },
      });
      
      // Extract ETag from response (simplified as tsdav types don't fully match)
      const result = response as unknown as CalendarObjectOperationResult;
      
      return {
        ...event,
        etag: result.etag || event.etag,
        data: icalData,
      };
    } catch (error) {
      console.error("Error updating event:", error);
      throw new Error("Failed to update event on the calendar");
    }
  }

  // Delete an event
  async deleteEvent(event: CalDAVEvent): Promise<boolean> {
    try {
      if (!event.url || !event.etag) {
        throw new Error("Event URL and ETag are required for deletion");
      }
      
      const client = await this.initClient();
      
      await client.deleteCalendarObject({
        calendarObject: {
          url: event.url,
          etag: event.etag,
        },
      });
      
      return true;
    } catch (error) {
      console.error("Error deleting event:", error);
      throw new Error("Failed to delete event from the calendar");
    }
  }

  // Synchronize changes with the server
  async syncCalendar(calendar: CalDAVCalendar): Promise<CalDAVCalendar> {
    try {
      const client = await this.initClient();
      
      // Get the latest ctag to check if the calendar has changed
      const calendars = await client.fetchCalendars();
      const serverCalendar = calendars.find(cal => cal.url === calendar.url);
      
      if (!serverCalendar) {
        throw new Error("Calendar not found on server");
      }
      
      // If ctag hasn't changed, no need to sync
      if (calendar.ctag && serverCalendar.ctag === calendar.ctag) {
        return calendar;
      }
      
      // Fetch all events from the calendar
      const events = await this.fetchEvents(calendar.url);
      
      // Return updated calendar with the new ctag
      return {
        ...calendar,
        events,
        ctag: serverCalendar.ctag,
      };
    } catch (error) {
      console.error("Error syncing calendar:", error);
      throw new Error("Failed to synchronize calendar with the server");
    }
  }
  
  /**
   * Get current ACL (Access Control List) for a calendar
   * @param calendarUrl The URL of the calendar
   * @returns Promise with the XML response from the ACL request
   */
  async getCalendarAcl(calendarUrl: string): Promise<string> {
    try {
      // Ensure the URL has a trailing slash
      const url = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
      
      // Make a PROPFIND request to get current ACL
      const response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0',
          'Authorization': 'Basic ' + btoa(`${this.account.username}:${this.account.password}`)
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
          <D:propfind xmlns:D="DAV:">
            <D:prop>
              <D:acl/>
              <D:owner/>
              <D:current-user-privilege-set/>
            </D:prop>
          </D:propfind>`
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get ACL: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      return xmlText;
    } catch (error) {
      console.error("Error getting calendar ACL:", error);
      throw new Error("Failed to retrieve calendar permissions");
    }
  }
  
  /**
   * Get sharing information for a calendar
   * @param calendarUrl The URL of the calendar
   * @returns Array of CalDAVSharing objects
   */
  async getCalendarSharing(calendarUrl: string): Promise<CalDAVSharing[]> {
    try {
      const aclXml = await this.getCalendarAcl(calendarUrl);
      // Parse XML to extract sharing information
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(aclXml, "text/xml");
      
      // Extract ACL entries
      const aclNode = xmlDoc.querySelector('acl');
      if (!aclNode) return [];
      
      const aceNodes = aclNode.querySelectorAll('ace');
      if (!aceNodes || aceNodes.length === 0) return [];
      
      const sharingList: CalDAVSharing[] = [];
      
      // Process each ACE (Access Control Entry)
      aceNodes.forEach(ace => {
        // Skip owner or non-user entries
        const principalNode = ace.querySelector('principal');
        if (!principalNode) return;
        
        // Skip self references
        const selfNode = principalNode.querySelector('self');
        if (selfNode) return;
        
        // Get the principal href
        const hrefNode = principalNode.querySelector('href');
        if (!hrefNode || !hrefNode.textContent) return;
        
        const principalHref = hrefNode.textContent;
        
        // Check if this is a user principal (contains 'principals')
        if (!principalHref.includes('principals/')) return;
        
        // Determine access level
        const grantNode = ace.querySelector('grant');
        if (!grantNode) return;
        
        let access: 'read-only' | 'read-write' = 'read-only';
        
        // Check for write privilege
        const writePrivilege = grantNode.querySelector('write');
        if (writePrivilege) {
          access = 'read-write';
        }
        
        // Add to sharing list
        sharingList.push({
          principalHref,
          // Extract email/username from principal href
          email: principalHref.split('/').filter(Boolean).pop(),
          access
        });
      });
      
      return sharingList;
    } catch (error) {
      console.error("Error getting calendar sharing:", error);
      return [];
    }
  }
  
  /**
   * Share a calendar with another user
   * @param calendarUrl The URL of the calendar
   * @param userEmail Email of the user to share with
   * @param access Permission level (read-only or read-write)
   * @returns Boolean indicating success
   */
  async shareCalendar(calendarUrl: string, userEmail: string, access: 'read-only' | 'read-write'): Promise<boolean> {
    try {
      // Ensure the URL has a trailing slash
      const url = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
      
      // First get the current ACL
      const currentAcl = await this.getCalendarAcl(calendarUrl);
      
      // Determine the principal URL for the user email
      // This is server-specific - in DAViCal it's typically /principals/[username]/
      const serverUrlObj = new URL(this.account.serverUrl);
      const baseUrl = serverUrlObj.origin;
      
      // Format principal URL based on server type (assuming DAViCal)
      // This needs to be adapted to the specific CalDAV server's principal URL format
      const principalHref = `${baseUrl}/principals/${userEmail}/`;
      
      // Create an ACL XML with the new permission
      const aclXml = `<?xml version="1.0" encoding="utf-8" ?>
        <D:acl xmlns:D="DAV:">
          <D:ace>
            <D:principal>
              <D:href>${principalHref}</D:href>
            </D:principal>
            <D:grant>
              <D:privilege><D:read/></D:privilege>
              ${access === 'read-write' ? '<D:privilege><D:write/></D:privilege>' : ''}
            </D:grant>
          </D:ace>
        </D:acl>`;
      
      // Make an ACL request to update permissions
      const response = await fetch(url, {
        method: 'ACL',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Authorization': 'Basic ' + btoa(`${this.account.username}:${this.account.password}`)
        },
        body: aclXml
      });
      
      return response.ok;
    } catch (error) {
      console.error("Error sharing calendar:", error);
      throw new Error("Failed to share calendar");
    }
  }
  
  /**
   * Remove sharing for a calendar
   * @param calendarUrl The URL of the calendar
   * @param userEmail Email of the user to unshare with
   * @returns Boolean indicating success
   */
  async unshareCalendar(calendarUrl: string, userEmail: string): Promise<boolean> {
    try {
      // Ensure the URL has a trailing slash
      const url = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
      
      // Get current sharing settings to find the principal to remove
      const currentSharing = await this.getCalendarSharing(calendarUrl);
      const sharingToRemove = currentSharing.find(share => 
        share.email === userEmail || share.principalHref.includes(userEmail)
      );
      
      if (!sharingToRemove) {
        // Calendar is not shared with this user
        return false;
      }
      
      // Create an ACL XML that removes the specific ACE
      const aclXml = `<?xml version="1.0" encoding="utf-8" ?>
        <D:acl xmlns:D="DAV:">
          <D:ace>
            <D:principal>
              <D:href>${sharingToRemove.principalHref}</D:href>
            </D:principal>
            <D:deny>
              <D:privilege><D:read/></D:privilege>
              <D:privilege><D:write/></D:privilege>
            </D:deny>
          </D:ace>
        </D:acl>`;
      
      // Make an ACL request to update permissions
      const response = await fetch(url, {
        method: 'ACL',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Authorization': 'Basic ' + btoa(`${this.account.username}:${this.account.password}`)
        },
        body: aclXml
      });
      
      return response.ok;
    } catch (error) {
      console.error("Error unsharing calendar:", error);
      throw new Error("Failed to unshare calendar");
    }
  }
  
  /**
   * Update sharing permissions for a calendar
   * @param calendarUrl The URL of the calendar
   * @param userEmail Email of the user
   * @param access New permission level (read-only or read-write)
   * @returns Boolean indicating success
   */
  async updateCalendarSharing(calendarUrl: string, userEmail: string, access: 'read-only' | 'read-write'): Promise<boolean> {
    try {
      // Simply call the share function which will update existing permissions
      return await this.shareCalendar(calendarUrl, userEmail, access);
    } catch (error) {
      console.error("Error updating calendar sharing:", error);
      throw new Error("Failed to update calendar sharing");
    }
  }
}
