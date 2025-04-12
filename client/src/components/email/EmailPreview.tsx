import React, { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, AlertCircle, RefreshCw, Mail, CheckCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface EmailPreviewProps {
  isLoading: boolean;
  isSending?: boolean;
  error: string | null;
  html: string | null;
  onRefresh: () => void;
  onSend?: () => void;
  showSendButton?: boolean;
  lastSendResult?: { success: boolean; message: string } | null;
}

const EmailPreview: React.FC<EmailPreviewProps> = ({
  isLoading,
  isSending = false,
  error,
  html,
  onRefresh,
  onSend,
  showSendButton = false,
  lastSendResult = null
}) => {
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  // Show success message when sending is complete and successful
  React.useEffect(() => {
    if (lastSendResult?.success && !isSending) {
      setShowSuccessMessage(true);
      // Auto-hide the success message after 5 seconds
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [lastSendResult, isSending]);

  if (isLoading) {
    return (
      <div className="flex flex-col lg:flex-row gap-4 min-h-[400px]">
        <div className="w-full flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4 mx-auto" />
            <p className="text-center text-muted-foreground">Generating email preview...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="w-full">
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
        </div>
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex flex-col lg:flex-row gap-4 min-h-[400px]">
        <div className="w-full flex items-center justify-center py-12 text-center">
          <div>
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Left column: Controls and Information */}
      <div className="w-full lg:w-1/3 space-y-4">
        <div className="flex flex-col space-y-4">
          <h3 className="text-lg font-medium text-primary">Email Preview</h3>
          
          <div className="flex flex-wrap gap-2">
            <Button 
              size="sm" 
              variant="outline"
              onClick={onRefresh}
              className="border-primary/30 hover:border-primary"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            
            {showSendButton && onSend && (
              <Button 
                size="sm" 
                variant="default"
                onClick={onSend}
                disabled={isSending || showSuccessMessage}
                className={`min-w-[100px] ${showSuccessMessage ? "bg-green-600 hover:bg-green-700" : "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"}`}
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : showSuccessMessage ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Sent!
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
          
          {lastSendResult && (
            <Alert 
              variant={lastSendResult.success ? "default" : "destructive"}
              className={`${lastSendResult.success ? "bg-green-50 border-green-200" : ""}`}
            >
              {lastSendResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
              ) : (
                <AlertCircle className="h-4 w-4 mr-2" />
              )}
              <AlertTitle>{lastSendResult.success ? "Success" : "Failed to Send"}</AlertTitle>
              <AlertDescription>
                {lastSendResult.message}
              </AlertDescription>
            </Alert>
          )}
          
          <Alert className="bg-primary/10 border-primary/20">
            <AlertDescription>
              This is a preview of the email that will be sent to attendees when you create this event.
              Attendees will receive this email along with an iCalendar (.ics) file attachment.
            </AlertDescription>
          </Alert>
        </div>
      </div>
      
      {/* Vertical separator for desktop */}
      <div className="hidden lg:block">
        <div className="w-px h-full bg-border"></div>
      </div>
      
      {/* Horizontal separator for mobile */}
      <Separator className="block lg:hidden my-2" />
      
      {/* Right column: Email Content Preview */}
      <div className="w-full lg:w-2/3">
        <Card className="p-0 overflow-hidden border shadow-sm h-full">
          <div 
            className="preview-container p-6 max-h-[600px] overflow-auto w-full"
            dangerouslySetInnerHTML={{ __html: html }}
            style={{ 
              fontFamily: "'Segoe UI', 'Arial', sans-serif",
              fontSize: "14px",
              lineHeight: "1.6",
              color: "#333",
              wordBreak: "break-word",
              whiteSpace: "normal"
            }}
          />
        </Card>
      </div>
    </div>
  );
};

export default EmailPreview;