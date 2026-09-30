"use client";

// Manage Offers container (OFFR-02). Copies products-page.tsx's loading /
// error-with-retry / no-store branch order over the ONE shared
// use-offers.ts read, dropping that container's URL-filter machinery
// entirely — this screen has no status filter, no search and no category
// sheet, because neither the requirement nor the UI contract names one.
// Closer in shape to storefront-page.tsx's own plain branch order than to
// its own most literal analog.

import { useAuth } from "@/features/auth/auth-provider";
import * as offersData from "@/features/offers/hooks/use-offers";
import { ManageOffersView } from "@/features/offers/components/manage-offers-view";

export function ManageOffersPage() {
  const { store, loading, error, refresh } = useAuth();
  const offersQuery = offersData.useOffers(store?.id ?? "");

  if (loading || offersQuery.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || offersQuery.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your offers.
        </p>
        <button
          onClick={() => {
            void refresh();
            void offersQuery.refetch();
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

  return (
    <ManageOffersView activeOffers={offersQuery.data} storeId={store.id} />
  );
}
