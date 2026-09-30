"use client";

// One Manage Offers row (OFFR-02, D-07, D-10). Owns the remove mutation
// directly so a failed removal's message stays local to the row that
// failed, never a page-wide banner — matching product-row.tsx's own
// precedent (product-row.tsx:139-143). The row is not itself a tap target
// (no onClick on the outer wrapper) — it matches the prototype exactly,
// which has no navigation from this row.
//
// 05-03 adds the Share control here, immediately before the remove control
// — the row's own share button opens the offer share sheet (owned by the
// parent, manage-offers-view.tsx) with exactly this one offer, matching
// D-10's "one" case. This plan lands that control together with the sheet
// it opens (see this plan's own prohibitions) — a visible control that
// opens nothing is exactly the defect this project already logged a ledger
// entry for once.
//
// Both icon controls are sized directly to forty-four pixels (Technique B),
// never given an invisible overhang: the row places its own controls
// twelve pixels apart, and an overhang on either would make hit areas
// intersect — the same overlap class this codebase's own toggle primitive
// already records once. Both also keep the row's neutral bg-muted fill,
// never a destructive-red treatment — D-07's own reasoning is that removing
// an offer is low-stakes (nothing of value is lost, the product itself is
// untouched), and Share carries no destructive connotation at all.
//
// Renders nothing while `offer._pendingRemoval` is set, rather than being
// removed from the list array — see use-remove-offer.ts's own header for
// why: a plain array-filter optimistic removal would unmount THIS component
// (the one that owns the mutation whose failure this row must report), so a
// rolled-back removal's error message would never be observable even though
// the rollback ran correctly. Hiding in place keeps this exact instance
// mounted across the whole optimistic cycle.

import { Package, Share2, X } from "lucide-react";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import {
  useRemoveOffer,
  type OfferWithPendingRemoval,
} from "@/features/offers/hooks/use-remove-offer";

const GENERIC_ERROR = "Something went wrong. Try again.";

function PlaceholderThumb() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="h-5 w-5 text-muted-foreground/50" />
    </div>
  );
}

export function OfferRow({
  offer,
  storeId,
  onShare,
}: {
  offer: OfferWithPendingRemoval;
  storeId: string;
  onShare: (offer: OfferWithPendingRemoval) => void;
}) {
  const removeOffer = useRemoveOffer(storeId);
  // Per-product accessible name (Copywriting Contract's own flagged
  // correction over the prototype's generic, identical-on-every-row label):
  // a screen-reader user scanning several offer rows must be able to tell
  // them apart by accessible name alone.
  const productName = offer.product_name;

  function handleRemove() {
    removeOffer.mutate({ offerId: offer.id });
  }

  if (offer._pendingRemoval) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        <div className="h-[52px] w-[52px] flex-shrink-0 overflow-hidden rounded-xl bg-muted">
          {offer.product_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded to Supabase Storage, no fixed domain for next/image yet (photo pipeline lands in a later plan)
            <img
              src={offer.product_image_url}
              alt={productName}
              className="h-full w-full object-cover"
            />
          ) : (
            <PlaceholderThumb />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{productName}</p>
          {offer.regular_price != null && (
            <p className="mt-0.5 text-xs leading-none text-muted-foreground line-through">
              ₹{formatPriceDisplay(offer.regular_price)}
            </p>
          )}
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            ₹{formatPriceDisplay(offer.offer_price)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              today
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onShare(offer);
          }}
          aria-label={`Share ${productName}'s offer`}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-muted transition-transform active:scale-90"
        >
          <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={handleRemove}
          aria-label={`Remove ${productName}'s offer`}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-muted transition-transform active:scale-90"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      {removeOffer.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {GENERIC_ERROR}
        </p>
      )}
    </div>
  );
}
