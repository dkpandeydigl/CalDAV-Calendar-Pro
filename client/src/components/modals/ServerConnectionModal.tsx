import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useServerConnection, ServerConnectionWithoutPassword, NewConnectionData, UpdateConnectionData } from '@/hooks/useServerConnection';
import { formatFullDate } from '@/lib/date-utils';

interface ServerConnectionModalProps {
  open: boolean;
  onClose: () => void;
}

const ServerConnectionModal: React.FC<ServerConnectionModalProps> = ({ open, onClose }) => {
  const { 
    serverConnection, 
    createServerConnection,
    updateServerConnection,
    disconnectServer,
    syncWithServer
  } = useServerConnection();
  
  // Form state
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState(15);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Set form values from existing server connection
  useEffect(() => {
    if (open && serverConnection) {
      // Cast to any as a workaround for type issues
      const conn = serverConnection as any;
      
      // Set the values safely with fallbacks
      if (conn.url) setUrl(conn.url);
      if (conn.username) setUsername(conn.username);
      
      // Don't set password, let user re-enter it for security
      if (typeof conn.autoSync === 'boolean') {
        setAutoSync(conn.autoSync);
      }
      
      if (typeof conn.syncInterval === 'number') {
        setSyncInterval(conn.syncInterval);
      }
    } else if (open) {
      // Default values for your server
      setUrl('https://zpush.ajaydata.com/davical/');
      setUsername('');
      setPassword('');
      setAutoSync(true);
      setSyncInterval(15);
    }
  }, [open, serverConnection]);
  
  const handleSubmit = () => {
    if (!url.trim() || !username.trim() || (!serverConnection && !password.trim())) {
      // Basic validation
      return;
    }
    
    setIsSubmitting(true);
    
    const connectionData = {
      url,
      username,
      autoSync,
      syncInterval
    };
    
    if (serverConnection) {
      // Cast to any to avoid type issues
      const conn = serverConnection as any;
      
      const updateData: UpdateConnectionData = {
        id: conn.id || 0,
        data: {
          ...connectionData,
          // Only include password if it was changed
          ...(password.trim() ? { password } : {})
        }
      };
      
      updateServerConnection(updateData);
    } else {
      // Create new connection
      const newConnection: NewConnectionData = {
        ...connectionData,
        password
      };
      
      createServerConnection(newConnection);
    }
    
    setIsSubmitting(false);
    onClose();
  };
  
  const handleDisconnect = () => {
    if (serverConnection) {
      // Cast to any to avoid type issues
      const conn = serverConnection as any;
      disconnectServer(conn.id || 0);
      setDisconnectDialogOpen(false);
      onClose();
    }
  };
  
  const handleSync = () => {
    syncWithServer();
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>CalDAV Server Settings</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="server-url">Server URL</Label>
              <Input
                id="server-url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://caldav.example.com"
              />
            </div>
            
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={serverConnection ? "••••••••" : "Enter password"}
              />
              {serverConnection && (
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank to keep current password
                </p>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch 
                id="auto-sync" 
                checked={autoSync} 
                onCheckedChange={setAutoSync}
              />
              <Label htmlFor="auto-sync">Auto-sync every {syncInterval} minutes</Label>
            </div>
            
            {serverConnection && (
              <div className="p-3 bg-neutral-100 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Last Sync</span>
                  <span className="text-sm text-neutral-500">
                    {(serverConnection as any).lastSync 
                      ? formatFullDate((serverConnection as any).lastSync) 
                      : 'Never'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  <span className={`text-sm ${(serverConnection as any).status === 'connected' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {(serverConnection as any).status === 'connected' ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="sm:justify-between">
            {serverConnection && (
              <Button 
                variant="destructive" 
                onClick={() => setDisconnectDialogOpen(true)}
              >
                Disconnect
              </Button>
            )}
            <div className="flex space-x-2">
              {serverConnection && (
                <Button
                  variant="outline"
                  onClick={handleSync}
                >
                  Sync Now
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={isSubmitting || !url.trim() || !username.trim() || (!serverConnection && !password.trim())}
              >
                Save Settings
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect from the CalDAV server? Your local calendars will be preserved,
              but they will no longer sync with the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDisconnect}
              className="bg-red-500 hover:bg-red-600"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ServerConnectionModal;
