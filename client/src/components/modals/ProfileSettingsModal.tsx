import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { updateUserFullName, apiRequest } from '@/lib/api';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFullName: string | undefined;
}

export function ProfileSettingsModal({ isOpen, onClose, currentFullName }: ProfileSettingsModalProps) {
  const [fullName, setFullName] = useState(currentFullName || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Update fullName state when currentFullName prop changes or when modal opens
  useEffect(() => {
    if (isOpen) {
      // Fetch fresh user data when modal opens
      const fetchCurrentUser = async () => {
        try {
          const response = await apiRequest('GET', '/api/user');
          
          if (response.ok) {
            const userData = await response.json();
            if (userData && userData.fullName) {
              console.log('Updated full name from server:', userData.fullName);
              setFullName(userData.fullName);
            }
          }
        } catch (error) {
          console.error('Error fetching current user data:', error);
        }
      };
      
      fetchCurrentUser();
    }
  }, [isOpen]);
  
  // Also update when the prop changes (fallback)
  useEffect(() => {
    if (currentFullName) {
      setFullName(currentFullName);
    }
  }, [currentFullName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fullName.trim()) {
      toast({
        title: 'Error',
        description: 'Full name cannot be empty',
        variant: 'destructive',
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      await updateUserFullName(fullName);
      
      // Invalidate user data to refresh it
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      
      toast({
        title: 'Success',
        description: 'Your full name has been updated successfully',
        variant: 'default',
      });
      
      onClose();
    } catch (error) {
      console.error('Failed to update full name:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update full name',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
          <DialogDescription>
            Update your profile information. Your full name will be used when sending emails.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fullName" className="text-right">
                Full Name
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="col-span-3"
                placeholder="Your full name"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}