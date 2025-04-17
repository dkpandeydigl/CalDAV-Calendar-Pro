import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function CancellationTest() {
  const [icsInput, setIcsInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleTest() {
    if (!icsInput) {
      toast({
        title: 'Missing ICS Data',
        description: 'Please provide ICS data to test the fix',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/test-organizer-fix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ icsData: icsInput }),
      });

      const data = await response.json();
      setResult(data);

      if (data.success) {
        toast({
          title: 'Test Completed',
          description: 'Organizer fix test completed successfully',
        });
      } else {
        toast({
          title: 'Test Failed',
          description: data.error || 'Unknown error occurred',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error testing organizer fix:', error);
      toast({
        title: 'Error',
        description: 'Failed to test the organizer fix',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Test ICS Cancellation Organizer Fix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ics-input">ICS Data with Organizer Issue</Label>
              <Textarea
                id="ics-input"
                value={icsInput}
                onChange={(e) => setIcsInput(e.target.value)}
                placeholder="Paste the problematic ICS data here..."
                className="h-40 font-mono text-sm"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleTest} disabled={loading}>
            {loading ? 'Testing...' : 'Test Organizer Fix'}
          </Button>
        </CardFooter>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Original Organizer Section */}
              <div>
                <h3 className="font-semibold mb-2">Original Organizer Line:</h3>
                <div className="bg-muted p-2 rounded overflow-auto max-h-24 font-mono text-xs">
                  {result.legacyImplementation?.organizer || 'Not found'}
                </div>
              </div>

              {/* Fixed Organizer Section */}
              <div>
                <h3 className="font-semibold mb-2">Fixed Organizer Line:</h3>
                <div className="bg-muted p-2 rounded overflow-auto max-h-24 font-mono text-xs">
                  {result.fixedImplementation?.organizer || 'Not found'}
                </div>
              </div>
              
              <Separator />
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold mb-2">Legacy Implementation:</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Method:</span>
                      <Badge variant="outline">{result.legacyImplementation?.method}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Status:</span>
                      <Badge variant="outline">{result.legacyImplementation?.status}</Badge>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold mb-2">Fixed Implementation:</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Method:</span>
                      <Badge variant="outline">{result.fixedImplementation?.method}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Status:</span>
                      <Badge variant="outline">{result.fixedImplementation?.status}</Badge>
                    </div>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="font-semibold mb-2">Full ICS Output (Fixed):</h3>
                <Textarea 
                  readOnly
                  value={result.fixedImplementation?.ics || ''}
                  className="h-60 font-mono text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}