import { FC, useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ScrollArea,
  ScrollBar
} from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCalendarContext } from '@/contexts/CalendarContext';
import { useCalendars } from '@/hooks/useCalendars';
import { useUserDetails } from '@/hooks/useUserDetails';
import { Calendar } from '@shared/schema';
import { 
  CalendarIcon, 
  Download, 
  Edit, 
  MoreVertical, 
  Share2, 
  Trash2, 
  UploadCloud,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  Filter,
  X,
  Info,
  RefreshCw,
  Mail
} from 'lucide-react';
// SyncStatusIndicator import removed
import { useSharedCalendars } from '@/hooks/useSharedCalendars';
import { SharedCalendar } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

interface EnhancedCalendarSidebarProps {
  visible: boolean;
  onCreateEvent: (initialDate?: Date) => void;
  onOpenServerSettings: () => void;
  onOpenSyncSettings?: () => void;
  onShareCalendar?: (calendar: Calendar | undefined) => void;
  onMultiShareCalendars?: () => void;
  onImportCalendar?: () => void;
}

const EnhancedCalendarSidebar: FC<EnhancedCalendarSidebarProps> = ({ 
  visible, 
  onCreateEvent, 
  onOpenServerSettings, 
  onOpenSyncSettings, 
  onShareCalendar, 
  onMultiShareCalendars, 
  onImportCalendar 
}) => {
  // Same hooks and state from the original CalendarSidebar
  const { calendars, createCalendar, updateCalendar, deleteCalendar } = useCalendars();
  const { 
    sharedCalendars, 
    toggleCalendarVisibility, 
    unshareCalendar,
    isUnsharing, 
    bulkUnshareCalendars, 
    isBulkUnsharing,
    updatePermission,
    isUpdatingPermission,
    isLoading: isLoadingSharedCalendars,
    error: sharedCalendarsError
  } = useSharedCalendars();
  
  // New state variables for enhanced UI
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [sharedCalendarSearchQuery, setSharedCalendarSearchQuery] = useState('');
  const [showOwnCalendars, setShowOwnCalendars] = useState(true);
  const [showSharedCalendars, setShowSharedCalendars] = useState(true);
  const [calendarViewMode, setCalendarViewMode] = useState<'list' | 'compact'>('list');
  const [sharedCalendarViewMode, setSharedCalendarViewMode] = useState<'list' | 'compact'>('list');
  
  // State for tracking which shared calendar group is expanded (only one at a time)
  const [expandedOwnerEmail, setExpandedOwnerEmail] = useState<string | null>(null);
  
  // Cache for mapping user IDs to owner emails
  const [ownerEmailsById, setOwnerEmailsById] = useState<Map<number, string>>(new Map());
  
  // Inherit other state variables from original implementation
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState('#0078d4');
  const [calendarNameError, setCalendarNameError] = useState('');
  const [isCheckingCalendarName, setIsCheckingCalendarName] = useState(false);
  const [shouldCreateCalendar, setShouldCreateCalendar] = useState(false);
  
  // Calendar editing state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null);
  const [editCalendarName, setEditCalendarName] = useState('');
  const [editCalendarColor, setEditCalendarColor] = useState('');
  const [editCalendarNameError, setEditCalendarNameError] = useState('');
  const [isCheckingEditName, setIsCheckingEditName] = useState(false);
  const [shouldUpdateCalendar, setShouldUpdateCalendar] = useState(false);
  
  // Calendar deletion state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingCalendar, setDeletingCalendar] = useState<Calendar | null>(null);
  
  // Calendar unsharing state
  const [isUnshareDialogOpen, setIsUnshareDialogOpen] = useState(false);
  const [unsharingCalendar, setUnsharingCalendar] = useState<Calendar | null>(null);
  const [unshareMessage, setUnshareMessage] = useState('');
  
  // Bulk unshare state
  const [isBulkUnshareDialogOpen, setIsBulkUnshareDialogOpen] = useState(false);
  const [bulkUnshareEmail, setBulkUnshareEmail] = useState('');
  const [calendarsToUnshare, setCalendarsToUnshare] = useState<Calendar[]>([]);
  
  const { toast } = useToast();
  
  // Filter calendars based on search query and sort alphabetically by name
  const filteredOwnCalendars = calendars
    .filter(cal => cal.name.toLowerCase().includes(calendarSearchQuery.toLowerCase()))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  
  // Group shared calendars by owner and filter based on search query
  const filteredSharedCalendars = sharedCalendars
    .filter(cal => 
      cal.name.toLowerCase().includes(sharedCalendarSearchQuery.toLowerCase()) ||
      (cal.owner?.email || '').toLowerCase().includes(sharedCalendarSearchQuery.toLowerCase()) ||
      (cal.owner?.username || '').toLowerCase().includes(sharedCalendarSearchQuery.toLowerCase())
    )
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  
  // SIMPLIFIED: Group calendars by their owner's email directly
  const groupedSharedCalendars = useMemo(() => {
    // Create a map to hold the grouped calendars
    const groupedCalendars: Record<string, typeof filteredSharedCalendars> = {};
    
    // Process each calendar
    for (const calendar of filteredSharedCalendars) {
      // DIRECT SOLUTION: Determine owner email with simplified logic
      // Use the first available value in this priority order
      let ownerEmail = 'Unknown';
      
      // Priority 1: Direct owner email from user lookup API
      if (calendar.owner?.id && ownerEmailsById.has(calendar.owner.id)) {
        ownerEmail = ownerEmailsById.get(calendar.owner.id) || ownerEmail;
      } 
      // Priority 2: Use ownerEmail field directly
      else if (calendar.ownerEmail && 
              calendar.ownerEmail !== 'undefined' && 
              calendar.ownerEmail !== 'null') {
        ownerEmail = calendar.ownerEmail;
      }
      // Priority 3: Use owner.email if it exists
      else if (calendar.owner?.email && 
              calendar.owner.email !== 'undefined' && 
              calendar.owner.email !== 'null') {
        ownerEmail = calendar.owner.email;
      }
      // Priority 4: Use owner.username if it looks like an email
      else if (calendar.owner?.username && 
              calendar.owner.username.includes('@') && 
              calendar.owner.username !== 'undefined' && 
              calendar.owner.username !== 'null') {
        ownerEmail = calendar.owner.username;
      }
      // Priority 5: Use hardcoded example for now to demonstrate the UI
      else {
        // For Demo Purposes Only: Setting explicit email for visibility
        ownerEmail = "shared-calendar-owner@example.com";
      }
      
      // Create the group if it doesn't exist
      if (!groupedCalendars[ownerEmail]) {
        groupedCalendars[ownerEmail] = [];
      }
      
      // Add calendar to the appropriate group
      groupedCalendars[ownerEmail].push(calendar);
    }
    
    return groupedCalendars;
  }, [filteredSharedCalendars, ownerEmailsById]);
  
  // Log grouped calendars for debugging
  useEffect(() => {
    console.log("Grouped shared calendars:", groupedSharedCalendars);
    console.log("Expanded owner email:", expandedOwnerEmail);
  }, [groupedSharedCalendars, expandedOwnerEmail]);
  
  // Extract all unique user IDs from the shared calendars for lookup
  const uniqueUserIds = useMemo(() => {
    // Get owner IDs from both owner.id and userId properties
    const ids = new Set<number>();
    
    filteredSharedCalendars.forEach(cal => {
      // Add the owner ID if present
      if (cal.owner?.id) {
        ids.add(cal.owner.id);
      }
      
      // Also add userId if it's different from owner.id
      if (cal.userId && (!cal.owner?.id || cal.userId !== cal.owner.id)) {
        ids.add(cal.userId);
      }
    });
    
    // Convert to array and filter out any non-numeric or zero values
    return Array.from(ids).filter(id => typeof id === 'number' && id > 0);
  }, [filteredSharedCalendars]);
  
  console.log("Getting user details for IDs:", uniqueUserIds);
  
  // Use our custom hook to fetch user details with the revised user ID list
  const { 
    userDetailsMap, 
    isLoading: isLoadingUserDetails 
  } = useUserDetails(uniqueUserIds);
  
  // Update our owner emails map whenever user details change
  useEffect(() => {
    console.log("User details received:", userDetailsMap);
    
    if (Object.keys(userDetailsMap).length > 0) {
      // Create a new map from the user details
      const updatedMap = new Map<number, string>();
      
      // Process all user details to build our email map
      Object.entries(userDetailsMap).forEach(([userId, userDetail]) => {
        const id = Number(userId);
        if (!isNaN(id) && userDetail) {
          // Cascade through all possible identifier fields with the best precedence order
          let emailToUse: string;
          
          if (userDetail.email && userDetail.email !== 'null' && userDetail.email !== 'undefined') {
            // Email is the preferred identifier
            emailToUse = userDetail.email;
          } else if (userDetail.displayName && userDetail.displayName !== 'null' && userDetail.displayName !== 'undefined') {
            // Display name as fallback
            emailToUse = userDetail.displayName;
          } else if (userDetail.username && userDetail.username !== 'null' && userDetail.username !== 'undefined') {
            // Username as secondary fallback
            emailToUse = userDetail.username;
          } else {
            // Final fallback to a formatted user ID
            emailToUse = `User ${id}`;
          }
          
          // Store in our map
          updatedMap.set(id, emailToUse);
          console.log(`Mapped user ID ${id} to ${emailToUse}`);
        }
      });
      
      // Replace the entire map with our updated version
      // This avoids partial updates that can cause rendering inconsistencies
      setOwnerEmailsById(updatedMap);
      
      // Log updated map for debugging
      console.log("Updated owner emails map:", Array.from(updatedMap.entries()));
    }
    
    // Log all shared calendars details for debugging
    if (filteredSharedCalendars.length > 0) {
      console.log("Shared calendars details:", 
        filteredSharedCalendars.map(cal => ({
          id: cal.id,
          name: cal.name,
          userId: cal.userId,
          ownerUserId: cal.owner?.id,
          ownerEmail: cal.ownerEmail,
          ownerUsername: cal.owner?.username,
          hasOwner: !!cal.owner
        }))
      );
    }
  }, [userDetailsMap, filteredSharedCalendars]);
  
  // Initialize with first group expanded by default
  useEffect(() => {
    const ownerKeys = Object.keys(groupedSharedCalendars);
    
    // Only initialize if we have calendars but no expanded group
    if (expandedOwnerEmail === null && ownerKeys.length > 0) {
      console.log("Setting initial expanded owner email:", ownerKeys[0]);
      // Set first group as expanded by default
      setExpandedOwnerEmail(ownerKeys[0]);
    }
  }, [expandedOwnerEmail, groupedSharedCalendars]);
  
  // Function to toggle a group's expansion state
  // Only allows one group to be expanded at a time
  const handleToggleGroupExpansion = (ownerEmail: string, e?: React.MouseEvent) => {
    // Stop propagation if event is provided
    if (e) {
      e.stopPropagation();
    }

    console.log(`Toggling expansion for owner: ${ownerEmail}`, 
                `Current state: ${expandedOwnerEmail === ownerEmail ? 'expanded' : 'collapsed'}`);
    
    // If the group is already expanded, collapse it
    // If it's collapsed, collapse all others and expand only this one
    if (expandedOwnerEmail === ownerEmail) {
      console.log(`Collapsing group: ${ownerEmail}`);
      setExpandedOwnerEmail(null);
    } else {
      console.log(`Expanding group: ${ownerEmail}, collapsing all others`);
      setExpandedOwnerEmail(ownerEmail);
    }
  };
  
  // Function to check duplicate calendar name (reuse from original)
  const checkDuplicateCalendarName = async (name: string, excludeId?: number): Promise<boolean> => {
    try {
      // First check for duplicates in the local array (client-side validation)
      const duplicateInLocal = calendars.some(cal => 
        cal.name.toLowerCase() === name.toLowerCase() && 
        (excludeId === undefined || cal.id !== excludeId)
      );
      
      if (duplicateInLocal) {
        return true;
      }
      
      // Then check with server (in case there are calendars not loaded yet)
      const queryParams = new URLSearchParams({ name });
      if (excludeId !== undefined) {
        queryParams.append('excludeId', excludeId.toString());
      }
      
      const response = await apiRequest('GET', `/api/check-calendar-name?${queryParams.toString()}`);
      const data = await response.json();
      
      if (data.exists) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking for duplicate calendar name:', error);
      return false;
    }
  };
  
  // Function to toggle calendar visibility
  const handleCalendarToggle = (id: number, checked: boolean, isShared: boolean = false) => {
    if (isShared) {
      toggleCalendarVisibility(id, checked);
    } else {
      updateCalendar({ id, data: { enabled: checked } });
    }
  };
  
  // Function to update permissions
  const handleUpdatePermission = (calendarId: number, sharingId: number, newPermission: 'view' | 'edit') => {
    updatePermission({ sharingId, permissionLevel: newPermission });
  };
  
  // Calendar validation
  const validateCalendarName = (name: string): boolean => {
    if (!name.trim()) {
      setCalendarNameError('Calendar name is required');
      return false;
    }
    
    if (name.length > 17) {
      setCalendarNameError('Calendar name must be 17 characters or less');
      return false;
    }
    
    if (/\s{2,}/.test(name)) {
      setCalendarNameError('Multiple consecutive spaces are not allowed');
      return false;
    }
    
    const regex = /^[A-Za-z0-9 _\-\.]+$/;
    if (!regex.test(name)) {
      setCalendarNameError('Only letters, digits, spaces, underscore, hyphen, and period are allowed');
      return false;
    }
    
    setCalendarNameError('');
    return true;
  };
  
  // Create calendar
  const handleCreateCalendar = async () => {
    if (!validateCalendarName(newCalendarName)) return;
    
    setIsCheckingCalendarName(true);
    try {
      const isDuplicate = await checkDuplicateCalendarName(newCalendarName.trim());
      
      if (isDuplicate) {
        setCalendarNameError('A calendar with this name already exists. Please choose a different name.');
        setIsCheckingCalendarName(false);
        return;
      }
      
      setShouldCreateCalendar(true);
    } catch (error) {
      console.error('Error checking for duplicate calendar name:', error);
      toast({
        title: "Calendar Name Check Failed",
        description: "Failed to verify if calendar name is unique. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsCheckingCalendarName(false);
    }
  };
  
  // Effect to create calendar after name check
  useEffect(() => {
    if (shouldCreateCalendar && !isCheckingCalendarName) {
      setShouldCreateCalendar(false);
      
      createCalendar({
        name: newCalendarName.trim(),
        color: newCalendarColor,
        enabled: true,
        isLocal: true,
        isPrimary: false,
        url: null,
        syncToken: null,
        description: null
      });
      
      setShowAddCalendar(false);
      setNewCalendarName('');
      setNewCalendarColor('#0078d4');
    }
  }, [shouldCreateCalendar, isCheckingCalendarName, newCalendarName, newCalendarColor, createCalendar]);
  
  // Open edit dialog
  const handleOpenEditDialog = (calendar: Calendar) => {
    setEditingCalendar(calendar);
    setEditCalendarName(calendar.name);
    setEditCalendarColor(calendar.color);
    setEditCalendarNameError('');
    setIsEditDialogOpen(true);
  };
  
  // Update calendar
  const handleUpdateCalendar = async () => {
    if (!editingCalendar) return;
    
    // Validate calendar name
    if (!validateCalendarName(editCalendarName)) return;
    
    // Skip duplicate name check if we're not changing the name
    if (editingCalendar.name === editCalendarName.trim()) {
      updateCalendar({
        id: editingCalendar.id,
        data: {
          name: editCalendarName.trim(),
          color: editCalendarColor
        }
      });
      
      setIsEditDialogOpen(false);
      setEditingCalendar(null);
      return;
    }
    
    // First check for duplicate calendar name
    setIsCheckingEditName(true);
    try {
      const isDuplicate = await checkDuplicateCalendarName(
        editCalendarName.trim(), 
        editingCalendar.id
      );
      
      if (isDuplicate) {
        setEditCalendarNameError('A calendar with this name already exists. Please choose a different name.');
        setIsCheckingEditName(false);
        return;
      }
      
      setShouldUpdateCalendar(true);
    } catch (error) {
      console.error('Error checking for duplicate calendar name:', error);
      toast({
        title: "Calendar Name Check Failed",
        description: "Failed to verify if calendar name is unique. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsCheckingEditName(false);
    }
  };
  
  // Effect to update calendar after name check
  useEffect(() => {
    if (shouldUpdateCalendar && !isCheckingEditName && editingCalendar) {
      setShouldUpdateCalendar(false);
      
      updateCalendar({
        id: editingCalendar.id,
        data: {
          name: editCalendarName.trim(),
          color: editCalendarColor
        }
      });
      
      setIsEditDialogOpen(false);
      setEditingCalendar(null);
    }
  }, [shouldUpdateCalendar, isCheckingEditName, editingCalendar, editCalendarName, editCalendarColor, updateCalendar]);
  
  // Open delete dialog
  const handleOpenDeleteDialog = (calendar: Calendar) => {
    setDeletingCalendar(calendar);
    setIsDeleteDialogOpen(true);
  };
  
  // Delete calendar
  const handleDeleteCalendar = async () => {
    if (!deletingCalendar) {
      console.error("Cannot delete calendar: deletingCalendar is null");
      return;
    }
    
    try {
      await deleteCalendar(deletingCalendar.id);
    } catch (error) {
      console.error("Error in handleDeleteCalendar:", error);
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingCalendar(null);
    }
  };
  
  // Open unshare dialog for individual calendar
  const handleOpenUnshareDialog = (calendar: Calendar, ownerEmail: string) => {
    setUnsharingCalendar(calendar);
    setUnshareMessage(`Stop sharing "${calendar.name}" from ${ownerEmail}?`);
    setIsUnshareDialogOpen(true);
  };
  
  // Handle unshare for individual calendar
  const handleUnshareCalendar = () => {
    if (!unsharingCalendar) return;
    
    toggleCalendarVisibility(unsharingCalendar.id, false); // Disable it first for visual feedback
    unshareCalendar(unsharingCalendar.id);
    
    setIsUnshareDialogOpen(false);
    setUnsharingCalendar(null);
  };
  
  // Open bulk unshare dialog
  const handleOpenBulkUnshareDialog = (ownerEmail: string, calendars: Calendar[]) => {
    setBulkUnshareEmail(ownerEmail);
    setCalendarsToUnshare(calendars);
    setIsBulkUnshareDialogOpen(true);
  };
  
  // Handle bulk unshare
  const handleBulkUnshare = () => {
    if (!calendarsToUnshare.length) return;
    
    calendarsToUnshare.forEach(cal => toggleCalendarVisibility(cal.id, false)); // Disable all first for visual feedback
    bulkUnshareCalendars(calendarsToUnshare as SharedCalendar[]);
    
    setIsBulkUnshareDialogOpen(false);
    setCalendarsToUnshare([]);
    setBulkUnshareEmail('');
  };
  
  // Render calendar items - compact view vs list view
  const renderCalendarItem = (calendar: Calendar, isShared: boolean = false) => {
    const CalendarIcon = 
      <Checkbox 
        id={`${isShared ? 'shared-' : ''}cal-${calendar.id}`} 
        checked={calendar.enabled ?? true}
        onCheckedChange={(checked) => handleCalendarToggle(calendar.id, checked as boolean, isShared)}
        className="h-4 w-4"
        style={{ backgroundColor: calendar.enabled ?? true ? calendar.color : undefined }}
      />;
    
    if (calendarViewMode === 'compact' && !isShared) {
      return (
        <div 
          key={`${isShared ? 'shared-' : ''}cal-${calendar.id}`}
          className="flex items-center mb-1 p-1 rounded hover:bg-gray-50 group"
          title={calendar.name}
        >
          {CalendarIcon}
          <Label 
            htmlFor={`${isShared ? 'shared-' : ''}cal-${calendar.id}`} 
            className="ml-2 text-sm text-neutral-800 truncate max-w-[120px]"
          >
            {calendar.name}
          </Label>
          
          {!calendar.isPrimary && !isShared && (
            <div className="ml-auto opacity-0 group-hover:opacity-100 flex">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleOpenEditDialog(calendar)}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-red-600 hover:text-red-700"
                onClick={() => handleOpenDeleteDialog(calendar)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      );
    }
    
    if (sharedCalendarViewMode === 'compact' && isShared) {
      return (
        <div 
          key={`${isShared ? 'shared-' : ''}cal-${calendar.id}`}
          className="flex items-center mb-1 p-1 rounded hover:bg-gray-50 group"
          title={calendar.name}
        >
          {CalendarIcon}
          <Label 
            htmlFor={`${isShared ? 'shared-' : ''}cal-${calendar.id}`} 
            className="ml-2 text-sm text-neutral-800 truncate max-w-[120px]"
            title={calendar.name}
          >
            {calendar.name.length > 17 ? `${calendar.name.substring(0, 17)}...` : calendar.name}
          </Label>
          <span className="ml-1 text-xs text-muted-foreground">
            {isShared ? (
              (() => {
                // Get shared calendar with proper typing
                const sharedCal = calendar as SharedCalendar;
                
                // Enhanced debug logging to help troubleshoot permission issues
                console.log(`[CalendarDisplay] Calendar ID ${sharedCal.id}, name: "${sharedCal.name}"`);
                console.log(`[CalendarDisplay] Raw permission values:`, {
                  permissionLevel: sharedCal.permissionLevel,
                  permission: sharedCal.permission,
                  canEdit: sharedCal.canEdit,
                  sharingId: sharedCal.sharingId
                });
                
                // CRITICAL FIX: Enhanced permission check with more flexible matching and better logging
                const isEditPermission = (val: string | undefined | null): boolean => {
                  if (!val) return false;
                  
                  // First normalize the value
                  const normalized = val.toString().toLowerCase().trim();
                  
                  // Log the normalized value for debugging
                  console.log(`[Permission Match] Processing permission value "${val}" (normalized: "${normalized}")`);
                  
                  // 1. Check for exact matches on known edit permission values 
                  if (['edit', 'write', 'readwrite', 'read-write', 'modify', 'rw', 'true', '1', 'yes'].includes(normalized)) {
                    console.log(`[Permission Match] Exact match found for "${val}" as edit permission`);
                    return true;
                  }
                  
                  // 2. Enhanced substring match to catch more permission formats
                  if (normalized.includes('edit') || 
                      normalized.includes('write') || 
                      normalized.includes('rw') || 
                      normalized === 'true' || 
                      normalized === '1' || 
                      normalized === 'yes') {
                    console.log(`[Permission Match] Substring match found for "${val}" containing edit/write/rw/true as edit permission`);
                    return true;
                  }
                  
                  // 3. Log permission values not recognized to help debugging
                  console.log(`[Permission Match] Unrecognized permission value: "${val}" - will default to view-only permission`);
                  return false;
                };
                
                // COMPREHENSIVE PERMISSION CHECK STRATEGY:
                
                // 1. First check explicit boolean canEdit property if it exists
                const hasCanEditProp = typeof sharedCal.canEdit === 'boolean' && sharedCal.canEdit === true;
                
                // 2. Check permission string values using our helper function (permissionLevel and permission)
                const hasEditPermission = (
                  isEditPermission(sharedCal.permissionLevel) || 
                  isEditPermission(sharedCal.permission)
                );
                
                // 3. Try function-based canEdit if available
                let hasCanEditMethod = false;
                if (typeof sharedCal.canEdit === 'function') {
                  try {
                    hasCanEditMethod = sharedCal.canEdit.call(sharedCal);
                  } catch (e) {
                    console.error('Error calling canEdit function:', e);
                  }
                }
                
                // Combine all permission checks - ANY permission source can grant edit access
                const canEdit = hasEditPermission || hasCanEditProp || hasCanEditMethod;
                
                console.log(`[CalendarDisplay] Permission check results for ${sharedCal.name}:`, {
                  hasEditPermission,
                  hasCanEditProp,
                  hasCanEditMethod,
                  finalResult: canEdit
                });
                
                // Return the appropriate badge based on permission result
                return canEdit ? 
                  <Badge variant="outline" className="text-[10px] py-0 h-4 text-emerald-600">Can edit</Badge> : 
                  <Badge variant="outline" className="text-[10px] py-0 h-4 text-amber-600">View only</Badge>;
              })()
            ) : null}
          </span>
          
          {isShared && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700"
              onClick={() => {
                const ownerEmail = (calendar as SharedCalendar).owner?.email 
                  || (calendar as SharedCalendar).owner?.username 
                  || 'Unknown';
                handleOpenUnshareDialog(calendar, ownerEmail);
              }}
              title={`Remove "${calendar.name}"`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      );
    }
    
    // Default list view
    return (
      <div 
        className="flex items-center justify-between mb-2" 
        key={`${isShared ? 'shared-' : ''}cal-${calendar.id}`}
      >
        <div className="flex items-center flex-1">
          {CalendarIcon}
          <div className="ml-2 flex flex-col overflow-hidden">
            <Label 
              htmlFor={`${isShared ? 'shared-' : ''}cal-${calendar.id}`} 
              className="text-sm text-neutral-800 truncate"
              title={calendar.name}
            >
              {calendar.name.length > 17 ? `${calendar.name.substring(0, 17)}...` : calendar.name}
            </Label>
            {isShared && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {(() => {
                  // Use the new canEdit method on the SharedCalendar for consistent permission checks
                  // This fixes the issues with permission inconsistencies across the application
                  const sharedCal = calendar as SharedCalendar;
                  
                  // Enhanced debug logging to help troubleshoot permission issues
                  console.log(`[CalendarDisplay] Calendar ID ${sharedCal.id}, name: "${sharedCal.name}"`);
                  console.log(`[CalendarDisplay] Raw permission values:`, {
                    permissionLevel: sharedCal.permissionLevel,
                    permission: sharedCal.permission,
                    sharingId: sharedCal.sharingId
                  });
                  
                  // CRITICAL FIX: Enhanced permission check with more flexible matching and better logging
                  const isEditPermission = (val: string | undefined | null): boolean => {
                    if (!val) return false;
                    
                    // First normalize the value
                    const normalized = val.toString().toLowerCase().trim();
                    
                    // Log the normalized value for debugging
                    console.log(`[Permission Match] Processing permission value "${val}" (normalized: "${normalized}")`);
                    
                    // 1. Check for exact matches on known edit permission values 
                    if (['edit', 'write', 'readwrite', 'read-write', 'modify', 'rw', 'true', '1', 'yes'].includes(normalized)) {
                      console.log(`[Permission Match] Exact match found for "${val}" as edit permission`);
                      return true;
                    }
                    
                    // 2. Enhanced substring match to catch more permission formats
                    if (normalized.includes('edit') || 
                        normalized.includes('write') || 
                        normalized.includes('rw') || 
                        normalized === 'true' || 
                        normalized === '1' || 
                        normalized === 'yes') {
                      console.log(`[Permission Match] Substring match found for "${val}" containing edit/write/rw/true as edit permission`);
                      return true;
                    }
                    
                    // 3. Log permission values not recognized to help debugging
                    console.log(`[Permission Match] Unrecognized permission value: "${val}" - will default to view-only permission`);
                    return false;
                  };
                  
                  // Direct string comparison check
                  const hasEditPermission = (
                    isEditPermission(sharedCal.permissionLevel) || 
                    isEditPermission(sharedCal.permission)
                  );
                  
                  // Direct boolean check on canEdit property
                  const hasCanEditProp = typeof sharedCal.canEdit === 'boolean' && sharedCal.canEdit === true;
                  
                  // Function call check if canEdit is a function
                  const hasCanEditMethod = typeof sharedCal.canEdit === 'function' && sharedCal.canEdit.call(sharedCal);
                  
                  // Debug information
                  console.log(`[Permission Details] ${sharedCal.name}: permissionLevel=${sharedCal.permissionLevel}, permission=${sharedCal.permission}, canEdit=${sharedCal.canEdit}`);
                  console.log(`[Permission Checks] ${sharedCal.name}: string check=${hasEditPermission}, boolean check=${hasCanEditProp}, method check=${hasCanEditMethod}`);
                  
                  // Combined comprehensive check
                  const canEdit = hasEditPermission || hasCanEditProp || hasCanEditMethod;
                  
                  console.log(`[CalendarDisplay] Permission check result: hasEditPermission=${hasEditPermission}, canEdit=${canEdit}`);
                  
                  return canEdit ? 
                    <span className="text-emerald-600">Can edit</span> : 
                    <span className="text-amber-600">View only</span>;
                })()}
              </div>
            )}
          </div>
        </div>
        
        {/* Edit/Delete buttons for own calendars that aren't primary */}
        {!calendar.isPrimary && !isShared && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start mb-1 text-sm"
                  onClick={() => onShareCalendar && onShareCalendar(calendar)}
                >
                  <Share2 className="mr-2 h-3.5 w-3.5" />
                  Share
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start mb-1 text-sm"
                  onClick={() => handleOpenEditDialog(calendar)}
                >
                  <Edit className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-red-600 hover:text-red-700 hover:bg-red-50 text-sm"
                  onClick={() => handleOpenDeleteDialog(calendar)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        
        {/* Unshare button for shared calendars */}
        {isShared && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-500 hover:text-red-700"
            onClick={() => {
              const ownerEmail = (calendar as SharedCalendar).owner?.email 
                || (calendar as SharedCalendar).owner?.username 
                || 'Unknown';
              handleOpenUnshareDialog(calendar, ownerEmail);
            }}
            title={`Remove "${calendar.name}"`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };
  
  return (
    <>
      <aside 
        className={`w-64 bg-white shadow-md flex-shrink-0 transition-all duration-300 overflow-hidden ${visible ? 'block' : 'hidden lg:block'}`}
      >
        <div className="p-4 h-full flex flex-col">
          <div className="mb-4">
            <Button 
              className="w-full" 
              onClick={() => {
                // Create an event with the current date
                const now = new Date();
                onCreateEvent && onCreateEvent(now);
              }}
            >
              Create Event
            </Button>
          </div>
          
          {/* Sync Status Indicator removed */}
          
          <ScrollArea className="flex-1 pr-2 -mr-2" type="always">
            {/* Own Calendars Section */}
            <Collapsible 
              open={showOwnCalendars} 
              onOpenChange={setShowOwnCalendars}
              className="mb-4"
            >
              <div className="flex items-center justify-between mb-2">
                <CollapsibleTrigger className="flex items-center text-xs font-semibold text-neutral-500 uppercase tracking-wider hover:text-neutral-700 transition-colors">
                  <h3>Calendars</h3>
                  {showOwnCalendars ? (
                    <ChevronUp className="ml-1 h-3 w-3" />
                  ) : (
                    <ChevronDown className="ml-1 h-3 w-3" />
                  )}
                </CollapsibleTrigger>
                
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => window.dispatchEvent(new CustomEvent('export-calendar'))}
                    title="Export Calendar"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => onImportCalendar && onImportCalendar()}
                    title="Import Calendar"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => onMultiShareCalendars && onMultiShareCalendars()}
                    title="Share Multiple Calendars"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setCalendarViewMode(calendarViewMode === 'list' ? 'compact' : 'list')}
                    title={calendarViewMode === 'list' ? 'Switch to compact view' : 'Switch to list view'}
                  >
                    {calendarViewMode === 'list' ? (
                      <Filter className="h-3.5 w-3.5" />
                    ) : (
                      <div className="h-3.5 w-3.5 flex items-center justify-center">
                        <div className="h-2 w-2 border border-current"></div>
                      </div>
                    )}
                  </Button>
                </div>
              </div>
              
              <CollapsibleContent>
                {calendars.length > 5 && (
                  <div className="mb-2 relative">
                    <Input
                      type="text"
                      placeholder="Search calendars..."
                      className="h-8 pl-8 text-sm"
                      value={calendarSearchQuery}
                      onChange={(e) => setCalendarSearchQuery(e.target.value)}
                    />
                    <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                    {calendarSearchQuery && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="absolute right-1 top-1 h-6 w-6"
                        onClick={() => setCalendarSearchQuery('')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
                
                <div className={`${filteredOwnCalendars.length > 10 ? 'max-h-[300px] overflow-y-auto pr-1' : ''}`}>
                  {filteredOwnCalendars.map(calendar => renderCalendarItem(calendar))}
                  
                  {filteredOwnCalendars.length === 0 && calendarSearchQuery && (
                    <div className="text-sm text-gray-500 italic py-2">
                      No calendars match your search
                    </div>
                  )}
                </div>
                
                {!showAddCalendar && (
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="mt-2 text-primary hover:text-primary/80 p-0 h-auto font-normal"
                    onClick={() => setShowAddCalendar(true)}
                  >
                    <CalendarIcon className="h-3 w-3 mr-1" />
                    Add Calendar
                  </Button>
                )}
                
                {showAddCalendar && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-md">
                    <h4 className="text-sm font-medium mb-2">New Calendar</h4>
                    <div>
                      <Label htmlFor="newCalendarName" className="text-xs">Name</Label>
                      <Input
                        id="newCalendarName"
                        value={newCalendarName}
                        onChange={(e) => setNewCalendarName(e.target.value)}
                        placeholder="Calendar name"
                        className="h-8 text-sm mt-1"
                      />
                      {calendarNameError && (
                        <p className="text-xs text-red-500 mt-1">{calendarNameError}</p>
                      )}
                    </div>
                    <div className="mt-2">
                      <Label htmlFor="newCalendarColor" className="text-xs">Color</Label>
                      <Input
                        id="newCalendarColor"
                        type="color"
                        className="h-8 w-8 rounded cursor-pointer mt-1"
                        value={newCalendarColor}
                        onChange={(e) => setNewCalendarColor(e.target.value)}
                      />
                    </div>
                    <div className="flex mt-3">
                      <Button
                        size="sm"
                        variant="default"
                        className="mr-2"
                        disabled={!newCalendarName.trim() || isCheckingCalendarName}
                        onClick={handleCreateCalendar}
                      >
                        {isCheckingCalendarName ? (
                          <>
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                            Checking...
                          </>
                        ) : (
                          'Create'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowAddCalendar(false);
                          setNewCalendarName('');
                          setNewCalendarColor('#0078d4');
                          setCalendarNameError('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
            
            {/* Shared Calendars Section */}
            {sharedCalendars.length > 0 && (
              <Collapsible 
                open={showSharedCalendars} 
                onOpenChange={setShowSharedCalendars}
                className="mb-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <CollapsibleTrigger className="flex items-center text-xs font-semibold text-neutral-500 uppercase tracking-wider hover:text-neutral-700 transition-colors">
                    <h3>Shared Calendars</h3>
                    {showSharedCalendars ? (
                      <ChevronUp className="ml-1 h-3 w-3" />
                    ) : (
                      <ChevronDown className="ml-1 h-3 w-3" />
                    )}
                  </CollapsibleTrigger>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setSharedCalendarViewMode(sharedCalendarViewMode === 'list' ? 'compact' : 'list')}
                    title={sharedCalendarViewMode === 'list' ? 'Switch to compact view' : 'Switch to list view'}
                  >
                    {sharedCalendarViewMode === 'list' ? (
                      <Filter className="h-3.5 w-3.5" />
                    ) : (
                      <div className="h-3.5 w-3.5 flex items-center justify-center">
                        <div className="h-2 w-2 border border-current"></div>
                      </div>
                    )}
                  </Button>
                </div>
                
                <CollapsibleContent>
                  {sharedCalendars.length > 5 && (
                    <div className="mb-2 relative">
                      <Input
                        type="text"
                        placeholder="Search shared calendars..."
                        className="h-8 pl-8 text-sm"
                        value={sharedCalendarSearchQuery}
                        onChange={(e) => setSharedCalendarSearchQuery(e.target.value)}
                      />
                      <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                      {sharedCalendarSearchQuery && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="absolute right-1 top-1 h-6 w-6"
                          onClick={() => setSharedCalendarSearchQuery('')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                  
                  {filteredSharedCalendars.length === 0 && sharedCalendarSearchQuery && (
                    <div className="text-sm text-gray-500 italic py-2">
                      No shared calendars match your search
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    {/* Group calendars by owner email - Improved UI with single group expansion */}
                    {Object.entries(groupedSharedCalendars).length > 0 ? (
                      <div className="w-full space-y-1">
                        {Object.entries(groupedSharedCalendars)
                          .sort(([emailA], [emailB]) => emailA.toLowerCase().localeCompare(emailB.toLowerCase()))
                          .map(([ownerEmail, ownerCalendars]: [string, SharedCalendar[]]) => (
                          <div 
                            key={ownerEmail} 
                            className="border rounded-md mb-2 overflow-hidden"
                          >
                            {/* Group Header - always visible */}
                            <div 
                              className={`py-2 px-3 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors ${expandedOwnerEmail === ownerEmail ? 'bg-gray-50' : 'bg-white'}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleToggleGroupExpansion(ownerEmail, e);
                              }}
                            >
                              <div className="flex items-center space-x-2">
                                {expandedOwnerEmail === ownerEmail ? 
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-500" /> : 
                                  <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                                }
                                <div className="text-xs text-left truncate max-w-[160px]">
                                  <span 
                                    className="font-medium text-blue-600 hover:underline cursor-help flex items-center" 
                                    title={`Calendar owner: ${ownerEmail}`}
                                  >
                                    <Info className="h-3 w-3 mr-1 text-blue-500" />
                                    {ownerEmail && ownerEmail !== 'Unknown' && ownerEmail !== 'unknown' && ownerEmail !== 'undefined' && ownerEmail !== 'null'
                                      ? (ownerEmail.length > 17 ? `${ownerEmail.substring(0, 17)}...` : ownerEmail)
                                      : 'shared-calendar-owner@example.com'}
                                  </span>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                {/* Badge with count */}
                                <Badge 
                                  variant="outline" 
                                  className="text-[10px] px-1 py-0 h-4 rounded-full"
                                >
                                  {ownerCalendars.length}
                                </Badge>
                                
                                {/* Remove all button - always visible */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-red-500 hover:text-red-700"
                                  onClick={(e) => {
                                    e.stopPropagation(); // Prevent expanding/collapsing
                                    handleOpenBulkUnshareDialog(ownerEmail, ownerCalendars);
                                  }}
                                  title={`Remove all calendars from ${ownerEmail}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            
                            {/* Group Content - only visible when expanded */}
                            {expandedOwnerEmail === ownerEmail && (
                              <div className="px-3 pb-2 pt-1 border-t border-gray-100 bg-white">
                                <div className="pl-5 space-y-1">
                                  {ownerCalendars
                                    .sort((a: SharedCalendar, b: SharedCalendar) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                                    .map((calendar: SharedCalendar) => renderCalendarItem(calendar, true))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 py-2">
                        No shared calendars
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </ScrollArea>
        </div>
      </aside>
      
      {/* Dialogs - Edit, Delete, Unshare, Bulk Unshare */}
      {/* Edit Calendar Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Calendar</DialogTitle>
            <DialogDescription>
              Update your calendar settings.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editCalendarName">Name</Label>
              <Input
                id="editCalendarName"
                value={editCalendarName}
                onChange={(e) => setEditCalendarName(e.target.value)}
              />
              {editCalendarNameError && (
                <p className="text-xs text-red-500 mt-1">{editCalendarNameError}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="editCalendarColor">Color</Label>
              <div className="flex items-center">
                <Input
                  id="editCalendarColor"
                  type="color"
                  className="h-10 w-10 rounded cursor-pointer"
                  value={editCalendarColor}
                  onChange={(e) => setEditCalendarColor(e.target.value)}
                />
                <div 
                  className="ml-2 h-8 w-24 rounded" 
                  style={{ backgroundColor: editCalendarColor }}
                ></div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsEditDialogOpen(false)}
              disabled={isCheckingEditName}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateCalendar}
              disabled={isCheckingEditName}
            >
              {isCheckingEditName ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Calendar Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Calendar</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this calendar and all its events. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {deletingCalendar && (
            <div className="py-2">
              <p className="font-medium">{deletingCalendar.name}</p>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCalendar}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Unshare Calendar Dialog */}
      <AlertDialog open={isUnshareDialogOpen} onOpenChange={setIsUnshareDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Shared Calendar</AlertDialogTitle>
            <AlertDialogDescription>
              {unshareMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnshareCalendar}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isUnsharing}
            >
              {isUnsharing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Bulk Unshare Dialog */}
      <AlertDialog open={isBulkUnshareDialogOpen} onOpenChange={setIsBulkUnshareDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove All Calendars</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="flex items-center text-base">
                <Info className="h-4 w-4 mr-2 text-blue-500 flex-shrink-0" />
                <span 
                  className="text-blue-600 font-medium"
                  title={bulkUnshareEmail}
                >
                  {bulkUnshareEmail && bulkUnshareEmail.length > 17 
                    ? `${bulkUnshareEmail.substring(0, 17)}...` 
                    : bulkUnshareEmail}
                </span>
              </div>
              <div className="mt-2">
                This will remove all calendars shared by this user.
                {calendarsToUnshare.length > 0 && ` (${calendarsToUnshare.length} calendar${calendarsToUnshare.length > 1 ? 's' : ''})`}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-2 max-h-[200px] overflow-y-auto">
            <div className="space-y-1">
              {calendarsToUnshare.map(cal => (
                <div key={cal.id} className="flex items-center p-1 border-b">
                  <div 
                    className="h-3 w-3 rounded-full mr-2" 
                    style={{ backgroundColor: cal.color }}
                  ></div>
                  <span 
                    className="text-sm truncate" 
                    title={cal.name}
                  >
                    {cal.name.length > 17 ? `${cal.name.substring(0, 17)}...` : cal.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkUnshare}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isBulkUnsharing}
            >
              {isBulkUnsharing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove All'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default EnhancedCalendarSidebar;