import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Calendar } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Extended calendar type with permission information
// Import SharedCalendar from our types file
import { SharedCalendar } from '@/types';

export const useSharedCalendars = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Get the current user
  const currentUser = queryClient.getQueryData<any>(['/api/user']);
  const currentUserId = currentUser?.id;
  
  const sharedCalendarsQuery = useQuery<SharedCalendar[]>({
    queryKey: ['/api/shared-calendars', currentUserId], // Include user ID in query key for proper cache management
    // ONLY enable query when we have a user ID to prevent cache from showing wrong data on login/logout
    enabled: !!currentUserId,
    // Add explicit debug logging for request and response
    queryFn: async ({ queryKey }) => {
      const url = queryKey[0] as string;
      
      try {
        // Make the API request
        const response = await fetch(url);
        
        // Handle non-200 responses
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} ${errorText}`);
        }
        
        // Parse the response
        const data = await response.json();
        
        console.log('Raw shared calendars data from server:', JSON.stringify(data, null, 2));
        
        // Ensure owner data is properly populated
        return data.map((calendar: SharedCalendar) => {
          // Enhanced debug logging with raw calendar data
          console.log(`Shared calendar raw data from server:`, calendar);
          
          // Always ensure both permission fields exist for maximum compatibility
          if (calendar.permissionLevel === undefined && calendar.permission !== undefined) {
            console.log(`Setting missing permissionLevel from permission: ${calendar.permission}`);
            calendar.permissionLevel = calendar.permission;
          } else if (calendar.permission === undefined && calendar.permissionLevel !== undefined) {
            console.log(`Setting missing permission from permissionLevel: ${calendar.permissionLevel}`);
            calendar.permission = calendar.permissionLevel;
          }
          
          // If we receive the canEdit property directly from the server, use it to set permissions
          if (calendar.canEdit !== undefined) {
            // Handle both boolean and function canEdit properties
            let isEditable = false;
            
            if (typeof calendar.canEdit === 'boolean') {
              isEditable = calendar.canEdit;
            } else if (typeof calendar.canEdit === 'string') {
              // Legacy code path for string-based canEdit values
              isEditable = calendar.canEdit === 'true';
            } else if (typeof calendar.canEdit === 'function') {
              try {
                isEditable = calendar.canEdit();
              } catch (e) {
                console.error('Error calling canEdit function', e);
                isEditable = false;
              }
            }
            
            console.log(`Server provided canEdit=${typeof calendar.canEdit === 'function' ? 'function' : calendar.canEdit}, 
              evaluated to ${isEditable}, converting to permissionLevel=${isEditable ? 'edit' : 'view'}`);
            
            // Set both permission properties based on the canEdit value
            calendar.permissionLevel = isEditable ? 'edit' : 'view';
            calendar.permission = isEditable ? 'edit' : 'view';
          }
          // CRITICAL FIX: If for some reason no permission information is available, default to 'edit' instead of 'view'
          else if (calendar.permissionLevel === undefined && calendar.permission === undefined) {
            console.log(`Neither permission nor permissionLevel nor canEdit defined, setting defaults to 'edit'`);
            calendar.permissionLevel = 'edit';
            calendar.permission = 'edit';
          }
          
          // CRITICAL FIX: Additional permission normalization to catch more variations
          if (calendar.permissionLevel) {
            const normalizedPerm = calendar.permissionLevel.toString().toLowerCase().trim();
            if (normalizedPerm.includes('edit') || normalizedPerm.includes('write')) {
              console.log(`[Permission Normalization] Found edit/write in permissionLevel value "${calendar.permissionLevel}", normalizing to "edit"`);
              calendar.permissionLevel = 'edit';
              calendar.permission = 'edit';
            }
          }
          
          if (calendar.permission) {
            const normalizedPerm = calendar.permission.toString().toLowerCase().trim();
            if (normalizedPerm.includes('edit') || normalizedPerm.includes('write')) {
              console.log(`[Permission Normalization] Found edit/write in permission value "${calendar.permission}", normalizing to "edit"`);
              calendar.permissionLevel = 'edit';
              calendar.permission = 'edit';
            }
          }
          
          // Debug what we received from the server with detailed permission info
          console.log(`Calendar ${calendar.id} (${calendar.name}) permission data:`, {
            permissionLevel: calendar.permissionLevel,
            permission: calendar.permission,
            sharingId: calendar.sharingId,
            isShared: !!calendar.isShared
          });
          
          // Enhanced debug information to track permission values
          if (calendar.permissionLevel) {
            console.log(`Calendar ${calendar.id} has permissionLevel: ${calendar.permissionLevel}`);
          }
          if (calendar.permission) {
            console.log(`Calendar ${calendar.id} has permission: ${calendar.permission}`);
          }
          // Create a complete owner object
          if (!calendar.owner) {
            // If we don't have an owner object at all, create one with the best available information
            // Create a partial owner object that matches the User type
            calendar.owner = {
              id: calendar.userId || 0,
              username: calendar.ownerEmail || 'Unknown',
              password: '', // Required field but not used in display
              preferredTimezone: null,
              email: calendar.ownerEmail || null,
              fullName: null
            };
          } else if (calendar.owner) {
            // If we have a partial owner object, enhance it with any additional information
            // Make sure the owner has a username
            if (!calendar.owner.username || calendar.owner.username === 'undefined' || calendar.owner.username === 'null') {
              calendar.owner.username = calendar.ownerEmail || `User ${calendar.owner.id || calendar.userId || 0}`;
            }
            
            // Make sure the owner has an email
            if (!calendar.owner.email || calendar.owner.email === 'undefined' || calendar.owner.email === 'null') {
              calendar.owner.email = calendar.ownerEmail || calendar.owner.username;
            }
          }
          
          // Set/update ownerEmail field for backward compatibility and ensuring we always have it
          // Choose the most reliable email source with fallbacks
          if (calendar.owner && calendar.owner.email && calendar.owner.email !== 'undefined' && calendar.owner.email !== 'null') {
            calendar.ownerEmail = calendar.owner.email;
          } else if (calendar.owner && calendar.owner.username && calendar.owner.username.includes('@')) {
            calendar.ownerEmail = calendar.owner.username;
          } else if (calendar.userId) {
            calendar.ownerEmail = `User ${calendar.userId}`;
          } else if (!calendar.ownerEmail || calendar.ownerEmail === 'undefined' || calendar.ownerEmail === 'null') {
            calendar.ownerEmail = calendar.owner && calendar.owner.username ? calendar.owner.username : 'Unknown Owner';
          }
          
          // Ensure enabled property is always set for consistency
          if (calendar.enabled === undefined) {
            calendar.enabled = true;
          }
          
          return calendar;
        });
      } catch (error) {
        throw error;
      }
    },
    // Tanstack Query v5 doesn't support these callbacks directly in the options
    // so we'll use the result object's callbacks instead
  });
  
  // Log errors using effects
  useEffect(() => {
    if (sharedCalendarsQuery.error) {
      console.error("Error loading shared calendars:", sharedCalendarsQuery.error);
    }
  }, [sharedCalendarsQuery.error]);

  // Toggle the visibility (enabled status) of a shared calendar locally
  // without making a server API call
  const toggleCalendarVisibility = (calendarId: number, enabled: boolean) => {
    // Use the queryKey that includes user ID to ensure we're updating the right cache entry
    const queryKey = ['/api/shared-calendars', currentUserId];
    const currentData = queryClient.getQueryData<SharedCalendar[]>(queryKey);
    
    if (!currentData) return;
    
    const updatedData = currentData.map(calendar => 
      calendar.id === calendarId ? { ...calendar, enabled } : calendar
    );
    
    // Update the shared calendars data in cache with proper query key
    queryClient.setQueryData(queryKey, updatedData);
    
    // Since the enabled status affects which events are displayed,
    // we need to invalidate the events query to trigger a re-fetch
    // with the updated enabled calendar IDs
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
  };
  
  // Unshare a single calendar - removes it from the UI immediately
  const unshareCalendarMutation = useMutation({
    mutationFn: async (calendarId: number) => {
      // Build URL with the calendar ID parameter - the server will find the sharing record
      const apiUrl = `/api/calendars/unshare/${calendarId}`;
      await apiRequest('DELETE', apiUrl);
      return calendarId;
    },
    onMutate: async (calendarId) => {
      // Use proper query key with user ID
      const queryKey = ['/api/shared-calendars', currentUserId];
      
      // Cancel any outgoing refetches 
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(queryKey);
      
      // Remove the calendar from the cache immediately
      if (previousSharedCalendars) {
        const removedCalendar = previousSharedCalendars.find(cal => cal.id === calendarId);
        const updatedCalendars = previousSharedCalendars.filter(cal => cal.id !== calendarId);
        
        queryClient.setQueryData(queryKey, updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, removedCalendar, queryKey };
      }
      
      return { previousSharedCalendars };
    },
    onSuccess: (calendarId, _, context) => {
      const removedCalendar = context?.removedCalendar;
      toast({
        title: "Calendar unshared",
        description: removedCalendar ? `You no longer have access to "${removedCalendar.name}"` : "Calendar removed from your view",
      });
    },
    onError: (error, calendarId, context) => {
      // If the mutation fails, use the context we saved to roll back
      if (context?.previousSharedCalendars && context?.queryKey) {
        // Use the saved query key for rollback to ensure we're updating the correct cache entry
        queryClient.setQueryData(context.queryKey, context.previousSharedCalendars);
      }
      
      console.error('Error unsharing calendar:', error);
      toast({
        title: "Error",
        description: "Failed to unshare calendar. Please try again.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Refetch after error or success to ensure server state
      // Use proper query key pattern with user ID
      queryClient.invalidateQueries({ 
        queryKey: ['/api/shared-calendars', currentUserId] 
      });
    }
  });
  
  // Bulk unshare all calendars from a specific owner
  const bulkUnshareCalendarsMutation = useMutation({
    mutationFn: async (calendars: SharedCalendar[]) => {
      // Execute all unshare operations in parallel
      const unsharePromises = calendars.map(calendar => {
        const apiUrl = `/api/calendars/unshare/${calendar.id}`;
        return apiRequest('DELETE', apiUrl);
      });
      
      await Promise.all(unsharePromises);
      return calendars;
    },
    onMutate: async (calendarsToRemove) => {
      // Use proper query key with user ID
      const queryKey = ['/api/shared-calendars', currentUserId];
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(queryKey);
      
      // Get the owner email from the first calendar (they all have the same owner)
      const ownerEmail = calendarsToRemove[0]?.ownerEmail;
      
      // Remove all the calendars from the cache immediately
      if (previousSharedCalendars) {
        const calendarIdsToRemove = new Set(calendarsToRemove.map(cal => cal.id));
        const updatedCalendars = previousSharedCalendars.filter(cal => !calendarIdsToRemove.has(cal.id));
        
        queryClient.setQueryData(queryKey, updatedCalendars);
        
        // Also update events query to reflect the change
        queryClient.invalidateQueries({ queryKey: ['/api/events'] });
        
        return { previousSharedCalendars, ownerEmail, queryKey };
      }
      
      return { previousSharedCalendars };
    },
    onSuccess: (calendars, _, context) => {
      toast({
        title: "Calendars unshared",
        description: context?.ownerEmail 
          ? `You no longer have access to calendars shared by ${context.ownerEmail}` 
          : "Calendars removed from your view",
      });
    },
    onError: (error, _, context) => {
      // If the mutation fails, use the context we saved to roll back
      if (context?.previousSharedCalendars && context?.queryKey) {
        // Use the saved query key for rollback to ensure we're updating the correct cache entry
        queryClient.setQueryData(context.queryKey, context.previousSharedCalendars);
      }
      
      console.error('Error unsharing calendars:', error);
      toast({
        title: "Error",
        description: "Failed to unshare all calendars. Please try again.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Refetch after error or success to ensure server state
      // Use proper query key pattern with user ID
      queryClient.invalidateQueries({ 
        queryKey: ['/api/shared-calendars', currentUserId] 
      });
    }
  });

  // Add permission update mutation
  const updatePermissionMutation = useMutation({
    mutationFn: async (params: { sharingId: number, permissionLevel: 'view' | 'edit' | 'read' | 'write' }) => {
      const { sharingId, permissionLevel } = params;
      
      // CRITICAL FIX: Apply permission normalization for the mutation
      console.log(`[Mutation] Updating permission for sharing ID ${sharingId} to ${permissionLevel}`);
      
      // Normalize permission value to ensure consistent format
      const normalizedPermission = 
        permissionLevel.toLowerCase().includes('edit') || 
        permissionLevel.toLowerCase().includes('write') ? 
        'edit' : 'view';
        
      if (normalizedPermission !== permissionLevel) {
        console.log(`[Mutation] Normalized permission from "${permissionLevel}" to "${normalizedPermission}"`);
      }
      
      const url = `/api/calendar-sharings/${sharingId}`;
      const requestData = { 
        permissionLevel: normalizedPermission,
        permission: normalizedPermission // Include both for backward compatibility
      };
      
      console.log(`[Mutation] Sending permission update request:`, requestData);
      const response = await apiRequest('PATCH', url, requestData);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Mutation] Permission update failed:`, errorText);
        throw new Error(`Failed to update permission: ${errorText}`);
      }
      
      const result = await response.json();
      console.log(`[Mutation] Permission updated successfully:`, result);
      return result;
    },
    onMutate: async ({ sharingId, permissionLevel }) => {
      // Use proper query key with user ID
      const queryKey = ['/api/shared-calendars', currentUserId];
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousSharedCalendars = queryClient.getQueryData<SharedCalendar[]>(queryKey);
      
      // CRITICAL FIX: Normalize permission value consistently for optimistic updates
      // This ensures the UI is immediately consistent with the normalized value being sent to server
      const normalizedPermission = 
        permissionLevel.toLowerCase().includes('edit') || 
        permissionLevel.toLowerCase().includes('write') ? 
        'edit' : 'view';
        
      if (normalizedPermission !== permissionLevel) {
        console.log(`[Optimistic Update] Normalized permission from "${permissionLevel}" to "${normalizedPermission}"`);
      }
      
      // Optimistically update the permission level in the cache with normalized value
      if (previousSharedCalendars) {
        const updatedCalendars = previousSharedCalendars.map(calendar => {
          if (calendar.sharingId === sharingId) {
            const updatedCalendar = { 
              ...calendar, 
              permissionLevel: normalizedPermission,
              permission: normalizedPermission, // Update both fields consistently
            };
            
            // If the calendar uses the canEdit function-based approach, update that to match too
            if (typeof updatedCalendar.canEdit === 'boolean') {
              updatedCalendar.canEdit = normalizedPermission === 'edit';
            }
            
            console.log(`[Optimistic Update] Calendar ${calendar.id} (${calendar.name}) permissions updated:`, {
              previous: {
                permissionLevel: calendar.permissionLevel,
                permission: calendar.permission,
                canEdit: typeof calendar.canEdit === 'boolean' ? calendar.canEdit : 'function'
              },
              updated: {
                permissionLevel: updatedCalendar.permissionLevel,
                permission: updatedCalendar.permission,
                canEdit: typeof updatedCalendar.canEdit === 'boolean' ? updatedCalendar.canEdit : 'function'
              }
            });
            
            return updatedCalendar;
          }
          return calendar;
        });
        
        queryClient.setQueryData(queryKey, updatedCalendars);
        
        // Find the updated calendar for better error messages
        const updatedCalendar = updatedCalendars.find(cal => cal.sharingId === sharingId);
        
        return { 
          previousSharedCalendars, 
          updatedCalendar,
          queryKey,
          permissionLevel: normalizedPermission // Return the normalized value for success message
        };
      }
      
      return { previousSharedCalendars, permissionLevel: normalizedPermission };
    },
    onSuccess: (_, { permissionLevel }, context) => {
      const calendarName = context?.updatedCalendar?.name || 'calendar';
      
      toast({
        title: "Permission updated",
        description: `You now have ${permissionLevel === 'edit' ? 'edit' : 'view-only'} permission for "${calendarName}"`,
      });
    },
    onError: (error, _, context) => {
      // If the mutation fails, use the context we saved to roll back
      if (context?.previousSharedCalendars && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousSharedCalendars);
      }
      
      console.error('Error updating calendar permission:', error);
      toast({
        title: "Error",
        description: "Failed to update calendar permission. Please try again.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Refetch after error or success to ensure server state
      queryClient.invalidateQueries({ 
        queryKey: ['/api/shared-calendars', currentUserId] 
      });
    }
  });

  // Thanks to our strict server-side security filtering, we can now trust the shared calendars directly from the server
  // The server will never send calendars owned by the current user in the shared calendars API
  // This simplifies our client-side logic and prevents bugs
  const filteredSharedCalendars = (sharedCalendarsQuery.data || []).map(calendar => {
    // Add the canEdit method to each calendar for consistent permission checking
    // This addresses the inconsistency where some parts of the app use permissionLevel
    // and others use permission
    // Create a function to check edit permissions if it doesn't already exist as a boolean
    // Use a regular function (not an arrow function) to keep 'this' context
    if (typeof calendar.canEdit !== 'boolean') {
      calendar.canEdit = function(this: SharedCalendar): boolean {
        // If the current user is the owner of the calendar, they always have edit permissions
        // This check takes priority over all others
        if (currentUserId && this.userId === currentUserId) {
          console.log(`[PERMISSION CHECK] Calendar ID ${this.id}, name: ${this.name} - USER IS OWNER, FULL EDIT PERMISSIONS`);
          return true;
        }
        
        // Check all possible permission field representations
        // Different parts of the API use different field names
        const permissionLevel = this.permissionLevel || '';
        const permission = this.permission || '';
        
        // Ensure we have at least one permission field value
        if (!permissionLevel && !permission) {
          console.log(`[PERMISSION CHECK] Calendar ID ${this.id}, name: ${this.name} - NO PERMISSION VALUES FOUND`);
          return false;
        }
        
        console.log(`[PERMISSION CHECK] Calendar ID ${this.id}, name: ${this.name}`);
        console.log(`[PERMISSION CHECK] permissionLevel="${permissionLevel}", permission="${permission}"`);
        
        // Examine sharingDebug data if available
        if (this._sharingDebug) {
          console.log(`[PERMISSION CHECK] Debug info for ${this.id}:`, this._sharingDebug);
        }

        // Function to normalize and check if a permission value indicates edit access
        const isEditPermission = (val: string): boolean => {
          if (!val) return false;
          const normalized = val.toLowerCase().trim();
          
          // Check for various edit permission formats
          return [
            'edit', 'write', 'readwrite', 'read-write', 
            'modify', 'rw', 'true', '1', 'yes'
          ].includes(normalized);
        };
        
        // Check both permission fields using the helper function
        const hasEditPermission = isEditPermission(permissionLevel) || isEditPermission(permission);
        
        console.log(`[PERMISSION CHECK] hasEditPermission=${hasEditPermission}`);
        return hasEditPermission;
      };
    }
    
    return calendar;
  });
  
  // Add debug logging to identify permission levels
  useEffect(() => {
    if (filteredSharedCalendars.length > 0) {
      console.log('Shared calendars with permission levels:', 
        filteredSharedCalendars.map(cal => ({
          id: cal.id,
          name: cal.name,
          permissionLevel: cal.permissionLevel,
          permission: cal.permission || cal.permissionLevel, // Check both fields
          canEdit: typeof cal.canEdit === 'boolean' ? cal.canEdit : 
                   (typeof cal.canEdit === 'function' ? cal.canEdit() :
                   (cal.permission ? ['edit', 'write'].includes(cal.permission) : 
                   ['edit', 'write'].includes(cal.permissionLevel || '')))
        }))
      );
    }
  }, [filteredSharedCalendars]);

  return {
    sharedCalendars: filteredSharedCalendars,
    isLoading: sharedCalendarsQuery.isLoading,
    error: sharedCalendarsQuery.error,
    toggleCalendarVisibility,
    unshareCalendar: unshareCalendarMutation.mutate,
    isUnsharing: unshareCalendarMutation.isPending,
    bulkUnshareCalendars: bulkUnshareCalendarsMutation.mutate,
    isBulkUnsharing: bulkUnshareCalendarsMutation.isPending,
    // Add the new permission update mutation
    updatePermission: updatePermissionMutation.mutate,
    isUpdatingPermission: updatePermissionMutation.isPending
  };
};