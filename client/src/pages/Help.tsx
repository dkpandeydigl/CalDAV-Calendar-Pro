import { useAuth } from '@/hooks/use-auth';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AuthCheck } from '@/components/diagnostics/AuthCheck';
import { Layers, Globe, LayoutDashboard, UserCheck, Shield } from 'lucide-react';

export default function Help() {
  const { user } = useAuth();

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold">Help &amp; Troubleshooting</h1>
        <p className="text-muted-foreground">
          Diagnose and resolve issues with your calendar application
        </p>
        <Separator className="my-4" />
      </div>

      <Tabs defaultValue="auth">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="auth" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Authentication
          </TabsTrigger>
          <TabsTrigger value="connection" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Server Connection
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Data Synchronization
          </TabsTrigger>
          <TabsTrigger value="account" className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Account Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Authentication Status</CardTitle>
                  <CardDescription>
                    Diagnose issues with user authentication
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p>
                    Authentication allows you to access your calendar data across devices and
                    synchronize with the CalDAV server. If you're experiencing issues:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li>Check if your session is active</li>
                    <li>Verify your connection to the CalDAV server</li>
                    <li>Ensure your credentials are correct</li>
                    <li>Try logging out and logging back in</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
            <div>
              <AuthCheck />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="connection">
          <Card>
            <CardHeader>
              <CardTitle>CalDAV Server Connection</CardTitle>
              <CardDescription>
                Diagnose issues with connecting to the CalDAV server
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p>
                {user ? (
                  <>
                    You are currently logged in as <strong>{user.username}</strong>. 
                    Your connection to the CalDAV server will be tested below.
                  </>
                ) : (
                  <>
                    You are not currently logged in. Please log in first to check your
                    CalDAV server connection.
                  </>
                )}
              </p>
              <p className="mt-4">
                Server connection diagnostics will appear here in a future update.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <Card>
            <CardHeader>
              <CardTitle>Synchronization Status</CardTitle>
              <CardDescription>
                Diagnose issues with calendar and event synchronization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p>
                Calendar synchronization diagnostic tools will appear here in a future update.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                View and manage your account details
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="font-medium">Username:</div>
                    <div className="col-span-2">{user.username}</div>
                    
                    <div className="font-medium">User ID:</div>
                    <div className="col-span-2">{user.id}</div>
                    
                    <div className="font-medium">Email:</div>
                    <div className="col-span-2">{user.email || "Not set"}</div>
                    
                    <div className="font-medium">Full Name:</div>
                    <div className="col-span-2">{user.fullName || "Not set"}</div>
                    
                    <div className="font-medium">Preferred Timezone:</div>
                    <div className="col-span-2">{user.preferredTimezone || "UTC"}</div>
                  </div>
                </div>
              ) : (
                <p>You are not currently logged in. Please log in to view your account details.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}