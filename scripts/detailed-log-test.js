/**
 * Script to create, update, and log every step of attendee handling
 * 
 * Run this in your browser console while logged in
 */
(async function() {
  console.log("=== DETAILED ATTENDEE PRESERVATION TEST ===");
  
  // Get current user
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
    console.error('No calendars found');
    return;
  }
  
  // Use first calendar
  const calendarId = calendars[0].id;
  console.log(`Using calendar ID ${calendarId} for test`);
  
  // Generate test data with UUID to make it unique
  const testId = Date.now();
  const title = `Attendee Test ${testId}`;
  
  // Create test attendees
  const testAttendees = [
    {
      name: "Test Attendee 1",
      email: "test1@example.com",
      role: "REQ-PARTICIPANT",
      status: "NEEDS-ACTION",
      id: `attendee-${testId}-1` 
    },
    {
      name: "Test Attendee 2",
      email: "test2@example.com",
      role: "OPT-PARTICIPANT",
      status: "NEEDS-ACTION",
      id: `attendee-${testId}-2`
    }
  ];
  
  console.log("=== STEP 1: CREATING EVENT WITH ATTENDEES ===");
  console.log("Test attendees:", testAttendees);
  
  // Create the event
  const now = new Date();
  const createData = {
    title: title,
    description: "Test for attendee preservation",
    startDate: new Date(now.getTime() + 3600000).toISOString(),
    endDate: new Date(now.getTime() + 7200000).toISOString(),
    calendarId: calendarId,
    attendees: testAttendees
  };
  
  console.log("Creating event with data:", createData);
  
  // Create the event with attendees
  let createdEvent;
  try {
    const createResponse = await fetch('/api/events/create-with-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createData)
    });
    
    const result = await createResponse.json();
    console.log("Create result:", result);
    
    if (!result.event || !result.event.id) {
      console.error("Failed to create event - missing event ID");
      return;
    }
    
    createdEvent = result.event;
    console.log(`Successfully created event ID: ${createdEvent.id}`);
  } catch (error) {
    console.error("Error creating event:", error);
    return;
  }
  
  // Fetch the created event to verify attendees
  console.log("\n=== STEP 2: FETCHING CREATED EVENT TO VERIFY ATTENDEES ===");
  let fetchedEvent;
  try {
    const fetchResponse = await fetch(`/api/events/${createdEvent.id}`);
    fetchedEvent = await fetchResponse.json();
    
    console.log("Fetched event after creation:", fetchedEvent);
    console.log("Attendees stored in database:", fetchedEvent.attendees);
    
    // Parse attendees if they're stored as a string
    let parsedAttendees;
    if (typeof fetchedEvent.attendees === 'string') {
      try {
        parsedAttendees = JSON.parse(fetchedEvent.attendees);
        console.log("Parsed attendees (from string):", parsedAttendees);
        console.log(`Attendee count: ${parsedAttendees.length}`);
      } catch (e) {
        console.error("Error parsing attendees:", e);
      }
    } else if (Array.isArray(fetchedEvent.attendees)) {
      parsedAttendees = fetchedEvent.attendees;
      console.log("Attendees (already array):", parsedAttendees);
      console.log(`Attendee count: ${parsedAttendees.length}`);
    } else {
      console.log("No attendees or unrecognized format");
    }
  } catch (error) {
    console.error("Error fetching event:", error);
    return;
  }
  
  // Wait a moment
  console.log("Waiting 2 seconds before updating...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Now update the event WITHOUT attendees
  console.log("\n=== STEP 3: UPDATING EVENT WITHOUT ATTENDEES ===");
  
  const updateData = {
    title: `${title} (Updated)`,
    description: "Updated description - attendees should be preserved"
    // Deliberately NOT including attendees
  };
  
  console.log("Update data (NO attendees):", updateData);
  
  // Update the event 
  let updatedEventResult;
  try {
    const updateResponse = await fetch(`/api/events/${createdEvent.id}/update-with-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    updatedEventResult = await updateResponse.json();
    console.log("Update result:", updatedEventResult);
  } catch (error) {
    console.error("Error updating event:", error);
    return;
  }
  
  // Fetch the updated event to verify attendees were preserved
  console.log("\n=== STEP 4: FETCHING UPDATED EVENT TO VERIFY ATTENDEES PRESERVED ===");
  
  let updatedEvent;
  try {
    const verifyResponse = await fetch(`/api/events/${createdEvent.id}`);
    updatedEvent = await verifyResponse.json();
    
    console.log("Fetched event after update:", updatedEvent);
    console.log("Attendees after update:", updatedEvent.attendees);
    
    // Parse attendees if they're stored as a string
    let parsedAttendees;
    if (typeof updatedEvent.attendees === 'string') {
      try {
        parsedAttendees = JSON.parse(updatedEvent.attendees);
        console.log("Parsed attendees after update (from string):", parsedAttendees);
        console.log(`Updated attendee count: ${parsedAttendees.length}`);
      } catch (e) {
        console.error("Error parsing attendees after update:", e);
      }
    } else if (Array.isArray(updatedEvent.attendees)) {
      parsedAttendees = updatedEvent.attendees;
      console.log("Attendees after update (already array):", parsedAttendees);
      console.log(`Updated attendee count: ${parsedAttendees.length}`);
    } else {
      console.log("No attendees after update or unrecognized format");
    }
    
    // Display raw event data as well
    console.log("Raw event data after update:", JSON.stringify(updatedEvent, null, 2));
    
    // Final result
    if (updatedEvent.attendees) {
      console.log("\n✅ SUCCESS: Attendees were preserved after update!");
    } else {
      console.error("\n❌ FAILURE: Attendees were lost during update!");
    }
  } catch (error) {
    console.error("Error verifying updated event:", error);
  }
  
  // Return event ID for further testing if needed
  return createdEvent.id;
})();