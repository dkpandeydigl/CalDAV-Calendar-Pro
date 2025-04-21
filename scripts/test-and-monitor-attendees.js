/**
 * Script to create an event with attendees, watch for console logs, then update it
 * 
 * Run this in your browser console after logging in
 */
async function testAndMonitorAttendees() {
  // Set up console monitoring for server logs
  const originalConsoleLog = console.log;
  const logs = [];
  
  // Override console.log to capture logs
  console.log = function() {
    // Call original function
    originalConsoleLog.apply(console, arguments);
    
    // Capture log message
    const args = Array.from(arguments);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    // Store log if it contains keywords
    if (message.includes('attendee') || 
        message.includes('Attendee') || 
        message.includes('ATTENDEE') ||
        message.includes('resource') ||
        message.includes('Resource') ||
        message.includes('RESOURCE') ||
        message.includes('PRESERVATION')) {
      logs.push({
        timestamp: new Date().toISOString(),
        message: message
      });
    }
  };
  
  try {
    // Get user
    const userResponse = await fetch('/api/user');
    const user = await userResponse.json();
    
    if (!user || !user.id) {
      throw new Error('Not logged in');
    }
    
    console.log('Logged in as:', user);
    
    // Get calendars
    const calendarsResponse = await fetch('/api/calendars');
    const calendars = await calendarsResponse.json();
    
    if (!calendars || !calendars.length) {
      throw new Error('No calendars found');
    }
    
    const calendarId = calendars[0].id;
    console.log(`Using calendar ID ${calendarId}`);
    
    // Create test event with attendees
    const testId = Date.now();
    const testAttendees = [
      {
        name: "Test Monitor Attendee 1",
        email: "test-monitor1@example.com",
        role: "REQ-PARTICIPANT",
        status: "NEEDS-ACTION",
        id: `monitor-${testId}-1` 
      },
      {
        name: "Test Monitor Attendee 2",
        email: "test-monitor2@example.com",
        role: "OPT-PARTICIPANT",
        status: "NEEDS-ACTION",
        id: `monitor-${testId}-2`
      }
    ];
    
    const now = new Date();
    const createData = {
      title: `Monitor Test ${testId}`,
      description: "Test for monitoring attendee preservation",
      startDate: new Date(now.getTime() + 3600000).toISOString(),
      endDate: new Date(now.getTime() + 7200000).toISOString(),
      calendarId: calendarId,
      attendees: testAttendees
    };
    
    console.log("Creating event with attendees:", createData);
    
    const createResponse = await fetch('/api/events/create-with-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createData)
    });
    
    const createResult = await createResponse.json();
    const eventId = createResult.event.id;
    
    console.log(`Created event ID ${eventId}`);
    
    // Wait a moment
    console.log("Waiting 3 seconds before updating...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Update the event without attendees
    const updateData = {
      title: `Monitor Test ${testId} (Updated)`,
      description: "Updated description without attendees field"
    };
    
    console.log("Updating event WITHOUT attendees:", updateData);
    
    // Update the event
    const updateResponse = await fetch(`/api/events/${eventId}/update-with-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    const updateResult = await updateResponse.json();
    
    // Wait for logs to be collected
    console.log("Waiting 3 seconds for logs...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Fetch the event after update
    const verifyResponse = await fetch(`/api/events/${eventId}`);
    const updatedEvent = await verifyResponse.json();
    
    // Restore original console.log
    console.log = originalConsoleLog;
    
    // Display captured logs
    console.log("=== CAPTURED LOGS ===");
    logs.forEach((log, i) => {
      console.log(`[${i+1}] ${log.timestamp}: ${log.message}`);
    });
    
    // Analyze results
    console.log("\n=== RESULTS ===");
    console.log("Original attendees:", testAttendees);
    
    let updatedAttendees;
    if (updatedEvent.attendees) {
      if (typeof updatedEvent.attendees === 'string') {
        try {
          updatedAttendees = JSON.parse(updatedEvent.attendees);
        } catch (e) {
          updatedAttendees = updatedEvent.attendees;
        }
      } else {
        updatedAttendees = updatedEvent.attendees;
      }
    }
    
    console.log("Updated attendees:", updatedAttendees);
    
    const originalCount = testAttendees.length;
    const updatedCount = Array.isArray(updatedAttendees) ? updatedAttendees.length : 0;
    
    if (originalCount === updatedCount && originalCount > 0) {
      console.log("✅ SUCCESS: Attendees were preserved!");
    } else {
      console.log("❌ FAILURE: Attendees were not preserved correctly");
    }
    
    // Return everything for further analysis
    return {
      logs,
      eventId,
      createResult,
      updateResult,
      updatedEvent
    };
  } catch (error) {
    // Restore original console.log
    console.log = originalConsoleLog;
    console.error("Error during test:", error);
    
    // Return logs even if there was an error
    return { logs, error };
  }
}

// Run the test
testAndMonitorAttendees();