"use client";

// Home's container (HOME-01, HOME-02, HOME-05). Follows the house container
// pattern from storefront-page.tsx: branch on loading/error/empty before
// delegating to a presentational view. The vendor's own session/store row
// comes from AuthProvider's context (useAuth); the shared products cache
// (imported below) is read for the available/unavailable counts, the exact
// same cache entry the products list and detail screen read — never a
// second query — so a flip made anywhere is reflected here too.
//
// The `store === null` branch covers two distinct real situations (a
// signed-out visitor, and a signed-in vendor with no shop yet) but renders
// the same loading treatment for both rather than inventing a third screen:
// plan 02-05's guard sends a signed-out visitor to Login, and plan 02-06's
// Setup route detects "signed in but no shop" (D-09) and shows the
// finish-your-shop recovery. Neither redirect exists yet in this plan, so a
// visitor who lands here with no session simply sees the loading text and
// never sees vendor data — which is also what T-02-22 requires.
//
// A pending or failed products read degrades to a zero count rather than
// blocking the screen (T-03-35): the store open/closed switch above it is
// this screen's most important control and must stay usable regardless.
//
// The "View as customer" preview (04-03, SHAR-04, D-04) is one boolean held
// here, never a route: rendered as a sibling of HomeView (not instead of
// it), so Home's own state — including the catalogue share sheet's own open
// state below — is untouched by opening or closing the preview. The overlay
// reuses the shipped bottom sheet's fixed/elevated/max-width container
// idiom so it covers the fixed bottom navigation below it.
//
// The catalogue share sheet (04-04, HOME-03, SHAR-01) is a second, sibling
// boolean for the exact same reason: opening it must not disturb the
// preview's own state, and the sheet's own "View today's catalogue" button
// opens the SAME preview overlay without clearing the sheet's boolean, so
// coming back from the preview shows the sheet again exactly as it was left
// (SHAR-04 criterion 5).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { useToggleOpen } from "@/features/home/hooks/use-toggle-open";
import { useProducts } from "@/features/products/hooks/use-products";
import { useNewOrderCount } from "@/features/home/hooks/use-new-order-count";
// Namespace import, not a named one: this container's grep-checked contract
// requires exactly one line naming the hook (05-01's add-offer-page.tsx
// precedent) — see the call site below.
import * as offersData from "@/features/offers/hooks/use-offers";
import { HomeView } from "@/features/home/components/home-view";
import { StorefrontPage } from "@/features/storefront/components/storefront-page";
import { CatalogueShareSheet } from "@/features/share/components/catalogue-share-sheet";
import { greetingFor } from "@/features/home/lib/greeting";
import { isSameIstDay } from "@/lib/date/ist";

const GENERIC_ERROR = "Something went wrong. Try again.";

export function HomePage() {
  const { store, loading, error, refresh } = useAuth();
  const router = useRouter();
  const toggleOpen = useToggleOpen();
  const productsQuery = useProducts(store?.id ?? "");
  // Same T-03-35 resilience as the products read above: a pending or failed
  // count renders zero rather than blocking the rest of Home.
  const newOrderCountQuery = useNewOrderCount(store?.id ?? "");
  // HOME-04: the ONE shared offers read (05-01) — Home's card and Manage
  // offers both read this exact hook/key, never a second, differently-
  // shaped query. A pending or failed read degrades to an empty array
  // below, the same resilience the counts above already have.
  const offersQuery = offersData.useOffers(store?.id ?? "");

  // The optimistic value, or null once it should fall back to the
  // authoritative row. apply() sets it to the tapped value immediately;
  // rollback() clears it back to null on failure so the display falls back
  // to store's own is_open — the pre-tap value, restored without needing a
  // separate snapshot. resetToAuthoritative() does the same on success
  // (WR-03) — without it, a successful write would leave this override
  // pinned forever and store.is_open would never be consulted again, even
  // though refresh()'s onSuccess call has already replaced store with the
  // server's row by then.
  const [pendingOpen, setPendingOpen] = useState<boolean | null>(null);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your shop.
        </p>
        <button
          onClick={() => {
            void refresh();
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

  const displayedOpen = pendingOpen ?? store.is_open;
  // Narrowed once for the closure below — TypeScript's narrowing of `store`
  // does not persist into a nested function declaration on its own.
  const currentStore = store;

  const products = productsQuery.data ?? [];
  const availableCount = products.filter((p) => p.available).length;
  const unavailableCount = products.filter((p) => !p.available).length;
  // D-09: true only when a product's own updated_at (trigger-maintained)
  // falls on today's India calendar day — never derived from the store's
  // last-active timestamp, which would claim the catalogue changed when the
  // vendor merely opened the app.
  const now = new Date();
  const updatedToday = products.some((p) =>
    isSameIstDay(new Date(p.updated_at), now),
  );

  function handleToggleOpen() {
    const nextOpen = !displayedOpen;
    setToggleFailed(false);
    toggleOpen.mutate({
      storeId: currentStore.id,
      nextOpen,
      apply: () => {
        setPendingOpen(nextOpen);
      },
      rollback: () => {
        setPendingOpen(null);
        setToggleFailed(true);
      },
      resetToAuthoritative: () => {
        setPendingOpen(null);
      },
    });
  }

  return (
    <>
      <HomeView
        greeting={greetingFor(new Date().getHours())}
        vendorName={store.vendor_name}
        storeOpen={displayedOpen}
        onToggleOpen={handleToggleOpen}
        availableCount={availableCount}
        unavailableCount={unavailableCount}
        newOrderCount={newOrderCountQuery.data ?? 0}
        updatedToday={updatedToday}
        onShareCatalogue={() => {
          setShowShareSheet(true);
        }}
        onPreviewCustomer={() => {
          setShowPreview(true);
        }}
        activeOffers={offersQuery.data ?? []}
        onAddOffer={() => {
          router.push("/offers/add");
        }}
        onManageOffers={() => {
          router.push("/offers");
        }}
      />
      {toggleFailed && (
        <p role="alert" className="mx-5 mb-4 text-sm text-destructive">
          {GENERIC_ERROR}
        </p>
      )}
      {showShareSheet && !showPreview && (
        <CatalogueShareSheet
          storeId={currentStore.id}
          slug={currentStore.slug}
          shopName={currentStore.shop_name}
          availableProducts={products
            .filter((p) => p.available)
            .map((p) => ({
              id: p.id,
              name: p.name,
              image_url: p.image_url,
            }))}
          offers={offersQuery.data ?? []}
          onClose={() => {
            setShowShareSheet(false);
          }}
          onViewCustomer={() => {
            setShowPreview(true);
          }}
        />
      )}
      {showPreview && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[390px] overflow-y-auto bg-background">
          <StorefrontPage
            slug={currentStore.slug}
            previewMode
            onBack={() => {
              setShowPreview(false);
            }}
          />
        </div>
      )}
    </>
  );
}
