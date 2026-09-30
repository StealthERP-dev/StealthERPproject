"use client";

// The shop's own persisted categories (PROD-05) — copies
// use-public-store.ts's shape: a module-level fetch function plus one
// useQuery, keyed on the store id. Feeds product-form.tsx's category chip
// list (merged with the business-type suggestions from constants.ts) and,
// via use-save-product.ts, the id lookup for a chip the vendor picked that
// already has a persisted row.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

export interface CategoryOption {
  id: string;
  name: string;
}

async function fetchCategories(storeId: string): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("store_id", storeId)
    .order("name", { ascending: true });

  if (error) throw error;

  return data;
}

export function useCategories(storeId: string) {
  return useQuery({
    queryKey: ["categories", storeId],
    queryFn: () => fetchCategories(storeId),
    enabled: storeId.length > 0,
  });
}
