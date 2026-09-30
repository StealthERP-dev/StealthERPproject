// HTTP (PostgREST) test: D-12's property, proven against fixtures this file
// builds itself — never against supabase/seed.sql's own literals. The
// seed's own counts (8 orders, 2 of them unseen) hold only immediately
// after `npx supabase db reset`, and every browser-flow run against the
// seeded shop adds real orders that accumulate — a literal assertion would
// drift and fail for a reason unrelated to the bug it guards, which is how
// a gate stops being trusted. This file instead builds its OWN store and
// asserts the RELATIONSHIP: a `status`-filtered count and an
// `is_new`-filtered count genuinely diverge, and a count query shaped
// exactly like the badge's own (use-new-order-count.ts) follows `is_new`.
//
// Mirrors createVendorStoreWithProduct from
// tests/db/order-lifecycle.test.mjs rather than importing it (test files
// stay independent, per this plan's own file list).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, signUpVendor, randomDigits } from "./_env.mjs";

const ORDER_COUNT = 5;
const CLEARED_SUBSET_COUNT = 2;

async function createVendorStoreWithProduct() {
  const { client, userId, phone } = await signUpVendor();
  const slug = `noc-${phone}`;

  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `New Order Count Shop ${phone}`,
      vendor_name: "New Order Count Vendor",
      slug,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { data: category, error: categoryError } = await client
    .from("categories")
    .insert({ store_id: store.id, name: "New Order Count Category" })
    .select("id")
    .single();
  assert.equal(categoryError, null);

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: "New Order Count Product",
      category_id: category.id,
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();
  assert.equal(productError, null);

  return { client, storeId: store.id, slug, productId: product.id };
}

async function placeOrder(slug, productId, customerName, phone) {
  const anon = anonClient();
  const { data: orderId, error } = await anon.rpc("place_order", {
    p_slug: slug,
    p_name: customerName,
    p_phone: phone,
    p_note: null,
    p_items: [{ product_id: productId, qty: 1 }],
  });
  assert.equal(error, null);
  return orderId;
}

test("D-12 fixture baseline: freshly placed orders are unseen and undecided — both counts start equal", async () => {
  const vendor = await createVendorStoreWithProduct();

  // Every order placed through place_order is unseen (is_new default true)
  // AND undecided (status default 'new') — both counts start equal.
  const orderIds = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    // A distinct phone per order — the rate limit is five orders per
    // (store, phone) per rolling hour.
    const phone = "9" + randomDigits(9);
    const orderId = await placeOrder(
      vendor.slug,
      vendor.productId,
      `New Order Count Baseline Customer ${String(i + 1)}`,
      phone,
    );
    orderIds.push(orderId);
  }

  const { count: lifecycleAllCount, error: lifecycleAllError } =
    await vendor.client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", vendor.storeId)
      .eq("status", "new");
  assert.equal(lifecycleAllError, null);
  assert.equal(
    lifecycleAllCount,
    ORDER_COUNT,
    "nothing has been decided yet — the lifecycle-filtered count equals the total number placed",
  );

  const { count: seenNessAllCount, error: seenNessAllError } =
    await vendor.client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", vendor.storeId)
      .eq("is_new", true);
  assert.equal(seenNessAllError, null);
  assert.equal(
    seenNessAllCount,
    ORDER_COUNT,
    "before any clear, both counts start equal — every placed order is unseen and undecided",
  );
});

test("D-12: is_new and status genuinely diverge after clearing a subset, and the badge's own count shape follows is_new", async () => {
  const vendor = await createVendorStoreWithProduct();

  const orderIds = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    // A distinct phone per order — the rate limit is five orders per
    // (store, phone) per rolling hour.
    const phone = "9" + randomDigits(9);
    const orderId = await placeOrder(
      vendor.slug,
      vendor.productId,
      `New Order Count Divergence Customer ${String(i + 1)}`,
      phone,
    );
    orderIds.push(orderId);
  }

  // As the owner, clear the seen-ness flag on a STRICT SUBSET.
  const toClear = orderIds.slice(0, CLEARED_SUBSET_COUNT);
  const { error: clearError } = await vendor.client
    .from("orders")
    .update({ is_new: false })
    .in("id", toClear);
  assert.equal(clearError, null);

  const { count: lifecycleAfterCount, error: lifecycleAfterError } =
    await vendor.client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", vendor.storeId)
      .eq("status", "new");
  assert.equal(lifecycleAfterError, null);
  assert.equal(
    lifecycleAfterCount,
    ORDER_COUNT,
    "the lifecycle column is untouched by the seen-ness clear — still equal to the total placed",
  );

  const { count: seenNessAfterCount, error: seenNessAfterError } =
    await vendor.client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", vendor.storeId)
      .eq("is_new", true);
  assert.equal(seenNessAfterError, null);
  assert.equal(
    seenNessAfterCount,
    ORDER_COUNT - CLEARED_SUBSET_COUNT,
    "the seen-ness-filtered count equals the total minus the cleared subset",
  );

  // The divergence D-12 exists to guard — asserted explicitly so this test
  // fails LOUDLY if the fixture ever stops producing it, rather than
  // passing vacuously.
  assert.ok(
    seenNessAfterCount < lifecycleAfterCount,
    `expected the seen-ness count (${String(seenNessAfterCount)}) to be strictly less than the lifecycle count (${String(lifecycleAfterCount)}) — the fixture failed to establish the discriminator`,
  );

  // A count query shaped EXACTLY like the badge's own
  // (use-new-order-count.ts's fetchNewOrderCount) — same table, same
  // head-only exact count, same store scope, same is_new filter — returns
  // the seen-ness number, never the lifecycle one.
  const { count: badgeShapedCount, error: badgeShapedError } =
    await vendor.client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", vendor.storeId)
      .eq("is_new", true);
  assert.equal(badgeShapedError, null);
  assert.equal(badgeShapedCount, seenNessAfterCount);
  assert.notEqual(badgeShapedCount, lifecycleAfterCount);
});
