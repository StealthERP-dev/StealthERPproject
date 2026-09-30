// One product row (PROD-01, PROD-02). Ports App.tsx:1211-1243's markup:
// the tappable region opening the product, the 60px thumbnail, the name,
// the category caption when the product has one, and the availability
// status pill with its dot. The photo placeholder replaces the prototype's
// random Unsplash assignment (D-05) — a product with no photo shows a
// neutral package icon, never a stock photo of something else.
//
// No monetary amount appears here (D-07). UI-SPEC's resolution for PROD-02
// ("toggle from a row or detail page") adds the Toggle as a third trailing
// element alongside the row's tap-through button and the Share icon button
// — a minimal addition to an otherwise verbatim row, not a restructure. The
// row owns its own toggle mutation (rather than an onToggle callback from
// the container) so its own failure message scopes to this row only, never
// a page-wide banner (see use-toggle-product-available.ts).

"use client";

import { Package, Share2 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { useToggleProductAvailable } from "@/features/products/hooks/use-toggle-product-available";
import type { Product } from "@/features/products/hooks/use-products";

const GENERIC_ERROR = "Something went wrong. Try again.";

function PlaceholderThumb() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="h-5 w-5 text-muted-foreground/50" />
    </div>
  );
}

function ShareIconButton({
  productName,
  onClick,
}: {
  productName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Share ${productName}`}
      className="group -m-2.5 flex-shrink-0 p-2.5"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted transition-transform group-active:scale-90">
        <Share2 className="h-4 w-4 text-foreground" />
      </span>
    </button>
  );
}

export function ProductRow({
  product,
  storeId,
  onNavigate,
  onShare,
}: {
  product: Product;
  storeId: string;
  onNavigate: (productId: string) => void;
  onShare: (product: Product) => void;
}) {
  const toggleAvailable = useToggleProductAvailable(storeId);

  function handleToggle() {
    toggleAvailable.mutate({
      productId: product.id,
      nextAvailable: !product.available,
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3">
        <button
          type="button"
          onClick={() => {
            onNavigate(product.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-3.5 text-left transition-opacity active:opacity-70"
        >
          <div className="h-[60px] w-[60px] flex-shrink-0 overflow-hidden rounded-xl bg-muted">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded to Supabase Storage, no fixed domain for next/image yet (photo pipeline lands in a later plan)
              <img
                src={product.image_url}
                alt={product.name}
                className={`h-full w-full object-cover ${
                  product.available ? "" : "opacity-50"
                }`}
              />
            ) : (
              <PlaceholderThumb />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {product.name}
            </p>
            {product.category_name && (
              <p className="text-xs text-muted-foreground">
                {product.category_name}
              </p>
            )}
            <span
              className={`mt-2 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${
                product.available
                  ? "bg-[#DCFCE7] text-[#166534]"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                  product.available ? "bg-[#16A34A]" : "bg-muted-foreground/40"
                }`}
              />
              {product.available ? "Available" : "Unavailable"}
            </span>
          </div>
        </button>
        <Toggle
          checked={product.available}
          onChange={handleToggle}
          label={
            product.available
              ? `Mark ${product.name} unavailable`
              : `Mark ${product.name} available`
          }
        />
        <ShareIconButton
          productName={product.name}
          onClick={() => {
            onShare(product);
          }}
        />
      </div>
      {toggleAvailable.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {GENERIC_ERROR}
        </p>
      )}
    </div>
  );
}
