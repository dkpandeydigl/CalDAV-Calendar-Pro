import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Calendar from "@/pages/Calendar";
import AuthPage from "@/pages/auth-page";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { WebSocketTestPage } from "@/pages/WebSocketTestPage";
import { WebSocketDebugPage } from "@/pages/WebSocketDebugPage";
import ResourceTestPage from "@/pages/ResourceTestPage";
import { ProtectedRoute } from "@/lib/protected-route";
import { AuthProvider } from "@/hooks/use-auth";
import { CalendarProvider } from "@/contexts/CalendarContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/login" component={AuthPage} /> {/* Alias for /auth */}
      <Route path="/notifications">
        {() => <ProtectedRoute component={NotificationsPage} />}
      </Route>
      <Route path="/websocket-test">
        {() => <ProtectedRoute component={WebSocketTestPage} />}
      </Route>
      <Route path="/websocket-debug">
        {() => <ProtectedRoute component={WebSocketDebugPage} />}
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
          <CalendarProvider>
            <Router />
            <Toaster />
          </CalendarProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
