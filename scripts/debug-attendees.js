/**
 * Script to directly debug attendee preservation during updates
 * 
 * Run this in your browser console after login
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
  
  // First, let's create a simple event with attendees
  const now = new Date();
  const eventTitle = `Debug Attendees Test ${now.toISOString().split('T')[0]}`;
  
  // Sample attendees
  const sampleAttendees = [
    {
      name: 'Debug Attendee 1',
      email: 'debug1@example.com',
      role: 'REQ-PARTICIPANT',
      status: 'NEEDS-ACTION',
      id: `debug-attendee-${Date.now()}-1`
    },
    {
      name: 'Debug Attendee 2',
      email: 'debug2@example.com',
      role: 'REQ-PARTICIPANT',
      status: 'NEEDS-ACTION',
      id: `debug-attendee-${Date.now()}-2`
    }
  ];
  
  // Get calendars to find one for testing
  const calendarsResponse = await fetch('/api/calendars');
  const calendars = await calendarsResponse.json();
  
  if (!calendars || !calendars.length) {
    console.error('No calendars found');
    return;
  }
  
  // Use first calendar
  const calendarId = calendars[0].id;
  console.log(`Using calendar ID ${calendarId} for test`);
  
  // Create event with attendees
  const createEventData = {
    title: eventTitle,
    description: 'Test event for debugging attendee preservation',
    startDate: new Date(now.getTime() + 3600000).toISOString(), // 1 hour from now
    endDate: new Date(now.getTime() + 7200000).toISOString(),   // 2 hours from now
    calendarId: calendarId,
    attendees: sampleAttendees
  };
  
  console.log('Creating test event with attendees:', createEventData);
  
  // Create the event
  const createResponse = await fetch('/api/events/create-with-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createEventData)
  });
  
  if (!createResponse.ok) {
    console.error('Failed to create test event:', await createResponse.text());
    return;
  }
  
  const createdEvent = await createResponse.json();
  console.log('Created event:', createdEvent);
  
  if (!createdEvent.event || !createdEvent.event.id) {
    console.error('Invalid response - missing event ID');
    return;
  }
  
  const eventId = createdEvent.event.id;
  console.log(`Successfully created event #${eventId} with attendees`);
  
  // Verify the created event has attendees
  const getEventResponse = await fetch(`/api/events/${eventId}`);
  const fetchedEvent = await getEventResponse.json();
  
  console.log('Fetched event after creation:', fetchedEvent);
  console.log('Attendees:', fetchedEvent.attendees);
  
  // Now update the event without including attendees
  const updateData = {
    title: `${eventTitle} (Updated)`,
    description: 'Updated description - attendees should still be preserved'
  };
  
  console.log('Updating event with partial data (no attendees):', updateData);
  
  // Update the event
  const updateResponse = await fetch(`/api/events/${eventId}/update-with-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData)
  });
  
  if (!updateResponse.ok) {
    console.error('Failed to update event:', await updateResponse.text());
    return;
  }
  
  const updatedEventResult = await updateResponse.json();
  console.log('Update result:', updatedEventResult);
  
  // Fetch the event again to see if attendees were preserved
  const verifyResponse = await fetch(`/api/events/${eventId}`);
  const verifiedEvent = await verifyResponse.json();
  
  console.log('Fetched event after update:', verifiedEvent);
  console.log('Attendees after update:', verifiedEvent.attendees);
  
  // Check if attendees were preserved
  if (verifiedEvent.attendees) {
    console.log('✅ SUCCESS: Attendees were preserved!');
    
    // Show details of preserved attendees
    try {
      const parsedAttendees = typeof verifiedEvent.attendees === 'string' 
        ? JSON.parse(verifiedEvent.attendees) 
        : verifiedEvent.attendees;
      
      console.log('Preserved attendees:', parsedAttendees);
      console.log(`Attendee count: ${parsedAttendees.length}`);
    } catch (err) {
      console.error('Error parsing attendees:', err);
    }
  } else {
    console.error('❌ FAILURE: Attendees were lost during update!');
  }
  
  return eventId;
})();