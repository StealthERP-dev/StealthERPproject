// HTTP (PostgREST) test: a customer places an order request through
// place_order as anon, and the seeded vendor can read it back with
// server-derived customer_name / customer_phone / product_name / price.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { anonClient, getLocalEnv, randomDigits } from "./_env.mjs";

test("place_order: customer sends an order request and the vendor can read it", async () => {
  const client = anonClient();

  const { data: product, error: productError } = await client
    .from("products")
    .select("id")
    .eq("name", "Tomatoes")
    .single();
  assert.equal(productError, null);

  const { data: offer } = await client
    .from("offers")
    .select("today_price_label")
    .eq("product_id", product.id)
    .maybeSingle();

  const digits = "9" + randomDigits(9);
  const phoneWithSpaces = `${digits.slice(0, 5)} ${digits.slice(5)}`;

  const { data: orderId, error } = await client.rpc("place_order", {
    p_slug: "priya-stores",
    p_name: "  Meera  ",
    p_phone: phoneWithSpaces,
    p_note: "",
    p_items: [{ product_id: product.id, qty: 2, price: "1", name: "Hacked" }],
  });

  assert.equal(error, null);
  assert.match(
    orderId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const { data: order, error: orderError } = await vendorClient
    .from("orders")
    .select(
      "customer_id, total, customer_name, customer_phone, note, order_items(product_name, qty, price)",
    )
    .eq("id", orderId)
    .single();
  assert.equal(orderError, null);

  assert.equal(order.customer_name, "Meera");
  assert.equal(order.customer_phone, digits);
  assert.equal(order.note, null);
  assert.match(
    order.customer_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  // The seeded Tomatoes product has no products.price and the seeded offer
  // has no numeric offer_price, so no line on this order is priceable — the
  // total is correctly null, not a defect (until Phase 3 ships the price
  // field).
  assert.equal(order.total, null);

  const item = order.order_items[0];
  assert.equal(item.product_name, "Tomatoes");
  assert.equal(item.qty, 2);
  assert.notEqual(item.price, "1");
  assert.equal(item.price, offer?.today_price_label ?? null);
});

test("place_order: same phone at the same shop reuses one customer_id; a different phone gets a different one", async () => {
  const client = anonClient();

  const { data: product, error: productError } = await client
    .from("products")
    .select("id")
    .eq("name", "Tomatoes")
    .single();
  assert.equal(productError, null);

  const phoneA = "9" + randomDigits(9);
  const phoneB = "9" + randomDigits(9);

  const { data: orderId1, error: error1 } = await client.rpc("place_order", {
    p_slug: "priya-stores",
    p_name: "Repeat Customer",
    p_phone: phoneA,
    p_note: null,
    p_items: [{ product_id: product.id, qty: 1 }],
  });
  assert.equal(error1, null);

  const { data: orderId2, error: error2 } = await client.rpc("place_order", {
    p_slug: "priya-stores",
    p_name: "Repeat Customer",
    p_phone: phoneA,
    p_note: null,
    p_items: [{ product_id: product.id, qty: 1 }],
  });
  assert.equal(error2, null);

  const { data: orderId3, error: error3 } = await client.rpc("place_order", {
    p_slug: "priya-stores",
    p_name: "Different Customer",
    p_phone: phoneB,
    p_note: null,
    p_items: [{ product_id: product.id, qty: 1 }],
  });
  assert.equal(error3, null);

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const { data: orders, error: ordersError } = await vendorClient
    .from("orders")
    .select("id, customer_id")
    .in("id", [orderId1, orderId2, orderId3]);
  assert.equal(ordersError, null);

  const byId = Object.fromEntries(orders.map((o) => [o.id, o.customer_id]));
  assert.equal(byId[orderId1], byId[orderId2]);
  assert.notEqual(byId[orderId1], byId[orderId3]);
});

test("place_order: concurrent rate limit — 10 parallel calls yield exactly 5 successes and 5 rate_limited", async () => {
  const client = anonClient();

  const { data: product, error: productError } = await client
    .from("products")
    .select("id")
    .eq("name", "Tomatoes")
    .single();
  assert.equal(productError, null);

  const phone = "9" + randomDigits(9);

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      client.rpc("place_order", {
        p_slug: "priya-stores",
        p_name: "Race Tester",
        p_phone: phone,
        p_note: null,
        p_items: [{ product_id: product.id, qty: 1 }],
      }),
    ),
  );

  const successes = results.filter((r) => r.error === null);
  const failures = results.filter((r) => r.error !== null);

  assert.equal(successes.length, 5);
  assert.equal(failures.length, 5);
  for (const { error } of failures) {
    assert.equal(error.message, "rate_limited");
  }
});
