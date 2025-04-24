import { useAuth } from "./auth";
import { Redirect, Route } from "wouter";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function ProtectedRoute({
  path,
  children,
}: {
  path?: string;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return path ? (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-sm text-gray-500">Verificando autenticação...</p>
          </div>
        </div>
      </Route>
    ) : (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-gray-500">Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return path ? (
      <Route path={path}>
        <Redirect to="/login" />
      </Route>
    ) : (
      <Redirect to="/login" />
    );
  }

  return path ? <Route path={path}>{children}</Route> : <>{children}</>;
}

// Componente para usar quando dados ainda estão carregando
export function LoadingState() {
  return (
    <div className="w-full p-8 space-y-4">
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array(6)
          .fill(0)
          .map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
      </div>
    </div>
  );
}