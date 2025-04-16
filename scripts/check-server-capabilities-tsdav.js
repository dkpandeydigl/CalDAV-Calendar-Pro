/**
 * Script to check DAViCal server capabilities using the tsdav library
 * 
 * This script checks if the CalDAV server supports automatic scheduling
 * by examining the server's reported features and looking for scheduling
 * capabilities.
 */

const { DAVClient } = require('tsdav');

// Server and authentication details - update with actual credentials when running
const serverUrl = 'https://zpush.ajaydata.com/davical/';
const credentials = {
  username: 'dk.pandey@xgenplus.com',
  password: 'your_password_here' // Replace with actual password when running
};

/**
 * Checks server capabilities using tsdav library
 */
async function checkServerCapabilitiesWithTsdav() {
  try {
    console.log(`Checking capabilities of CalDAV server: ${serverUrl}`);
    
    // Create DAV client
    const client = new DAVClient({
      serverUrl,
      credentials,
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    });
    
    // Login and get account information
    await client.login();
    console.log('Successfully authenticated with the server');
    
    // Fetch the principal URL
    const principal = await client.fetchPrincipal();
    console.log(`\nPrincipal URL: ${principal.url}`);
    
    // Fetch home URL
    const homeUrl = await client.fetchHomeUrl();
    console.log(`Home URL: ${homeUrl}`);
    
    // Check for scheduling capabilities - Using principals-URL
    try {
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
      
      console.log('\nScheduling Properties Result:');
      console.log(JSON.stringify(scheduleProps, null, 2));
      
      // Interpret results
      const hasScheduleInbox = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:schedule-inbox-URL'));
      const hasScheduleOutbox = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:schedule-outbox-URL'));
      const hasAutoSchedule = scheduleProps.some(prop => 
        Object.prototype.hasOwnProperty.call(prop, 'calendar:calendar-auto-schedule'));
        
      console.log('\nCapabilities Summary:');
      console.log(`Schedule Inbox: ${hasScheduleInbox ? '✅ Found' : '❌ Not Found'}`);
      console.log(`Schedule Outbox: ${hasScheduleOutbox ? '✅ Found' : '❌ Not Found'}`);
      console.log(`Auto-Schedule: ${hasAutoSchedule ? '✅ Found' : '❌ Not Found'}`);
      
      if (hasScheduleInbox && hasScheduleOutbox) {
        console.log('\n✅ Server supports scheduling capabilities!');
        
        if (hasAutoSchedule) {
          console.log('✅ Server supports automatic scheduling/notifications!');
        } else {
          console.log('⚠️ Server has scheduling but may not support automatic notifications');
        }
      } else {
        console.log('\n❌ Server does not fully support scheduling capabilities');
      }
      
    } catch (propError) {
      console.error('Error fetching scheduling properties:', propError);
    }
    
    // Try to find calendar collections that support automatic scheduling
    try {
      console.log('\nChecking for calendars with scheduling capabilities...');
      const calendars = await client.fetchCalendars();
      
      console.log(`Found ${calendars.length} calendars`);
      
      for (const calendar of calendars) {
        console.log(`\nCalendar: ${calendar.displayName}`);
        
        try {
          const calendarProps = await client.propfind({
            url: calendar.url,
            props: [
              '{DAV:}resourcetype',
              '{urn:ietf:params:xml:ns:caldav}schedule-calendar-transp',
              '{urn:ietf:params:xml:ns:caldav}schedule-default-calendar-URL',
              '{urn:ietf:params:xml:ns:caldav}calendar-user-address-set'
            ],
            depth: '0'
          });
          
          console.log(`Calendar ${calendar.displayName} scheduling properties:`, 
            calendarProps.some(prop => Object.keys(prop).some(key => key.includes('schedule'))) ? 
              '✅ Has scheduling properties' : '❌ No scheduling properties'
          );
        } catch (calPropError) {
          console.error(`Error fetching properties for calendar ${calendar.displayName}:`, calPropError);
        }
      }
    } catch (calError) {
      console.error('Error fetching calendars:', calError);
    }
    
    return true;
  } catch (error) {
    console.error('Error checking server capabilities with tsdav:', error);
    return false;
  }
}

// Run the check
if (require.main === module) {
  checkServerCapabilitiesWithTsdav().then(() => {
    console.log('\nServer capability check completed');
  }).catch(err => {
    console.error('Error running capability check:', err);
  });
}

module.exports = { checkServerCapabilitiesWithTsdav };