/**
 * Script to extract and analyze attendee data from an existing event
 * 
 * Run this in your browser console while logged in
 * Pass the event ID as a parameter: extractEventData(17)
 */
function extractEventData(eventId) {
  if (!eventId) {
    console.error("Please provide an event ID as parameter");
    return;
  }
  
  console.log(`=== EXTRACTING DATA FOR EVENT #${eventId} ===`);
  
  // Get the event
  return fetch(`/api/events/${eventId}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to fetch event: ${response.statusText}`);
      }
      return response.json();
    })
    .then(event => {
      console.log("Event data:", event);
      
      // Analyze attendees
      if (event.attendees) {
        console.log("Raw attendees:", event.attendees);
        
        if (typeof event.attendees === 'string') {
          try {
            const parsedAttendees = JSON.parse(event.attendees);
            console.log("Parsed attendees:", parsedAttendees);
            console.log(`Attendee count: ${parsedAttendees.length}`);
            
            // Show each attendee
            parsedAttendees.forEach((attendee, index) => {
              console.log(`Attendee #${index + 1}:`, attendee);
            });
          } catch (e) {
            console.error("Error parsing attendees:", e);
          }
        } else if (Array.isArray(event.attendees)) {
          console.log("Attendees (already array):", event.attendees);
          console.log(`Attendee count: ${event.attendees.length}`);
          
          // Show each attendee
          event.attendees.forEach((attendee, index) => {
            console.log(`Attendee #${index + 1}:`, attendee);
          });
        }
      } else {
        console.log("No attendees found in this event");
      }
      
      // Analyze resources
      if (event.resources) {
        console.log("\nRaw resources:", event.resources);
        
        if (typeof event.resources === 'string') {
          try {
            const parsedResources = JSON.parse(event.resources);
            console.log("Parsed resources:", parsedResources);
            console.log(`Resource count: ${parsedResources.length}`);
            
            // Show each resource
            parsedResources.forEach((resource, index) => {
              console.log(`Resource #${index + 1}:`, resource);
            });
          } catch (e) {
            console.error("Error parsing resources:", e);
          }
        } else if (Array.isArray(event.resources)) {
          console.log("Resources (already array):", event.resources);
          console.log(`Resource count: ${event.resources.length}`);
          
          // Show each resource
          event.resources.forEach((resource, index) => {
            console.log(`Resource #${index + 1}:`, resource);
          });
        }
      } else {
        console.log("No resources found in this event");
      }
      
      // Raw data analysis
      if (event.rawData) {
        console.log("\nRaw data present:", !!event.rawData);
        console.log("Raw data preview:", event.rawData.substring(0, 200) + "...");
        
        // Look for attendee entries in raw data
        if (event.rawData.includes("ATTENDEE")) {
          const attendeeEntries = event.rawData.match(/ATTENDEE[^\r\n]+/g);
          console.log("Attendee entries in raw data:", attendeeEntries);
        }
      }
      
      return event;
    })
    .catch(error => {
      console.error("Error extracting event data:", error);
    });
}

// You can call this function with an event ID
// Example: extractEventData(17)