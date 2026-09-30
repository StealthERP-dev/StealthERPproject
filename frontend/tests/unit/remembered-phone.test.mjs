// Unit test (no database, no browser): proves getRememberedPhone/
// setRememberedPhone's round trip, empty-string default, never-throws
// private-browsing fallback (D-07), and the writer's one-argument arity —
// the mechanical form of "there is no shape in which a PIN could be passed
// to it" (T-02-27).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getRememberedPhone,
  setRememberedPhone,
} from "../../src/features/auth/lib/remembered-phone.ts";

function fakeStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    // exposed for assertions only, not part of RememberedPhoneStorage
    _data: data,
  };
}

test("setRememberedPhone/getRememberedPhone: a phone written to a fake store round-trips back out", () => {
  const storage = fakeStorage();

  setRememberedPhone("9876543210", storage);
  const result = getRememberedPhone(storage);

  assert.equal(result, "9876543210");
});

test("getRememberedPhone: an empty fake store returns an empty string", () => {
  const storage = fakeStorage();

  const result = getRememberedPhone(storage);

  assert.equal(result, "");
});

test("getRememberedPhone/setRememberedPhone: a fake whose getItem/setItem both throw on every call never throws, and the reader still returns an empty string", () => {
  const storage = {
    getItem() {
      throw new Error("QuotaExceededError: private browsing");
    },
    setItem() {
      throw new Error("QuotaExceededError: private browsing");
    },
  };

  assert.doesNotThrow(() => {
    setRememberedPhone("9876543210", storage);
  });
  let result;
  assert.doesNotThrow(() => {
    result = getRememberedPhone(storage);
  });
  assert.equal(result, "");
});

test("setRememberedPhone: with no storage available at all (undefined resolution), never throws", () => {
  const storage = undefined;

  assert.doesNotThrow(() => {
    setRememberedPhone("9876543210", storage);
  });
});

test("setRememberedPhone: arity is one — the writer accepts exactly one required argument, so no call shape can carry a second value such as a PIN", () => {
  assert.equal(setRememberedPhone.length, 1);
});
