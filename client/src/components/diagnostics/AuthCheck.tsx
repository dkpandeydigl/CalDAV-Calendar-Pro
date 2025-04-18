import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { InfoIcon, AlertTriangleIcon, AlertCircleIcon, CheckCircleIcon, RefreshCwIcon } from 'lucide-react';

interface AuthStatusData {
  status: string;
  details: {
    isAuthenticated: boolean;
    sessionExists: boolean;
    hasUser: boolean;
    userId?: number;
    username?: string;
    sessionId?: string;
    hasCookies: boolean;
    cookieCount: number;
  };
}

export function AuthCheck() {
  const [loading, setLoading] = useState(false);
  const [statusData, setStatusData] = useState<AuthStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkAuthStatus = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth-check', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status check failed with status: ${response.status}`);
      }
      
      const data = await response.json();
      setStatusData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <InfoIcon className="h-5 w-5" />
          Authentication Status
        </CardTitle>
        <CardDescription>
          Check your current authentication status with the server
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {statusData && (
          <div className="space-y-4">
            <Alert variant={statusData.status === 'authenticated' ? 'default' : 'destructive'}>
              {statusData.status === 'authenticated' ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <AlertTriangleIcon className="h-4 w-4" />
              )}
              <AlertTitle>
                {statusData.status === 'authenticated' ? 'Authenticated' : 'Not Authenticated'}
              </AlertTitle>
              <AlertDescription>
                {statusData.status === 'authenticated' 
                  ? `Logged in as ${statusData.details.username || 'unknown user'}`
                  : 'You are not currently logged in'
                }
              </AlertDescription>
            </Alert>
            
            <div className="rounded-md border p-4">
              <h3 className="font-medium mb-2">Detailed Information</h3>
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <dt className="font-medium">User ID:</dt>
                <dd className="col-span-2">{statusData.details.userId || 'None'}</dd>
                
                <dt className="font-medium">Session:</dt>
                <dd className="col-span-2">
                  {statusData.details.sessionExists ? 'Active' : 'None'}
                </dd>
                
                <dt className="font-medium">Session ID:</dt>
                <dd className="col-span-2 truncate" title={statusData.details.sessionId}>
                  {statusData.details.sessionId?.substring(0, 8) || 'None'}...
                </dd>
                
                <dt className="font-medium">Cookies:</dt>
                <dd className="col-span-2">
                  {statusData.details.hasCookies 
                    ? `Present (${statusData.details.cookieCount})` 
                    : 'None'
                  }
                </dd>
              </dl>
            </div>
          </div>
        )}
      </CardContent>
      
      <CardFooter>
        <Button 
          onClick={checkAuthStatus} 
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            'Check Authentication Status'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}