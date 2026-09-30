"use client";

// The vendor-route guard (D-12/D-13 auth flow): no signed-out visit to any
// route under this group ever renders vendor chrome. While AuthProvider is
// still resolving, this renders the same centred loading treatment every
// other container uses — a guard that shows vendor chrome before it knows
// who is there is a guard that leaks layout (T-02-29). Once resolved with no
// user, it replaces the current history entry with Login, carrying the
// requested path so a successful sign-in continues there rather than
// dumping the vendor on Home. A session that cannot be refreshed resolves to
// the identical `user === null` state, so no separate branch is needed.
//
// Whether a signed-in vendor has a shop is Home's and Setup's concern, not
// this layout's — duplicating that check here would create two places that
// can disagree.
//
// Phase 6 fix (D-13): this file used to render `<BottomNav />` with NO count
// prop at all — the nav's own default silently absorbed that into zero, so
// the badge has NEVER rendered a number in this app's history. That is a
// separate defect from D-12's wrong-column bug: fixing the column alone
// leaves the badge permanently at zero if nothing ever calls the hook here.
// This layout now takes the store out of the session provider as well as
// the user, calls the SAME shared `useNewOrderCount` hook Home's own tile
// calls (D-09 — one query, so the two surfaces can only agree, never
// diverge), and hands the result to the nav. A pending or failed count
// degrades to zero rather than blocking the chrome, the same resilience
// Home's own container already applies to this hook.

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BOTTOM_NAV_HEIGHT_PX, BottomNav } from "@/components/ui/bottom-nav";
import { useAuth } from "@/features/auth/auth-provider";
import { useNewOrderCount } from "@/features/home/hooks/use-new-order-count";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

// Reads useSearchParams — the reason this is split out and wrapped in a
// Suspense boundary by VendorLayout below, rather than doing this work
// directly in the exported layout: Next.js requires a Suspense boundary
// around any client component that reads the search params during a static
// render.
function VendorGuard({ children }: { children: ReactNode }) {
  const { user, store, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const newOrderCountQuery = useNewOrderCount(store?.id ?? "");

  useEffect(() => {
    if (loading || user) {
      return;
    }
    const query = searchParams.toString();
    const requestedPath = query ? `${pathname}?${query}` : pathname;
    router.replace(`/login?next=${encodeURIComponent(requestedPath)}`);
  }, [loading, user, pathname, searchParams, router]);

  if (loading) {
    return <LoadingShell />;
  }

  if (!user) {
    // The redirect above is in flight — render nothing rather than a
    // second loading state or a flash of vendor chrome.
    return null;
  }

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[390px] bg-background">
      <main
        style={{
          paddingBottom: `calc(${String(BOTTOM_NAV_HEIGHT_PX)}px + env(safe-area-inset-bottom))`,
        }}
      >
        {children}
      </main>
      <BottomNav newOrderCount={newOrderCountQuery.data ?? 0} />
    </div>
  );
}

export default function VendorLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <VendorGuard>{children}</VendorGuard>
    </Suspense>
  );
}
