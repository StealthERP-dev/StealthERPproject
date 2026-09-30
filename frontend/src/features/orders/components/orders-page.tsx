"use client";

// Orders container (ORDR-01). Copies Manage Offers' own container
// (manage-offers-page.tsx) nearly verbatim — the closest structural match in
// this phase: loading / error-with-retry / no-store branch order over the
// ONE shared use-orders.ts read, dropping that container's URL-filter
// machinery entirely (this screen has no status filter, no search, no
// category sheet — nothing in the requirement or the UI contract names
// one).
//
// D-08/ORDR-03: leaving this screen (route change or unmount) marks every
// currently-unseen order seen, via an effect CLEANUP — "leaving the tab" IS
// an unmount here, so the write belongs in the cleanup, not the effect body.
// The dependency list is `[storeId]` and NOTHING else: including the
// fetched orders array (or a derived array, or an inline callback) would
// re-run this cleanup on every data change, so the 30s poll (ORDR-04)
// picking up a newly-arrived order would mark IT seen while the vendor is
// still looking at the screen — silently defeating D-08 and looking, from
// the outside, like the New section draining itself. A force-closed
// app/tab while on this screen never fires a React cleanup at all; that gap
// is accepted (06-CONTEXT.md D-08's own wording is scoped to leaving the
// tab, an in-app concept) rather than chased with a page-lifecycle
// listener, which would mark orders seen on a mere app-switch — exactly the
// case ORDR-04's focus refetch exists to serve.

import { useEffect } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { useOrders } from "@/features/orders/hooks/use-orders";
import { useMarkOrdersSeen } from "@/features/orders/hooks/use-mark-orders-seen";
import { OrdersView } from "@/features/orders/components/orders-view";

export function OrdersPage() {
  const { store, loading, error, refresh } = useAuth();
  const ordersQuery = useOrders(store?.id ?? "");
  const markOrdersSeen = useMarkOrdersSeen(store?.id ?? "");
  const storeId = store?.id;

  useEffect(() => {
    return () => {
      if (storeId) {
        markOrdersSeen.mutate();
      }
    };
    // storeId ONLY — see this file's own header for why nothing derived
    // from ordersQuery may join this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  if (loading || ordersQuery.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || ordersQuery.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your orders.
        </p>
        <button
          onClick={() => {
            void refresh();
            void ordersQuery.refetch();
          }}
          className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return <OrdersView orders={ordersQuery.data} />;
}
