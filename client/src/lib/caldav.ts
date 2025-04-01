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
}

export interface CalDAVAccount {
  serverUrl: string;
  username: string;
  password: string;
  calendars?: CalDAVCalendar[];
}

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
}
