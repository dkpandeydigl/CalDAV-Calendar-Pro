import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Bell,
  Calendar,
  ChevronDown,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Settings,
  User,
  Wifi,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import useNotifications from '@/hooks/use-notifications';

export function AppNav() {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const { unreadCount } = useNotifications();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
  };

  return (
    <header className="bg-background border-b sticky top-0 z-50">
      <div className="container h-16 flex items-center justify-between">
        <div className="flex items-center gap-6 md:gap-8 lg:gap-10">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Calendar className="h-5 w-5" />
            <span className="hidden md:inline-block">CalDAV Client</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              to="/"
              className={`text-sm font-medium ${location === '/' ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground transition-colors`}
            >
              Calendar
            </Link>
            <Link
              to="/notifications"
              className={`text-sm font-medium ${location === '/notifications' ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground transition-colors relative`}
            >
              Notifications
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-3 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
            <Link
              to="/email-settings"
              className={`text-sm font-medium ${location === '/email-settings' ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground transition-colors`}
            >
              Email Settings
            </Link>
            <Link
              to="/websocket-chat"
              className={`text-sm font-medium ${location === '/websocket-chat' ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground transition-colors`}
            >
              <span className="flex items-center gap-1">
                <Wifi className="h-3 w-3" />
                Chat
              </span>
            </Link>
          </nav>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] sm:w-[300px]">
              <nav className="flex flex-col gap-4 mt-8">
                <Link
                  to="/"
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted text-sm"
                  onClick={() => setMobileOpen(false)}
                >
                  <Calendar className="h-4 w-4" />
                  Calendar
                </Link>
                <Link
                  to="/notifications"
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted text-sm relative"
                  onClick={() => setMobileOpen(false)}
                >
                  <Bell className="h-4 w-4" />
                  Notifications
                  {unreadCount > 0 && (
                    <span className="absolute left-5 top-0 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>
                <Link
                  to="/email-settings"
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted text-sm"
                  onClick={() => setMobileOpen(false)}
                >
                  <Mail className="h-4 w-4" />
                  Email Settings
                </Link>
                <Link
                  to="/websocket-chat"
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted text-sm"
                  onClick={() => setMobileOpen(false)}
                >
                  <MessageSquare className="h-4 w-4" />
                  Chat
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>

        {/* User menu */}
        <div className="flex items-center gap-4">
          <Link
            to="/notifications"
            className="relative md:hidden"
          >
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2">
                <User className="h-5 w-5" />
                <span className="hidden sm:inline-block max-w-[150px] truncate">
                  {user?.username || 'User'}
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/email-settings" className="flex items-center gap-2 cursor-pointer">
                  <Mail className="h-4 w-4" />
                  <span>Email Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 cursor-pointer text-destructive">
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}