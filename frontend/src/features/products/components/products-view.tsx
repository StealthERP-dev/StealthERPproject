"use client";

// Products list, presentational half (PROD-01, D-08). Ports
// App.tsx:1147-1300's header/search/status-chips/category-pill/rows/empty
// states. No data-fetching hook is used here (no useQuery/useMutation/
// useAuth) — filtering itself happens in the container, this component only
// renders what it's handed. Navigation is the one exception: Add-product
// and row-navigate call useRouter directly, the same pattern back-button.tsx
// already establishes for a component that isn't itself a data container.
// Both push (not replace) so Back returns to this screen normally — keeping
// that call here, rather than in the container, is what lets
// products-page.tsx's own router calls stay limited to the filter's
// replace (see its acceptance criteria).
//
// The row's Share control is wired (SHAR-02): its own product opens
// ProductShareSheet, the same component the product detail page uses,
// held as local state here rather than lifted to products-page.tsx —
// mirroring the category sheet's own conditional-sibling shape already in
// this file.

import { useState } from "react";
import { ChevronRight, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ProductRow } from "@/features/products/components/product-row";
import { CategoryFilterSheet } from "@/features/products/components/category-filter-sheet";
import { ProductShareSheet } from "@/features/share/components/product-share-sheet";
import type { Product } from "@/features/products/hooks/use-products";
import type { StatusFilter } from "@/features/products/components/products-page";

const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "available",
  "unavailable",
];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  available: "Available",
  unavailable: "Unavailable",
};

function ClearSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Clear search"
      className="-m-3 flex-shrink-0 p-3"
    >
      <span className="flex h-5 w-5 items-center justify-center">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </button>
  );
}

function emptyStateMessage({
  search,
  filter,
  categoryFilter,
}: {
  search: string;
  filter: StatusFilter;
  categoryFilter: string;
}): string {
  if (search.trim()) {
    return `No results for "${search}"`;
  }
  if (categoryFilter !== "All") {
    return `No ${filter === "all" ? "" : `${filter} `}products in ${categoryFilter}`;
  }
  return filter === "unavailable"
    ? "All products are available"
    : "No available products";
}

export function ProductsView({
  products,
  filteredProducts,
  storeId,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  categoryFilter,
  categoryList,
  showCategorySheet,
  onOpenCategorySheet,
  onCloseCategorySheet,
  onSelectCategory,
}: {
  products: Product[];
  filteredProducts: Product[];
  storeId: string;
  search: string;
  onSearchChange: (value: string) => void;
  filter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
  categoryFilter: string;
  categoryList: string[];
  showCategorySheet: boolean;
  onOpenCategorySheet: () => void;
  onCloseCategorySheet: () => void;
  onSelectCategory: (category: string) => void;
}) {
  const router = useRouter();
  const total = products.length;
  const available = products.filter((product) => product.available).length;
  const [shareProduct, setShareProduct] = useState<Product | null>(null);

  function handleAddProduct() {
    router.push("/manage/add");
  }

  function handleNavigate(productId: string) {
    router.push(`/manage/${productId}`);
  }

  function handleShare(product: Product) {
    setShareProduct(product);
  }

  return (
    <div className="scrollbar-hide flex-1 overflow-y-auto pb-6">
      <div className="flex items-start justify-between px-5 pt-7 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Your products
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {available} of {total} available today
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddProduct}
          className="mt-1 flex h-11 flex-shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3.5 transition-transform active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5 text-background" />
          <span className="text-sm font-semibold text-background">
            Add product
          </span>
        </button>
      </div>

      <div className="mx-5 mb-3 flex h-12 items-center gap-2.5 rounded-xl bg-muted px-3">
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          placeholder="Search products…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {search && (
          <ClearSearchButton
            onClick={() => {
              onSearchChange("");
            }}
          />
        )}
      </div>

      <div className="mb-5 flex items-center gap-2 px-5">
        <div className="flex min-w-0 flex-1 gap-1.5">
          {STATUS_FILTERS.map((statusFilter) => (
            <button
              key={statusFilter}
              type="button"
              onClick={() => {
                onFilterChange(statusFilter);
              }}
              className={`h-11 flex-shrink-0 rounded-full px-3 text-xs font-semibold transition-colors ${
                filter === statusFilter
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {STATUS_FILTER_LABELS[statusFilter]}
            </button>
          ))}
        </div>
        {categoryList.length > 2 && (
          <button
            type="button"
            onClick={onOpenCategorySheet}
            className={`flex h-11 flex-shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors ${
              categoryFilter !== "All"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {categoryFilter === "All" ? "Category" : categoryFilter}
            <ChevronRight className="h-3 w-3 flex-shrink-0 rotate-90 opacity-60" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 px-5">
        {filteredProducts.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            storeId={storeId}
            onNavigate={handleNavigate}
            onShare={handleShare}
          />
        ))}

        {filteredProducts.length === 0 && total === 0 && (
          <button
            type="button"
            onClick={handleAddProduct}
            className="flex flex-col items-center justify-center py-10 text-center transition-opacity active:opacity-70"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              Add your first product
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap to get started
            </p>
          </button>
        )}

        {filteredProducts.length === 0 && total > 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {emptyStateMessage({ search, filter, categoryFilter })}
            </p>
          </div>
        )}
      </div>

      {showCategorySheet && (
        <CategoryFilterSheet
          categoryList={categoryList}
          categoryFilter={categoryFilter}
          onSelect={onSelectCategory}
          onClose={onCloseCategorySheet}
        />
      )}

      {shareProduct && (
        <ProductShareSheet
          product={shareProduct}
          onClose={() => {
            setShareProduct(null);
          }}
        />
      )}
    </div>
  );
}
