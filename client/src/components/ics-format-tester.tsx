/**
 * Component for testing the ICS formatting fixes
 * - Tests the processIcsForAttachment function in the email service
 * - Allows testing both regular and malformed ICS data
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

// Interface mirroring server-side IcsFormattingTestResult
interface IcsFormattingTestResult {
  original: string;
  processed: string;
  fixes: string[];
  sequenceFixed: boolean;
  lineBreaksFixed: boolean;
  singleLineFixed: boolean;
  attendeeEmailsFixed: boolean;
  organizerEmailsFixed: boolean;
}

export function IcsFormatTester() {
  const [icsData, setIcsData] = useState<string>('');
  const [eventId, setEventId] = useState<string>('');
  const [useEventId, setUseEventId] = useState<boolean>(false);
  const [sendRealEmails, setSendRealEmails] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<IcsFormattingTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!icsData && !useEventId) {
      setError('Please enter ICS data or provide an event ID');
      return;
    }
    
    if (useEventId && !eventId) {
      setError('Please enter an event ID');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/test-ics-formatting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          icsData: !useEventId ? icsData : undefined,
          eventId: useEventId ? parseInt(eventId, 10) : undefined,
          sendRealEmails,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to test ICS formatting');
        return;
      }
      
      if (sendRealEmails) {
        // If we sent real emails, we get a nested structure
        if (data.testResult) {
          setResult(data.testResult);
          toast({
            title: 'Email sent successfully',
            description: 'A test email was sent with the formatted ICS data',
          });
        } else {
          setResult(data);
        }
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>ICS Format Tester</CardTitle>
        <CardDescription>
          Test the formatting fixes for ICS data used in email attachments
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div className="mb-4 flex items-center space-x-2">
            <Checkbox 
              id="useEventId" 
              checked={useEventId} 
              onCheckedChange={(checked) => setUseEventId(checked as boolean)} 
            />
            <Label htmlFor="useEventId">
              Test using an existing event ID instead of raw ICS data
            </Label>
          </div>
          
          {useEventId ? (
            <div className="mb-4">
              <Label htmlFor="eventId">Event ID</Label>
              <input
                id="eventId"
                type="number"
                className="mt-1 w-full p-2 border rounded-md"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="Enter event ID"
              />
            </div>
          ) : (
            <div className="mb-4">
              <Label htmlFor="icsData">ICS Data</Label>
              <Textarea
                id="icsData"
                value={icsData}
                onChange={(e) => setIcsData(e.target.value)}
                placeholder="Paste raw ICS data here to test formatting fixes"
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
          )}
          
          <div className="mb-4 flex items-center space-x-2">
            <Checkbox 
              id="sendRealEmails" 
              checked={sendRealEmails} 
              onCheckedChange={(checked) => setSendRealEmails(checked as boolean)} 
            />
            <Label htmlFor="sendRealEmails">
              Send test email with formatted ICS attachment
            </Label>
          </div>
          
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <Button type="submit" disabled={loading}>
            {loading ? 'Testing...' : 'Test ICS Formatting'}
          </Button>
        </form>
      </CardContent>
      
      {result && (
        <CardFooter className="flex flex-col items-start">
          <h3 className="text-lg font-semibold mb-2">Results</h3>
          
          {result.fixes.length > 0 ? (
            <div className="mb-4">
              <h4 className="font-medium mb-1">Fixes Applied:</h4>
              <ul className="list-disc pl-5">
                {result.fixes.map((fix, index) => (
                  <li key={index}>{fix}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mb-4">
              <p>No formatting issues detected in the ICS data.</p>
            </div>
          )}
          
          <Tabs defaultValue="before-after" className="w-full">
            <TabsList>
              <TabsTrigger value="before-after">Before/After</TabsTrigger>
              <TabsTrigger value="formatted">Formatted ICS</TabsTrigger>
              <TabsTrigger value="original">Original ICS</TabsTrigger>
            </TabsList>
            
            <TabsContent value="before-after" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-md p-4">
                  <h4 className="font-medium mb-2">Original</h4>
                  <pre className="text-xs overflow-auto max-h-[300px] p-2 bg-gray-100 dark:bg-gray-800 rounded">
                    {result.original}
                  </pre>
                </div>
                <div className="border rounded-md p-4">
                  <h4 className="font-medium mb-2">Processed</h4>
                  <pre className="text-xs overflow-auto max-h-[300px] p-2 bg-gray-100 dark:bg-gray-800 rounded">
                    {result.processed}
                  </pre>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="formatted">
              <pre className="text-xs overflow-auto max-h-[400px] p-3 bg-gray-100 dark:bg-gray-800 rounded">
                {result.processed}
              </pre>
            </TabsContent>
            
            <TabsContent value="original">
              <pre className="text-xs overflow-auto max-h-[400px] p-3 bg-gray-100 dark:bg-gray-800 rounded">
                {result.original}
              </pre>
            </TabsContent>
          </Tabs>
        </CardFooter>
      )}
    </Card>
  );
}