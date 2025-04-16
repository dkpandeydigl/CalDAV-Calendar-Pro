  public generateICSData(data: EventInvitationData): string {
    const { uid, title, description, location, startDate, endDate, organizer, attendees, resources, status, rawData, sequence, _originalResourceAttendees } = data;
    
    // CRITICAL FIX: If raw server data is available, use it as the source of truth for proper RFC compliance
    // This ensures we preserve the exact same UID throughout the event lifecycle
    if (rawData && typeof rawData === 'string') {
      console.log(`Using original raw server data for ICS generation (${rawData.length} bytes)`);
      
      try {
        // First, extract original UID to log it for debugging purposes
        const uidMatch = rawData.match(/UID:([^\r\n]+)/);
        if (uidMatch && uidMatch[1]) {
          const originalUid = uidMatch[1];
          console.log(`Preserving original UID from raw data: ${originalUid}`);
        } else {
          console.log(`No UID found in raw data - will preserve provided UID: ${uid}`);
        }
        
        // For regular events (not cancellations), use the shared formatter for proper RFC compliance
        if (status !== 'CANCELLED') {
          console.log('Using shared ICS formatter for email attachment generation');
          
          // Update METHOD to REQUEST if needed for email invitations
          let processedIcs = rawData;
          if (!processedIcs.includes('METHOD:REQUEST')) {
            if (processedIcs.includes('METHOD:')) {
              // Replace existing METHOD
              processedIcs = processedIcs.replace(/METHOD:[^\r\n]+/g, 'METHOD:REQUEST');
            } else {
              // Add METHOD after PRODID
              processedIcs = processedIcs.replace(/PRODID:[^\r\n]+/g, match => match + '\r\nMETHOD:REQUEST');
            }
          }
          
          // Use the shared formatter to ensure proper RFC compliance
          return sanitizeAndFormatICS(processedIcs);
        }
      } catch (error) {
        console.error('Error processing raw data for ICS generation:', error);
        // Fall through to standard method if there was an error
      }
    }