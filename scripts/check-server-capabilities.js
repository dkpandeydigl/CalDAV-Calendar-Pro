/**
 * Script to check if the CalDAV server supports calendar-auto-schedule
 * 
 * This script performs a PROPFIND request to the server to check for
 * supported features, specifically looking for the calendar-auto-schedule
 * capability that would allow automatic email notifications.
 */

const fetch = require('node-fetch');

// Server details - these should be updated with actual credentials
const serverUrl = 'https://zpush.ajaydata.com/davical/';
const username = 'dk.pandey@xgenplus.com';
const password = 'your_password_here'; // Replace with actual password when running

// PROPFIND request to check server capabilities
async function checkServerCapabilities() {
  try {
    console.log(`Checking capabilities of CalDAV server: ${serverUrl}`);
    
    // Create basic auth header
    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    
    // PROPFIND request body to request server features
    const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
      <propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <prop>
          <C:calendar-home-set/>
          <C:calendar-user-address-set/>
          <supported-report-set/>
          <supported-calendar-component-set/>
          <C:supported-calendar-component-sets/>
          <C:schedule-inbox-URL/>
          <C:schedule-outbox-URL/>
          <C:calendar-timezone/>
          <current-user-principal/>
          <C:calendar-auto-schedule/>
          <resourcetype/>
        </prop>
      </propfind>`;
    
    // Send the PROPFIND request
    const response = await fetch(serverUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/xml',
        'Depth': '0'
      },
      body: propfindBody
    });
    
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }
    
    const responseText = await response.text();
    console.log('\nServer Response:\n', responseText);
    
    // Check if calendar-auto-schedule is supported
    if (responseText.includes('calendar-auto-schedule')) {
      console.log('\n✅ Server appears to support automatic scheduling/notifications');
    } else {
      console.log('\n❌ Server does not appear to support automatic scheduling/notifications');
    }
    
    // Check for schedule-inbox and outbox URLs
    if (responseText.includes('schedule-inbox-URL') || responseText.includes('schedule-outbox-URL')) {
      console.log('✅ Server has scheduling inbox/outbox URLs - a good sign for scheduling support');
    } else {
      console.log('❌ No scheduling inbox/outbox URLs found');
    }
    
    return responseText;
  } catch (error) {
    console.error('Error checking server capabilities:', error);
    return null;
  }
}

// Run the check if this script is executed directly
if (require.main === module) {
  checkServerCapabilities();
}

module.exports = { checkServerCapabilities };