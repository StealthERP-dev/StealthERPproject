"use client";

// The catalogue share sheet (HOME-03, SHAR-01, SHAR-03, D-03, D-05, D-11).
// Composes the shipped ShareSheet shell — this component owns no share
// mechanics of its own; both callbacks delegate straight to
// useShareDestination. The preview slot renders UI-SPEC Screen 2's markup
// verbatim: the shop-identity band, a 3-col grid of up to six available
// products with an overflow tile beyond that, or the empty branch when
// there are none. Above that grid, a small labelled block (Screen 7) lists
// up to three of today's active offers with the regular price struck
// through where one exists, its own cap kept independent of the grid's own
// tile cap and overflow tile below it, and renders nothing at all when no
// offer is active.
//
// The product and offers arrays are exactly what Home already fetched for its own
// counts — no second query here, and no useQuery/supabase import in this
// file at all.

import { Package } from "lucide-react";
import { ShareSheet } from "@/features/share/components/share-sheet";
import { useShareDestination } from "@/features/share/hooks/use-share-destination";
import { formatPriceDisplay } from "@/features/products/lib/format-price";

interface CatalogueShareProduct {
  id: string;
  name: string;
  image_url: string | null;
}

interface CatalogueShareOffer {
  id: string;
  product_name: string;
  product_image_url: string | null;
  offer_price: number | null;
  regular_price: number | null;
}

function PlaceholderThumb({ sizeClassName }: { sizeClassName: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className={`${sizeClassName} text-muted-foreground/50`} />
    </div>
  );
}

export function CatalogueShareSheet({
  storeId,
  slug,
  shopName,
  availableProducts,
  offers,
  onClose,
  onViewCustomer,
}: {
  storeId: string;
  slug: string;
  shopName: string;
  availableProducts: CatalogueShareProduct[];
  offers: CatalogueShareOffer[];
  onClose: () => void;
  onViewCustomer: () => void;
}) {
  const { selectDestination, copyLink } = useShareDestination({
    storeId,
    slug,
    shopName,
  });

  const shown = availableProducts.slice(0, 6);
  const overflowCount = availableProducts.length - shown.length;

  // D-11's own cap: the first three active offers, with a summarising line
  // beyond that. Deliberately a binding of its own, independent from the
  // grid's tile-overflow count above — the two caps must never be conflated.
  const shownOffers = offers.slice(0, 3);
  const extraOffersCount = offers.length - shownOffers.length;

  const preview = (
    <>
      <h2 className="mb-4 text-[17px] font-semibold text-foreground">
        Share today&apos;s catalogue
      </h2>
      <div className="mb-2 overflow-hidden rounded-2xl border border-border">
        <div className="bg-foreground px-4 py-4 text-background">
          <p className="text-[15px] font-semibold">
            {shopName || "Your Store"}
          </p>
          <p className="mt-0.5 text-sm text-background/60">
            Available today · {availableProducts.length} items
          </p>
        </div>
        {shownOffers.length > 0 && (
          <div className="border-b border-border bg-secondary px-4 pt-3 pb-2">
            <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Today&apos;s offers
            </p>
            <div className="flex flex-col gap-2">
              {shownOffers.map((offer) => (
                <div key={offer.id} className="flex items-center gap-2.5">
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                    {offer.product_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- share preview mirrors the prototype's plain <img> thumbnails, same as the mini-grid below
                      <img
                        src={offer.product_image_url}
                        alt={offer.product_name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <PlaceholderThumb sizeClassName="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {offer.product_name}
                    </p>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      {offer.regular_price != null && (
                        <span className="text-[10px] text-muted-foreground line-through">
                          ₹{formatPriceDisplay(offer.regular_price)}
                        </span>
                      )}
                      <span className="text-[10px] font-semibold text-foreground">
                        ₹{formatPriceDisplay(offer.offer_price)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {extraOffersCount > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  +{extraOffersCount} more offers
                </p>
              )}
            </div>
          </div>
        )}
        {availableProducts.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 bg-secondary p-6 text-center">
            <Package className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No items available yet
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 bg-secondary p-3">
            {shown.map((product) => (
              <div key={product.id}>
                <div className="aspect-square overflow-hidden rounded-xl bg-muted">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- share preview mirrors the prototype's plain <img> thumbnails, same as product-row.tsx
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderThumb sizeClassName="w-5 h-5" />
                  )}
                </div>
                <p className="mt-1 truncate px-0.5 text-[10px] font-semibold text-foreground">
                  {product.name}
                </p>
                <p className="px-0.5 text-[9px] font-semibold text-[#16A34A]">
                  Available
                </p>
              </div>
            ))}
            {overflowCount > 0 && (
              <div className="flex aspect-square items-center justify-center rounded-xl bg-muted">
                <span className="text-xs font-semibold text-muted-foreground">
                  +{overflowCount}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="bg-secondary px-3 pb-3">
          <button
            type="button"
            onClick={onViewCustomer}
            className="h-11 w-full rounded-xl bg-foreground text-xs font-semibold text-background transition-transform active:scale-[0.98]"
          >
            View today&apos;s catalogue
          </button>
        </div>
      </div>
      <p className="mt-2 mb-5 text-center text-xs text-muted-foreground">
        This is what your customers will see
      </p>
    </>
  );

  return (
    <ShareSheet
      label="Share today's catalogue"
      preview={preview}
      onClose={onClose}
      onSelectDestination={selectDestination}
      onCopyLink={copyLink}
      copyLinkLabel="Copy catalogue link"
    />
  );
}
