"use client";

// D-01/ORDR-05's Cancel: one owner-scoped update writing the cancelled
// lifecycle value, its timestamp, the vendor's preset reason code and the
// optional free-text note — four columns, one call. Never touches
// `orders.note` (the CUSTOMER's own note, written by place_order) and never
// touches `is_new` (the seen-ness flag, D-08's own column).
//
// Follows use-confirm-order.ts's optimistic shape exactly — the target row
// is MAPPED, never filtered out — but this hook is invoked from
// cancel-reason-sheet.tsx, not the row: the sheet owns this mutation
// directly, so its own onError leaves the sheet open with an inline message
// rather than rolling back a dismissed sheet (cancel-reason-sheet.tsx's own
// header explains why). The cancel event fires from the success callback
// only, for the identical reason use-confirm-order.ts's own header states:
// the settle callback also runs after a rolled-back failure, and a
// cancellation that never happened must not be recorded in the funnel it
// would otherwise silently corrupt.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import { ordersQueryKey, type Order } from "@/features/orders/hooks/use-orders";
import { UpdateOrderStatusInputSchema } from "@shared/api-contract";

export interface CancelOrderInput {
  orderId: string;
  reasonCode: string;
  /** An empty string is stored as `null`, so "no note" and "an empty note"
   * stay distinguishable in the column. */
  rejectionNote: string;
}

interface CancelOrderContext {
  previous: Order[] | undefined;
}

export function useCancelOrder(storeId: string) {
  return useMutation<undefined, Error, CancelOrderInput, CancelOrderContext>({
    mutationFn: async ({ orderId, reasonCode, rejectionNote }) => {
      const parsed = UpdateOrderStatusInputSchema.safeParse({
        status: "cancelled",
        rejection_reason: reasonCode,
        rejection_note: rejectionNote || null,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { error } = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          rejection_reason: reasonCode,
          rejection_note: rejectionNote || null,
        })
        .eq("id", orderId);

      if (error) {
        throw new Error(error.message);
      }

      return undefined;
    },
    onMutate: async ({ orderId, reasonCode, rejectionNote }, { client }) => {
      await client.cancelQueries({ queryKey: ordersQueryKey(storeId) });

      const previous = client.getQueryData<Order[]>(ordersQueryKey(storeId));

      client.setQueryData<Order[]>(ordersQueryKey(storeId), (old) =>
        old?.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
                rejection_reason: reasonCode,
                rejection_note: rejectionNote || null,
              }
            : order,
        ),
      );

      return { previous };
    },
    onError: (_error, _variables, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(ordersQueryKey(storeId), onMutateResult.previous);
      }
    },
    onSuccess: (_data, { orderId }) => {
      void logEvent({ eventName: "order_cancelled", orderId });
    },
    onSettled: (_data, _error, _variables, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: ordersQueryKey(storeId) });
    },
  });
}
