import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ResourceTestPage() {
  const [resources, setResources] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newResource, setNewResource] = useState({
    name: 'Conference Room A',
    type: 'Room',
    capacity: '10',
    adminName: 'Building Manager',
    adminEmail: 'manager@example.com',
    remarks: 'Has projector and whiteboard'
  });
  const [eventData, setEventData] = useState<string>('');
  const { toast } = useToast();

  // Fetch existing resources
  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/resources');
      if (response.ok) {
        const data = await response.json();
        setResources(data);
      } else {
        toast({
          title: 'Error fetching resources',
          description: 'Could not load resources from server',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error fetching resources:', error);
      toast({
        title: 'Connection error',
        description: 'Could not connect to the server',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewResource(prev => ({ ...prev, [name]: value }));
  };

  const createTestEvent = async () => {
    setIsLoading(true);
    try {
      // Create a simple test event with a resource
      const event = {
        title: 'Test Event with Resource X-Properties',
        description: 'This event tests the resource metadata preservation with X-Properties',
        startDate: new Date(Date.now() + 3600000), // 1 hour from now
        endDate: new Date(Date.now() + 7200000),   // 2 hours from now
        location: 'Test Location',
        calendarId: 1, // Replace with your actual calendar ID
        resources: [{
          name: newResource.name,
          type: newResource.type,
          capacity: parseInt(newResource.capacity),
          adminName: newResource.adminName,
          adminEmail: newResource.adminEmail,
          remarks: newResource.remarks
        }]
      };

      const response = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      if (response.ok) {
        const createdEvent = await response.json();
        toast({
          title: 'Event created',
          description: 'Event with resource X-properties created successfully'
        });
        
        // Fetch the raw ICS data for the event
        const icsResponse = await fetch(`/api/events/${createdEvent.id}/ics`);
        if (icsResponse.ok) {
          const icsData = await icsResponse.text();
          setEventData(icsData);
        }
      } else {
        toast({
          title: 'Failed to create event',
          description: 'Could not create test event',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error creating test event:', error);
      toast({
        title: 'Error',
        description: 'An error occurred while creating the test event',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Resource X-Properties Test</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Create Test Resource</CardTitle>
            <CardDescription>
              Fill out the form to create a test resource with X-properties
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Resource Name</Label>
                  <Input 
                    id="name" 
                    name="name" 
                    value={newResource.name}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Resource Type</Label>
                  <Input 
                    id="type" 
                    name="type" 
                    value={newResource.type}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="capacity">Capacity</Label>
                  <Input 
                    id="capacity" 
                    name="capacity" 
                    type="number" 
                    value={newResource.capacity}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminName">Admin Name</Label>
                  <Input 
                    id="adminName" 
                    name="adminName" 
                    value={newResource.adminName}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="adminEmail">Admin Email</Label>
                <Input 
                  id="adminEmail" 
                  name="adminEmail" 
                  type="email" 
                  value={newResource.adminEmail}
                  onChange={handleInputChange}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="remarks">Notes/Remarks</Label>
                <Textarea 
                  id="remarks" 
                  name="remarks" 
                  value={newResource.remarks}
                  onChange={handleInputChange}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              onClick={createTestEvent}
              disabled={isLoading}
            >
              {isLoading ? 'Creating...' : 'Create Test Event with Resource'}
            </Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Generated ICS Data</CardTitle>
            <CardDescription>
              View the raw ICS data with X-properties
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] w-full border rounded-md p-2 bg-slate-50 dark:bg-slate-900">
              <pre className="text-xs font-mono whitespace-pre-wrap">{eventData || 'No event data yet. Create a test event first.'}</pre>
            </ScrollArea>
          </CardContent>
          <CardFooter>
            <div className="flex items-center space-x-2">
              {eventData && (
                <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                  ICS Generated Successfully
                </Badge>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}