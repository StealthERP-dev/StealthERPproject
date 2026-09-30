"use client";

// The single-product share sheet (SHAR-02). Composes the shipped ShareSheet
// shell exactly as its catalogue sibling does — this component owns no
// share mechanics of its own; both callbacks delegate straight to the
// destination hook 04-04 built. The preview slot renders UI-SPEC Screen 3's
// markup verbatim: the wide photo box (or the shared placeholder icon when
// there is none), the product's own name, the availability line and the
// in-store caption. No offer price, no struck-through price, no add
// control (D-03).
//
// The sheet resolves the sharing shop from the session provider itself
// (useAuth) rather than taking storeId/slug/shopName as props. It is only
// ever mounted inside vendor screens, behind the shipped signed-in guard,
// and threading three identity props through two presentational components
// and two containers would create four places that could disagree about
// which shop is sharing. Resolving identity here rather than through props
// is what guarantees the detail-page entry point and the product-row entry
// point cannot disagree about which shop is sharing — it renders nothing
// when there is no resolved store, which cannot happen behind the vendor
// guard but keeps the type honest.
//
// Title correction: the preview title below is the product's own name and
// nothing else. UI-SPEC's Copywriting Contract ("Prototype correction
// note") records this as a deliberate content fix — the prototype's
// hardcoded adjective prefix is nonsensical for most of the fourteen
// business types this app now supports.
//
// Flagged UI correction (CR-01 fix, recorded in 04-UI-SPEC.md next to the
// "Fresh " correction note above): UI-SPEC never specified a branch for an
// unavailable product, and the preview it did specify makes a false claim
// ("Available today") for one. `available` is threaded through from the
// caller's full Product object (this is also IN-01's fix — the previously
// narrow {id, name, image_url} shape let the caller's `available` field be
// silently dropped with no compiler signal). When the product is
// unavailable, the preview shows the honest status ("Currently
// unavailable", muted dot — matching product-row.tsx's grey/muted
// treatment for an unavailable row) and the destination grid/copy-link
// button are replaced with a single line telling the vendor what to do,
// per D-07's "Currently closed" wording precedent. Both Share entry points
// (the row icon and the detail page's button) stay exactly as they are —
// always enabled, never hidden or dimmed — the sheet is what tells the
// vendor the truth, not the control that opens it.

import { ExternalLink, Package } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ShareSheet } from "@/features/share/components/share-sheet";
import { useShareDestination as useDestination } from "@/features/share/hooks/use-share-destination";
import { useAuth } from "@/features/auth/auth-provider";

interface ProductShareProduct {
  id: string;
  name: string;
  image_url: string | null;
  available: boolean;
}

function PlaceholderThumb({ sizeClassName }: { sizeClassName: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className={`${sizeClassName} text-muted-foreground/50`} />
    </div>
  );
}

export function ProductShareSheet({
  product,
  onClose,
}: {
  product: ProductShareProduct;
  onClose: () => void;
}) {
  const { store } = useAuth();

  const destination = useDestination(
    store
      ? {
          storeId: store.id,
          slug: store.slug,
          shopName: store.shop_name,
          product: { id: product.id, name: product.name },
        }
      : { storeId: "", slug: "", shopName: "" },
  );

  if (!store) {
    return null;
  }

  if (!product.available) {
    // Honest-status branch (CR-01): no destination grid, no copy-link
    // button — a link to an unavailable product 404s for the recipient
    // (use-public-store-product.ts's anon read is `.eq("available",
    // true)`), so no destination is offered and no catalogue_shares row is
    // written for it.
    return (
      <BottomSheet label="Share product" onClose={onClose}>
        <div className="mb-5 overflow-hidden rounded-2xl bg-secondary">
          <div className="aspect-[16/9] overflow-hidden bg-muted">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- share preview mirrors the vendor product-detail's plain <img>, same as catalogue-share-sheet.tsx
              <img
                src={product.image_url}
                alt={product.name}
                className="h-full w-full object-cover opacity-50"
              />
            ) : (
              <PlaceholderThumb sizeClassName="w-10 h-10" />
            )}
          </div>
          <div className="px-4 py-4">
            <p className="text-[17px] font-semibold text-foreground">
              {product.name}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">
                Currently unavailable
              </p>
            </div>
          </div>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Turn this item back on to share it.
        </p>
      </BottomSheet>
    );
  }

  const preview = (
    <div className="mb-5 overflow-hidden rounded-2xl bg-secondary">
      <div className="aspect-[16/9] overflow-hidden bg-muted">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- share preview mirrors the vendor product-detail's plain <img>, same as catalogue-share-sheet.tsx
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <PlaceholderThumb sizeClassName="w-10 h-10" />
        )}
      </div>
      <div className="px-4 py-4">
        <p className="text-[17px] font-semibold text-foreground">
          {product.name}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
          <p className="text-sm font-medium text-[#16A34A]">Available today</p>
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          View in store <ExternalLink className="h-3 w-3" />
        </p>
      </div>
    </div>
  );

  return (
    <ShareSheet
      label="Share product"
      preview={preview}
      onClose={onClose}
      onSelectDestination={destination.selectDestination}
      onCopyLink={destination.copyLink}
    />
  );
}
