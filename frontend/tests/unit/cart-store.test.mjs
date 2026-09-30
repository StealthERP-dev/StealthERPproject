import { test } from "node:test";
import assert from "node:assert/strict";
import { readCart, writeCart, subscribeToCart, addOrIncrementItem, incrementItemQty, decrementItemQty, removeCartItem, cartStorageKey } from "../../src/features/storefront/lib/cart-store.ts";
let slugCounter = 0; const freshSlug = () => `test-shop-${++slugCounter}`;
const TOMATOES = { productId: "p-tomatoes", name: "Tomatoes", unit: "kg", hadOffer: true };
const BANANAS = { productId: "p-bananas", name: "Bananas", unit: "dozen", hadOffer: false };
function fakeStorage() { const data = new Map(); return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), _data: data }; }
test("kg uses 0.5 steps", () => { const slug = freshSlug(); const storage = fakeStorage(); let items = addOrIncrementItem(readCart(slug, storage), TOMATOES); assert.equal(items[0].qty, 0.5); items = incrementItemQty(items, "p-tomatoes"); assert.equal(items[0].qty, 1); items = incrementItemQty(items, "p-tomatoes"); assert.equal(items[0].qty, 1.5); items = decrementItemQty(items, "p-tomatoes"); assert.equal(items[0].qty, 1); });
test("piece-like units use whole numbers", () => { let items = addOrIncrementItem([], BANANAS); assert.equal(items[0].qty, 1); items = incrementItemQty(items, "p-bananas"); assert.equal(items[0].qty, 2); });
test("quantity is capped at 99", () => { let items = [{ ...TOMATOES, qty: 98.5 }]; items = incrementItemQty(items, "p-tomatoes"); assert.equal(items[0].qty, 99); items = incrementItemQty(items, "p-tomatoes"); assert.equal(items[0].qty, 99); });
test("remove at the minimum", () => { let items = [{ ...TOMATOES, qty: 0.5 }]; items = decrementItemQty(items, "p-tomatoes"); assert.deepEqual(items, []); });
test("storage and subscriber isolation remain intact", () => { const a = freshSlug(); const b = freshSlug(); const storage = fakeStorage(); let calls = 0; const off = subscribeToCart(a, () => calls++); writeCart(b, addOrIncrementItem([], TOMATOES), storage); assert.equal(calls, 0); writeCart(a, addOrIncrementItem([], TOMATOES), storage); assert.equal(calls, 1); off(); assert.equal(readCart(a, storage).length, 1); assert.notEqual(cartStorageKey(a), cartStorageKey(b)); });
test("removeCartItem removes only requested product", () => { const items = addOrIncrementItem(addOrIncrementItem([], TOMATOES), BANANAS); assert.deepEqual(removeCartItem(items, TOMATOES.productId).map(item => item.productId), [BANANAS.productId]); });
