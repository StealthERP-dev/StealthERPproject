"use client";

// The Add offer product picker (D-01). Content-only sheet composing the
// shipped BottomSheet — the scrim, handle, close control and
// role="dialog" aria-modal="true" aria-label={label} accessibility contract
// all come from BottomSheet itself and are not re-derived here, matching
// category-filter-sheet.tsx's own division of labour.
//
// Lists AVAILABLE PRODUCTS ONLY, per D-01: an offer on a hidden product is a
// promise the customer cannot act on. Per D-01 and UI-SPEC divergence 5,
// there is deliberately NO per-row status badge here — every row in this
// list is already available, so a badge would read the same word on every
// row, which the prototype never intended.
//
// Never opened on an empty list: the trigger in offer-form.tsx is disabled
// whenever the list handed to this sheet is empty, so no in-sheet
// empty-state branch is needed here at all — unlike category-filter-sheet.tsx,
// which has no such guard because "All categories" always renders.

import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { Product } from "@/features/products/hooks/use-products";

export function ProductPickerSheet({
  products,
  onSelect,
  onClose,
}: {
  /** The picker's own list — filtered by the caller before this component
   * ever sees it (D-01), never a second filtering step in here. */
  products: Product[];
  onSelect: (productId: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet label="Choose a product" onClose={onClose}>
      <p className="mb-4 flex-shrink-0 text-[15px] font-semibold text-foreground">
        Choose a product
      </p>
      <div className="flex flex-col gap-2">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => {
              onSelect(product.id);
            }}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3 text-left transition-opacity active:opacity-70"
          >
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-background">
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a remote demo/product photo URL, not a next/image-optimisable local asset — matches product-row.tsx's own treatment.
                <img
                  src={product.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="h-5 w-5 rounded-md bg-muted-foreground/20" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {product.name}
              </p>
              {product.category_name && (
                <p className="text-xs text-muted-foreground">
                  {product.category_name}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
