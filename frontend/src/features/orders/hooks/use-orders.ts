"use client";

// The ONE vendor-side orders read (ORDR-01…04). Copies use-offers.ts's shape
// exactly: a module-level fetch function, one useQuery, owner-scoped by
// store id, an exported query-key builder every writer imports rather than
// re-spelling. Returns the flat, newest-first array and does no grouping —
// grouping (New vs Earlier, on `is_new`, never `status` — see
// use-new-order-count.ts's header for why the two columns are orthogonal)
// belongs to the consumer, the same "one query, every grouping done by a
// consumer" posture use-offers.ts already takes.
//
// The embed shape (order_items(product_name, qty, price)) is already proven
// live in tests/db/place-order.test.mjs. `order_items.price` is a TEXT
// display label, not a number — never format it as currency here.
//
// ORDR-04's two refresh triggers, same reasoning as
// use-new-order-count.ts's own header: `refetchOnWindowFocus: "always"`
// bypasses the project-wide 30s staleTime gate that would otherwise
// silently defeat a focus refetch inside that window, and
// `refetchInterval: 30_000` polls independently of staleTime. Both are a
// first use in this codebase for a query the vendor actually watches while
// it is open.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "product_name" | "qty" | "price"
>;

export type Order = OrderRow & {
  order_items: OrderItemRow[];
};

/** Every writer of an orders row (the mark-seen bulk clear, and 06-05's
 * confirm/cancel mutations) imports this rather than re-spelling the key, so
 * this read and every invalidation of it address the exact same cache
 * entry. */
export function ordersQueryKey(storeId: string) {
  return ["orders", storeId] as const;
}

async function fetchOrders(storeId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, store_id, customer_name, customer_phone, note, total, status, is_new, created_at, confirmed_at, cancelled_at, completed_at, customer_id, rejection_reason, rejection_note, order_items(product_name, qty, price)",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data;
}

export function useOrders(storeId: string) {
  return useQuery({
    queryKey: ordersQueryKey(storeId),
    queryFn: () => fetchOrders(storeId),
    enabled: storeId.length > 0,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
}
