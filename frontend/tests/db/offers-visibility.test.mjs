// HTTP (PostgREST) test: proves the three explicit filters every
// vendor-facing offers read needs (05-01-PLAN.md <the_three_filters>) are
// what EXCLUDE a stale-date offer, a hidden product's offer, and an
// unpriced offer — reading the RESPONSE BODY, never a rendering. This is
// the only place the plain-embed trap (D-14) is visible: a client-side
// filter would still leave the excluded row in the network response.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getLocalEnv, signUpVendor } from "./_env.mjs";
import { istDateString } from "../../src/lib/date/ist.ts";

test("offers-visibility: the stale-date trap — an unfiltered vendor read returns every date this store has ever had; the explicit date filter returns only today's (D-13)", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Offers Visibility Date Shop",
      vendor_name: "Offers Visibility Vendor",
      slug: `offers-vis-date-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: "Visibility Date Product",
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();
  assert.equal(productError, null);

  const today = istDateString(new Date());
  const yesterday = istDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const { error: insertError } = await client.from("offers").insert([
    {
      store_id: store.id,
      product_id: product.id,
      today_price_label: "₹10/kg",
      offer_price: 10,
      offer_date: today,
    },
    {
      store_id: store.id,
      product_id: product.id,
      today_price_label: "₹8/kg",
      offer_price: 8,
      offer_date: yesterday,
    },
  ]);
  assert.equal(insertError, null);

  // The trap itself, asserted POSITIVELY: "offers: owner manages" has no
  // date predicate of its own, so a query with no date bound returns BOTH
  // rows. If this assertion ever stops returning 2, the policy has changed
  // and D-13's own justification must be re-read before the application's
  // date filter is removed as "redundant".
  const { data: unfiltered, error: unfilteredError } = await client
    .from("offers")
    .select("id, offer_date")
    .eq("store_id", store.id);
  assert.equal(unfilteredError, null);
  assert.equal(unfiltered.length, 2);

  // The fix: the explicit date filter every vendor-facing read carries.
  const { data: filtered, error: filteredError } = await client
    .from("offers")
    .select("id, offer_date")
    .eq("store_id", store.id)
    .eq("offer_date", today);
  assert.equal(filteredError, null);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].offer_date, today);
});

test("offers-visibility: the hidden-product trap — a plain embed returns a null product instead of dropping the row; the inner join with the embedded-column filter excludes it entirely (D-14)", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Offers Visibility Availability Shop",
      vendor_name: "Offers Visibility Vendor",
      slug: `offers-vis-avail-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { data: visibleProduct, error: visibleError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: "Visibility Visible Product",
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();
  assert.equal(visibleError, null);

  const { data: hiddenProduct, error: hiddenError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: "Visibility Hidden Product",
      unit: "kg",
      available: false,
    })
    .select("id")
    .single();
  assert.equal(hiddenError, null);

  const today = istDateString(new Date());
  const { error: insertError } = await client.from("offers").insert([
    {
      store_id: store.id,
      product_id: visibleProduct.id,
      today_price_label: "₹5/kg",
      offer_price: 5,
      offer_date: today,
    },
    {
      store_id: store.id,
      product_id: hiddenProduct.id,
      today_price_label: "₹5/kg",
      offer_price: 5,
      offer_date: today,
    },
  ]);
  assert.equal(insertError, null);

  // The trap itself, asserted POSITIVELY: a plain (non-inner) embed still
  // returns BOTH offer rows — the row is never excluded on its own.
  //
  // Live-verified correction to CONTEXT/RESEARCH's own generic framing: for
  // an ANONYMOUS reader, whose "products: public reads available" policy
  // denies visibility into an unavailable product row, the embed resolves
  // to null (RLS silently nulls a child it cannot authorize). But for THIS
  // signed-in OWNER, "products: owner manages" is `for all` with no
  // availability clause, so the owner can see every one of their own
  // products regardless of state — the embed for their own hidden product
  // therefore comes back as a REAL object (available: false), not null.
  // Either shape is dangerous the same way: the offer row itself is never
  // excluded by a plain embed, so a naive client-side filter still receives
  // the hidden product's offer over the wire.
  const { data: plainEmbed, error: plainError } = await client
    .from("offers")
    .select("id, product_id, products(id, available)")
    .eq("store_id", store.id)
    .eq("offer_date", today);
  assert.equal(plainError, null);
  assert.equal(
    plainEmbed.length,
    2,
    "a plain embed must never exclude the hidden product's offer row — this is what makes it dangerous, not merely redundant",
  );
  const hiddenRow = plainEmbed.find(
    (row) => row.product_id === hiddenProduct.id,
  );
  assert.ok(
    hiddenRow.products === null || hiddenRow.products.available === false,
    "the hidden product's embed must never read as available: true — it is either nulled (anon) or a real row reporting its own unavailability (owner), never a live product",
  );

  // The fix: products!inner + the embedded-column filter excludes the row
  // itself, not merely its rendering.
  const { data: innerJoin, error: innerError } = await client
    .from("offers")
    .select("id, product_id, products!inner(id, available)")
    .eq("store_id", store.id)
    .eq("offer_date", today)
    .eq("products.available", true);
  assert.equal(innerError, null);
  assert.equal(innerJoin.length, 1);
  assert.equal(innerJoin[0].product_id, visibleProduct.id);
});

test("offers-visibility: the unpriced case — the seeded demo shop's label-only offer is returned by the date+availability filters and excluded once the priceability filter is added", async () => {
  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const today = istDateString(new Date());
  const SEEDED_STORE_ID = "00000000-0000-4000-8000-000000000002";
  const SEEDED_LABEL_ONLY_OFFER_ID = "00000000-0000-4000-8000-000000000030";

  const { data: withoutPriceFilter, error: withoutPriceError } =
    await vendorClient
      .from("offers")
      .select("id, offer_price, products!inner(available)")
      .eq("store_id", SEEDED_STORE_ID)
      .eq("offer_date", today)
      .eq("products.available", true);
  assert.equal(withoutPriceError, null);
  assert.ok(
    withoutPriceFilter.some((row) => row.id === SEEDED_LABEL_ONLY_OFFER_ID),
    "the seeded label-only offer must be returned by the date and availability filters alone — it is NOT the seed that is broken",
  );

  const { data: withPriceFilter, error: withPriceError } = await vendorClient
    .from("offers")
    .select("id, offer_price, products!inner(available)")
    .eq("store_id", SEEDED_STORE_ID)
    .eq("offer_date", today)
    .eq("products.available", true)
    .not("offer_price", "is", null);
  assert.equal(withPriceError, null);
  assert.ok(
    !withPriceFilter.some((row) => row.id === SEEDED_LABEL_ONLY_OFFER_ID),
    "adding the priceability filter must exclude the label-only offer — it has no number to render and no number place_order can price from",
  );
});
