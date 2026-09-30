"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { AuthProvider } from "@/features/auth/auth-provider";

// AuthProvider is mounted here (D-21), inside QueryClientProvider so a later
// phase can route the provider's store fetch through the same query client,
// and wrapping every route this app has — including the anonymous public
// storefront. For an anonymous visitor, AuthProvider's session probe
// resolves to no session and stops there; it adds a client-side auth check
// to every page, not a server-side one (D-14: no @supabase/ssr, no
// middleware/proxy.ts).
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  // Android Chrome only offers "Install app" when a service worker with a
  // fetch handler controls the page (public/sw.js is a no-cache pass-through).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
