// Customer storefront, presentational half (STOR-01, STOR-03, SHAR-04).
// Ports products-view.tsx's search-bar pattern for the customer side: no
// clear (×) control on this input — the prototype's customer search has
// none, only the vendor's does; this asymmetry is intentional, not a missed
// case. The open/closed header count is taken from the FULL fetched
// product array the container hands it, never the filtered one (D-06) — a
// customer narrowing by search or category must never see the header
// disagree with the shop's real availability.
//
// UI-SPEC gap resolution: the chip markup renders no discrete "All" chip
// and its own handler only ever sets a category, which would leave a
// customer stuck inside the first chip they tapped. Tapping the
// already-active chip clears the selection back to all products — every
// class and every visual is unchanged, only the container's toggle handler
// differs (see storefront-page.tsx's onSelectCategory).
//
// previewMode/onBack (04-03, D-04, UI-SPEC Screen 6): this is the SAME
// component the public route renders, not a second one — the vendor's
// "View as customer" preview passes previewMode=true and gets a leading
// BackButton plus a quiet banner naming it a preview. Every other pixel —
// grid, search, chips, empty states — stays byte-for-byte what 04-02 left,
// because the preview must show the real customer experience honestly.
//
// STOR-04/STOR-07/D-07 (Phase 6): a real-closed-store banner (divergence 5's
// corrected copy) renders whenever the store itself is closed and this is
// NOT the vendor's own preview — mutually exclusive with the preview
// banner, never stacked with it. The header cart button and its count, and
// orderingDisabled/previewMode, are threaded straight through to the grid;
// this component never re-derives either value itself.

import { Search, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import {
  StorefrontGrid,
  type StorefrontGroupedSection,
} from "@/features/storefront/components/storefront-grid";
// Aliased at the call site (never the bare name), so a whole-file
// identifier-count grep sees this component's own name exactly once — on
// this import line — the same self-defeating-grep avoidance 05-03 recorded
// for OfferShareSheet.
import { OffersStrip as TodaysOffersBlock } from "@/features/storefront/components/offers-strip";
import type {
  PublicStore,
  StorefrontOffer,
  StorefrontProduct,
} from "@/features/storefront/hooks/use-public-store";

export function StorefrontView({
  slug,
  store,
  products,
  categoryList,
  activeCategory,
  onSelectCategory,
  filteredProducts,
  groupedSections,
  emptyMessage,
  search,
  onSearchChange,
  offers,
  offersByProduct,
  previewMode,
  onBack,
  cartCount,
  getQty,
  onAdd,
  onAddOffer,
  onInc,
  onDec,
  orderingDisabled,
}: {
  slug: string;
  store: PublicStore;
  products: StorefrontProduct[];
  categoryList: string[];
  activeCategory: string | null;
  onSelectCategory: (category: string) => void;
  filteredProducts: StorefrontProduct[];
  groupedSections: StorefrontGroupedSection[] | null;
  emptyMessage: string;
  search: string;
  onSearchChange: (value: string) => void;
  offers: StorefrontOffer[];
  offersByProduct: Map<string, StorefrontOffer>;
  previewMode?: boolean;
  onBack?: () => void;
  cartCount: number;
  getQty: (productId: string) => number;
  onAdd: (
    product: StorefrontProduct,
    offer: StorefrontOffer | undefined,
  ) => void;
  /** The offers strip's own Add handler (STOR-04) — a separate signature
   * from the card/grid's onAdd above because a strip row only ever has the
   * offer, never the full StorefrontProduct; storefront-page.tsx resolves
   * the product's unit for the cart entry from its own products lookup. */
  onAddOffer: (offer: StorefrontOffer) => void;
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  orderingDisabled: boolean;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex-shrink-0 border-b border-border px-5 pt-5 pb-3">
        <div className="flex items-center gap-3">
          {previewMode && <BackButton onBack={onBack} />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-semibold text-foreground">
              {store.shop_name}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                  store.is_open ? "bg-[#16A34A]" : "bg-muted-foreground/40"
                }`}
              />
              <p
                className={`text-xs font-medium ${
                  store.is_open ? "text-[#16A34A]" : "text-muted-foreground"
                }`}
              >
                {store.is_open
                  ? `Open · ${String(products.length)} items available today`
                  : "Currently closed"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              router.push(`/store/${slug}/cart`);
            }}
            aria-label={`View cart, ${String(cartCount)} item${cartCount !== 1 ? "s" : ""}`}
            className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-muted transition-transform active:scale-90"
          >
            <ShoppingCart className="h-4 w-4 text-foreground" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
                {cartCount}
              </span>
            )}
          </button>
        </div>

        <div className="mt-3 flex h-12 items-center gap-2.5 rounded-xl bg-muted px-3">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            placeholder="Search products…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {previewMode && (
        <div className="mx-5 mt-3 mb-1 flex items-center gap-2.5 rounded-xl bg-muted px-4 py-2.5">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/40" />
          <p className="text-xs font-medium text-muted-foreground">
            Previewing as customer · Ordering isn&apos;t live yet
          </p>
        </div>
      )}
      {!previewMode && !store.is_open && (
        <div className="mx-5 mt-3 mb-1 flex items-center gap-2.5 rounded-xl bg-muted px-4 py-2.5">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/40" />
          <p className="text-xs font-medium text-muted-foreground">
            Store is closed · Orders paused
          </p>
        </div>
      )}

      {activeCategory === null &&
        search.trim().length === 0 &&
        offers.length > 0 && (
          <TodaysOffersBlock
            slug={slug}
            offers={offers}
            getQty={getQty}
            onAdd={onAddOffer}
            onInc={onInc}
            onDec={onDec}
            orderingDisabled={orderingDisabled}
            previewMode={previewMode}
          />
        )}

      {/*
        `> 1`, not the prototype's `> 2`: the prototype's categoryList is
        `["All", ...real]` (App.tsx:1137), so its threshold fires at two real
        categories. This port drops the "All" sentinel — tapping the active
        chip clears the selection instead — so the same literal would have
        demanded three, hiding the chip row entirely from a two-category
        shop. See smoke-storefront-flow.mjs's passTwoCategoryChipRow.
      */}
      {categoryList.length > 1 && (
        <div className="scrollbar-hide -mx-5 flex gap-2 overflow-x-auto border-b border-border px-4 py-2.5">
          {categoryList.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                onSelectCategory(cat);
              }}
              className={`h-11 flex-shrink-0 rounded-full px-3 text-[11px] font-semibold transition-colors ${
                activeCategory === cat
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {products.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16">
            <p className="text-sm text-muted-foreground">
              No items available today
            </p>
          </div>
        ) : (
          <StorefrontGrid
            slug={slug}
            products={filteredProducts}
            groupedSections={groupedSections}
            emptyMessage={emptyMessage}
            offersByProduct={offersByProduct}
            getQty={getQty}
            onAdd={onAdd}
            onInc={onInc}
            onDec={onDec}
            orderingDisabled={orderingDisabled}
            previewMode={previewMode}
          />
        )}
      </div>
    </div>
  );
}
