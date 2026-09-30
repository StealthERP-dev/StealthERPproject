"use client";

// D-02's create-or-replace write (OFFR-01, DATA-07). Modelled on
// use-upsert-category.ts for its conflict-aware upsert shape (D-02 follows
// Phase 3's own precedent for "replace via an existing unique constraint,
// never a pre-check") and on use-save-product.ts for its typed-error class,
// its fire-and-forget event fired from inside the already-resolved mutation
// body, and its onSettled cache invalidation.
//
// The conflict target is the shipped `offers_product_id_offer_date_key
// unique (product_id, offer_date)` constraint
// (supabase/migrations/20260923000500_offers_price_model.sql:57-58) — no new
// migration, no read-then-decide-insert-or-update branch. A second save for
// the same product the same day resolves to the SAME row (same id, same
// created_at), live-tested end to end in 05-RESEARCH.md Pattern 2.
//
// No date key is sent in the write payload — the column's own
// `default public.today_ist()` is the single source of that date; a
// client-computed value would be a second place a day boundary could
// disagree (D-08). The conflict target still NAMES the column (that is the
// constraint's own two-column identity), which is not the same as sending
// it as a payload key.
//
// The database also carries three generated columns this file must never
// write: the price-difference column and the two generated timestamp-window
// columns. The generated `database.types.ts` does not mark any of them as
// generated, so a stray key here would compile cleanly and throw only at
// the database (05-RESEARCH.md Pitfall 4). This file writes exactly six
// payload keys: the store id, the product id, the two numeric prices and
// their two derived display strings — nothing else ever reaches `.upsert()`.
//
// The two display-label columns are NOT NULL-adjacent legacy freight: the
// first (today's price label) is NOT NULL with no default, so every insert
// must supply it, and `place_order` selects it straight into
// `order_items.price` — a human-facing string a vendor reads on an order
// line in Phase 6. Both labels are derived here from the SAME numeric value
// the row stores, through the app's one money formatter, so a label can
// never disagree with the number it describes.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import { istDateString } from "@/lib/date/ist";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import { offersQueryKey } from "@/features/offers/hooks/use-offers";
import { CreateOfferInputSchema } from "@shared/api-contract";

export const SAVE_OFFER_ERROR_CODES = ["save_failed"] as const;
export type SaveOfferErrorCode = (typeof SAVE_OFFER_ERROR_CODES)[number];

export const GENERIC_SAVE_OFFER_ERROR = "Something went wrong. Try again.";

function isSaveOfferErrorCode(value: string): value is SaveOfferErrorCode {
  return (SAVE_OFFER_ERROR_CODES as readonly string[]).includes(value);
}

export class SaveOfferError extends Error {
  readonly code: SaveOfferErrorCode | "unknown";

  constructor(message: string) {
    super(message);
    this.name = "SaveOfferError";
    this.code = isSaveOfferErrorCode(message) ? message : "unknown";
  }
}

export interface SaveOfferInput {
  productId: string;
  /** The product's own selling unit — suffixes both derived display labels,
   * falling back to the storefront card's own "piece" default when empty. */
  unit: string;
  offerPrice: number;
  regularPrice: number | null;
}

export interface SaveOfferResult {
  id: string;
  productId: string;
}

function priceLabel(value: number, unit: string): string {
  return `₹${formatPriceDisplay(value)}/${unit || "piece"}`;
}

export function useSaveOffer(storeId: string) {
  return useMutation<SaveOfferResult, SaveOfferError, SaveOfferInput>({
    mutationFn: async (input) => {
      const todayPriceLabel = priceLabel(input.offerPrice, input.unit);
      const regularPriceLabel =
        input.regularPrice === null
          ? null
          : priceLabel(input.regularPrice, input.unit);

      const upsertPayload = {
        store_id: storeId,
        product_id: input.productId,
        offer_price: input.offerPrice,
        regular_price: input.regularPrice,
        today_price_label: todayPriceLabel,
        regular_price_label: regularPriceLabel,
      };

      const parsed = CreateOfferInputSchema.safeParse(upsertPayload);
      if (!parsed.success) {
        throw new SaveOfferError("save_failed");
      }

      const { data, error } = await supabase
        .from("offers")
        .upsert(upsertPayload, { onConflict: "product_id,offer_date" })
        .select("id, product_id")
        .single();

      if (error) {
        throw new SaveOfferError("save_failed");
      }

      void logEvent({
        eventName: "offer_created",
        offerId: data.id,
        productId: data.product_id,
      });

      return { id: data.id, productId: data.product_id };
    },
    onSettled: (_data, _error, _variables, _context, { client }) => {
      const dateString = istDateString(new Date());
      void client.invalidateQueries({
        queryKey: offersQueryKey(storeId, dateString),
      });
    },
  });
}
