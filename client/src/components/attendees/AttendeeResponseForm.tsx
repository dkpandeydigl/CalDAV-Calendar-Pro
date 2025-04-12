import React, { useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { TimePicker } from '@/components/ui/time-picker';
import { TiptapEditorEditor } from '@/components/ui/tiptap';
import { CheckCircle, XCircle, HelpCircle, Calendar as CalendarIcon, Clock, MessageSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { formatDayOfWeekDate, formatTime } from '@/lib/date-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// Schema for the form
const responseSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']),
  comment: z.string().optional(),
  proposedStart: z.date().optional(),
  proposedEnd: z.date().optional(),
});

type ResponseFormData = z.infer<typeof responseSchema>;

interface AttendeeResponseFormProps {
  eventId: number;
  eventTitle: string;
  eventStart: Date;
  eventEnd: Date;
  organizer?: { name?: string; email: string };
  currentUserEmail: string;
  onResponseSuccess?: () => void;
}

const AttendeeResponseForm: React.FC<AttendeeResponseFormProps> = ({
  eventId,
  eventTitle,
  eventStart,
  eventEnd,
  organizer,
  currentUserEmail,
  onResponseSuccess
}) => {
  const { toast } = useToast();
  const [isFullScreenMode, setIsFullScreenMode] = useState(false);
  const [showTimeProposal, setShowTimeProposal] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [previewingNote, setPreviewingNote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Initialize the form
  const form = useForm<ResponseFormData>({
    resolver: zodResolver(responseSchema),
    defaultValues: {
      status: 'ACCEPTED',
      comment: '',
      proposedStart: new Date(eventStart),
      proposedEnd: new Date(eventEnd)
    }
  });
  
  // Helper function to replace template tags
  const replaceTemplateTags = (text: string) => {
    return text
      .replace(/\{\{organizer_name\}\}/g, organizer?.name || 'Organizer')
      .replace(/\{\{start_time\}\}/g, `${format(new Date(eventStart), 'EEEE, MMMM d, yyyy h:mm a')}`)
      .replace(/\{\{end_time\}\}/g, `${format(new Date(eventEnd), 'EEEE, MMMM d, yyyy h:mm a')}`)
      .replace(/\{\{event_title\}\}/g, eventTitle);
  };
  
  // Handle form submission
  const onSubmit = async (data: ResponseFormData) => {
    setIsSubmitting(true);
    
    try {
      // Process template tags in comment
      if (data.comment) {
        data.comment = replaceTemplateTags(data.comment);
      }
      
      // Submit the response to the server
      await apiRequest({
        url: `/api/events/${eventId}/respond`,
        method: 'POST',
        data
      });
      
      // Invalidate event queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      
      // Show success message
      toast({
        title: 'Response Sent',
        description: `You've ${data.status.toLowerCase()} the event.`,
        variant: 'default',
      });
      
      // Call the success callback if provided
      if (onResponseSuccess) {
        onResponseSuccess();
      }
      
      // Reset the form
      form.reset();
      setShowTimeProposal(false);
      setShowComment(false);
    } catch (error) {
      console.error('Error sending response:', error);
      toast({
        title: 'Error',
        description: 'Failed to send your response. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Status button styling based on selected status
  const getButtonStyle = (status: string) => {
    const baseStyle = "flex items-center gap-2 flex-1";
    const selected = form.watch('status');
    
    if (selected === status) {
      switch (status) {
        case 'ACCEPTED':
          return `${baseStyle} bg-green-100 border-green-500 text-green-700`;
        case 'DECLINED':
          return `${baseStyle} bg-red-100 border-red-500 text-red-700`;
        case 'TENTATIVE':
          return `${baseStyle} bg-amber-100 border-amber-500 text-amber-700`;
        default:
          return baseStyle;
      }
    }
    
    return baseStyle;
  };
  
  // Compact mode component
  const CompactResponseForm = () => (
    <Card>
      <CardHeader>
        <CardTitle>Going?</CardTitle>
        <CardDescription>
          Respond to the invitation for "{eventTitle}"
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex gap-2 mb-4">
              <Button
                type="button"
                variant="outline"
                className={getButtonStyle('ACCEPTED')}
                onClick={() => form.setValue('status', 'ACCEPTED')}
              >
                <CheckCircle className="h-5 w-5" /> Yes
              </Button>
              <Button
                type="button"
                variant="outline"
                className={getButtonStyle('TENTATIVE')}
                onClick={() => form.setValue('status', 'TENTATIVE')}
              >
                <HelpCircle className="h-5 w-5" /> Maybe
              </Button>
              <Button
                type="button"
                variant="outline"
                className={getButtonStyle('DECLINED')}
                onClick={() => form.setValue('status', 'DECLINED')}
              >
                <XCircle className="h-5 w-5" /> No
              </Button>
            </div>

            <div className="space-y-2">
              {showComment && (
                <FormField
                  control={form.control}
                  name="comment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Add a note</FormLabel>
                      <FormControl>
                        <div className="border rounded-md">
                          <TiptapEditor 
                            content={field.value || ''} 
                            onChange={field.onChange}
                            placeholder="Add a note to your response..."
                          />
                        </div>
                      </FormControl>
                      <div className="text-xs text-muted-foreground mt-1">
                        Use tags like &#123;&#123;organizer_name&#125;&#125;, &#123;&#123;start_time&#125;&#125;, &#123;&#123;event_title&#125;&#125;
                        <Button 
                          type="button" 
                          variant="link" 
                          size="sm" 
                          className="ml-1 p-0 h-auto" 
                          onClick={() => {
                            setPreviewingNote(true);
                          }}
                        >
                          Preview
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              
              {showTimeProposal && (
                <>
                  <FormField
                    control={form.control}
                    name="proposedStart"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Propose start time</FormLabel>
                        <div className="flex items-center gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="flex-1">
                                <CalendarIcon className="h-4 w-4 mr-2" />
                                {format(field.value || new Date(), 'PPP')}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <TimePicker 
                            date={field.value}
                            setDate={field.onChange}
                          />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="proposedEnd"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Propose end time</FormLabel>
                        <div className="flex items-center gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="flex-1">
                                <CalendarIcon className="h-4 w-4 mr-2" />
                                {format(field.value || new Date(), 'PPP')}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <TimePicker 
                            date={field.value}
                            setDate={field.onChange}
                          />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </div>
            
            <div className="pt-2 flex justify-between items-center">
              <div className="flex space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTimeProposal(!showTimeProposal)}
                  className={showTimeProposal ? "bg-blue-100 border-blue-500 text-blue-700" : ""}
                >
                  <Clock className="h-4 w-4 mr-1" />
                  {showTimeProposal ? 'Hide time proposal' : 'Propose new time'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowComment(!showComment)}
                  className={showComment ? "bg-blue-100 border-blue-500 text-blue-700" : ""}
                >
                  <MessageSquare className="h-4 w-4 mr-1" />
                  {showComment ? 'Hide note' : 'Add a note'}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsFullScreenMode(true)}
              >
                Expand
              </Button>
            </div>
            
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Submit Response'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
  
  // Preview dialog for comment with template tags replaced
  const CommentPreviewDialog = () => (
    <Dialog open={previewingNote} onOpenChange={setPreviewingNote}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Comment Preview</DialogTitle>
        </DialogHeader>
        <div 
          className="prose prose-sm max-w-none mt-2" 
          dangerouslySetInnerHTML={{ 
            __html: replaceTemplateTags(form.watch('comment') || '') 
          }} 
        />
      </DialogContent>
    </Dialog>
  );
  
  // Fullscreen modal component
  const FullScreenResponseForm = () => (
    <Dialog open={isFullScreenMode} onOpenChange={setIsFullScreenMode}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Respond to Invitation</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <div className="border rounded-md p-4 bg-muted/30">
                <h3 className="font-medium text-lg">{eventTitle}</h3>
                <p className="text-sm text-muted-foreground">
                  {formatDayOfWeekDate(new Date(eventStart))}
                </p>
                <p className="text-sm">
                  {formatTime(new Date(eventStart))} - {formatTime(new Date(eventEnd))}
                </p>
                {organizer && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Organized by: {organizer.name || organizer.email}
                  </p>
                )}
              </div>
              
              <div>
                <h3 className="text-sm font-medium mb-2">Your response:</h3>
                <Tabs defaultValue="response" className="w-full">
                  <TabsList className="grid grid-cols-3 mb-4">
                    <TabsTrigger value="response" className="text-sm">Status</TabsTrigger>
                    <TabsTrigger value="time" className="text-sm">Time Proposal</TabsTrigger>
                    <TabsTrigger value="note" className="text-sm">Add Note</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="response" className="space-y-4">
                    <div className="flex flex-col gap-3">
                      <Button
                        type="button"
                        variant={form.watch('status') === 'ACCEPTED' ? 'default' : 'outline'}
                        className="flex justify-start items-center gap-3 h-12"
                        onClick={() => form.setValue('status', 'ACCEPTED')}
                      >
                        <CheckCircle className={`h-5 w-5 ${form.watch('status') === 'ACCEPTED' ? 'text-white' : 'text-green-500'}`} />
                        <div className="text-left">
                          <div className={`font-medium ${form.watch('status') === 'ACCEPTED' ? 'text-white' : ''}`}>Yes, I'll attend</div>
                          <div className={`text-xs ${form.watch('status') === 'ACCEPTED' ? 'text-white/80' : 'text-muted-foreground'}`}>Accept this invitation</div>
                        </div>
                      </Button>
                      
                      <Button
                        type="button"
                        variant={form.watch('status') === 'TENTATIVE' ? 'default' : 'outline'}
                        className="flex justify-start items-center gap-3 h-12"
                        onClick={() => form.setValue('status', 'TENTATIVE')}
                      >
                        <HelpCircle className={`h-5 w-5 ${form.watch('status') === 'TENTATIVE' ? 'text-white' : 'text-amber-500'}`} />
                        <div className="text-left">
                          <div className={`font-medium ${form.watch('status') === 'TENTATIVE' ? 'text-white' : ''}`}>Maybe</div>
                          <div className={`text-xs ${form.watch('status') === 'TENTATIVE' ? 'text-white/80' : 'text-muted-foreground'}`}>Tentatively accept this invitation</div>
                        </div>
                      </Button>
                      
                      <Button
                        type="button"
                        variant={form.watch('status') === 'DECLINED' ? 'default' : 'outline'}
                        className="flex justify-start items-center gap-3 h-12"
                        onClick={() => form.setValue('status', 'DECLINED')}
                      >
                        <XCircle className={`h-5 w-5 ${form.watch('status') === 'DECLINED' ? 'text-white' : 'text-red-500'}`} />
                        <div className="text-left">
                          <div className={`font-medium ${form.watch('status') === 'DECLINED' ? 'text-white' : ''}`}>No, I can't attend</div>
                          <div className={`text-xs ${form.watch('status') === 'DECLINED' ? 'text-white/80' : 'text-muted-foreground'}`}>Decline this invitation</div>
                        </div>
                      </Button>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="time" className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      If the proposed time doesn't work for you, suggest a new time:
                    </p>
                    
                    <FormField
                      control={form.control}
                      name="proposedStart"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Proposed start time</FormLabel>
                          <div className="flex items-center gap-2">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="flex-1">
                                  <CalendarIcon className="h-4 w-4 mr-2" />
                                  {format(field.value || new Date(), 'PPP')}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <TimePicker 
                              date={field.value}
                              setDate={field.onChange}
                            />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="proposedEnd"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Proposed end time</FormLabel>
                          <div className="flex items-center gap-2">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="flex-1">
                                  <CalendarIcon className="h-4 w-4 mr-2" />
                                  {format(field.value || new Date(), 'PPP')}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <TimePicker 
                              date={field.value}
                              setDate={field.onChange}
                            />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                  
                  <TabsContent value="note" className="space-y-4">
                    <FormField
                      control={form.control}
                      name="comment"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Add a note to your response</FormLabel>
                          <FormControl>
                            <div className="border rounded-md">
                              <TiptapEditor 
                                content={field.value || ''} 
                                onChange={field.onChange}
                                placeholder="Add a note to your response..."
                              />
                            </div>
                          </FormControl>
                          <div className="text-xs text-muted-foreground mt-1">
                            Available template tags: 
                            <ul className="list-disc list-inside mt-1">
                              <li>&#123;&#123;organizer_name&#125;&#125; - Name of the event organizer</li>
                              <li>&#123;&#123;start_time&#125;&#125; - Start time of the event</li>
                              <li>&#123;&#123;end_time&#125;&#125; - End time of the event</li>
                              <li>&#123;&#123;event_title&#125;&#125; - Title of the event</li>
                            </ul>
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="sm" 
                              className="mt-2" 
                              onClick={() => {
                                setPreviewingNote(true);
                              }}
                            >
                              Preview with tags replaced
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFullScreenMode(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending...' : 'Submit Response'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
  
  return (
    <>
      <CompactResponseForm />
      <FullScreenResponseForm />
      <CommentPreviewDialog />
    </>
  );
};

export default AttendeeResponseForm;