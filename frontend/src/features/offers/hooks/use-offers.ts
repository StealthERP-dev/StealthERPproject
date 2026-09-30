// The ONE vendor-side offers read every screen in this phase (and the two
// still to come, per COVERAGE) uses. Copies use-products.ts's shape
// (module-level fetch function, one useQuery, owner-scoped) with one
// addition use-products.ts does not need: the RLS policy that authorizes
// this read ("offers: owner manages") carries no date bound of its own,
// unlike the anonymous/customer "offers: public reads today's" policy — so
// this hook, not the database, is what makes "today's offers" true for the
// vendor's own screens.
//
// Three explicit filters, unconditional, on every call
// (05-01-PLAN.md <the_three_filters>; both traps below were falsified live
// against the real database this phase, see 05-RESEARCH.md Pattern 1):
//   1. Date (D-13): .eq("offer_date", dateString) — RLS's owner-scoped
//      policy has no date predicate, so an authenticated vendor's read
//      otherwise returns every offer that store has ever had.
//   2. Availability (D-14): products!inner(...) + .eq("products.available",
//      true) — a plain (non-inner) embed returns the offer row with a NULL
//      products object instead of dropping it; only the inner-join form
//      excludes the row itself.
//   3. Priceability: .not("offer_price", "is", null) — a label-only legacy
//      row (the seeded demo offer, supabase/seed.sql) has no number to
//      render and no number place_order can price from.
//
// The query key carries the date string as a third element, not just the
// store id: a browser left open across midnight keeps an unchanged key
// otherwise, and the crossing must produce a fresh fetch. Every writer
// imports offersQueryKey rather than re-spelling this key, so the read and
// every invalidation of it cannot drift apart — the same "one shared query,
// one invalidation point" discipline use-products.ts's own header comment
// establishes for products.
//
// This is the ONE offers query Home's card and Manage Offers both read
// (plans 05-02/05-03) — do not create a second, differently-shaped query
// for either screen.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { istDateString } from "@/lib/date/ist";
import type { Database } from "@/lib/supabase/database.types";

export type Offer = Database["public"]["Tables"]["offers"]["Row"] & {
  /** The joined product's own display fields, flattened the same way
   * use-products.ts flattens its category embed. No `product_available`
   * field here (IN-02, 05-REVIEW.md): the query's own `products!inner(...)`
   * + `.eq("products.available", true)` (D-14, kept in the select/filter
   * below) already excludes any unavailable product's offer from the
   * result set entirely, so a flattened `product_available` on a row that
   * survived the join would always be `true` and could carry no
   * information a reader could act on. */
  product_name: string;
  product_image_url: string | null;
};

interface FetchedOfferRow {
  id: string;
  store_id: string;
  product_id: string;
  offer_date: string;
  offer_price: number | null;
  regular_price: number | null;
  saving: number | null;
  starts_at: string | null;
  ends_at: string | null;
  today_price_label: string;
  regular_price_label: string | null;
  created_at: string;
  products: {
    name: string;
    image_url: string | null;
    available: boolean;
  };
}

/** Every writer of an offers row imports this rather than re-spelling the
 * key, so this read hook and every mutation's invalidation address the
 * exact same cache entry. */
export function offersQueryKey(storeId: string, dateString: string) {
  return ["offers", storeId, dateString] as const;
}

async function fetchOffers(
  storeId: string,
  dateString: string,
): Promise<Offer[]> {
  const { data, error } = await supabase
    .from("offers")
    .select(
      "id, store_id, product_id, offer_date, offer_price, regular_price, saving, starts_at, ends_at, today_price_label, regular_price_label, created_at, products!inner(name, image_url, available)",
    )
    .eq("store_id", storeId)
    .eq("offer_date", dateString)
    .eq("products.available", true)
    .not("offer_price", "is", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data as unknown as FetchedOfferRow[]).map(
    ({ products, ...offer }) => ({
      ...offer,
      product_name: products.name,
      product_image_url: products.image_url,
    }),
  );
}

export function useOffers(storeId: string) {
  const dateString = istDateString(new Date());
  return useQuery({
    queryKey: offersQueryKey(storeId, dateString),
    queryFn: () => fetchOffers(storeId, dateString),
    enabled: storeId.length > 0,
  });
}
