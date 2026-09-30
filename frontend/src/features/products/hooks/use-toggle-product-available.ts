"use client";

// The row/detail availability toggle (PROD-02). Copies Home's
// use-toggle-open.ts contract — flip before the request leaves, restore on
// failure, relinquish to the server row on success — but moves the
// optimistic value from container-local state into the shared TanStack
// Query cache (`["products", storeId]`) instead. Home has exactly one
// renderer of `is_open`; Products has two independent renderers of the same
// `available` value (the row and, from plan 03-04 on, the detail page), so
// a per-component override would let them drift — the exact drift PROD-02
// exists to prevent. Patching the shared cache entry is what makes every
// renderer agree by construction rather than by synchronization.
//
// The catalogue event fires from the success path only, never the settle
// path below: the settle callback also runs after a failed write, and a
// flip that rolled back did not mark anything — reporting it anyway would
// put a false row in the analytics the beta is measured on. This is this
// hook's one deliberate divergence from RESEARCH.md's Pattern 4 snippet
// (which fires from the settle callback), recorded as a flagged assumption
// in 03-02-PLAN.md.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import type { Product } from "@/features/products/hooks/use-products";
import { UpdateProductInputSchema } from "@shared/api-contract";

export interface ToggleProductAvailableInput {
  productId: string;
  nextAvailable: boolean;
}

interface ToggleProductAvailableContext {
  previous: Product[] | undefined;
}

export function useToggleProductAvailable(storeId: string) {
  return useMutation<
    undefined,
    Error,
    ToggleProductAvailableInput,
    ToggleProductAvailableContext
  >({
    mutationFn: async ({ productId, nextAvailable }) => {
      const parsed = UpdateProductInputSchema.pick({
        available: true,
      }).safeParse({ available: nextAvailable });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { error } = await supabase
        .from("products")
        .update({ available: nextAvailable })
        .eq("id", productId);

      if (error) {
        throw new Error(error.message);
      }

      return undefined;
    },
    onMutate: async ({ productId, nextAvailable }, { client }) => {
      await client.cancelQueries({ queryKey: ["products", storeId] });

      const previous = client.getQueryData<Product[]>(["products", storeId]);

      client.setQueryData<Product[]>(["products", storeId], (old) =>
        old?.map((product) =>
          product.id === productId
            ? { ...product, available: nextAvailable }
            : product,
        ),
      );

      return { previous };
    },
    onError: (_error, _variables, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(["products", storeId], onMutateResult.previous);
      }
    },
    onSuccess: (_data, { productId, nextAvailable }) => {
      void logEvent({
        eventName: nextAvailable
          ? "product_marked_available"
          : "product_marked_unavailable",
        productId,
      });
    },
    onSettled: (_data, _error, _variables, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: ["products", storeId] });
    },
  });
}
