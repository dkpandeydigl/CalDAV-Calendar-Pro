const fs = require('fs');

const addImport = (content) => {
  // Add import for the ICS formatter at the top of the file
  const importLine = "import { sanitizeAndFormatICS } from '../shared/ics-formatter';";
  const importSection = content.match(/import.*?;(\r?\n|\r)/g).join('');
  return content.replace(importSection, importSection + importLine + '\n');
};

const updateGenerateICSData = (content) => {
  // Regular expression to find the beginning of the generateICSData method
  const methodStart = /public generateICSData\(data: EventInvitationData\): string \{/;
  
  // Find the start of the method in the content
  const startIndex = content.search(methodStart);
  if (startIndex === -1) {
    throw new Error('Could not find generateICSData method');
  }
  
  // Find the location of "try {" inside the rawData block
  const tryBlockStartIndex = content.indexOf('try {', startIndex);
  if (tryBlockStartIndex === -1) {
    throw new Error('Could not find try block in generateICSData method');
  }
  
  // Find the block where we need to add our code
  const ifRawDataBlock = content.substring(
    content.indexOf('if (rawData && typeof rawData === \'string\')', startIndex),
    tryBlockStartIndex
  );
  
  // New code for within the 'if (rawData...' block, just before the try block
  const newCode = `
        // For regular events (not cancellations), use the shared formatter for proper RFC compliance
        if (status !== 'CANCELLED') {
          console.log('Using shared ICS formatter for email attachment generation');
          
          // Update METHOD to REQUEST if needed for email invitations
          let processedIcs = rawData;
          if (!processedIcs.includes('METHOD:REQUEST')) {
            if (processedIcs.includes('METHOD:')) {
              // Replace existing METHOD
              processedIcs = processedIcs.replace(/METHOD:[^\\r\\n]+/g, 'METHOD:REQUEST');
            } else {
              // Add METHOD after PRODID
              processedIcs = processedIcs.replace(/PRODID:[^\\r\\n]+/g, match => match + '\\r\\nMETHOD:REQUEST');
            }
          }
          
          // The sanitizeAndFormatICS will preserve the UID while fixing formatting issues
          return sanitizeAndFormatICS(processedIcs);
        }
        
`;
  
  // Construct the modified content
  const modifiedContent = content.substring(0, tryBlockStartIndex) + 
                         newCode + 
                         content.substring(tryBlockStartIndex);
  
  return modifiedContent;
};

// Read the file
fs.readFile('server/email-service.ts.bak', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading file:', err);
    return;
  }
  
  try {
    // Step 1: Add import
    let modifiedContent = addImport(data);
    
    // Step 2: Update generateICSData method
    modifiedContent = updateGenerateICSData(modifiedContent);
    
    // Step 3: Write the modified content back to file
    fs.writeFile('server/email-service.ts', modifiedContent, 'utf8', (err) => {
      if (err) {
        console.error('Error writing file:', err);
        return;
      }
      console.log('Successfully updated email-service.ts');
    });
  } catch (error) {
    console.error('Error updating file:', error);
  }
});
