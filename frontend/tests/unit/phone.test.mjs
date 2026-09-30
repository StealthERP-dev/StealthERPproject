// Unit test (no database, no browser): proves the canonical-phone identity
// invariant this plan's assumption-delta decision commits to — every typed
// spelling of one number maps to the identical canonical string and the
// identical synthetic email, so Setup and Login can never silently diverge
// into two accounts for the same vendor.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toDigits,
  toCanonicalPhone,
  toSyntheticEmail,
  SYNTHETIC_EMAIL_DOMAIN,
} from "../../src/features/auth/lib/phone.ts";

const CANONICAL = "9876543210";

const SPELLINGS = [
  "9876543210",
  "98765 43210",
  "98765-43210",
  "+91 98765 43210",
  "+919876543210",
  "091-9876543210",
  "0091 98765 43210",
  "09876543210",
  "91 98765 43210",
  "(98765) 43210",
];

test("toCanonicalPhone: every spelling of one number maps to the identical canonical string", () => {
  for (const spelling of SPELLINGS) {
    assert.equal(
      toCanonicalPhone(spelling),
      CANONICAL,
      `expected ${JSON.stringify(spelling)} to canonicalise to ${CANONICAL}`,
    );
  }
});

test("toSyntheticEmail: every spelling of one number maps to the identical synthetic email", () => {
  for (const spelling of SPELLINGS) {
    assert.equal(
      toSyntheticEmail(spelling),
      `${CANONICAL}@${SYNTHETIC_EMAIL_DOMAIN}`,
      `expected ${JSON.stringify(spelling)} to produce the canonical email`,
    );
  }
});

test("toCanonicalPhone: idempotent — feeding its own output back returns the same value", () => {
  const once = toCanonicalPhone("+91 98765 43210");
  const twice = toCanonicalPhone(once);
  assert.equal(once, CANONICAL);
  assert.equal(twice, CANONICAL);
});

test("toCanonicalPhone: a 12-digit number NOT beginning with the Indian country code is returned unchanged", () => {
  const foreign = "441234567890"; // 12 digits, does not start with 91
  assert.equal(toCanonicalPhone(foreign), foreign);
});

test("toCanonicalPhone: an 8-digit number is returned unchanged (too short to be a mangled Indian number)", () => {
  const short = "12345678";
  assert.equal(toCanonicalPhone(short), short);
});

test("toCanonicalPhone/toDigits: empty, whitespace-only and punctuation-only inputs canonicalise to the empty string", () => {
  for (const empty of ["", "   ", "----", "()  -- ()"]) {
    assert.equal(toDigits(empty), "");
    assert.equal(toCanonicalPhone(empty), "");
  }
});

test("toSyntheticEmail: an empty canonical phone still produces a valid (empty-local-part) address on the bare domain", () => {
  assert.equal(toSyntheticEmail(""), `@${SYNTHETIC_EMAIL_DOMAIN}`);
  assert.equal(toSyntheticEmail("   "), `@${SYNTHETIC_EMAIL_DOMAIN}`);
});

test("toDigits: strips every non-digit character, keeping digit order", () => {
  assert.equal(toDigits("+91 (98765) 43-210"), "919876543210");
});
