"use client";

// Manage Offers screen, presentational half (OFFR-02, D-03, D-07, D-10).
// Header shape matches product-detail-view.tsx's own BackButton + h1 +
// subtext — this screen is reached by forward navigation and needs a way
// back, unlike a bottom-nav tab. No data-fetching hook here —
// manage-offers-page already resolved activeOffers from the ONE shared
// use-offers.ts read; this component renders only what it is handed and
// re-derives nothing — a second filter or sort here could disagree with
// Home's own count, the exact drift D-03 exists to prevent.
//
// One sheet, two entry points, one recorded shape (D-10): `shareOffers`
// (null when closed) carries either a one-element array (a row's own Share
// tap) or the whole active array (the footer's "Share today's offers" tap,
// rendered only while at least one offer is active), and the one imported
// sheet component below renders both — matching products-view.tsx's own
// shareProduct/ProductShareSheet conditional-sibling pattern, with no
// second sheet and no second preview for the "all" case.
//
// The sheet's import is aliased to `ShareSheetForOffers` — the same rename
// discipline offer-share-sheet.tsx already applies to its own hook import —
// so the one JSX render site below never re-spells the component's own
// name; the sheet is named exactly once, on the import line that names it.
//
// WR-01 (05-REVIEW.md): the header count and the empty-state gate below are
// derived from `visibleOffers(activeOffers)`, NOT the raw prop — a row
// use-remove-offer.ts has marked `_pendingRemoval` must read as already
// gone here, the same way offer-row.tsx itself already treats it. The row
// MAP a few lines down deliberately keeps mapping the UNFILTERED
// `activeOffers`: that is what keeps offer-row.tsx's own mounted mutation
// instance alive through the optimistic cycle (05-02-SUMMARY.md's Deviation
// 1 — filtering here would unmount the very row whose own rollback-error
// state this project has already once shipped, then fixed, then nearly
// broken again). The empty-state block and the row-list block are therefore
// two INDEPENDENT conditionals, not one ternary: when every remaining offer
// is mid-delete, both can render at once — the empty-state message on top
// of a row list that is present in the tree but visually empty (every
// OfferRow in it is hiding itself) — so the header/message agree with what
// the vendor sees, without ever discarding OfferRow's own mutation state.

import { useState } from "react";
import { Plus, Share2, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { OfferRow } from "@/features/offers/components/offer-row";
import { OfferShareSheet as ShareSheetForOffers } from "@/features/offers/components/offer-share-sheet";
import type { Offer } from "@/features/offers/hooks/use-offers";
import { visibleOffers } from "@/features/offers/lib/visible-offers";

export function ManageOffersView({
  activeOffers,
  storeId,
}: {
  activeOffers: Offer[];
  storeId: string;
}) {
  const router = useRouter();
  const [shareOffers, setShareOffers] = useState<Offer[] | null>(null);
  const visible = visibleOffers(activeOffers);

  return (
    <div className="scrollbar-hide flex-1 overflow-y-auto pb-6">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 pt-5 pb-4">
        <BackButton />
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold text-foreground">
            Today&apos;s offers
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {visible.length > 0 ? (
              <>{visible.length} active today</>
            ) : (
              "Nothing promoted today"
            )}
          </p>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <Tag className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mb-1 text-sm font-semibold text-foreground">
            No offers today
          </p>
          <p className="text-xs text-muted-foreground">
            Add a special price to promote a product
          </p>
        </div>
      )}
      {activeOffers.length > 0 && (
        <div className="flex flex-col gap-3 px-5 pt-5 pb-8">
          {activeOffers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              storeId={storeId}
              onShare={(sharedOffer) => {
                setShareOffers([sharedOffer]);
              }}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5 px-5 pb-8">
        <button
          type="button"
          onClick={() => {
            router.push("/offers/add");
          }}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-semibold text-background transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add offer
        </button>
        {activeOffers.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShareOffers(activeOffers);
            }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-medium text-foreground transition-all active:scale-[0.98]"
          >
            <Share2 className="h-4 w-4 text-muted-foreground" />
            Share today&apos;s offers
          </button>
        )}
      </div>

      {shareOffers && (
        <ShareSheetForOffers
          sheetOffers={shareOffers}
          onClose={() => {
            setShareOffers(null);
          }}
        />
      )}
    </div>
  );
}
