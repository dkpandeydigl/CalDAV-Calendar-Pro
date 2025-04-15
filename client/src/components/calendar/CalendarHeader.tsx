import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { useCalendarContext } from '@/contexts/CalendarContext';
import { formatMonthYear } from '@/lib/date-utils';
import { useAuth } from '@/hooks/use-auth';
import { ChevronLeft, ChevronRight, Menu, LogOut, User, Settings, Wifi } from 'lucide-react';
import { ProfileSettingsModal } from '@/components/modals/ProfileSettingsModal';
import { queryClient } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator';

interface CalendarHeaderProps {
  onToggleSidebar: () => void;
  onCreateEvent: () => void;
  showSidebarToggle?: boolean;
}

const CalendarHeader: React.FC<CalendarHeaderProps> = ({ 
  onToggleSidebar, 
  onCreateEvent,
  showSidebarToggle = true
}) => {
  const { 
    currentDate, 
    viewType, 
    setViewType, 
    goToNextPeriod, 
    goToPreviousPeriod, 
    goToToday,
    serverStatus
  } = useCalendarContext();
  
  const { user, logoutMutation } = useAuth();
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [, setLocation] = useLocation();
  
  // Retrieve the latest user data when opening profile settings
  const handleOpenProfileSettings = () => {
    // Force refresh user data before opening the modal
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    setIsProfileSettingsOpen(true);
  };
  
  // Navigate to WebSocket test page
  const navigateToWebSocketTest = () => {
    setLocation('/websocket-test');
  };
  
  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <>
      {/* Profile Settings Modal */}
      {user && (
        <ProfileSettingsModal
          isOpen={isProfileSettingsOpen}
          onClose={() => setIsProfileSettingsOpen(false)}
          currentFullName={user.fullName || ''}
        />
      )}
      
      <header className="bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center">
            {showSidebarToggle && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onToggleSidebar}
                className="lg:hidden"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle sidebar</span>
              </Button>
            )}
            <h1 className="ml-2 text-xl font-semibold text-neutral-900">CalDAV Calendar</h1>
          </div>
          <div className="flex items-center">
            {/* Status indicator - dot only without animation */}
            <div className="mr-3 relative flex items-center">
              <span className={`inline-flex rounded-full h-3 w-3 ${serverStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            </div>
            
            {/* Sync Status Indicator */}
            {user && (
              <div className="mr-3">
                <SyncStatusIndicator />
              </div>
            )}
            
            {/* User dropdown with logout */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center p-1 h-auto rounded-md hover:bg-neutral-100">
                    <User className="h-4 w-4 mr-1" />
                    <span className="text-sm font-medium">{user.username}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    onClick={handleOpenProfileSettings} 
                    className="cursor-pointer"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Profile Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={navigateToWebSocketTest} 
                    className="cursor-pointer"
                  >
                    <Wifi className="h-4 w-4 mr-2" />
                    WebSocket Test
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleLogout} 
                    className="text-red-500 cursor-pointer"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => window.location.href = '/auth'}
                className="ml-2"
              >
                <User className="h-4 w-4 mr-1" />
                Login
              </Button>
            )}
          </div>
        </div>
        <div className="border-b border-neutral-200"></div>
        
        {/* Calendar Controls */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2">
          <div className="flex items-center mb-2 md:mb-0 space-x-1">
            <div className="flex items-center rounded-md border border-input bg-transparent shadow-sm">
              <Button variant="ghost" size="icon" onClick={goToPreviousPeriod} className="rounded-l-md h-9">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={goToToday} className="h-9 px-2 rounded-none border-x">
                Today
              </Button>
              <Button variant="ghost" size="icon" onClick={goToNextPeriod} className="rounded-r-md h-9">
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next</span>
              </Button>
            </div>
            <h2 className="ml-3 text-lg font-semibold">{formatMonthYear(currentDate)}</h2>
          </div>
          <div className="flex items-center">
            <Button 
              variant={viewType === 'month' ? 'default' : 'outline'} 
              size="sm"
              className="rounded-l-md rounded-r-none"
              onClick={() => setViewType('month')}
            >
              Month
            </Button>
            <Button 
              variant={viewType === 'week' ? 'default' : 'outline'} 
              size="sm"
              className="rounded-none border-x-0"
              onClick={() => setViewType('week')}
            >
              Week
            </Button>
            <Button 
              variant={viewType === 'day' ? 'default' : 'outline'} 
              size="sm"
              className="rounded-r-md rounded-l-none"
              onClick={() => setViewType('day')}
            >
              Day
            </Button>
          </div>
        </div>
      </header>
    </>
  );
};

export default CalendarHeader;