"use client";

// Home's offers card (HOME-04, D-03). Presentational only — activeOffers is
// resolved by home-page.tsx from the ONE shared use-offers.ts read, already
// carrying all three explicit filters (date, availability, priceability);
// this component derives nothing from the network and re-filters nothing:
// the count and the two previewed rows both come from the length and the
// head of the SAME array, so they cannot disagree by construction (Phase
// 4's D-06 rule, applied here to a secondary card).
//
// Copy divergence 1 (05-UI-SPEC.md header): HOME-04's own composition
// supersedes the prototype's original Home-card copy ("No offers today ·
// Add one", a single preview + "+N more", "View all offers"). Every one of
// those three prototype strings is deliberately absent below, not a missed
// port — this card's own empty-state line, non-empty header and the CTA to
// the full offers list read differently by design. No overflow chip
// renders here even with more than two active offers; that affordance
// lives one tap away, at the full list.
//
// No "Save ₹X" caption anywhere on this card — that caption is
// customer-facing only (storefront strip/card/detail), never rendered on a
// vendor-facing screen (Copywriting Contract's own vendor/customer rule).
//
// WR-01 (05-REVIEW.md): activeOffers may still contain a row
// use-remove-offer.ts has marked `_pendingRemoval` — never filtered out of
// the shared cache, so offer-row.tsx's own mounted instance survives its
// optimistic delete cycle (see that hook's own header). This card owns no
// mutation of its own, so unlike offer-row.tsx it has nothing to lose by
// filtering: visibleOffers() derives BOTH the count and the two previewed
// rows from the SAME filtered array, so a vendor who has just tapped Remove
// on Manage Offers never sees that same offer rendered here as fully active
// (the exact cross-screen defect this rule exists to prevent).

import { ChevronRight, Package, Plus } from "lucide-react";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import type { Offer } from "@/features/offers/hooks/use-offers";
import { visibleOffers } from "@/features/offers/lib/visible-offers";

function PlaceholderThumb() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="h-5 w-5 text-muted-foreground/50" />
    </div>
  );
}

export function OffersCard({
  activeOffers,
  onAddOffer,
  onManageOffers,
}: {
  activeOffers: Offer[];
  onAddOffer: () => void;
  onManageOffers: () => void;
}) {
  // WR-01: filtered once, here — the count and the rows below both come
  // from THIS array, never the raw activeOffers prop, so a row
  // use-remove-offer.ts has marked `_pendingRemoval` can never render as
  // active here even while it stays mounted (and hidden) on Manage Offers.
  const visible = visibleOffers(activeOffers);
  // The shared read already orders newest-created first; this takes the
  // head of that order rather than sorting or filtering again — either
  // would be a second place that could disagree with the count above.
  const topTwoOffers = visible.slice(0, 2);

  return (
    <div className="mx-5 mb-6">
      <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Today&apos;s offers
      </p>
      {visible.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
          <p className="text-sm text-muted-foreground">
            Nothing promoted today
          </p>
          <button
            type="button"
            onClick={onAddOffer}
            className="flex h-11 flex-shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3.5 transition-transform active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5 text-background" />
            <span className="text-sm font-semibold text-background">
              Add offer
            </span>
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <p className="px-4 pt-3.5 pb-1 text-xs text-muted-foreground">
            {visible.length} active today
          </p>
          <div className="flex flex-col gap-2.5 px-4 pb-3">
            {topTwoOffers.map((offer) => (
              <div key={offer.id} className="flex items-center gap-3">
                <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-xl bg-muted">
                  {offer.product_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded to Supabase Storage, no fixed domain for next/image yet (photo pipeline lands in a later plan)
                    <img
                      src={offer.product_image_url}
                      alt={offer.product_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderThumb />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {offer.product_name}
                  </p>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-sm leading-none font-bold text-foreground">
                      ₹{formatPriceDisplay(offer.offer_price)}
                    </span>
                    {offer.regular_price != null && (
                      <span className="text-[10px] text-muted-foreground line-through">
                        ₹{formatPriceDisplay(offer.regular_price)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 pt-3 pb-3.5">
            <button
              type="button"
              onClick={onManageOffers}
              className="flex h-11 items-center gap-1 text-sm font-semibold text-foreground transition-opacity active:opacity-60"
            >
              Manage offers
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
