// Customer storefront grid, presentational half (STOR-03, STOR-04). Renders
// one of two shapes the container already resolved: a flat two-column grid
// (active search or an active category — filtering already applied
// upstream) or a sequence of category-grouped sections (the "All" state
// with no search). Takes fully-resolved props only — no data hooks, no
// filtering logic, no cart lookup and no ordering-disabled derivation here;
// it only threads the container's own single cart and orderingDisabled
// values through to every card in both branches (D-09's "one derivation,
// many consumers" discipline).

import { StorefrontProductCard } from "@/features/storefront/components/storefront-product-card";
import type {
  StorefrontOffer,
  StorefrontProduct,
} from "@/features/storefront/hooks/use-public-store";

export interface StorefrontGroupedSection {
  /** null renders no section label — the uncategorised bucket, always last. */
  label: string | null;
  products: StorefrontProduct[];
}

export function StorefrontGrid({
  slug,
  products,
  groupedSections,
  emptyMessage,
  offersByProduct,
  getQty,
  onAdd,
  onInc,
  onDec,
  orderingDisabled,
  previewMode,
}: {
  slug: string;
  products: StorefrontProduct[];
  /** null means "render the flat grid below"; non-null means "render these
   * grouped sections instead" — the container decides which shape applies. */
  groupedSections: StorefrontGroupedSection[] | null;
  emptyMessage: string;
  /** The container's own one product-keyed offer lookup (D-05, D-09) — this
   * grid never resolves an offer itself, in either branch below; it only
   * passes along what it was handed. */
  offersByProduct: Map<string, StorefrontOffer>;
  getQty: (productId: string) => number;
  onAdd: (
    product: StorefrontProduct,
    offer: StorefrontOffer | undefined,
  ) => void;
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  orderingDisabled: boolean;
  previewMode?: boolean;
}) {
  if (groupedSections !== null) {
    return (
      <>
        {groupedSections.map((section) => (
          <div key={section.label ?? "__uncategorised__"} className="px-3 pt-3">
            {section.label && (
              <p className="mb-2 px-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {section.label}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {section.products.map((product) => (
                <StorefrontProductCard
                  key={product.id}
                  slug={slug}
                  product={product}
                  offer={offersByProduct.get(product.id)}
                  qty={getQty(product.id)}
                  onAdd={() => {
                    onAdd(product, offersByProduct.get(product.id));
                  }}
                  onInc={() => {
                    onInc(product.id);
                  }}
                  onDec={() => {
                    onDec(product.id);
                  }}
                  orderingDisabled={orderingDisabled}
                  previewMode={previewMode}
                />
              ))}
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 px-3 pt-3">
      {products.map((product) => (
        <StorefrontProductCard
          key={product.id}
          slug={slug}
          product={product}
          offer={offersByProduct.get(product.id)}
          qty={getQty(product.id)}
          onAdd={() => {
            onAdd(product, offersByProduct.get(product.id));
          }}
          onInc={() => {
            onInc(product.id);
          }}
          onDec={() => {
            onDec(product.id);
          }}
          orderingDisabled={orderingDisabled}
          previewMode={previewMode}
        />
      ))}
      {products.length === 0 && (
        <p className="col-span-2 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}
