"use client";

// Customer storefront container (STOR-01, STOR-03, SHAR-04, DATA-06). Same
// branch order it has always had: loading, error, shop-not-found, ready.
// Fires catalogue_opened exactly once per mount, only once a shop has
// resolved (mirrors product-detail-page.tsx's identical guard for
// product_viewed) — nothing fires when no shop resolved, since nothing was
// opened.
//
// Ordering is gone from this route entirely (D-04's correction): the
// order-form component import and its render call are deleted, not
// flagged — a boolean prop would be one accidental `true` away from
// resurrecting a live checkout path with no cart behind it. The deleted
// form and its mutation hook stay on disk, imported by nothing, for Phase 6
// to rewrite against its real cart. Both the real public route and the
// customer preview render through this one container (previewMode/onBack,
// 04-03), so this single deletion and the catalogue_opened guard below
// cover both surfaces.
//
// UI-SPEC gap resolution: the shipped chip markup has no discrete "All"
// chip and its handler only ever sets a category, leaving a customer stuck
// inside the first chip they tap. onSelectCategory below clears
// activeCategory back to null (all products) when the already-active chip
// is tapped again — the smallest change that keeps every class and every
// visual in the markup unchanged.

import { useEffect, useRef, useState } from "react";
import { usePublicStore } from "@/features/storefront/hooks/use-public-store";
import { useCart } from "@/features/storefront/hooks/use-cart";
import { StorefrontView } from "@/features/storefront/components/storefront-view";
import { NotFoundView } from "@/features/storefront/components/not-found-view";
import { logEvent } from "@/lib/analytics/log-event";
import type { StorefrontGroupedSection } from "@/features/storefront/components/storefront-grid";
import type {
  StorefrontOffer,
  StorefrontProduct,
} from "@/features/storefront/hooks/use-public-store";

export function StorefrontPage({
  slug,
  previewMode,
  onBack,
}: {
  slug: string;
  previewMode?: boolean;
  onBack?: () => void;
}) {
  const { data, isPending, isError, refetch } = usePublicStore(slug);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const cart = useCart(slug);

  const store = data?.store ?? null;
  const firedRef = useRef(false);

  useEffect(() => {
    // !previewMode: firing this from the vendor's own preview would misattribute a customer-open event to the vendor.
    if (store && !firedRef.current && !previewMode) {
      firedRef.current = true;
      void logEvent({ eventName: "catalogue_opened", slug });
    }
  }, [store, slug, previewMode]);

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load this shop.
        </p>
        <button
          onClick={() => {
            void refetch();
          }}
          className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data.store) {
    return <NotFoundView variant="shop" />;
  }

  const products = data.products;
  // The one product-keyed offers lookup, built once here and threaded down
  // to both the strip and the grid — so the strip and a product's own card
  // can never independently disagree about which product has which offer.
  // Neither StorefrontView nor StorefrontGrid nor StorefrontProductCard ever
  // re-derives the date, availability or priceability filters themselves;
  // those three live in use-public-store.ts alone.
  const offers = data.offers;
  const offersByProduct = new Map(
    offers.map((offer) => [offer.productId, offer]),
  );
  // The strip's own Add handler needs a product's unit, which StorefrontOffer
  // does not carry (it only has the offer's own priced fields plus the
  // product's name/image) — this lookup resolves it from the SAME products
  // array the grid already uses, never a second fetch.
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  const categoryList = Array.from(
    new Set(
      products
        .map((product) => product.category_name)
        .filter((name): name is string => Boolean(name)),
    ),
  );

  const trimmedSearch = search.trim().toLowerCase();
  const searching = trimmedSearch.length > 0;

  const filteredProducts = products.filter((product) => {
    const matchSearch =
      !searching || product.name.toLowerCase().includes(trimmedSearch);
    const matchCategory =
      activeCategory === null || product.category_name === activeCategory;
    return matchSearch && matchCategory;
  });

  // Grouped sections only apply to the "All" state with no active search —
  // otherwise the flat filtered grid above is what renders (UI-SPEC Screen
  // 4). Sections follow the chip list's own order; any product without a
  // category renders last in one unlabelled bucket, and a shop with no
  // categories at all therefore produces a single unlabelled section.
  const groupedSections: StorefrontGroupedSection[] | null =
    !searching && activeCategory === null
      ? (() => {
          const sections: StorefrontGroupedSection[] = categoryList.map(
            (label) => ({
              label,
              products: products.filter(
                (product) => product.category_name === label,
              ),
            }),
          );
          const uncategorised = products.filter(
            (product) => product.category_name === null,
          );
          if (uncategorised.length > 0) {
            sections.push({ label: null, products: uncategorised });
          }
          return sections;
        })()
      : null;

  const emptyMessage = searching
    ? `No results for "${search}"`
    : "No products in this category";

  // One derivation, many consumers (D-09's own naming, extended here per
  // divergence 6): preview mode disables ordering unconditionally,
  // independent of the shop's own open state (the preview banner already
  // says ordering isn't live), OR the shop itself being closed. Computed
  // once here and threaded to the grid/card/strip — never recomputed in a
  // child.
  const orderingDisabled = Boolean(previewMode) || !data.store.is_open;

  function onSelectCategory(category: string) {
    setActiveCategory((prev) => (prev === category ? null : category));
  }

  function onAdd(
    product: StorefrontProduct,
    offer: StorefrontOffer | undefined,
  ) {
    cart.add({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      hadOffer: Boolean(offer),
    });
  }

  // The strip's own Add handler (STOR-04): every offer here is already
  // available-product-joined (use-public-store.ts's own filter), so the
  // lookup below always resolves — the `?? ""` fallback is defensive only,
  // never expected to be exercised.
  function onAddOffer(offer: StorefrontOffer) {
    const product = productsById.get(offer.productId);
    cart.add({
      productId: offer.productId,
      name: offer.productName,
      unit: product?.unit ?? "",
      hadOffer: true,
    });
  }

  return (
    <StorefrontView
      slug={slug}
      store={data.store}
      products={products}
      categoryList={categoryList}
      activeCategory={activeCategory}
      onSelectCategory={onSelectCategory}
      filteredProducts={filteredProducts}
      groupedSections={groupedSections}
      emptyMessage={emptyMessage}
      search={search}
      onSearchChange={setSearch}
      offers={offers}
      offersByProduct={offersByProduct}
      previewMode={previewMode}
      onBack={onBack}
      cartCount={cart.cartCount}
      getQty={cart.getQty}
      onAdd={onAdd}
      onAddOffer={onAddOffer}
      onInc={cart.increment}
      onDec={cart.decrement}
      orderingDisabled={orderingDisabled}
    />
  );
}
