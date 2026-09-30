import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import {
  GENERIC_ORDER_ERROR,
  ORDER_ERROR_MESSAGES,
  PLACE_ORDER_ERROR_CODES,
  type PlaceOrderErrorCode,
} from "@/features/storefront/constants";
import { logEvent } from "@/lib/analytics/log-event";
import { PlaceOrderInputSchema } from "@shared/api-contract";

export interface PlaceOrderItem {
  productId: string;
  qty: number;
}

export interface PlaceOrderInput {
  slug: string;
  name: string;
  phone: string;
  note: string;
  items: PlaceOrderItem[];
}

function isPlaceOrderErrorCode(value: string): value is PlaceOrderErrorCode {
  return (PLACE_ORDER_ERROR_CODES as readonly string[]).includes(value);
}

export class PlaceOrderError extends Error {
  readonly code: PlaceOrderErrorCode | "unknown";

  constructor(message: string) {
    super(message);
    this.name = "PlaceOrderError";
    this.code = isPlaceOrderErrorCode(message) ? message : "unknown";
  }
}

export function orderErrorMessage(error: unknown): string {
  if (error instanceof PlaceOrderError && error.code !== "unknown") {
    return ORDER_ERROR_MESSAGES[error.code];
  }
  return GENERIC_ORDER_ERROR;
}

export function usePlaceOrder() {
  return useMutation<string, PlaceOrderError, PlaceOrderInput>({
    mutationFn: async ({ slug, name, phone, note, items }) => {
      const rpcParams = {
        p_slug: slug,
        p_name: name,
        p_phone: phone,
        p_note: note,
        p_items: items.map((item) => ({
          product_id: item.productId,
          qty: item.qty,
        })),
      };

      // Client-side pre-validation against the shared contract — a defensive
      // net, never the authority. place_order() itself remains the only
      // real enforcement point; this just avoids a doomed round trip.
      const parsed = PlaceOrderInputSchema.safeParse(rpcParams);
      if (!parsed.success) {
        throw new PlaceOrderError(
          parsed.error.issues[0]?.message ?? "invalid_items",
        );
      }

      const { data, error } = await supabase.rpc("place_order", rpcParams);

      if (error) {
        throw new PlaceOrderError(error.message);
      }

      if (!data) {
        throw new PlaceOrderError("unknown");
      }

      return data;
    },
    // The ONE edit D-05 makes to this hook: fire order_placed from the
    // mutation's own success callback (never a settle callback, which also
    // runs after a failure and would record an order that never happened —
    // DATA-08, D-10). Attached here rather than at each call site's own
    // per-call callback so every future caller gets it without remembering
    // to — the mutation function, the error class and the message mapping
    // above are all otherwise untouched.
    onSuccess: (orderId, variables) => {
      void logEvent({
        eventName: "order_placed",
        slug: variables.slug,
        orderId,
      });
    },
  });
}
