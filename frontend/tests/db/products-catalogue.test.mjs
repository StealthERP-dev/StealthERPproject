// HTTP (PostgREST) test: the category upsert race (PROD-05, D-12), the
// cross-store category guard (PROD-05), and an edit through the real
// owner-scoped RLS path preserving history (PROD-07) — all exercised through
// the anon-key client with a real signed-in vendor session, not against the
// SQL directly (supabase/tests/018_categories_upsert.sql already covers the
// SQL half).

import { test } from "node:test";
import assert from "node:assert/strict";
import { signUpVendor } from "./_env.mjs";

async function makeVendorWithStore(labelSuffix) {
  const { client, userId, phone } = await signUpVendor();
  const { data: store, error: storeError } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `Products Catalogue Test Shop ${labelSuffix}`,
      vendor_name: "Products Catalogue Test Vendor",
      slug: `products-catalogue-test-${labelSuffix}-${phone}`,
    })
    .select("id")
    .single();
  assert.equal(storeError, null);
  return { client, userId, phone, storeId: store.id };
}

test("categories upsert: N parallel conflict-aware writes for the same (store_id, name) all resolve to the identical row", async () => {
  const { client, storeId } = await makeVendorWithStore("race");
  const categoryName = "Vegetables";

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      client
        .from("categories")
        .upsert(
          { store_id: storeId, name: categoryName },
          { onConflict: "store_id,name" },
        )
        .select("id, name")
        .single(),
    ),
  );

  for (const { error } of results) {
    assert.equal(error, null);
  }

  const ids = results.map(({ data }) => data.id);
  const uniqueIds = new Set(ids);
  assert.equal(
    uniqueIds.size,
    1,
    "every parallel upsert call resolved to the identical row id",
  );

  const { data: rows, error: selectError } = await client
    .from("categories")
    .select("id")
    .eq("store_id", storeId)
    .eq("name", categoryName);
  assert.equal(selectError, null);
  assert.equal(
    rows.length,
    1,
    "the store holds exactly one row with that category name",
  );
});

test("products: a category from another store is rejected, and the vendor's own category succeeds", async () => {
  const { client: clientA, storeId: storeIdA } =
    await makeVendorWithStore("cross-a");
  const { client: clientB, storeId: storeIdB } =
    await makeVendorWithStore("cross-b");

  const { data: categoryB, error: categoryBError } = await clientB
    .from("categories")
    .insert({ store_id: storeIdB, name: "Store B Category" })
    .select("id")
    .single();
  assert.equal(categoryBError, null);

  const { data: categoryA, error: categoryAError } = await clientA
    .from("categories")
    .insert({ store_id: storeIdA, name: "Store A Category" })
    .select("id")
    .single();
  assert.equal(categoryAError, null);

  // Rejected: vendor A attaching vendor B's category to a product in A's own store.
  const { error: crossStoreError } = await clientA.from("products").insert({
    store_id: storeIdA,
    name: "Cross-Store Category Product",
    category_id: categoryB.id,
  });
  assert.notEqual(crossStoreError, null);

  // Succeeds: the exact same insert shape, but with vendor A's own category —
  // proves the prior rejection was the cross-store guard, not a malformed insert.
  const { data: ownCategoryProduct, error: ownCategoryError } = await clientA
    .from("products")
    .insert({
      store_id: storeIdA,
      name: "Own-Category Product",
      category_id: categoryA.id,
    })
    .select("id, category_id")
    .single();
  assert.equal(ownCategoryError, null);
  assert.equal(ownCategoryProduct.category_id, categoryA.id);
});

test("products: an edit through the owner-scoped RLS path writes exactly one product_history row carrying the pre-update values", async () => {
  const { client, storeId } = await makeVendorWithStore("history");

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      store_id: storeId,
      name: "Before Edit",
      price: 10,
      available: true,
    })
    .select("id, name, price, available")
    .single();
  assert.equal(productError, null);

  const { error: updateError } = await client
    .from("products")
    .update({ name: "After Edit", price: 20, available: false })
    .eq("id", product.id);
  assert.equal(updateError, null);

  const { data: historyRows, error: historyError } = await client
    .from("product_history")
    .select("name, price, available")
    .eq("product_id", product.id);
  assert.equal(historyError, null);
  assert.equal(
    historyRows.length,
    1,
    "exactly one history row exists after the single update",
  );

  const [historyRow] = historyRows;
  assert.equal(historyRow.name, "Before Edit");
  assert.equal(historyRow.price, 10);
  assert.equal(historyRow.available, true);
});

test("products: sequential edits accumulate history rows, each preserving the pre-edit state, proving UPDATE is not delete-then-insert", async () => {
  const { client, storeId } = await makeVendorWithStore("history-accumulation");

  // Insert a fresh product
  const { data: product, error: insertError } = await client
    .from("products")
    .insert({
      store_id: storeId,
      name: "Accumulation Test Product",
      price: 100,
      available: true,
    })
    .select("id")
    .single();
  assert.equal(insertError, null);

  // Edit 1: change name and price
  const { error: edit1Error } = await client
    .from("products")
    .update({ name: "Edit One", price: 110 })
    .eq("id", product.id);
  assert.equal(edit1Error, null);

  // Edit 2: change name, price, and availability
  const { error: edit2Error } = await client
    .from("products")
    .update({ name: "Edit Two", price: 120, available: false })
    .eq("id", product.id);
  assert.equal(edit2Error, null);

  // Edit 3: another name and price change
  const { error: edit3Error } = await client
    .from("products")
    .update({ name: "Edit Three", price: 130 })
    .eq("id", product.id);
  assert.equal(edit3Error, null);

  // Assert: history rows accumulate (not overwritten, not deleted)
  const { data: allHistoryRows, error: historyError } = await client
    .from("product_history")
    .select("name, price, available, recorded_at")
    .eq("product_id", product.id)
    .order("recorded_at", { ascending: true });
  assert.equal(historyError, null);

  assert.equal(
    allHistoryRows.length,
    3,
    "exactly 3 history rows exist after 3 sequential updates (accumulation, not replace)",
  );

  // Assert: history rows preserve the correct pre-edit snapshots
  // History row 1 should have the ORIGINAL values from before Edit 1
  assert.equal(
    allHistoryRows[0].name,
    "Accumulation Test Product",
    "history row 1 preserves the original product name",
  );
  assert.equal(
    allHistoryRows[0].price,
    100,
    "history row 1 preserves the original price",
  );
  assert.equal(
    allHistoryRows[0].available,
    true,
    "history row 1 preserves the original availability",
  );

  // History row 2 should have the state from AFTER Edit 1 (before Edit 2)
  assert.equal(
    allHistoryRows[1].name,
    "Edit One",
    "history row 2 preserves the name from after Edit 1",
  );
  assert.equal(
    allHistoryRows[1].price,
    110,
    "history row 2 preserves the price from after Edit 1",
  );
  assert.equal(
    allHistoryRows[1].available,
    true,
    "history row 2 preserves the availability from after Edit 1",
  );

  // History row 3 should have the state from AFTER Edit 2 (before Edit 3)
  assert.equal(
    allHistoryRows[2].name,
    "Edit Two",
    "history row 3 preserves the name from after Edit 2",
  );
  assert.equal(
    allHistoryRows[2].price,
    120,
    "history row 3 preserves the price from after Edit 2",
  );
  assert.equal(
    allHistoryRows[2].available,
    false,
    "history row 3 preserves the availability from after Edit 2",
  );
});
