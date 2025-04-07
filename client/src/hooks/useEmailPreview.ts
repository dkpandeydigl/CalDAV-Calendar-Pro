import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useState } from 'react';

interface Attendee {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface EmailPreviewData {
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  attendees: Attendee[];
}

interface EmailPreviewResponse {
  html: string;
  ics: string;
}

export function useEmailPreview() {
  const [previewData, setPreviewData] = useState<EmailPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
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
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate email preview');
      }
      
      return await response.json() as EmailPreviewResponse;
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
  
  const generatePreview = (data: EmailPreviewData) => {
    // Validate required fields
    if (!data.title || !data.startDate || !data.endDate || !data.attendees || data.attendees.length === 0) {
      setPreviewError('Required fields missing for email preview');
      return;
    }
    
    // Generate preview
    emailPreviewMutation.mutate(data);
  };
  
  const clearPreview = () => {
    setPreviewData(null);
    setPreviewError(null);
  };
  
  return {
    previewData,
    previewError,
    isLoading: emailPreviewMutation.isPending,
    generatePreview,
    clearPreview
  };
}