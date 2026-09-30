// HTTP (PostgREST) proof of the anon/public read surface — complements the
// pgTAP suite (supabase/tests/010_public_read_surface.sql) with a real
// over-the-wire round trip through PostgREST, using only the anon key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, signUpVendor, randomDigits } from "./_env.mjs";

test("anon reads public_stores for the seeded demo shop with exactly the public columns", async () => {
  const anon = anonClient();

  const { data, error } = await anon
    .from("public_stores")
    .select("*")
    .eq("slug", "priya-stores")
    .maybeSingle();

  assert.equal(error, null);
  assert.ok(data, "expected a public_stores row for priya-stores");
  assert.deepEqual(
    new Set(Object.keys(data)),
    new Set(["id", "slug", "shop_name", "is_open"]),
  );
});

test("anon sees only available products and only today's offers for a fresh vendor's store", async () => {
  const { client: vendor, userId, phone } = await signUpVendor();
  const slug = `test-shop-${randomDigits(8)}`;

  const { data: store, error: storeError } = await vendor
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Test Vendor Shop",
      vendor_name: "Test Vendor",
      slug,
      business_types: ["Vegetables"],
    })
    .select()
    .single();
  assert.equal(storeError, null);

  const { data: available, error: availableError } = await vendor
    .from("products")
    .insert({
      store_id: store.id,
      name: "Available Product",
      unit: "kg",
      available: true,
    })
    .select()
    .single();
  assert.equal(availableError, null);

  const { error: unavailableError } = await vendor.from("products").insert({
    store_id: store.id,
    name: "Unavailable Product",
    unit: "kg",
    available: false,
  });
  assert.equal(unavailableError, null);

  const { data: todayStr, error: todayError } = await vendor.rpc("today_ist");
  assert.equal(todayError, null);
  const today = new Date(`${todayStr}T00:00:00Z`);
  const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { error: offerTodayError } = await vendor.from("offers").insert({
    store_id: store.id,
    product_id: available.id,
    today_price_label: "₹20/kg",
    regular_price_label: "₹25/kg",
    offer_date: todayStr,
  });
  assert.equal(offerTodayError, null);

  const { error: offerYesterdayError } = await vendor.from("offers").insert({
    store_id: store.id,
    product_id: available.id,
    today_price_label: "₹20/kg",
    regular_price_label: "₹25/kg",
    offer_date: yesterdayStr,
  });
  assert.equal(offerYesterdayError, null);

  const anon = anonClient();

  const { data: products, error: productsError } = await anon
    .from("products")
    .select("id, name")
    .eq("store_id", store.id);
  assert.equal(productsError, null);
  assert.deepEqual(
    products.map((p) => p.id),
    [available.id],
  );

  const { data: offers, error: offersError } = await anon
    .from("offers")
    .select("id, offer_date")
    .eq("store_id", store.id);
  assert.equal(offersError, null);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].offer_date, todayStr);
});

test("anon cannot read stores, orders, or order_items (42501, no data)", async () => {
  const anon = anonClient();

  for (const table of ["stores", "orders", "order_items"]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    assert.equal(data, null, `expected no data from ${table}`);
    assert.ok(error, `expected an error selecting from ${table}`);
    assert.equal(error.code, "42501", `expected 42501 selecting from ${table}`);
  }
});

test("the private schema is not reachable over the REST API", async () => {
  const anon = anonClient();

  const { data, error } = await anon.schema("private").rpc("owned_store_id");
  assert.equal(data, null);
  assert.ok(
    error,
    "expected an error calling private.owned_store_id over PostgREST",
  );
});
