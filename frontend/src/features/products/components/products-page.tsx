"use client";

// Products list container (PROD-01). Copies storefront-page.tsx's branching
// order: loading, then error, then ready. There is no not-found branch — a
// vendor's own product list is never missing, only empty, and the empty
// cases are ProductsView's own branches.
//
// The status filter is the ONLY piece of screen state that lives in the URL
// (D-08): read from /manage's query string, written back by replacing the
// URL (never pushing — a filter tap is not a place the vendor wants to step
// back through) so it survives a reload and the signed-out round trip
// through Login. Search and the category filter are deliberately local
// React state, reset on unmount, exactly as the prototype has them — D-08's
// contract names the status filter only. Filtering/searching run over the
// already-fetched list; a shop's catalogue is small enough that a round
// trip per keystroke would only add latency for no benefit.
//
// Add-product and row navigation are pushed (not replaced) from
// products-view.tsx itself, the same way back-button.tsx already owns its
// own router call — this container's only navigation call is the filter's
// replace.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { useProducts } from "@/features/products/hooks/use-products";
import { ProductsView } from "@/features/products/components/products-view";

export type StatusFilter = "all" | "available" | "unavailable";

const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "available",
  "unavailable",
];

function isStatusFilter(value: string | null): value is StatusFilter {
  return value !== null && STATUS_FILTERS.includes(value as StatusFilter);
}

export function ProductsPage() {
  const { store, loading: authLoading, error: authError, refresh } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeId = store?.id ?? "";
  const productsQuery = useProducts(storeId);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showCategorySheet, setShowCategorySheet] = useState(false);

  const rawFilter = searchParams.get("filter");
  const filter: StatusFilter = isStatusFilter(rawFilter) ? rawFilter : "all";

  function setFilter(next: StatusFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("filter");
    } else {
      params.set("filter", next);
    }
    const query = params.toString();
    router.replace(query ? `/manage?${query}` : "/manage", { scroll: false });
  }

  if (authLoading || productsQuery.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (authError || productsQuery.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your products.
        </p>
        <button
          onClick={() => {
            void refresh();
            void productsQuery.refetch();
          }}
          className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!store) {
    // authLoading is false and there is no error, so this is a signed-in
    // vendor with no shop yet — the same "not our concern here" loading
    // treatment home-page.tsx gives this state (D-09's detection lives in
    // Setup, not this container).
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const products = productsQuery.data;

  const categoryList = [
    "All",
    ...Array.from(
      new Set(
        products
          .map((product) => product.category_name)
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  ];

  const trimmedSearch = search.trim().toLowerCase();
  const filteredProducts = products.filter((product) => {
    const matchStatus =
      filter === "all"
        ? true
        : filter === "available"
          ? product.available
          : !product.available;
    const matchSearch =
      trimmedSearch === "" ||
      product.name.toLowerCase().includes(trimmedSearch);
    const matchCategory =
      categoryFilter === "All" || product.category_name === categoryFilter;
    return matchStatus && matchSearch && matchCategory;
  });

  return (
    <ProductsView
      products={products}
      filteredProducts={filteredProducts}
      storeId={storeId}
      search={search}
      onSearchChange={setSearch}
      filter={filter}
      onFilterChange={setFilter}
      categoryFilter={categoryFilter}
      categoryList={categoryList}
      showCategorySheet={showCategorySheet}
      onOpenCategorySheet={() => {
        setShowCategorySheet(true);
      }}
      onCloseCategorySheet={() => {
        setShowCategorySheet(false);
      }}
      onSelectCategory={(category) => {
        setCategoryFilter(category);
        setShowCategorySheet(false);
      }}
    />
  );
}
