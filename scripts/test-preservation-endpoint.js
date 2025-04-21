/**
 * Script to test the attendee preservation endpoint directly
 * 
 * Run this in your browser console after creating an event with attendees
 * Make sure to replace EVENT_ID with the actual event ID
 */
(async function(eventId) {
  if (!eventId) {
    console.error('Please provide an event ID as parameter');
    return;
  }

  console.log(`Testing attendee preservation endpoint for event ID ${eventId}`);
  
  try {
    const response = await fetch(`/api/test/attendee-preservation/${eventId}`);
    
    if (!response.ok) {
      console.error(`Failed to test event ${eventId}:`, response.statusText);
      return;
    }
    
    const result = await response.json();
    console.log('Test result:', result);
    
    if (result.attendeesPreserved) {
      console.log('✅ SUCCESS: Attendees were properly preserved during update!');
      console.log(`- Original attendee count: ${result.originalAttendeeCount}`);
      console.log(`- Updated attendee count: ${result.updatedAttendeeCount}`);
      console.log('- Original title:', result.originalTitle);
      console.log('- Updated title:', result.updatedTitle);
    } else {
      console.error('❌ FAILURE: Attendees were lost or changed during update!');
      console.log(`- Original attendee count: ${result.originalAttendeeCount}`);
      console.log(`- Updated attendee count: ${result.updatedAttendeeCount}`);
      console.log('- Original attendees:', result.originalAttendees);
      console.log('- Updated attendees:', result.updatedAttendees);
    }
  } catch (error) {
    console.error('Error testing attendee preservation:', error);
  }
})(); // Add event ID here as parameter