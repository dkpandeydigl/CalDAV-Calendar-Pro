import React from 'react';
import { AppNav } from '@/components/AppNav';
import { EmailSettings } from '@/components/EmailSettings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export function EmailSettingsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-muted/40">
      <AppNav />
      <div className="container py-6 flex-1">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Email Settings</h1>
            <p className="text-muted-foreground">
              Configure your email settings for sending calendar invitations.
            </p>
          </div>
        </div>
        <Separator className="mb-6" />
        
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>SMTP Configuration</CardTitle>
              <CardDescription>
                Set up your SMTP server details to enable sending calendar invitations.
                Your CalDAV password is automatically used for authentication.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmailSettings />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}