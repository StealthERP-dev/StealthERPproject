"use client";

// Product detail, presentational half (PROD-02/06). Ports
// App.tsx:888-936's header/photo/name/availability-card/share markup, with
// three additions layered in per UI-SPEC section 5: the edit entry icon
// (net-new, reusing the shipped back button's exact 36px box and hit area),
// the D-05 placeholder branch, and the D-06 price line. No data-fetching
// hook here — product-detail-page.tsx already resolved the product from the
// shared cache; this component only renders what it is handed and owns
// navigation the same way products-view.tsx already does for its own
// Add-product and row taps.
//
// The Share control now opens ProductShareSheet (SHAR-02) — the control
// Phase 3 reserved for this phase to wire is wired.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Pencil, Share2 } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Toggle } from "@/components/ui/toggle";
import { ProductShareSheet } from "@/features/share/components/product-share-sheet";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import type { Product } from "@/features/products/hooks/use-products";

const GENERIC_ERROR = "Something went wrong. Try again.";

export function ProductDetailView({
  product,
  onToggle,
  toggleFailed,
}: {
  product: Product;
  onToggle: () => void;
  toggleFailed: boolean;
}) {
  const router = useRouter();
  const formattedPrice = formatPriceDisplay(product.price);
  const [showShareSheet, setShowShareSheet] = useState(false);

  function handleEdit() {
    router.push(`/manage/${product.id}/edit`);
  }

  function handleShare() {
    setShowShareSheet(true);
  }

  return (
    <>
      <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto pb-10">
        <div className="flex flex-shrink-0 items-center gap-3 px-5 pt-5 pb-4">
          <BackButton />
          <h1 className="flex-1 truncate text-[17px] leading-tight font-semibold text-foreground">
            {product.name}
          </h1>
          <button
            type="button"
            onClick={handleEdit}
            aria-label="Edit product"
            className="group -m-2.5 flex-shrink-0 p-2.5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted transition-transform group-active:scale-90">
              <Pencil className="h-4 w-4 text-foreground" />
            </span>
          </button>
        </div>

        <div className="mx-5 flex-shrink-0 overflow-hidden rounded-2xl bg-muted">
          <div className="aspect-[4/3]">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- vendor-uploaded to Supabase Storage, no fixed domain for next/image
              <img
                src={product.image_url}
                alt={product.name}
                className={`h-full w-full object-cover transition-opacity ${
                  product.available ? "" : "opacity-50"
                }`}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Package className="h-10 w-10 text-muted-foreground/40" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 px-5">
          <p className="text-[22px] font-semibold tracking-tight text-foreground">
            {product.name}
          </p>
          {product.category_name && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {product.category_name}
            </p>
          )}
          {formattedPrice && (
            <p className="mt-1.5 text-base font-semibold text-foreground">
              ₹{formattedPrice}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-foreground">
                Available today
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {product.available
                  ? "Showing as available to customers"
                  : "Hidden from customers"}
              </p>
            </div>
            <Toggle
              checked={product.available}
              onChange={onToggle}
              label={
                product.available
                  ? `Mark ${product.name} unavailable`
                  : `Mark ${product.name} available`
              }
            />
          </div>
          {toggleFailed && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {GENERIC_ERROR}
            </p>
          )}

          <button
            type="button"
            onClick={handleShare}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-border bg-card text-sm font-medium text-foreground transition-all active:scale-[0.98]"
          >
            <Share2 className="h-4 w-4 text-muted-foreground" />
            Share this product
          </button>
        </div>
      </div>
      {showShareSheet && (
        <ProductShareSheet
          product={product}
          onClose={() => {
            setShowShareSheet(false);
          }}
        />
      )}
    </>
  );
}
