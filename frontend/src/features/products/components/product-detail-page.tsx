"use client";

// Product detail container (PROD-02/06). Copies storefront-page.tsx's
// loading/error/not-found branching order and home-page.tsx's toggle-wiring
// shape. Resolves its product from the SAME shared ['products', storeId]
// cache the list already reads, through the identical products hook below —
// never a second query of its own — so the row and the detail page can
// never disagree; a per-product query key would recreate exactly the drift
// PROD-02 exists to prevent.
//
// A fetch that failed and a fetch that resolved with no matching row are two
// different branches, never one: trying again for an id that will never
// resolve cannot ever succeed, so only the fetch-error branch offers that
// control — the same distinction storefront-page.tsx already makes between
// its own error and not-found branches.

import { useAuth } from "@/features/auth/auth-provider";
import { useProducts } from "@/features/products/hooks/use-products";
import { useToggleProductAvailable } from "@/features/products/hooks/use-toggle-product-available";
import { ProductDetailView } from "@/features/products/components/product-detail-view";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function LoadErrorShell({ onTryAgain }: { onTryAgain: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load this product.
      </p>
      <button
        onClick={onTryAgain}
        className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
      >
        Retry
      </button>
    </div>
  );
}

function NotFoundShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Product not found</p>
    </div>
  );
}

export function ProductDetailPage({ id }: { id: string }) {
  const { store, loading: authLoading, error: authError, refresh } = useAuth();
  const storeId = store?.id ?? "";
  const productsQuery = useProducts(storeId);
  const toggleAvailable = useToggleProductAvailable(storeId);

  function tryAgain() {
    void refresh();
    void productsQuery.refetch();
  }

  if (authLoading || productsQuery.isPending) {
    return <LoadingShell />;
  }

  if (authError || productsQuery.isError) {
    return <LoadErrorShell onTryAgain={tryAgain} />;
  }

  if (!store) {
    return <LoadingShell />;
  }

  const product = productsQuery.data.find((row) => row.id === id);

  if (!product) {
    // A resolved fetch that simply has no matching row — its own branch,
    // deliberately with no retry control (see the file header).
    return <NotFoundShell />;
  }

  // Narrowed once for the closure below — TypeScript's narrowing of
  // `product` does not persist into a nested function declaration on its
  // own (same reason home-page.tsx's handleToggleOpen narrows `store` into
  // `currentStore` first).
  const currentProduct = product;

  function handleToggle() {
    toggleAvailable.mutate({
      productId: currentProduct.id,
      nextAvailable: !currentProduct.available,
    });
  }

  return (
    <ProductDetailView
      product={product}
      onToggle={handleToggle}
      toggleFailed={toggleAvailable.isError}
    />
  );
}
