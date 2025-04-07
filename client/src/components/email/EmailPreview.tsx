import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, AlertCircle, RefreshCw, Mail } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface EmailPreviewProps {
  isLoading: boolean;
  isSending?: boolean;
  error: string | null;
  html: string | null;
  onRefresh: () => void;
  onSend?: () => void;
  showSendButton?: boolean;
}

const EmailPreview: React.FC<EmailPreviewProps> = ({
  isLoading,
  isSending = false,
  error,
  html,
  onRefresh,
  onSend,
  showSendButton = false
}) => {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-center text-muted-foreground">Generating email preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertCircle className="h-4 w-4 mr-2" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {error}
          <div className="mt-4">
            <Button 
              size="sm" 
              variant="outline"
              onClick={onRefresh}
              className="mt-2"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (!html) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-4">
          Fill in event details and add at least one attendee to see email preview
        </p>
        <Button 
          size="sm" 
          variant="outline"
          onClick={onRefresh}
          className="mt-2"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Generate Preview
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Email Preview</h3>
        <div className="flex space-x-2">
          <Button 
            size="sm" 
            variant="outline"
            onClick={onRefresh}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          
          {showSendButton && onSend && (
            <Button 
              size="sm" 
              variant="default"
              onClick={onSend}
              disabled={isSending}
              className="min-w-[100px]"
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Now
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      
      <Separator className="my-4" />
      
      <Card className="p-0 overflow-hidden border">
        <div 
          className="preview-container p-4 max-h-[500px] overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Card>
      
      <Alert className="mt-4 bg-primary/10 border-primary/20">
        <AlertDescription>
          This is a preview of the email that will be sent to attendees when you create this event.
          Attendees will receive this email along with an iCalendar (.ics) file attachment.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default EmailPreview;