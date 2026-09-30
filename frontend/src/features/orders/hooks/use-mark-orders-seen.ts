"use client";

// D-08/ORDR-03: leaving the Orders tab clears the seen-ness flag for every
// currently-unseen order of the vendor's own store — a single, plain,
// owner-scoped `.update()` under the "orders: owner updates" policy already
// shipped in Phase 1 (06-01 already proved this exact bulk update's row
// scope and cross-store isolation in pgTAP; this hook proves the TRIGGER,
// not the permission). No RPC, no new policy, and only ONE column: the
// filter and the write both name `is_new`, never `status` — an update that
// also touched the lifecycle column would silently decide every order.
//
// Where the invalidation sits is the one thing here that is NOT a style
// choice: this mutation fires AS the Orders screen unmounts (see
// orders-page.tsx's own effect-cleanup header), and callbacks passed to a
// `.mutate()` CALL are dropped the instant the calling component unmounts —
// documented TanStack Query behavior, not this project's assumption. The
// invalidation is therefore placed in this hook's own `onSuccess` (a
// useMutation OPTION, registered on the mutation itself, not on a specific
// `.mutate()` invocation) so it still runs after the triggering component is
// gone. Both the orders list and the shared new-order-count query are
// invalidated through their exported key builders, never re-spelt literals,
// so this hook cannot drift from what use-orders.ts / use-new-order-count.ts
// actually read — and clearing the count key here is what makes the badge
// disappear within a moment rather than waiting for its own 30s poll.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { ordersQueryKey } from "@/features/orders/hooks/use-orders";
import { newOrderCountQueryKey } from "@/features/home/hooks/use-new-order-count";

export function useMarkOrdersSeen(storeId: string) {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("orders")
        .update({ is_new: false })
        .eq("store_id", storeId)
        .eq("is_new", true);

      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: (_data, _variables, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: ordersQueryKey(storeId) });
      void client.invalidateQueries({
        queryKey: newOrderCountQueryKey(storeId),
      });
    },
  });
}
