// Unit test (no database, no browser): proves getVisitorId's persistence and
// its never-throws private-browsing fallback (D-03, D-05).

import { test } from "node:test";
import assert from "node:assert/strict";
import { getVisitorId } from "../../src/lib/analytics/visitor-id.ts";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    // exposed for assertions only, not part of VisitorIdStorage
    _data: data,
  };
}

test("getVisitorId: first call against an empty fake storage generates a UUID-shaped value and writes it", () => {
  const storage = fakeStorage();

  const id = getVisitorId(storage);

  assert.match(id, UUID_SHAPE);
  assert.equal(storage._data.get("visitor_id"), id);
});

test("getVisitorId: a second call against the same fake returns the identical value without writing again", () => {
  const storage = fakeStorage();

  const first = getVisitorId(storage);
  // Overwrite the underlying store directly to prove the second call reads
  // rather than regenerates — if getVisitorId wrote again it would not see
  // this tampering.
  const spySetItem = storage.setItem;
  let setItemCalls = 0;
  storage.setItem = (...args) => {
    setItemCalls++;
    return spySetItem.apply(storage, args);
  };

  const second = getVisitorId(storage);

  assert.equal(second, first);
  assert.equal(setItemCalls, 0);
});

test("getVisitorId: a fake whose setItem throws still returns a UUID-shaped value, does not throw, and returns the same value on a second call", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("QuotaExceededError: private browsing");
    },
  };

  const first = getVisitorId(storage);
  assert.match(first, UUID_SHAPE);

  const second = getVisitorId(storage);
  assert.equal(second, first);
});
