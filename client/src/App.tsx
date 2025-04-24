import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Catalogs from "@/pages/catalogs";
import CatalogDetails from "@/pages/catalog-details";
import Quotes from "@/pages/quotes";
import Moodboards from "@/pages/moodboards";
import Profile from "@/pages/profile";
import AiDesign from "@/pages/ai-design";
import AiDesignChat from "@/pages/ai-design-chat";
import Layout from "@/components/layout/layout";
import { AuthProvider } from "@/lib/auth";

import { ProtectedRoute } from "./lib/protected-route";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <ProtectedRoute path="/">
        <Layout>
          <Dashboard />
        </Layout>
      </ProtectedRoute>
      
      <ProtectedRoute path="/catalogs">
        <Layout>
          <Catalogs />
        </Layout>
      </ProtectedRoute>
      
      <ProtectedRoute path="/catalog/:id">
        <Layout>
          <CatalogDetails />
        </Layout>
      </ProtectedRoute>
      
      <ProtectedRoute path="/quotes">
        <Layout>
          <Quotes />
        </Layout>
      </ProtectedRoute>
      
      <ProtectedRoute path="/moodboards">
        <Layout>
          <Moodboards />
        </Layout>
      </ProtectedRoute>
      
      <ProtectedRoute path="/profile">
        <Layout>
          <Profile />
        </Layout>
      </ProtectedRoute>

      <ProtectedRoute path="/ai-design">
        <Layout>
          <AiDesign />
        </Layout>
      </ProtectedRoute>

      <Route path="/ai-design/:id">
        {params => (
          <ProtectedRoute>
            <Layout>
              <AiDesignChat params={params} />
            </Layout>
          </ProtectedRoute>
        )}
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
