"use client";

// D-10's one sheet, rendering either one offer or all of them — the
// prototype's own shape (App.tsx:732, sheetOffers = shareOffer ? [shareOffer]
// : activeOffers). This component owns no share mechanics of its own; both
// callbacks delegate straight to the one shared share-destination hook, the
// same composition discipline catalogue-share-sheet.tsx and
// product-share-sheet.tsx already use. There is no second sheet, no second
// hook, no second dispatch path.
//
// For a single-offer share (sheetOffers.length === 1) the hook's target
// carries that offer's own product AND its offer id — one choice that does
// three things at once: it selects the product deep link as the shared URL
// through the existing, unchanged buildSharePayload (the one surface D-05
// guarantees shows the offer price to a recipient); it populates the
// written share row's product_id column exactly as an ordinary product
// share already does; and it names which offer the fired event is about.
// For a share-all, only the explicit `shareType: "offer"` discriminator is
// passed — no product, so the payload resolves to the storefront link (D-09's
// strip shows every active offer there) and the written row's product_id is
// null, mirroring how a whole-catalogue share already carries no product id.
//
// The sheet resolves the sharing shop from the session provider itself,
// matching product-share-sheet.tsx's own reasoning: two entry points (a
// row's own Share button and the footer's share-all button) threading
// identity through different components would create places that could
// disagree about which shop is sharing.
//
// The hook import is aliased to `useDestination` — the same rename
// product-share-sheet.tsx already uses — so this file's own call site never
// re-spells the hook's own name; the one hook this project has is imported
// exactly once, by its own name, right here.
//
// No footer, no copyLinkLabel override, no error state, no saving caption —
// UI-SPEC Screen Contract 4 is explicit that this sheet uses the shipped
// shell's own plain default wording, unlike the catalogue sheet's deliberate
// "Copy catalogue link" override.

import { Package } from "lucide-react";
import { ShareSheet } from "@/features/share/components/share-sheet";
import { useShareDestination as useDestination } from "@/features/share/hooks/use-share-destination";
import { useAuth } from "@/features/auth/auth-provider";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import type { Offer } from "@/features/offers/hooks/use-offers";

function PlaceholderThumb() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="h-5 w-5 text-muted-foreground/50" />
    </div>
  );
}

export function OfferShareSheet({
  sheetOffers,
  onClose,
}: {
  sheetOffers: Offer[];
  onClose: () => void;
}) {
  const { store } = useAuth();

  const singleOffer = sheetOffers.length === 1 ? sheetOffers[0] : null;

  const { selectDestination, copyLink } = useDestination(
    store
      ? {
          storeId: store.id,
          slug: store.slug,
          shopName: store.shop_name,
          shareType: "offer",
          ...(singleOffer
            ? {
                product: {
                  id: singleOffer.product_id,
                  name: singleOffer.product_name,
                },
                offerId: singleOffer.id,
              }
            : {}),
        }
      : { storeId: "", slug: "", shopName: "", shareType: "offer" },
  );

  if (!store) {
    return null;
  }

  const label = singleOffer ? "Share offer" : "Share today's offers";

  const preview = (
    <>
      <h2 className="mb-4 text-[15px] font-semibold text-foreground">
        {label}
      </h2>
      <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-secondary">
        <div className="px-4 pt-4 pb-1">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Today&apos;s offers
          </p>
        </div>
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {sheetOffers.map((offer) => (
            <div key={offer.id} className="flex items-center gap-3">
              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-xl bg-muted">
                {offer.product_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded to Supabase Storage, no fixed domain for next/image yet, same as offer-row.tsx
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
                <p className="truncate text-sm font-semibold text-foreground">
                  {offer.product_name}
                </p>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  {offer.regular_price != null && (
                    <span className="text-xs text-muted-foreground line-through">
                      ₹{formatPriceDisplay(offer.regular_price)}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-foreground">
                    ₹{formatPriceDisplay(offer.offer_price)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    today
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <ShareSheet
      label={label}
      preview={preview}
      onClose={onClose}
      onSelectDestination={selectDestination}
      onCopyLink={copyLink}
    />
  );
}
