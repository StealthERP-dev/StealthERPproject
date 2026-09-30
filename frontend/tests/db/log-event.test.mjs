// HTTP (PostgREST) test: an anonymous browser-shaped log_event call becomes
// one attributable, timestamped, versioned row in public.events, which no
// client role can read except the owning vendor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { anonClient, getLocalEnv, signUpVendor } from "./_env.mjs";
import pkg from "../../package.json" with { type: "json" };

test("log_event: an anonymous event is recorded and the vendor can read it back", async () => {
  const client = anonClient();
  const visitorId = crypto.randomUUID();
  const appVersion = "0.1.0-beta-test";

  const { error } = await client.rpc("log_event", {
    p_event_name: "catalogue_opened",
    p_slug: "priya-stores",
    p_visitor_id: visitorId,
    p_app_version: appVersion,
  });
  assert.equal(error, null);

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const { data: rows, error: selectError } = await vendorClient
    .from("events")
    .select("store_id, visitor_id, app_version, user_id, props")
    .eq("visitor_id", visitorId);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(row.visitor_id, visitorId);
  assert.equal(row.app_version, appVersion);
  assert.equal(row.user_id, null);
  assert.equal(row.props.store_name, "Priya Stores");
});

test("log_event: concurrent rate limit — 65 parallel calls from one visitor all resolve OK and exactly 60 rows are stored", async () => {
  const client = anonClient();
  const visitorId = crypto.randomUUID();

  const results = await Promise.all(
    Array.from({ length: 65 }, () =>
      client.rpc("log_event", {
        p_event_name: "catalogue_opened",
        p_slug: "priya-stores",
        p_visitor_id: visitorId,
      }),
    ),
  );

  // D-04: over the limit, log_event drops silently — every result resolves
  // OK, never a rate_limited error (the opposite semantics of place_order's
  // 5-success/5-error split).
  for (const { error } of results) {
    assert.equal(error, null);
  }

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const { count, error: countError } = await vendorClient
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("visitor_id", visitorId);
  assert.equal(countError, null);
  assert.equal(count, 60);
});

test("log_event: the real package.json version reaches the stored row, and a null app version stores null not an empty string", async () => {
  const client = anonClient();

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  // The real single source: the same string next.config.ts inlines into the
  // browser bundle as NEXT_PUBLIC_APP_VERSION, read here directly from
  // package.json rather than hardcoded — proving the value on the stored row
  // traces back to the real source, not a literal that happens to agree with
  // itself.
  const versionedVisitorId = crypto.randomUUID();
  const { error: versionedError } = await client.rpc("log_event", {
    p_event_name: "catalogue_opened",
    p_slug: "priya-stores",
    p_visitor_id: versionedVisitorId,
    p_app_version: pkg.version,
  });
  assert.equal(versionedError, null);

  const { data: versionedRows, error: versionedSelectError } =
    await vendorClient
      .from("events")
      .select("app_version")
      .eq("visitor_id", versionedVisitorId);
  assert.equal(versionedSelectError, null);
  assert.equal(versionedRows.length, 1);
  assert.equal(versionedRows[0].app_version, pkg.version);

  // A null app version must store SQL null, never an empty string — "we do
  // not know which release this came from" and "a release literally named
  // with an empty string" must stay distinguishable in the stored column.
  const nullVersionVisitorId = crypto.randomUUID();
  const { error: nullVersionError } = await client.rpc("log_event", {
    p_event_name: "catalogue_opened",
    p_slug: "priya-stores",
    p_visitor_id: nullVersionVisitorId,
    p_app_version: null,
  });
  assert.equal(nullVersionError, null);

  const { data: nullVersionRows, error: nullVersionSelectError } =
    await vendorClient
      .from("events")
      .select("app_version")
      .eq("visitor_id", nullVersionVisitorId);
  assert.equal(nullVersionSelectError, null);
  assert.equal(nullVersionRows.length, 1);
  assert.equal(nullVersionRows[0].app_version, null);
  assert.notEqual(nullVersionRows[0].app_version, "");
});

test("log_event: shop_created from a signed-in vendor is attributed to their own store with no slug and no visitor_id (signed-in branch)", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Signup Events Test Shop",
      vendor_name: "Signup Events Test Vendor",
      slug: `signup-events-test-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { error } = await client.rpc("log_event", {
    p_event_name: "shop_created",
  });
  assert.equal(error, null);

  const { data: rows, error: selectError } = await client
    .from("events")
    .select("store_id, user_id, visitor_id")
    .eq("event_name", "shop_created")
    .eq("store_id", store.id);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, store.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.visitor_id, null);
});

test("log_event: onboarding_completed from a signed-in vendor is attributed to their own store with no slug and no visitor_id (signed-in branch)", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Onboarding Events Test Shop",
      vendor_name: "Onboarding Events Test Vendor",
      slug: `onboarding-events-test-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { error } = await client.rpc("log_event", {
    p_event_name: "onboarding_completed",
  });
  assert.equal(error, null);

  const { data: rows, error: selectError } = await client
    .from("events")
    .select("store_id, user_id, visitor_id")
    .eq("event_name", "onboarding_completed")
    .eq("store_id", store.id);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, store.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.visitor_id, null);
});

// DATA-05: the four catalogue events a save/toggle fires, each from a fresh
// signed-in vendor session, attributed to that vendor's own store_id and
// user_id and carrying the product id they name — same shape as the
// shop_created/onboarding_completed cases above.
async function assertCatalogueEventAttributed(eventName) {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `Catalogue Events Test Shop ${eventName}`,
      vendor_name: "Catalogue Events Test Vendor",
      slug: `catalogue-events-test-${eventName}-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      store_id: store.id,
      name: `Catalogue Events Test Product ${eventName}`,
    })
    .select("id")
    .single();
  assert.equal(productError, null);

  const { error } = await client.rpc("log_event", {
    p_event_name: eventName,
    p_product_id: product.id,
  });
  assert.equal(error, null);

  const { data: rows, error: selectError } = await client
    .from("events")
    .select("store_id, user_id, visitor_id, product_id")
    .eq("event_name", eventName)
    .eq("product_id", product.id);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, store.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.visitor_id, null);
  assert.equal(row.product_id, product.id);
}

test("log_event: product_added from a signed-in vendor is attributed to their own store and carries the product id", async () => {
  await assertCatalogueEventAttributed("product_added");
});

test("log_event: product_updated from a signed-in vendor is attributed to their own store and carries the product id", async () => {
  await assertCatalogueEventAttributed("product_updated");
});

test("log_event: product_marked_available from a signed-in vendor is attributed to their own store and carries the product id", async () => {
  await assertCatalogueEventAttributed("product_marked_available");
});

test("log_event: product_marked_unavailable from a signed-in vendor is attributed to their own store and carries the product id", async () => {
  await assertCatalogueEventAttributed("product_marked_unavailable");
});

// 04-04 (DATA-06): three more cases proving the event names this phase's
// share/storefront call sites use — or will use — reach the log from the
// path that fires them, matching the same shapes already established above.

test("log_event: catalogue_shared from a signed-in vendor is attributed to their own store with no slug and no visitor_id (signed-in branch)", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Share Events Test Shop",
      vendor_name: "Share Events Test Vendor",
      slug: `share-events-test-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { error } = await client.rpc("log_event", {
    p_event_name: "catalogue_shared",
  });
  assert.equal(error, null);

  const { data: rows, error: selectError } = await client
    .from("events")
    .select("store_id, user_id, visitor_id")
    .eq("event_name", "catalogue_shared")
    .eq("store_id", store.id);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, store.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.visitor_id, null);
});

test("log_event: product_viewed is the anonymous branch — a visitor with a slug and no session is attributed by visitor_id, with a null user_id", async () => {
  const client = anonClient();
  const visitorId = crypto.randomUUID();
  // The seeded demo shop's own product (00000000-0000-4000-8000-000000000020,
  // "Tomatoes", available = true) — the same shop the file's first test
  // already reads back through, so the anonymous branch (this test) and the
  // signed-in branch (every other test in this file) sit side by side
  // against the same fixture, making the two attribution paths comparable
  // at a glance.
  const productId = "00000000-0000-4000-8000-000000000020";

  const { error } = await client.rpc("log_event", {
    p_event_name: "product_viewed",
    p_slug: "priya-stores",
    p_visitor_id: visitorId,
    p_product_id: productId,
  });
  assert.equal(error, null);

  const { apiUrl, anonKey } = getLocalEnv();
  const vendorClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await vendorClient.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "123456",
  });
  assert.equal(signInError, null);

  const { data: rows, error: selectError } = await vendorClient
    .from("events")
    .select("store_id, visitor_id, user_id, product_id")
    .eq("event_name", "product_viewed")
    .eq("visitor_id", visitorId);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(row.product_id, productId);
  assert.equal(row.visitor_id, visitorId);
  assert.equal(row.user_id, null);
});

test("log_event: offer_shared is accepted from a signed-in vendor and reaches the log — no application call site exists in this phase (D-03 defers offers to Phase 5); this case exists so Phase 5 adds only a call site, never a migration", async () => {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: "Offer Share Events Test Shop",
      vendor_name: "Offer Share Events Test Vendor",
      slug: `offer-share-events-test-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);

  const { error } = await client.rpc("log_event", {
    p_event_name: "offer_shared",
  });
  assert.equal(error, null);

  const { data: rows, error: selectError } = await client
    .from("events")
    .select("store_id, user_id, visitor_id")
    .eq("event_name", "offer_shared")
    .eq("store_id", store.id);
  assert.equal(selectError, null);
  assert.equal(rows.length, 1);

  const [row] = rows;
  assert.equal(row.store_id, store.id);
  assert.equal(row.user_id, userId);
  assert.equal(row.visitor_id, null);
});
