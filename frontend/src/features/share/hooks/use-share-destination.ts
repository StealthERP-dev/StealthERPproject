"use client";

// The one place a share is recorded, its event fired, and the browser is
// dispatched to a destination (HOME-03, SHAR-01, SHAR-03, DATA-06). Composes
// use-save-product.ts's direct-table-insert-then-fire-event idiom with
// use-toggle-open.ts's fire-before-navigate discipline — no existing hook in
// this project mixes a DB insert with a native browser API call, so this one
// is assembled from those two shapes rather than cloned from either.
//
// The catalogue_shares insert below is issued but DELIBERATELY NOT AWAITED
// before the destination dispatch: the native share API requires the
// click's own user activation to still be live, and an awaited network
// round trip inside the handler can end it (iOS Safari is the documented
// risk). Pitfall 3's real requirement is only that the write be issued
// before any navigation and that the page survive to finish it — opening
// WhatsApp in a NEW TAB (never location.href) guarantees that; a same-tab
// navigation would not.
//
// Every destination still records its OWN destination label, even though
// three of the four buttons (Status, Instagram, Other) call the identical
// native-share function (D-05) — the beta analytics want what the vendor
// intended to share to, not which app the OS sheet happened to hand the
// payload to. All three stay mechanically identical on purpose; this is an
// approved decision, not an oversight to "fix" into one shared button.
//
// A dismissed native share (the OS sheet's own cancellation, surfaced as a
// DOMException named AbortError) is swallowed silently — the vendor is
// shown nothing, because a share they abandoned is not a failure. Any OTHER
// native-share rejection falls through to copying the link (D-05's stated
// fallback), and when the native-share function does not exist at all the
// link is copied directly, with no attempt.

import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import {
  COPY_LINK_DESTINATION,
  type ShareDestinationLabel,
} from "@/features/share/constants";
import {
  buildSharePayload,
  buildWhatsAppUrl,
} from "@/features/share/lib/share-payload";
import { CreateCatalogueShareInputSchema } from "@shared/api-contract";

interface ShareTarget {
  storeId: string;
  slug: string;
  shopName: string;
  product?: { id: string; name: string } | null;
  /** D-12: set only by the offer share sheet. Independent of `product` — a
   * "share all offers" target has shareType: "offer" but no `product` at
   * all, and must NOT fall back to being recorded as "catalogue" the way an
   * inferred type (derived from whether `product` is present) would. Left
   * undefined, this preserves today's exact two-way product?-ternary for
   * the two already-shipped sheets — neither one sets this field, so
   * neither needs to change. */
  shareType?: "offer";
  /** D-12: the single offer's id, set alongside `product` for a
   * single-offer share. Omitted for "share all" — mirrors how `product` is
   * itself omitted there. */
  offerId?: string;
}

/** Issues the catalogue_shares insert and fires the share event — see the
 * file header for why the insert is issued, not awaited, from here. RLS and
 * the shipped enforce_share_product_store trigger do all the authorization
 * work; there is no client-side ownership check to write before this
 * insert. */
function recordShare(target: ShareTarget, destination: string) {
  // Explicit three-way discriminator (D-12): the offer share type comes
  // from `target.shareType`, set only by the offer share sheet, never
  // inferred from whether `product` is present — a share-all target has no
  // `product` and would otherwise misclassify as "catalogue" under an
  // inferred rule, making the stored row lie about what was shared. When
  // `shareType` is absent (both existing sheets), this computes exactly
  // today's two-way product-or-catalogue choice, unchanged.
  const shareTypeValue =
    target.shareType ?? (target.product ? "product" : "catalogue");

  const insertPayload = {
    store_id: target.storeId,
    product_id: target.product?.id ?? null,
    share_type: shareTypeValue,
    destination,
  };

  // Validated with safeParse, never .parse() — this call sits between the
  // click and the synchronous destination dispatch below (native share/
  // WhatsApp tab) and must not throw. An invalid payload just skips the
  // insert; the share itself (and its event) still goes through.
  const parsed = CreateCatalogueShareInputSchema.safeParse(insertPayload);
  if (parsed.success) {
    void supabase
      .from("catalogue_shares")
      .insert(insertPayload)
      .then(({ error }) => {
        if (error) {
          console.error(
            "useShareDestination: catalogue_shares insert failed",
            error,
          );
        }
      });
  } else {
    console.error(
      "useShareDestination: catalogue_shares payload failed validation",
      parsed.error,
    );
  }

  void logEvent({
    eventName:
      target.shareType === "offer" ? "offer_shared" : "catalogue_shared",
    productId: target.product?.id,
    offerId: target.offerId,
  });
}

/** Wrapped in try/catch so a missing clipboard (an insecure origin, or a
 * browser that simply never exposes it) cannot throw into the caller — the
 * type declares `navigator.clipboard` as always present, but that is not
 * true on every real origin; a synchronous access failure here is caught by
 * the same block that already handles a rejected `writeText()`. */
async function copyToClipboard(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    console.error("useShareDestination: clipboard write failed", err);
  }
}

export function useShareDestination(target: ShareTarget) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const payload = buildSharePayload({
    origin,
    slug: target.slug,
    shopName: target.shopName,
    product: target.product ?? undefined,
  });

  function selectDestination(destination: ShareDestinationLabel) {
    recordShare(target, destination);

    if (destination === "WhatsApp") {
      window.open(buildWhatsAppUrl(payload), "_blank", "noopener,noreferrer");
      return;
    }

    if ("share" in navigator) {
      void navigator.share(payload).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          // The vendor dismissed the OS share sheet — not a failure (D-05).
          return;
        }
        void copyToClipboard(payload.url);
      });
      return;
    }

    void copyToClipboard(payload.url);
  }

  function copyLink() {
    recordShare(target, COPY_LINK_DESTINATION);
    return copyToClipboard(payload.url);
  }

  return { selectDestination, copyLink };
}
