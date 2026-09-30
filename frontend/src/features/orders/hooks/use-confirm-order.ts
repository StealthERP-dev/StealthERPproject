"use client";

// ORDR-05's Confirm: one owner-scoped update of orders.status/confirmed_at,
// optimistic in the shared orders cache. Copies
// use-toggle-product-available.ts's shape exactly, including its one
// deliberate divergence from a generic optimistic-write pattern: the confirm
// event fires from the success callback only, never the settle callback below
// — the settle callback also runs after a rolled-back failure, and a confirm
// that never happened must not be recorded in the funnel it would otherwise
// silently corrupt.
//
// The optimistic update MAPS the target row in place and never filters it
// out of the array — this row's own component (order-row.tsx) owns the
// mutation whose failure it must report, and removing the row here would
// unmount that component before a rollback's error message could ever
// render (the carried-forward "never optimistically remove a row whose own
// component owns the in-flight mutation" rule, restated from Phase 5's own
// finding).

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import { ordersQueryKey, type Order } from "@/features/orders/hooks/use-orders";
import { UpdateOrderStatusInputSchema } from "@shared/api-contract";

interface ConfirmOrderContext {
  previous: Order[] | undefined;
}

export function useConfirmOrder(storeId: string) {
  return useMutation<undefined, Error, string, ConfirmOrderContext>({
    mutationFn: async (orderId) => {
      const parsed = UpdateOrderStatusInputSchema.pick({
        status: true,
      }).safeParse({ status: "confirmed" });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { error } = await supabase
        .from("orders")
        .update({
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) {
        throw new Error(error.message);
      }

      return undefined;
    },
    onMutate: async (orderId, { client }) => {
      await client.cancelQueries({ queryKey: ordersQueryKey(storeId) });

      const previous = client.getQueryData<Order[]>(ordersQueryKey(storeId));

      client.setQueryData<Order[]>(ordersQueryKey(storeId), (old) =>
        old?.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: "confirmed",
                confirmed_at: new Date().toISOString(),
              }
            : order,
        ),
      );

      return { previous };
    },
    onError: (_error, _orderId, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(ordersQueryKey(storeId), onMutateResult.previous);
      }
    },
    onSuccess: (_data, orderId) => {
      void logEvent({ eventName: "order_confirmed", orderId });
    },
    onSettled: (_data, _error, _orderId, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: ordersQueryKey(storeId) });
    },
  });
}
