// The vendor's own owner-scoped product read (PROD-01, PROD-02). Copies
// use-public-store.ts's shape (module-level fetch function, one useQuery)
// but projects the vendor's own columns, not the public storefront's
// narrowed projection — this is the caller's own catalogue, restricted by
// the shipped `products: owner manages` RLS policy, not by this query.
//
// The query key below (see queryKey) is the contract this phase's remaining
// plans depend on: the row toggle, the detail screen, the edit form and
// Home's counts all address this exact two-element key — the literal
// "products" string plus the store id — so every renderer of a product's
// availability agrees by construction. Do not rename or re-shape it (see
// 03-02-PLAN.md's reversibility note on Task 1).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type Product = Database["public"]["Tables"]["products"]["Row"] & {
  /** The related category's name, resolved through the foreign key — null
   * when the product has no category ("None"). */
  category_name: string | null;
};

async function fetchProducts(storeId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, store_id, name, category_id, unit, image_url, available, price, created_at, updated_at, categories(name)",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;

  return data.map(({ categories, ...product }) => ({
    ...product,
    category_name: categories?.name ?? null,
  }));
}

export function useProducts(storeId: string) {
  return useQuery({
    queryKey: ["products", storeId],
    queryFn: () => fetchProducts(storeId),
    enabled: storeId.length > 0,
  });
}
