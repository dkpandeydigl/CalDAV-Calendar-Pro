import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useState } from 'react';

interface Attendee {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface Resource {
  id: string;
  subType: string;
  capacity?: number;
  adminEmail: string;
  adminName?: string;
  remarks?: string;
}

interface EmailPreviewData {
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  attendees: Attendee[];
  resources?: Resource[]; // Add resources to preview data
  eventId?: number; // Optional event ID if sending emails for an existing event
  recurrenceRule?: string | object; // Add recurrence rule
}

interface EmailPreviewResponse {
  html: string;
  ics: string;
}

interface SendEmailResponse {
  success: boolean;
  message: string;
  details?: any;
}

export function useEmailPreview() {
  const [previewData, setPreviewData] = useState<EmailPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lastSendResult, setLastSendResult] = useState<SendEmailResponse | null>(null);
  
  const emailPreviewMutation = useMutation({
    mutationFn: async (data: EmailPreviewData) => {
      // Format the dates as ISO strings for the API
      const formattedData = {
        ...data,
        startDate: data.startDate instanceof Date ? data.startDate.toISOString() : data.startDate,
        endDate: data.endDate instanceof Date ? data.endDate.toISOString() : data.endDate,
      };
      
      const response = await apiRequest('POST', '/api/email-preview', formattedData);
      
      if (!response.ok) {
        // Try to parse response as JSON, but handle case where it's not valid JSON (like HTML)
        try {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to generate email preview');
        } catch (jsonError) {
          // If response isn't valid JSON, try to get the text content
          const textContent = await response.text();
          
          // Check if it's an HTML response
          if (textContent.includes('<!DOCTYPE') || textContent.includes('<html')) {
            throw new Error('Server returned HTML instead of JSON. The API endpoint may be experiencing an error.');
          } else {
            throw new Error(`Failed to generate preview: ${textContent.substring(0, 100)}...`);
          }
        }
      }
      
      // Try to parse the response as JSON, with error handling
      try {
        return await response.json() as EmailPreviewResponse;
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        throw new Error('Server returned invalid JSON response');
      }
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewError(null);
    },
    onError: (error) => {
      console.error('Failed to generate email preview:', error);
      setPreviewData(null);
      setPreviewError(error instanceof Error ? error.message : 'An unknown error occurred');
    }
  });
  
  const generatePreview = async (data: EmailPreviewData): Promise<EmailPreviewResponse> => {
    // Validate required fields
    if (!data.title || !data.startDate || !data.endDate || !data.attendees || data.attendees.length === 0) {
      setPreviewError('Required fields missing for email preview');
      return Promise.reject(new Error('Required fields missing for email preview'));
    }
    
    // Clear any previous send results when generating a new preview
    setLastSendResult(null);
    
    // Generate preview and return promise
    try {
      const result = await emailPreviewMutation.mutateAsync(data);
      return result;
    } catch (error) {
      console.error('Email preview generation error:', error);
      throw error;
    }
  };
  
  const clearPreview = () => {
    setPreviewData(null);
    setPreviewError(null);
    setLastSendResult(null);
  };
  
  // Add a mutation for sending emails directly
  const sendEmailMutation = useMutation({
    mutationFn: async (data: EmailPreviewData) => {
      // Format the dates as ISO strings for the API
      const formattedData = {
        ...data,
        startDate: data.startDate instanceof Date ? data.startDate.toISOString() : data.startDate,
        endDate: data.endDate instanceof Date ? data.endDate.toISOString() : data.endDate,
      };
      
      const response = await apiRequest('POST', '/api/send-email', formattedData);
      
      if (!response.ok) {
        // Try to parse response as JSON, but handle case where it's not valid JSON (like HTML)
        try {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to send email');
        } catch (jsonError) {
          // If response isn't valid JSON, try to get the text content
          const textContent = await response.text();
          
          // Check if it's an HTML response
          if (textContent.includes('<!DOCTYPE') || textContent.includes('<html')) {
            throw new Error('Server returned HTML instead of JSON. The API endpoint may be experiencing an error.');
          } else {
            throw new Error(`Failed to send email: ${textContent.substring(0, 100)}...`);
          }
        }
      }
      
      // Try to parse the response as JSON, with error handling
      try {
        return await response.json() as SendEmailResponse;
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        throw new Error('Server returned invalid JSON response');
      }
    },
    onSuccess: (data) => {
      console.log('Email sent successfully:', data);
      setLastSendResult(data);
    },
    onError: (error) => {
      console.error('Failed to send email:', error);
      setLastSendResult({
        success: false,
        message: error instanceof Error ? error.message : 'An unknown error occurred'
      });
    }
  });
  
  // Function to trigger email sending
  const sendEmail = async (data: EmailPreviewData): Promise<SendEmailResponse> => {
    // Validate required fields
    if (!data.title || !data.startDate || !data.endDate || !data.attendees || data.attendees.length === 0) {
      const error = new Error('Required fields missing for sending email');
      setLastSendResult({
        success: false,
        message: error.message
      });
      return Promise.reject(error);
    }
    
    // Send email
    try {
      const result = await sendEmailMutation.mutateAsync(data);
      return result;
    } catch (error) {
      console.error('Email sending error:', error);
      throw error;
    }
  };
  
  return {
    previewData,
    previewError,
    lastSendResult,
    isLoading: emailPreviewMutation.isPending,
    isSending: sendEmailMutation.isPending,
    generatePreview,
    clearPreview,
    sendEmail
  };
}