"use client";

// Customer product-detail container (STOR-04, STOR-08, DATA-06). Copies
// storefront-page.tsx's and the vendor product-detail-page.tsx's
// loading/error/not-found branch order. Unlike the vendor version there is
// no useAuth() call here — slug/id come as props from the server page.tsx
// wrapper, and usePublicStoreProduct(slug, id) is the only data source.
//
// This container has NO preview-mode prop — it is customer-only, reached
// only via a real URL, never through Home's "Preview as customer" overlay
// (unlike storefront-page.tsx, which that overlay renders directly).
// orderingDisabled here therefore collapses to the shop's own open state
// alone; if a later phase ever renders this container inside a preview, it
// must gain the prop rather than inferring the mode.

import { useEffect, useRef } from "react";
import { usePublicStoreProduct } from "@/features/storefront/hooks/use-public-store-product";
import { useCart } from "@/features/storefront/hooks/use-cart";
import { StorefrontProductDetailView } from "@/features/storefront/components/product-detail-view";
import { NotFoundView } from "@/features/storefront/components/not-found-view";
import { logEvent } from "@/lib/analytics/log-event";

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

export function StorefrontProductPage({
  slug,
  id,
}: {
  slug: string;
  id: string;
}) {
  const { data, isPending, isError, refetch } = usePublicStoreProduct(slug, id);
  const cart = useCart(slug);

  // Fires product_viewed exactly once per mount, once a product has
  // resolved — never on either not-found branch (nothing was viewed). The
  // ref guard is what stops a re-render (e.g. a refetch resolving to the
  // same product again) from firing it twice.
  const firedRef = useRef(false);
  const viewedProduct = data?.product ?? null;

  useEffect(() => {
    if (viewedProduct && !firedRef.current) {
      firedRef.current = true;
      void logEvent({
        eventName: "product_viewed",
        slug,
        productId: viewedProduct.id,
      });
    }
  }, [viewedProduct, slug]);

  if (isPending) {
    return <LoadingShell />;
  }

  if (isError) {
    return (
      <LoadErrorShell
        onTryAgain={() => {
          void refetch();
        }}
      />
    );
  }

  if (!data.store) {
    return <NotFoundView variant="shop" />;
  }

  if (!data.product) {
    return <NotFoundView variant="product" slug={slug} />;
  }

  const product = data.product;
  const offer = data.offer;
  // The same "one derivation" discipline storefront-page.tsx follows —
  // collapsed to the shop's open state alone here, per this container's own
  // header note above.
  const orderingDisabled = !data.store.is_open;

  function onAdd() {
    cart.add({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      hadOffer: Boolean(offer),
    });
  }

  return (
    <StorefrontProductDetailView
      slug={slug}
      product={product}
      offer={offer}
      qty={cart.getQty(product.id)}
      onAdd={onAdd}
      onInc={() => {
        cart.increment(product.id);
      }}
      onDec={() => {
        cart.decrement(product.id);
      }}
      orderingDisabled={orderingDisabled}
      cartCount={cart.cartCount}
    />
  );
}
