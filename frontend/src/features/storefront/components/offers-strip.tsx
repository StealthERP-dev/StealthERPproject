"use client";

// The storefront offers strip (STOR-02, STOR-04, D-03, D-07, D-09,
// divergence 4). Each row is now a container holding TWO sibling real
// buttons — one wrapping the thumbnail, name and price (navigates to the
// product's own route), one holding Add or the stepper — never one
// whole-row button, which would nest the stepper's own buttons inside an
// outer button (invalid HTML, inconsistent across browsers). Copies the
// two-sibling-button restructuring storefront-product-card.tsx already
// established for the identical reason (that file's own header comment
// records why); qty, the three handlers, orderingDisabled and previewMode
// all come from the container (storefront-page.tsx via storefront-view.tsx)
// — this component never recomputes any of them.
//
// This component renders rows and nothing else. It never decides whether
// the strip appears at all — storefront-view.tsx owns that gate — and it
// never re-derives the date, availability or priceability filters itself;
// all three already live in use-public-store.ts, once, for every consumer.

import { useRouter } from "next/navigation";
import { Minus, Package, Plus } from "lucide-react";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import type { StorefrontOffer } from "@/features/storefront/hooks/use-public-store";

function PlaceholderThumb() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="h-5 w-5 text-muted-foreground/50" />
    </div>
  );
}

export function OffersStrip({
  slug,
  offers,
  getQty,
  onAdd,
  onInc,
  onDec,
  orderingDisabled,
  previewMode,
}: {
  slug: string;
  offers: StorefrontOffer[];
  getQty: (productId: string) => number;
  onAdd: (offer: StorefrontOffer) => void;
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  orderingDisabled: boolean;
  previewMode?: boolean;
}) {
  const router = useRouter();

  return (
    <div className="mb-1 px-3 pt-3">
      <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Today&apos;s offers
      </p>
      <div className="flex flex-col gap-2">
        {offers.map((offer) => {
          const qty = getQty(offer.productId);
          return (
            <div
              key={offer.id}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5"
            >
              <button
                type="button"
                onClick={() => {
                  router.push(`/store/${slug}/p/${offer.productId}`);
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity active:opacity-90"
              >
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                  {offer.productImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- vendor-uploaded to Supabase Storage, no fixed domain for next/image
                    <img
                      src={offer.productImageUrl}
                      alt={offer.productName}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderThumb />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">
                    {offer.productName}
                  </p>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-sm leading-none font-bold text-foreground">
                      ₹{formatPriceDisplay(offer.offerPrice)}
                    </span>
                    {offer.regularPrice != null && (
                      <span className="text-[10px] text-muted-foreground line-through">
                        ₹{formatPriceDisplay(offer.regularPrice)}
                      </span>
                    )}
                    {offer.saving != null && offer.saving > 0 && (
                      <span className="text-[9px] font-semibold text-[#D97706]">
                        Save ₹{formatPriceDisplay(offer.saving)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              {orderingDisabled ? (
                <span className="flex-shrink-0 px-2 text-[10px] text-muted-foreground">
                  {previewMode ? "Add" : "Closed"}
                </span>
              ) : qty > 0 ? (
                <div className="flex h-11 flex-shrink-0 items-center gap-1 rounded-lg bg-foreground px-0">
                  <button
                    type="button"
                    onClick={() => {
                      onDec(offer.productId);
                    }}
                    aria-label={`Remove one ${offer.productName}`}
                    className="flex h-11 w-11 items-center justify-center transition-transform active:scale-90"
                  >
                    <Minus className="h-3 w-3 text-background" />
                  </button>
                  <span className="w-5 text-center text-xs font-semibold text-background">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onInc(offer.productId);
                    }}
                    disabled={qty >= 99}
                    aria-label={`Add one more ${offer.productName}`}
                    className="flex h-11 w-11 items-center justify-center transition-transform active:scale-90 disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3 text-background" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onAdd(offer);
                  }}
                  className="h-11 flex-shrink-0 rounded-lg bg-foreground px-3 text-[11px] font-semibold text-background transition-transform active:scale-95"
                >
                  Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
