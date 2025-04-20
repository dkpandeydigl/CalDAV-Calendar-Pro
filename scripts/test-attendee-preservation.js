/**
 * Test script to verify preservation of attendees during event updates
 * 
 * This script helps test if the fixes for attendee preservation are working correctly.
 * Run this in the browser console after logging in to the application.
 */

(async function() {
  // Get current user info
  const userResponse = await fetch('/api/user');
  const user = await userResponse.json();
  
  if (!user || !user.id) {
    console.error('You must be logged in to run this test');
    return;
  }
  
  console.log('Logged in as:', user);
  
  // Get calendars
  const calendarsResponse = await fetch('/api/calendars');
  const calendars = await calendarsResponse.json();
  
  if (!calendars || !calendars.length) {
    console.error('No calendars found, please create a calendar first');
    return;
  }
  
  console.log('Available calendars:', calendars);
  
  // Select the first calendar for testing
  const testCalendar = calendars[0];
  console.log('Using calendar for test:', testCalendar);
  
  // Create a test event with attendees
  const now = new Date();
  const eventTitle = `Attendee Test ${now.toISOString().split('T')[0]} ${now.getHours()}:${now.getMinutes()}`;
  
  // Test attendees
  const testAttendees = [
    {
      name: 'Test Attendee 1',
      email: 'test1@example.com',
      partstat: 'NEEDS-ACTION',
      role: 'REQ-PARTICIPANT'
    },
    {
      name: 'Test Attendee 2',
      email: 'test2@example.com',
      partstat: 'NEEDS-ACTION',
      role: 'REQ-PARTICIPANT'
    }
  ];
  
  // Create event with attendees
  const createData = {
    title: eventTitle,
    description: 'Test event for attendee preservation testing',
    startDate: new Date(now.getTime() + 3600000).toISOString(), // 1 hour from now
    endDate: new Date(now.getTime() + 7200000).toISOString(),   // 2 hours from now
    calendarId: testCalendar.id,
    attendees: testAttendees,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  
  console.log('Creating test event with attendees:', createData);
  
  try {
    // Use the enhanced create endpoint
    const createResponse = await fetch('/api/events/create-with-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createData)
    });
    
    const createdEvent = await createResponse.json();
    
    if (!createdEvent || !createdEvent.event || !createdEvent.event.id) {
      console.error('Failed to create test event:', createdEvent);
      return;
    }
    
    console.log('Successfully created test event:', createdEvent);
    
    // Now test our endpoint that tests attendee preservation
    const eventId = createdEvent.event.id;
    
    console.log('Testing attendee preservation for event ID:', eventId);
    
    const testResponse = await fetch(`/api/test/attendee-preservation/${eventId}`);
    const testResult = await testResponse.json();
    
    console.log('Attendee preservation test results:', testResult);
    
    if (testResult.attendeesPreserved) {
      console.log('✅ SUCCESS: Attendees were properly preserved during update!');
      console.log(`Original attendee count: ${testResult.originalAttendeeCount}`);
      console.log(`Updated attendee count: ${testResult.updatedAttendeeCount}`);
    } else {
      console.error('❌ FAILURE: Attendees were lost during update!');
      console.log(`Original attendee count: ${testResult.originalAttendeeCount}`);
      console.log(`Updated attendee count: ${testResult.updatedAttendeeCount}`);
      console.log('Original attendees:', testResult.originalAttendees);
      console.log('Updated attendees:', testResult.updatedAttendees);
    }
  } catch (error) {
    console.error('Error running test:', error);
  }
})();