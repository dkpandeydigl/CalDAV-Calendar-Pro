import React, { useState } from 'react';
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from '@/hooks/use-toast';

/**
 * Component for testing the ICS formatting fixes
 * - Tests the processIcsForAttachment function in the email service
 * - Allows testing both regular and malformed ICS data
 */
const IcsFormatTester: React.FC = () => {
  const [eventId, setEventId] = useState<string>('');
  const [testType, setTestType] = useState<'sample' | 'custom'>('sample');
  const [customIcsData, setCustomIcsData] = useState<string>('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sendRealEmails, setSendRealEmails] = useState<boolean>(false);
  const { toast } = useToast();

  // Sample malformed ICS data
  const sampleMalformedIcs = `BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nPRODID:-//Example Corp//Calendar App//EN\\r\\nMETHOD:REQUEST\\r\\nBEGIN:VEVENT\\r\\nUID:test-event-123\\r\\nSUMMARY:Test Event with Formatting Issues\\r\\nDTSTART:20250417T140000Z\\r\\nDTEND:20250417T150000Z\\r\\nSEQUENCE:1mailto:test@example.com\\r\\nORGANIZER;CN=Organizer:mailto:organizer@example.com\\r\\nATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Attendee:mailto:attendee@example.com\\r\\nDESCRIPTION:This is a test event with formatting issues\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR`;

  // Sample single-line ICS data
  const sampleSingleLineIcs = `BEGIN:VCALENDAR VERSION:2.0 PRODID:-//Example Corp//Calendar App//EN METHOD:REQUEST BEGIN:VEVENT UID:test-event-456 SUMMARY:Test Event on Single Line DTSTART:20250417T160000Z DTEND:20250417T170000Z SEQUENCE:2 ORGANIZER;CN=Organizer:mailto:organizer@example.com ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Attendee:mailto:attendee@example.com DESCRIPTION:This is a test event on a single line END:VEVENT END:VCALENDAR`;

  // Function to handle test submission
  const handleTestIcsFormatting = async () => {
    try {
      setLoading(true);
      let apiUrl = '/api/test-ics-formatting';
      let payload: any = {
        sendRealEmails
      };

      if (testType === 'custom') {
        if (!customIcsData.trim()) {
          toast({
            title: "Error",
            description: "Please provide custom ICS data",
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
        payload.icsData = customIcsData;
      } else if (eventId.trim()) {
        payload.eventId = parseInt(eventId, 10);
      } else {
        // No event ID, use sample data
        payload.icsData = Math.random() > 0.5 ? sampleMalformedIcs : sampleSingleLineIcs;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      setResponse(data);

      if (response.ok) {
        toast({
          title: "Success",
          description: "ICS formatting test executed successfully",
        });
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to test ICS formatting",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error testing ICS formatting:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>ICS Formatting Test Tool</CardTitle>
          <CardDescription>
            Test the ICS formatting fixes for email attachments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="testType">Test Type</Label>
            <div className="flex gap-4 mt-2">
              <Button 
                variant={testType === 'sample' ? "default" : "outline"}
                onClick={() => setTestType('sample')}
              >
                Use Sample Data
              </Button>
              <Button 
                variant={testType === 'custom' ? "default" : "outline"}
                onClick={() => setTestType('custom')}
              >
                Custom ICS Data
              </Button>
            </div>
          </div>

          {testType === 'sample' && (
            <div>
              <Label htmlFor="eventId">Event ID (Optional)</Label>
              <Input
                id="eventId"
                placeholder="Enter event ID or leave empty to use sample data"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="mt-1"
              />
              <p className="text-sm text-gray-500 mt-1">
                If left empty, a sample malformed ICS will be used for testing
              </p>
            </div>
          )}

          {testType === 'custom' && (
            <div>
              <Label htmlFor="customIcsData">Custom ICS Data</Label>
              <Textarea
                id="customIcsData"
                placeholder="Paste your ICS data here"
                value={customIcsData}
                onChange={(e) => setCustomIcsData(e.target.value)}
                className="mt-1 font-mono"
                rows={10}
              />
            </div>
          )}

          <div className="flex items-center space-x-2">
            <Switch
              id="sendRealEmails"
              checked={sendRealEmails}
              onCheckedChange={setSendRealEmails}
            />
            <Label htmlFor="sendRealEmails">Send real emails (be careful!)</Label>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleTestIcsFormatting} 
            disabled={loading}
            className="w-full"
          >
            {loading ? "Processing..." : "Test ICS Formatting"}
          </Button>
        </CardFooter>
      </Card>

      {response && (
        <Card className="mt-6 shadow-lg">
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-100 p-4 rounded-md overflow-auto max-h-96">
              <pre className="whitespace-pre-wrap text-sm">
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default IcsFormatTester;