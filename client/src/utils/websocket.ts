/**
 * WebSocket utility for the calendar application
 * Handles connection to the server with appropriate fallback mechanisms
 */

// Function to create a WebSocket connection with proper protocol and path
export function createWebSocketConnection(onMessage?: (data: any) => void, onOpen?: () => void, onClose?: () => void) {
  try {
    // Use the correct protocol based on the current window location
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    
    // Primary WebSocket endpoint
    const primaryWsUrl = `${protocol}//${window.location.host}/api/ws`;
    console.log(`Attempting to connect to primary WebSocket endpoint: ${primaryWsUrl}`);
    
    // Create the WebSocket connection
    const socket = new WebSocket(primaryWsUrl);
    
    // Set up event handlers
    socket.onopen = () => {
      console.log("WebSocket connection established successfully");
      if (onOpen) onOpen();
    };
    
    socket.onclose = (event) => {
      console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
      
      // If the primary connection fails, try the fallback
      if (event.code !== 1000) { // 1000 = normal closure
        console.log("Primary WebSocket connection failed. Trying fallback...");
        tryFallbackConnection();
      }
      
      if (onClose) onClose();
    };
    
    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket message received:", data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
      }
    };
    
    return socket;
  } catch (error) {
    console.error("Error creating WebSocket connection:", error);
    tryFallbackConnection();
    return null;
  }
  
  // Try the fallback WebSocket endpoint
  function tryFallbackConnection() {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const fallbackWsUrl = `${protocol}//${window.location.host}/ws`;
      console.log(`Attempting to connect to fallback WebSocket endpoint: ${fallbackWsUrl}`);
      
      const fallbackSocket = new WebSocket(fallbackWsUrl);
      
      fallbackSocket.onopen = () => {
        console.log("Fallback WebSocket connection established successfully");
        if (onOpen) onOpen();
      };
      
      fallbackSocket.onclose = (event) => {
        console.log(`Fallback WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
        if (onClose) onClose();
      };
      
      fallbackSocket.onerror = (error) => {
        console.error("Fallback WebSocket error:", error);
      };
      
      fallbackSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Fallback WebSocket message received:", data);
          if (onMessage) onMessage(data);
        } catch (err) {
          console.error("Error processing fallback WebSocket message:", err);
        }
      };
      
      return fallbackSocket;
    } catch (fallbackError) {
      console.error("Error creating fallback WebSocket connection:", fallbackError);
      return null;
    }
  }
}

// Function to check WebSocket connectivity
export function checkWebSocketConnectivity(callback: (isWorking: boolean) => void) {
  // Flag for whether any connection succeeded
  let connectionSucceeded = false;
  
  // Create a test connection
  const testSocket = createWebSocketConnection(
    // onMessage handler
    (data) => {
      // If we get a message, the connection is working
      if (data && data.type === 'pong') {
        connectionSucceeded = true;
        callback(true);
        testSocket?.close(1000, "Test complete");
      }
    },
    // onOpen handler
    () => {
      // Try sending a ping
      if (testSocket && testSocket.readyState === WebSocket.OPEN) {
        testSocket.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
        
        // Set a timeout to close the connection if we don't get a response
        setTimeout(() => {
          if (!connectionSucceeded) {
            callback(false);
            testSocket.close(1000, "Test timeout");
          }
        }, 3000);
      }
    },
    // onClose handler
    () => {
      if (!connectionSucceeded) {
        callback(false);
      }
    }
  );
  
  // If we couldn't create a connection at all, report failure
  if (!testSocket) {
    callback(false);
  }
}