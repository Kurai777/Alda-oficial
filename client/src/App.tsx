import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Catalogs from "@/pages/catalogs";
import Quotes from "@/pages/quotes";
import Moodboards from "@/pages/moodboards";
import Layout from "@/components/layout/layout";
import { AuthProvider } from "@/lib/auth.js";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Layout>
          <Dashboard />
        </Layout>
      </Route>
      <Route path="/catalogs">
        <Layout>
          <Catalogs />
        </Layout>
      </Route>
      <Route path="/quotes">
        <Layout>
          <Quotes />
        </Layout>
      </Route>
      <Route path="/moodboards">
        <Layout>
          <Moodboards />
        </Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
