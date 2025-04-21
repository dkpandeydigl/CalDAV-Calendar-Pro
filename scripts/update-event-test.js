/**
 * Script to update an existing event without including attendees
 * 
 * Run this in your browser console after creating an event with attendees
 * Make sure to replace EVENT_ID with the actual event ID
 */
(async function(eventId) {
  if (!eventId) {
    console.error('Please provide an event ID as parameter');
    return;
  }

  // Get current user info
  const userResponse = await fetch('/api/user');
  const user = await userResponse.json();
  
  if (!user || !user.id) {
    console.error('You must be logged in to run this test');
    return;
  }
  
  console.log('Logged in as:', user);
  
  // First get the event to update
  const eventResponse = await fetch(`/api/events/${eventId}`);
  
  if (!eventResponse.ok) {
    console.error(`Failed to fetch event ${eventId}:`, eventResponse.statusText);
    return;
  }
  
  const event = await eventResponse.json();
  console.log('Original event:', event);
  
  // Original attendees for comparison
  const originalAttendees = event.attendees ? 
    (typeof event.attendees === 'string' ? JSON.parse(event.attendees) : event.attendees) : 
    [];
    
  console.log('Original attendees:', originalAttendees);
  
  // Create minimal update data that doesn't include attendees
  const updateData = {
    title: event.title + ' (Updated V2)',
    description: event.description + ' - This event was updated without including attendees field'
  };
  
  console.log('Update data (deliberately excludes attendees):', updateData);
  
  try {
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
    const updatedAttendees = verifiedEvent.attendees ? 
      (typeof verifiedEvent.attendees === 'string' ? JSON.parse(verifiedEvent.attendees) : verifiedEvent.attendees) : 
      [];
      
    console.log('Attendees after update:', updatedAttendees);
    
    // Compare attendees
    const originalCount = Array.isArray(originalAttendees) ? originalAttendees.length : 0;
    const updatedCount = Array.isArray(updatedAttendees) ? updatedAttendees.length : 0;
    
    if (originalCount === updatedCount && originalCount > 0) {
      console.log('✅ SUCCESS: Attendees were properly preserved during update!');
      console.log(`- Original attendee count: ${originalCount}`);
      console.log(`- Updated attendee count: ${updatedCount}`);
    } else {
      console.error('❌ FAILURE: Attendees were lost or changed during update!');
      console.log(`- Original attendee count: ${originalCount}`);
      console.log(`- Updated attendee count: ${updatedCount}`);
      console.log('Original attendees:', originalAttendees);
      console.log('Updated attendees:', updatedAttendees);
    }
  } catch (error) {
    console.error('Error updating event:', error);
  }
})(); // Add event ID here as parameter