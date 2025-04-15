import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, ServerCrash, CheckCircle2 } from "lucide-react";
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from "@/components/ui/skeleton";

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName?: string;
  enabled: boolean;
  hasPassword: boolean;
}

export function EmailSettings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<SMTPConfig | null>(null);
  const [password, setPassword] = useState('');
  const [passwordModified, setPasswordModified] = useState(false);

  useEffect(() => {
    // Fetch SMTP configuration when component mounts
    fetchSmtpConfig();
  }, []);

  const fetchSmtpConfig = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/api/test-smtp-config', { method: 'GET' });
      
      if (response.success && response.config) {
        setConfig(response.config);
      } else {
        // If no configuration exists, we'll show the default form
        setConfig(null);
        toast({
          title: "Email settings not configured",
          description: "Set up your email settings to send invitations and notifications.",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Error fetching SMTP configuration:', error);
      toast({
        title: "Failed to load email settings",
        description: "Could not retrieve your email configuration.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!config) return;
    
    try {
      setSaving(true);
      
      // Only include password if it was modified
      const updateData: any = {
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        enabled: config.enabled
      };
      
      // Only include password if it was changed
      if (passwordModified && password) {
        updateData.password = password;
      }
      
      const response = await apiRequest('/api/smtp-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });
      
      if (response.success) {
        setConfig(response.config);
        setPasswordModified(false);
        toast({
          title: "Email settings saved",
          description: "Your email configuration has been updated successfully.",
          variant: "default"
        });
      } else {
        throw new Error(response.message || 'Failed to save email settings');
      }
    } catch (error) {
      console.error('Error saving SMTP configuration:', error);
      toast({
        title: "Failed to save email settings",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      const response = await apiRequest('/api/test-smtp-connection', {
        method: 'POST'
      });
      
      if (response.success) {
        toast({
          title: "Connection successful",
          description: "Your email settings are working correctly.",
          variant: "default"
        });
      } else {
        throw new Error(response.message || 'Connection test failed');
      }
    } catch (error) {
      console.error('Error testing SMTP connection:', error);
      toast({
        title: "Connection test failed",
        description: error instanceof Error ? error.message : "Could not connect to email server",
        variant: "destructive"
      });
    } finally {
      setTesting(false);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setPasswordModified(true);
  };

  // Render a loading skeleton while fetching settings
  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            <Skeleton className="h-6 w-48" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div className="space-y-2" key={i}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Skeleton className="h-10 w-32" />
        </CardFooter>
      </Card>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Settings
        </CardTitle>
        <CardDescription>
          Configure your email settings to send invitations and notifications to event attendees.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="smtp-enabled">Enable email sending</Label>
            <Switch 
              id="smtp-enabled" 
              checked={config?.enabled || false}
              onCheckedChange={(checked) => {
                if (config) setConfig({...config, enabled: checked});
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            When enabled, the system will send emails for calendar invitations.
          </p>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-host">SMTP Server</Label>
          <Input 
            id="smtp-host" 
            placeholder="e.g., smtps.xgen.in" 
            value={config?.host || ''} 
            onChange={(e) => {
              if (config) setConfig({...config, host: e.target.value});
            }}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-port">Port</Label>
          <Input 
            id="smtp-port" 
            type="number" 
            placeholder="465" 
            value={config?.port || ''} 
            onChange={(e) => {
              if (config) setConfig({...config, port: parseInt(e.target.value) || 465});
            }}
          />
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="smtp-secure">Use SSL/TLS</Label>
            <Switch 
              id="smtp-secure" 
              checked={config?.secure || false}
              onCheckedChange={(checked) => {
                if (config) setConfig({...config, secure: checked});
              }}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-username">Username</Label>
          <Input 
            id="smtp-username" 
            placeholder="Your email address" 
            value={config?.username || user?.username || ''} 
            onChange={(e) => {
              if (config) setConfig({...config, username: e.target.value});
            }}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-password" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Password
            {config?.hasPassword && (
              <span className="ml-2 text-xs text-green-600 flex items-center">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Password set
              </span>
            )}
          </Label>
          <Input 
            id="smtp-password" 
            type="password" 
            placeholder={config?.hasPassword ? "••••••••••••" : "Enter email password"} 
            value={password} 
            onChange={handlePasswordChange}
          />
          <p className="text-xs text-muted-foreground">
            {config?.hasPassword 
              ? "Leave blank to keep your existing password, or enter a new one to change it." 
              : "Enter your email password to enable sending emails."}
          </p>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-from-name">From Name</Label>
          <Input 
            id="smtp-from-name" 
            placeholder="Your name" 
            value={config?.fromName || ''} 
            onChange={(e) => {
              if (config) setConfig({...config, fromName: e.target.value});
            }}
          />
          <p className="text-xs text-muted-foreground">
            This name will appear in the "From" field of emails you send.
          </p>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="smtp-from-email">From Email</Label>
          <Input 
            id="smtp-from-email" 
            placeholder="Your email address" 
            value={config?.fromEmail || config?.username || ''} 
            onChange={(e) => {
              if (config) setConfig({...config, fromEmail: e.target.value});
            }}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={handleTestConnection} 
          disabled={testing || saving || !config?.hasPassword && (!passwordModified || !password)}
        >
          {testing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <ServerCrash className="mr-2 h-4 w-4" />
              Test Connection
            </>
          )}
        </Button>
        <Button 
          onClick={handleSaveSettings} 
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}