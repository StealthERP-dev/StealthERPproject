"use client";

// Home's third count tile (HOME-05) AND the bottom-nav badge (ORDR-02, D-09,
// D-13) — this is the ONE shared query both surfaces read, so "identical on
// Home and the badge" holds by construction rather than by two call sites
// happening to agree. Copies use-public-store.ts's/use-categories.ts's
// shape: a module-level fetch function plus one useQuery keyed on the store
// id, using PostgREST's exact-count head request so the database returns a
// number rather than every row — a shop with a busy day should not pull
// every order row to render one numeral.
//
// Reads `orders.is_new` — SEEN-NESS, not the lifecycle column. `is_new` is
// what leaving the Orders tab clears (D-08/ORDR-03); `orders.status` is the
// lifecycle a Confirm or Cancel changes (ORDR-05). The two are orthogonal
// and both default to a state named "new". This hook's badge means "orders
// the vendor has not yet looked at" — the former, never the latter. D-12:
// this file used to filter `status = 'new'` and its own comment argued that
// column was canonical; that was backwards, and the lifecycle column no
// longer appears anywhere in this file's code. The shipped
// `private.order_outcomes` analytics view deliberately keeps counting
// `status` (a lifecycle KPI) and must not be "fixed" to read `is_new`
// alongside this — that is a different question. The shipped "orders: owner
// reads" RLS policy is what scopes this to the caller's own store; no new
// policy and no filtering by hand.
//
// ORDR-04's two refresh triggers apply here too (settled discretion,
// 06-CONTEXT.md): the badge is visible on EVERY vendor route via the
// persistent BottomNav, while the Orders list is only visible on one route,
// so the badge needs the same freshness the list gets or it can lag behind
// what the Orders screen already shows. `refetchOnWindowFocus: "always"`,
// not the plain boolean default — src/app/providers.tsx sets a project-wide
// staleTime of 30s with no focus/interval option of its own, and the plain
// boolean only refetches on focus when the data is already stale, which
// silently no-ops for most real focus events inside that window.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

/** Every reader of this count imports this rather than re-spelling the key,
 * so this read and the mark-seen bulk clear's invalidation of it cannot
 * drift apart. */
export function newOrderCountQueryKey(storeId: string) {
  return ["new-order-count", storeId] as const;
}

async function fetchNewOrderCount(storeId: string): Promise<number> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("is_new", true);

  if (error) throw error;

  return count ?? 0;
}

export function useNewOrderCount(storeId: string) {
  return useQuery({
    queryKey: newOrderCountQueryKey(storeId),
    queryFn: () => fetchNewOrderCount(storeId),
    enabled: storeId.length > 0,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
}
