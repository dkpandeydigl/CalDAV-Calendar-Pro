/**
 * Script to create a recurring test event with attendees
 * and then update it to ensure attendees are preserved
 * 
 * Run this in your browser console after logging in
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
  const eventTitle = `Recurring Attendee Test V2 ${now.toISOString().split('T')[0]} ${now.getHours()}:${now.getMinutes()}`;
  
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
  
  // Create a recurring event with attendees
  const createData = {
    title: eventTitle,
    description: 'Test recurring event for attendee preservation testing',
    startDate: new Date(now.getTime() + 3600000).toISOString(), // 1 hour from now
    endDate: new Date(now.getTime() + 7200000).toISOString(),   // 2 hours from now
    calendarId: testCalendar.id,
    attendees: testAttendees,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isRecurring: true,
    recurrenceRule: 'FREQ=DAILY;COUNT=3'
  };
  
  console.log('Creating recurring test event with attendees:', createData);
  
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
      console.error('Failed to create recurring test event:', createdEvent);
      return;
    }
    
    console.log('Successfully created recurring test event:', createdEvent);
    const eventId = createdEvent.event.id;
    console.log('EVENT ID:', eventId);
    
    // Wait a moment before updating
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Now update the event without including attendees
    const updateData = {
      title: eventTitle + ' (Updated V2)',
      description: 'This recurring event was updated without including attendees field'
    };
    
    console.log('Update data (deliberately excludes attendees):', updateData);
    
    // Use the enhanced update endpoint
    const updateResponse = await fetch(`/api/events/${eventId}/update-with-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });
    
    if (!updateResponse.ok) {
      console.error(`Failed to update event ${eventId}:`, updateResponse.statusText);
      return;
    }
    
    const updatedEventResult = await updateResponse.json();
    console.log('Update result:', updatedEventResult);
    
    // Fetch the event again to verify attendees
    const verifyResponse = await fetch(`/api/events/${eventId}`);
    const verifiedEvent = await verifyResponse.json();
    
    console.log('Verified event after update:', verifiedEvent);
    
    // Check attendees after update
    const originalAttendees = testAttendees;
    const updatedAttendees = verifiedEvent.attendees ? 
      (typeof verifiedEvent.attendees === 'string' ? JSON.parse(verifiedEvent.attendees) : verifiedEvent.attendees) : 
      [];
      
    console.log('Attendees after update:', updatedAttendees);
    
    // Compare attendees
    const originalCount = Array.isArray(originalAttendees) ? originalAttendees.length : 0;
    const updatedCount = Array.isArray(updatedAttendees) ? updatedAttendees.length : 0;
    
    if (originalCount === updatedCount && originalCount > 0) {
      console.log('✅ SUCCESS: Attendees were properly preserved during recurring event update!');
      console.log(`- Original attendee count: ${originalCount}`);
      console.log(`- Updated attendee count: ${updatedCount}`);
    } else {
      console.error('❌ FAILURE: Attendees were lost or changed during recurring event update!');
      console.log(`- Original attendee count: ${originalCount}`);
      console.log(`- Updated attendee count: ${updatedCount}`);
      console.log('Original attendees:', originalAttendees);
      console.log('Updated attendees:', updatedAttendees);
    }
  } catch (error) {
    console.error('Error with recurring test:', error);
  }
})();