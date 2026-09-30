// The one shared "what's actually still active" filter for WR-01
// (05-REVIEW.md). use-remove-offer.ts's optimistic delete MARKS the target
// row in the shared use-offers.ts cache (`_pendingRemoval: true`) instead of
// filtering it out — a deliberate fix, recorded in 05-02-SUMMARY.md's
// Deviation 1, for a real bug: filtering the row out of the array unmounts
// the OfferRow instance that owns the mutation, discarding its own isError
// state before a rolled-back failure could ever be shown. That means the
// SHARED cache can legitimately contain a row that is about to disappear,
// and every reader of that cache other than the row itself must treat it as
// already gone, or its own count/gate can visibly disagree with what the
// row itself is showing (WR-01's concrete repro: Home read the same cache
// entry and rendered a just-removed offer as fully active).
//
// Used by offers-card.tsx (both its count and its rendered rows — it owns
// no mutation of its own, so it has nothing to lose by filtering) and by
// manage-offers-view.tsx (its header count and its empty-state gate only —
// NOT the row map, which must keep receiving the unfiltered array so
// offer-row.tsx's own mounted instance survives the optimistic cycle; see
// use-remove-offer.ts's own header and manage-offers-view.tsx's own comment
// for why). offer-row.tsx itself never imports this — its existing
// `if (offer._pendingRemoval) return null;` branch is what keeps it
// mounted, and is intentionally left untouched by this fix.
import type { Offer } from "@/features/offers/hooks/use-offers";
import type { OfferWithPendingRemoval } from "@/features/offers/hooks/use-remove-offer";

export function visibleOffers(offers: OfferWithPendingRemoval[]): Offer[] {
  return offers.filter((offer) => !offer._pendingRemoval);
}
