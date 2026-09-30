"use client";

// Login's container (D-12): reads the requested-path search parameter,
// renders LoginForm, and on success navigates to that path or Home when
// there is none. Extended by Task 3 (02-06) with the AUTH-07
// returning-vendor redirect: a vendor who already has a session and a shop
// and opens Login anyway is sent straight to the requested path (or Home)
// with no entry screen — the complement of the vendor-route guard, applied
// after the requested-path parameter has been read so that continuation
// target is honoured here too. No query to load otherwise — see
// storefront-page.tsx's container pattern for the branch shape this
// deliberately skips (T-02-29 does not apply here; there is no vendor data
// this screen could leak).

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginForm } from "@/features/auth/components/login-form";

// T-02-28: the requested-path parameter is attacker-controllable. Treat
// anything that does not begin with a single forward slash — including a
// protocol-relative "//host" value, which also starts with "/" but is a
// scheme-relative URL a browser will navigate off-site — as absent, and
// fall back to Home instead of using it as a navigation target.
function safeNextPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const { user, store, loading } = useAuth();

  // AUTH-07: effect, never during render; router.replace (never push) so
  // the back button does not return a returning vendor to a screen they
  // have no use for.
  useEffect(() => {
    if (loading || !user || !store) {
      return;
    }
    router.replace(next);
  }, [loading, user, store, next, router]);

  if (loading) {
    return <LoadingShell />;
  }

  if (user && store) {
    // The redirect above is in flight.
    return null;
  }

  return (
    <LoginForm
      onSuccess={() => {
        router.replace(next);
      }}
    />
  );
}
