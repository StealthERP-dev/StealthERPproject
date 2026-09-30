// HTTP (PostgREST) test: owner-only access to stores/orders/order_items and
// cross-store write denial, proven with two real Auth sessions (D-06 — owning
// vendor vs a different vendor). Mirrors createVendorStore from
// tests/db/storage.test.mjs rather than importing it (test files stay
// independent, per this plan's own file list).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, signUpVendor, randomDigits } from "./_env.mjs";

async function createVendorStore() {
  const { client, userId, phone } = await signUpVendor();
  const slug = `t-${phone}`;

  const { data, error } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `Test Shop ${phone}`,
      vendor_name: "Test Vendor",
      slug,
    })
    .select("id")
    .single();
  assert.equal(error, null);

  return { client, storeId: data.id, phone, slug };
}

test("vendor isolation: owner-only access to stores, orders, order_items; cross-store writes denied", async () => {
  const a = await createVendorStore();
  const b = await createVendorStore();

  // A's own category + available product
  const { data: catA, error: catAError } = await a.client
    .from("categories")
    .insert({ store_id: a.storeId, name: "Category A" })
    .select("id")
    .single();
  assert.equal(catAError, null);

  await a.client
    .from("products")
    .insert({
      store_id: a.storeId,
      name: "Product A",
      category_id: catA.id,
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();

  // B's own category + available product (used for the offer + the order) +
  // an unavailable product
  const { data: catB, error: catBError } = await b.client
    .from("categories")
    .insert({ store_id: b.storeId, name: "Category B" })
    .select("id")
    .single();
  assert.equal(catBError, null);

  const { data: prodBAvail, error: prodBAvailError } = await b.client
    .from("products")
    .insert({
      store_id: b.storeId,
      name: "Product B Available",
      category_id: catB.id,
      unit: "kg",
      available: true,
    })
    .select("id")
    .single();
  assert.equal(prodBAvailError, null);

  await b.client
    .from("products")
    .insert({
      store_id: b.storeId,
      name: "Product B Unavailable",
      unit: "kg",
      available: false,
    })
    .select("id")
    .single();

  const { error: offerBError } = await b.client.from("offers").insert({
    store_id: b.storeId,
    product_id: prodBAvail.id,
    today_price_label: "₹10/kg",
    regular_price_label: "₹15/kg",
  });
  assert.equal(offerBError, null);

  // One order placed on B's store through the public write path (anon, no session)
  const { data: orderId, error: placeOrderError } = await anonClient().rpc(
    "place_order",
    {
      p_slug: b.slug,
      p_name: "Iso HTTP Customer",
      p_phone: "9" + randomDigits(9),
      p_note: null,
      p_items: [{ product_id: prodBAvail.id, qty: 1 }],
    },
  );
  assert.equal(placeOrderError, null);

  // A's from('stores').select() returns only A's row
  const { data: aStores, error: aStoresError } = await a.client
    .from("stores")
    .select("id");
  assert.equal(aStoresError, null);
  assert.deepEqual(
    aStores.map((s) => s.id),
    [a.storeId],
  );

  // A's update of B's store returns an empty array; B still reads its own shop_name
  const { data: updateStoreResult, error: updateStoreError } = await a.client
    .from("stores")
    .update({ shop_name: "Hacked" })
    .eq("id", b.storeId)
    .select();
  assert.equal(updateStoreError, null);
  assert.deepEqual(updateStoreResult, []);

  const { data: bStoreCheck, error: bStoreCheckError } = await b.client
    .from("stores")
    .select("shop_name")
    .eq("id", b.storeId)
    .single();
  assert.equal(bStoreCheckError, null);
  assert.equal(bStoreCheck.shop_name, `Test Shop ${b.phone}`);

  // A's inserts into B's store, and cross-store category/product references, fail 42501
  const { error: insertProductBError } = await a.client
    .from("products")
    .insert({ store_id: b.storeId, name: "Malicious Product" });
  assert.equal(insertProductBError?.code, "42501");

  const { error: insertOfferBError } = await a.client.from("offers").insert({
    store_id: b.storeId,
    product_id: prodBAvail.id,
    today_price_label: "₹1/kg",
  });
  assert.equal(insertOfferBError?.code, "42501");

  const { error: insertCategoryBError } = await a.client
    .from("categories")
    .insert({ store_id: b.storeId, name: "Malicious Category" });
  assert.equal(insertCategoryBError?.code, "42501");

  const { error: crossCategoryError } = await a.client.from("products").insert({
    store_id: a.storeId,
    name: "Cross-Category Product",
    category_id: catB.id,
  });
  assert.equal(crossCategoryError?.code, "42501");

  const { error: crossProductOfferError } = await a.client
    .from("offers")
    .insert({
      store_id: a.storeId,
      product_id: prodBAvail.id,
      today_price_label: "₹1/kg",
    });
  assert.equal(crossProductOfferError?.code, "42501");

  // A's from('orders') filtered to B's store returns []
  const { data: aOrdersForB, error: aOrdersForBError } = await a.client
    .from("orders")
    .select("id")
    .eq("store_id", b.storeId);
  assert.equal(aOrdersForBError, null);
  assert.deepEqual(aOrdersForB, []);

  // B sees its order
  const { data: bOrders, error: bOrdersError } = await b.client
    .from("orders")
    .select("id, is_new")
    .eq("id", orderId);
  assert.equal(bOrdersError, null);
  assert.equal(bOrders.length, 1);
  assert.equal(bOrders[0].is_new, true);

  // A's direct insert into orders/order_items fails
  const { error: insertOrderError } = await a.client.from("orders").insert({
    store_id: a.storeId,
    customer_name: "Direct Insert",
    customer_phone: "9000000099",
  });
  assert.equal(insertOrderError?.code, "42501");

  const { error: insertOrderItemError } = await a.client
    .from("order_items")
    .insert({ order_id: orderId, product_name: "Direct Insert Item", qty: 1 });
  assert.equal(insertOrderItemError?.code, "42501");

  // A's update of B's order is_new returns [] and B's order stays is_new true
  const { data: updateOrderResult, error: updateOrderError } = await a.client
    .from("orders")
    .update({ is_new: false })
    .eq("id", orderId)
    .select();
  assert.equal(updateOrderError, null);
  assert.deepEqual(updateOrderResult, []);

  const { data: bOrderStillNew, error: bOrderStillNewError } = await b.client
    .from("orders")
    .select("is_new")
    .eq("id", orderId)
    .single();
  assert.equal(bOrderStillNewError, null);
  assert.equal(bOrderStillNew.is_new, true);

  // B can update is_new on its own order (spot-check owner access still works)
  const { data: bUpdateResult, error: bUpdateError } = await b.client
    .from("orders")
    .update({ is_new: false })
    .eq("id", orderId)
    .select();
  assert.equal(bUpdateError, null);
  assert.equal(bUpdateResult.length, 1);
  assert.equal(bUpdateResult[0].is_new, false);
});

test("vendor isolation: is_open double-flip returns to its starting value, read back from a fresh select each time", async () => {
  const { client, storeId } = await createVendorStore();

  // Newly-created shop starts open (schema default true) — flip closed first.
  const { error: toClosedError } = await client
    .from("stores")
    .update({ is_open: false })
    .eq("id", storeId);
  assert.equal(toClosedError, null);

  const { data: afterClosed, error: afterClosedError } = await client
    .from("stores")
    .select("is_open")
    .eq("id", storeId)
    .single();
  assert.equal(afterClosedError, null);
  assert.equal(afterClosed.is_open, false);

  // Flip back open — the same value it started at.
  const { error: toOpenError } = await client
    .from("stores")
    .update({ is_open: true })
    .eq("id", storeId);
  assert.equal(toOpenError, null);

  const { data: afterOpen, error: afterOpenError } = await client
    .from("stores")
    .select("is_open")
    .eq("id", storeId)
    .single();
  assert.equal(afterOpenError, null);
  assert.equal(afterOpen.is_open, true);

  // Exactly one row for this store throughout — the write is an UPDATE, never
  // an insert or an upsert.
  const { data: rows, error: rowsError } = await client
    .from("stores")
    .select("id")
    .eq("id", storeId);
  assert.equal(rowsError, null);
  assert.deepEqual(
    rows.map((r) => r.id),
    [storeId],
  );
});

test("vendor isolation: another vendor's attempt to flip is_open affects zero rows, and the value is unchanged", async () => {
  const owner = await createVendorStore();
  const intruder = await createVendorStore();

  const { data: crossUpdateResult, error: crossUpdateError } =
    await intruder.client
      .from("stores")
      .update({ is_open: false })
      .eq("id", owner.storeId)
      .select();
  assert.equal(crossUpdateError, null);
  assert.deepEqual(crossUpdateResult, []);

  const { data: ownerStoreCheck, error: ownerStoreCheckError } =
    await owner.client
      .from("stores")
      .select("is_open")
      .eq("id", owner.storeId)
      .single();
  assert.equal(ownerStoreCheckError, null);
  assert.equal(ownerStoreCheck.is_open, true);
});

test("vendor isolation: signUp rejects a 5-digit PIN and accepts a 6-digit PIN", async () => {
  const client = anonClient();
  const phone = "9" + randomDigits(9);

  const { data: weakData, error: weakError } = await client.auth.signUp({
    email: `${phone}@phone.local`,
    password: "12345",
  });
  assert.ok(weakError);
  assert.equal(weakData.session, null);

  const { data: strongData, error: strongError } = await client.auth.signUp({
    email: `${phone}9@phone.local`,
    password: "654321",
  });
  assert.equal(strongError, null);
  assert.ok(strongData.session);
});
