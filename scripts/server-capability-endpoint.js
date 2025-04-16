/**
 * Server Capability Check Endpoint
 * 
 * This script adds a simple API endpoint to check CalDAV server capabilities
 * using the authenticated user's credentials.
 */

const express = require('express');
const { DAVClient } = require('tsdav');

// Type definitions to make TypeScript happy
/**
 * @typedef {Object} ServerConnection
 * @property {string} url
 * @property {string} username
 * @property {string} password
 */

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} [email]
 * @property {string} [fullName]
 */

/**
 * @typedef {Object} Storage
 * @property {function(number): Promise<ServerConnection|null>} getServerConnection
 */

/**
 * @typedef {Object} AuthenticatedRequest
 * @property {User} user
 * @property {Storage} storage
 * @property {function(): boolean} isAuthenticated
 */

/**
 * Register the server capability check endpoint
 * 
 * @param {express.Express} app - The Express application
 */
function registerServerCapabilityEndpoint(app) {
  app.get('/api/check-server-capabilities', async (req, res) => {
    // Check if user is authenticated
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    try {
      // Get server connection for authenticated user
      const serverConnection = await req.storage.getServerConnection(req.user.id);
      if (!serverConnection) {
        return res.status(404).json({ success: false, message: 'No server connection found' });
      }
      
      console.log(`Checking capabilities for server ${serverConnection.url} with user ${serverConnection.username}`);
      
      // Create DAV client with user's credentials
      const client = new DAVClient({
        serverUrl: serverConnection.url,
        credentials: {
          username: serverConnection.username,
          password: serverConnection.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });
      
      // Login and get account information
      await client.login();
      console.log('Successfully authenticated with the server');
      
      // Fetch the principal URL
      const principal = await client.fetchPrincipal();
      
      // Check for scheduling capabilities
      const scheduleProps = await client.propfind({
        url: principal.url,
        props: [
          '{urn:ietf:params:xml:ns:caldav}schedule-inbox-URL',
          '{urn:ietf:params:xml:ns:caldav}schedule-outbox-URL',
          '{urn:ietf:params:xml:ns:caldav}calendar-auto-schedule',
          '{urn:ietf:params:xml:ns:caldav}schedule-default-calendar-URL'
        ],
        depth: '0'
      });
      
      // Extract results
      const hasScheduleInbox = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:schedule-inbox-URL'));
      const hasScheduleOutbox = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:schedule-outbox-URL'));
      const hasAutoSchedule = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:calendar-auto-schedule'));
      
      // Get all calendars
      const calendars = await client.fetchCalendars();
      const calendarResults = [];
      
      for (const calendar of calendars) {
        try {
          const calendarProps = await client.propfind({
            url: calendar.url,
            props: [
              '{DAV:}resourcetype',
              '{urn:ietf:params:xml:ns:caldav}schedule-calendar-transp',
              '{urn:ietf:params:xml:ns:caldav}schedule-default-calendar-URL',
              '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'
            ],
            depth: '0'
          });
          
          calendarResults.push({
            name: calendar.displayName,
            url: calendar.url,
            hasScheduleProps: calendarProps.some(prop => 
              Object.keys(prop).some(key => key.includes('schedule'))
            )
          });
        } catch (calError) {
          console.error(`Error checking calendar ${calendar.displayName}:`, calError);
        }
      }
      
      // Return results
      return res.json({
        success: true,
        server: {
          url: serverConnection.url,
          principal: principal.url
        },
        schedulingCapabilities: {
          hasScheduleInbox,
          hasScheduleOutbox,
          hasAutoSchedule,
          supportsScheduling: hasScheduleInbox && hasScheduleOutbox
        },
        calendars: calendarResults,
        rawProps: scheduleProps
      });
    } catch (error) {
      console.error('Error checking server capabilities:', error);
      return res.status(500).json({ success: false, message: 'Error checking server capabilities', error: String(error) });
    }
  });
  
  console.log('Registered server capability check endpoint: /api/check-server-capabilities');
}

module.exports = { registerServerCapabilityEndpoint };