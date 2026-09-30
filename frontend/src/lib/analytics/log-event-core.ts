// Pure, dependency-injected event send (DATA-02, D-05). Imports nothing but
// types, so `node --test` can load this file directly without resolving the
// `@/` path alias or reading NEXT_PUBLIC_SUPABASE_URL at import time — see
// 01.1-PATTERNS.md and 01.1-04-PLAN.md's module_split_rationale.
//
// The one contract this module exists to prove: logEventWith NEVER rejects.
// A returned non-null `error`, a rejected promise, and a synchronous throw
// all resolve to undefined. Copying use-place-order.ts's `throw new
// PlaceOrderError(...)` shape here would let a throttled or failed analytics
// call abort the product action that triggered it — exactly what doc §17 and
// D-05 forbid. tests/unit/log-event-core.test.mjs is the mechanical proof.

/** The fixed 17-name event allow-list (mirrors the SQL check constraint in
 * `public.log_event` — see supabase/migrations/20260923001000_log_event.sql).
 * A name outside this union is a compile error here, before it would ever
 * reach the server-side allow-list as a runtime rejection. */
export type LogEventName =
  | "shop_created"
  | "onboarding_completed"
  | "product_added"
  | "product_updated"
  | "product_marked_available"
  | "product_marked_unavailable"
  | "offer_created"
  | "offer_shared"
  | "catalogue_shared"
  | "catalogue_opened"
  | "product_viewed"
  | "add_to_cart"
  | "checkout_started"
  | "order_placed"
  | "order_confirmed"
  | "order_cancelled"
  | "orders_opened";

/** A self-contained structural twin of the generated `Json` type
 * (`src/lib/supabase/database.types.ts`) — declared locally, not imported,
 * so this module stays free of any project import and loadable by
 * `node --test`. TypeScript compares types structurally, so this is
 * compatible with the real client's generated `p_props?: Json` parameter. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface LogEventInput {
  eventName: LogEventName;
  slug?: string;
  visitorId?: string;
  appVersion?: string | null;
  productId?: string;
  orderId?: string;
  offerId?: string;
  props?: Record<string, Json | undefined>;
}

/** The exact `p_`-prefixed parameter shape `public.log_event`'s SQL signature
 * expects (supabase/migrations/20260923001000_log_event.sql). Declared
 * explicitly, rather than a bare `Record<string, unknown>`, because the real
 * client's generated `.rpc()` type requires `p_event_name` to be present and
 * every other field to be `string | undefined` (never `null`) — an
 * index-signature type doesn't structurally guarantee either. Sending
 * `undefined` (an omitted JSON key) reaches the exact same server-side
 * outcome as an explicit `null`: every parameter after the first `default
 * null`s in the SQL signature. */
export interface LogEventRpcParams {
  p_event_name: string;
  p_slug?: string;
  p_visitor_id?: string;
  p_app_version?: string;
  p_product_id?: string;
  p_order_id?: string;
  p_offer_id?: string;
  p_props?: Json;
}

/** Structural shape of a Supabase-js-like client — deliberately not the real
 * `SupabaseClient` type, so this module stays free of the `@supabase/supabase-js`
 * import and loadable by `node --test`. `name` is narrowed to the one RPC this
 * module ever calls (rather than a bare `string`) because the real client's
 * `.rpc()` is generic over a literal union of known function names — a bare
 * `string` parameter is not assignable from that generic signature. The
 * return type is `PromiseLike`, not `Promise`: the real client's `.rpc()`
 * returns a thenable query builder, not a native `Promise`. */
export interface RpcCapableClient {
  rpc: (
    name: "log_event",
    params: LogEventRpcParams,
  ) => PromiseLike<{ error: { message: string } | null }>;
}

/** Fire-and-forget event send. Resolves — never rejects — regardless of what
 * `client.rpc` does: a returned error, a rejected promise, or a synchronous
 * throw all end here without propagating. */
export async function logEventWith(
  client: RpcCapableClient,
  input: LogEventInput,
): Promise<void> {
  try {
    const { error } = await client.rpc("log_event", {
      p_event_name: input.eventName,
      p_slug: input.slug ?? undefined,
      p_visitor_id: input.visitorId ?? undefined,
      p_app_version: input.appVersion ?? undefined,
      p_product_id: input.productId ?? undefined,
      p_order_id: input.orderId ?? undefined,
      p_offer_id: input.offerId ?? undefined,
      p_props: input.props ?? undefined,
    });

    if (error) {
      console.debug("logEvent: log_event RPC returned an error", error);
    }
  } catch (err) {
    // fire-and-forget (D-05): never throw into the caller's product action
    console.debug("logEvent: log_event RPC threw", err);
  }
}
