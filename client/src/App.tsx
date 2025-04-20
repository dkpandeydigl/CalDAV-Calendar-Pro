import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Calendar from "@/pages/Calendar";
import AuthPage from "@/pages/auth-page";
import Help from "@/pages/Help";
import { NotificationsPage } from "@/pages/NotificationsPage";
import WebSocketTestPage from "@/pages/WebSocketTestPage";
import WebSocketDebugPage from "@/pages/WebSocketDebugPage";
import WebSocketDiagnosticPage from "@/pages/WebSocketDiagnosticPage";
import WebSocketChatPage from "@/pages/WebSocketChatPage";
import SimpleWebSocketDemo from "@/pages/SimpleWebSocketDemo";
import ResourceTestPage from "@/pages/ResourceTestPage";
import { EmailSettingsPage } from "@/pages/EmailSettingsPage";
import { ProtectedRoute } from "@/lib/protected-route";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { CalendarProvider } from "@/contexts/CalendarContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { EnhancedSyncProvider } from "@/contexts/EnhancedSyncContext";
import LoadingOverlay from "@/components/LoadingOverlay";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/login" component={AuthPage} /> {/* Alias for /auth */}
      <Route path="/help" component={Help} /> {/* Help page doesn't require authentication */}
      <Route path="/notifications">
        {() => <ProtectedRoute component={NotificationsPage} />}
      </Route>
      <Route path="/email-settings">
        {() => <ProtectedRoute component={EmailSettingsPage} />}
      </Route>
      <Route path="/websocket-test">
        {() => <ProtectedRoute component={() => <WebSocketTestPage />} />}
      </Route>
      <Route path="/websocket-debug">
        {() => <ProtectedRoute component={WebSocketDebugPage} />}
      </Route>
      <Route path="/websocket-diagnostic">
        {() => <ProtectedRoute component={WebSocketDiagnosticPage} />}
      </Route>
      <Route path="/websocket-chat">
        {() => <ProtectedRoute component={WebSocketChatPage} />}
      </Route>
      <Route path="/websocket-simple">
        {() => <ProtectedRoute component={SimpleWebSocketDemo} />}
      </Route>
      <Route path="/resource-test">
        {() => <ProtectedRoute component={ResourceTestPage} />}
      </Route>
      <Route path="/">
        {() => <ProtectedRoute component={Calendar} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { isPostLoginLoading } = useAuth();
  
  return (
    <>
      <Router />
      <Toaster />
      {isPostLoginLoading && (
        <LoadingOverlay 
          duration={5000} 
          message="Loading your calendars and events..." 
          onComplete={() => {
            // Loading is complete, component will unmount
            console.log('Loading complete, calendars and events are ready to use');
          }} 
        />
      )}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
          <EnhancedSyncProvider>
            <CalendarProvider>
              <AppContent />
            </CalendarProvider>
          </EnhancedSyncProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
