/**
 * Script to directly simulate the API call for updating an event with attendees
 * 
 * Run this in your browser console while logged in
 * Pass the event ID as a parameter
 */
async function simulateUpdateApiCall(eventId) {
  if (!eventId) {
    console.error("Please provide an event ID as parameter");
    return;
  }
  
  console.log(`=== SIMULATING API UPDATE FOR EVENT #${eventId} ===`);
  
  try {
    // First get the existing event
    const fetchResponse = await fetch(`/api/events/${eventId}`);
    const originalEvent = await fetchResponse.json();
    
    console.log("Original event:", originalEvent);
    
    if (!originalEvent || !originalEvent.id) {
      console.error("Failed to fetch event");
      return;
    }
    
    // Extract original attendees for comparison
    let originalAttendees;
    if (originalEvent.attendees) {
      if (typeof originalEvent.attendees === 'string') {
        try {
          originalAttendees = JSON.parse(originalEvent.attendees);
          console.log("Original attendees (parsed from string):", originalAttendees);
        } catch (e) {
          console.error("Error parsing original attendees:", e);
          originalAttendees = originalEvent.attendees;
        }
      } else {
        originalAttendees = originalEvent.attendees;
        console.log("Original attendees:", originalAttendees);
      }
    }
    
    // Create minimal update that doesn't include attendees
    const updateData = {
      title: `${originalEvent.title} (API Test)`,
      description: `${originalEvent.description || ''} - Updated via API test at ${new Date().toISOString()}`
      // No attendees field
    };
    
    console.log("Update data being sent to server (no attendees):", updateData);
    console.log("Raw HTTP request body:", JSON.stringify(updateData));
    
    // Make the API call to update
    const updateResponse = await fetch(`/api/events/${eventId}/update-with-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData)
    });
    
    if (!updateResponse.ok) {
      console.error(`Update API call failed: ${updateResponse.status} ${updateResponse.statusText}`);
      const errorText = await updateResponse.text();
      console.error("Error details:", errorText);
      return;
    }
    
    const updateResult = await updateResponse.json();
    console.log("Update API result:", updateResult);
    
    // Now fetch the updated event to see what was saved
    const verifyResponse = await fetch(`/api/events/${eventId}`);
    const updatedEvent = await verifyResponse.json();
    
    console.log("Event after update:", updatedEvent);
    
    // Extract and analyze updated attendees
    let updatedAttendees;
    if (updatedEvent.attendees) {
      if (typeof updatedEvent.attendees === 'string') {
        try {
          updatedAttendees = JSON.parse(updatedEvent.attendees);
          console.log("Updated attendees (parsed from string):", updatedAttendees);
        } catch (e) {
          console.error("Error parsing updated attendees:", e);
          updatedAttendees = updatedEvent.attendees;
        }
      } else {
        updatedAttendees = updatedEvent.attendees;
        console.log("Updated attendees:", updatedAttendees);
      }
    }
    
    // Compare attendee counts
    const originalCount = Array.isArray(originalAttendees) ? originalAttendees.length : 0;
    const updatedCount = Array.isArray(updatedAttendees) ? updatedAttendees.length : 0;
    
    console.log(`Original attendee count: ${originalCount}`);
    console.log(`Updated attendee count: ${updatedCount}`);
    
    if (originalCount === updatedCount && originalCount > 0) {
      console.log("✅ SUCCESS: Attendees were properly preserved");
    } else if (originalCount > 0 && updatedCount === 0) {
      console.error("❌ FAILURE: Attendees were lost during update");
    } else if (originalCount === 0 && updatedCount === 0) {
      console.log("⚠️ NOTE: No attendees in original or updated event");
    } else {
      console.log(`⚠️ WARNING: Attendee count changed from ${originalCount} to ${updatedCount}`);
    }
    
    return {
      originalEvent,
      updateData,
      updateResult,
      updatedEvent
    };
  } catch (error) {
    console.error("Error during API simulation:", error);
  }
}

// Usage:
// simulateUpdateApiCall(17)