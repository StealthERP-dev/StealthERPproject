// HTTP (PostgREST) test: the application half of the order lifecycle
// (ORDR-05/D-01) — a real PostgREST round trip. A freshly signed-up vendor
// creates a store and one available product, a customer places an order
// against that store's slug through place_order as anon, and the vendor
// confirms/cancels it as the owner through the already-shipped
// "orders: owner updates" policy (no new policy, no new grant, no new RPC).
// Three separate tests, each with its own vendor/store/product and its own
// randomly generated customer phone number — never the same number twice
// in this file, since the rate limit is five orders per phone per store per
// hour and reusing one number across a growing test file is a latent flake.
// Mirrors createVendorStore from tests/db/vendor-isolation.test.mjs rather
// than importing it (test files stay independent, per this plan's own file
// list).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, signUpVendor, randomDigits } from "./_env.mjs";

async function createVendorStoreWithProduct() {
  const { client, userId, phone } = await signUpVendor();
  const slug = `ol-${phone}`;

  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `Order Lifecycle Shop ${phone}`,
      vendor_name: "Order Lifecycle Vendor",
      slug,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { data: category, error: categoryError } = await client
    .from("categories")
    .insert({ store_id: store.id, name: "Order Lifecycle Category" })
    .select("id")
    .single();
  assert.equal(categoryError, null);

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: "Order Lifecycle Product",
      category_id: category.id,
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();
  assert.equal(productError, null);

  return { client, storeId: store.id, slug, productId: product.id };
}

async function placeOrder(slug, productId, customerName, note, phone) {
  const anon = anonClient();
  const { data: orderId, error } = await anon.rpc("place_order", {
    p_slug: slug,
    p_name: customerName,
    p_phone: phone,
    p_note: note,
    p_items: [{ product_id: productId, qty: 1 }],
  });
  assert.equal(error, null);
  return { orderId, phone };
}

test("order lifecycle: confirming sets status and confirmed_at; cancellation columns stay null", async () => {
  const vendor = await createVendorStoreWithProduct();
  // A phone number distinct from the other two tests' — the rate limit is
  // five orders per phone per store per hour, and reusing one number across
  // a growing test file is a latent flake.
  const phoneA = "9" + randomDigits(9);
  const { orderId } = await placeOrder(
    vendor.slug,
    vendor.productId,
    "Confirm Customer",
    "Customer's own note",
    phoneA,
  );

  const { error: confirmError } = await vendor.client
    .from("orders")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", orderId);
  assert.equal(confirmError, null);

  const { data: order, error: readError } = await vendor.client
    .from("orders")
    .select("status, confirmed_at, rejection_reason, rejection_note")
    .eq("id", orderId)
    .single();
  assert.equal(readError, null);
  assert.equal(order.status, "confirmed");
  assert.notEqual(order.confirmed_at, null);
  assert.equal(order.rejection_reason, null);
  assert.equal(order.rejection_note, null);
});

test("order lifecycle: cancelling writes the preset code and the note; the customer's own note is untouched", async () => {
  const vendor = await createVendorStoreWithProduct();
  // A second, distinct phone number — see the note in the first test above.
  const phoneB = "9" + randomDigits(9);
  const { orderId } = await placeOrder(
    vendor.slug,
    vendor.productId,
    "Cancel Customer",
    "Customer's own note, never overwritten",
    phoneB,
  );

  const { error: cancelError } = await vendor.client
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      rejection_reason: "out_of_stock",
      rejection_note: "Ran out this morning",
    })
    .eq("id", orderId);
  assert.equal(cancelError, null);

  const { data: order, error: readError } = await vendor.client
    .from("orders")
    .select("status, cancelled_at, rejection_reason, rejection_note, note")
    .eq("id", orderId)
    .single();
  assert.equal(readError, null);
  assert.equal(order.status, "cancelled");
  assert.notEqual(order.cancelled_at, null);
  assert.equal(order.rejection_reason, "out_of_stock");
  assert.equal(order.rejection_note, "Ran out this morning");
  // The CUSTOMER's own note column, untouched by the vendor's cancellation
  // write — a defect here would leave every screen looking correct.
  assert.equal(order.note, "Customer's own note, never overwritten");
});

test("order lifecycle: a misspelled preset code is rejected by error code, then the same order cancels correctly", async () => {
  const vendor = await createVendorStoreWithProduct();
  // A third, distinct phone number — see the note in the first test above.
  const phoneC = "9" + randomDigits(9);
  const { orderId } = await placeOrder(
    vendor.slug,
    vendor.productId,
    "Typo Customer",
    null,
    phoneC,
  );

  const { error: badCancelError } = await vendor.client
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      rejection_reason: "out_of_stok",
      rejection_note: "typo attempt",
    })
    .eq("id", orderId);
  assert.notEqual(badCancelError, null);
  // Asserted by error code, never by message text.
  assert.equal(badCancelError.code, "23514");

  const { data: unchanged, error: unchangedReadError } = await vendor.client
    .from("orders")
    .select("status, rejection_reason, rejection_note")
    .eq("id", orderId)
    .single();
  assert.equal(unchangedReadError, null);
  assert.equal(unchanged.status, "new");
  assert.equal(unchanged.rejection_reason, null);
  assert.equal(unchanged.rejection_note, null);

  const { error: goodCancelError } = await vendor.client
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      rejection_reason: "out_of_stock",
      rejection_note: "Ran out this morning",
    })
    .eq("id", orderId);
  assert.equal(goodCancelError, null);

  const { data: cancelled, error: cancelledReadError } = await vendor.client
    .from("orders")
    .select("status, rejection_reason, rejection_note")
    .eq("id", orderId)
    .single();
  assert.equal(cancelledReadError, null);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.rejection_reason, "out_of_stock");
  assert.equal(cancelled.rejection_note, "Ran out this morning");
});
