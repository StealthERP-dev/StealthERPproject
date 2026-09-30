// Unit test (no database, no browser): proves the money-parsing edges D-06
// depends on — an unparseable value can never be typed in the first place,
// truncation never silently rounds into a different amount, and an absent
// price is a genuinely different fact from a price of zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePriceInput,
  formatPriceDisplay,
  parsePriceInput,
} from "../../src/features/products/lib/format-price.ts";

test("sanitizePriceInput: text with letters and symbols mixed in reduces to digits and one separator", () => {
  assert.equal(sanitizePriceInput("abc12.5xyz"), "12.5");
  assert.equal(sanitizePriceInput("₹42.99!!"), "42.99");
  assert.equal(sanitizePriceInput("  100  "), "100");
});

test("sanitizePriceInput: a second decimal separator is dropped rather than accepted", () => {
  assert.equal(sanitizePriceInput("1.2.3"), "1.23");
  assert.equal(sanitizePriceInput("12..5"), "12.5");
  assert.equal(sanitizePriceInput("1...."), "1.");
});

test("sanitizePriceInput: more than two fractional digits are truncated rather than rounded into a different amount", () => {
  assert.equal(sanitizePriceInput("12.345"), "12.34");
  assert.equal(sanitizePriceInput("0.999"), "0.99");
  // Truncation, not rounding: 12.999 would round to 13.00, but must stay 12.99.
  assert.equal(sanitizePriceInput("12.999"), "12.99");
});

test("sanitizePriceInput: a whole number typed with no separator is returned unchanged", () => {
  assert.equal(sanitizePriceInput("42"), "42");
  assert.equal(sanitizePriceInput(""), "");
});

test("sanitizePriceInput: leading zeros collapse instead of accumulating on screen", () => {
  assert.equal(sanitizePriceInput("005"), "5");
  assert.equal(sanitizePriceInput("00000"), "0");
  // A single leading zero mid-typing a fractional value stays intact.
  assert.equal(sanitizePriceInput("0.5"), "0.5");
  assert.equal(sanitizePriceInput("0"), "0");
});

test("formatPriceDisplay: a whole value renders without decimals", () => {
  assert.equal(formatPriceDisplay(42), "42");
  assert.equal(formatPriceDisplay(0), "0");
});

test("formatPriceDisplay: a value with fractional digits renders with exactly two decimals", () => {
  assert.equal(formatPriceDisplay(12.5), "12.50");
  assert.equal(formatPriceDisplay(12.34), "12.34");
});

test("formatPriceDisplay: an absent value (null or undefined) renders nothing", () => {
  assert.equal(formatPriceDisplay(null), "");
  assert.equal(formatPriceDisplay(undefined), "");
});

test("parsePriceInput: empty text converts to no value", () => {
  assert.equal(parsePriceInput(""), null);
  assert.equal(parsePriceInput("   "), null);
});

test("parsePriceInput: a value at zero is a real value, distinct from an absent one", () => {
  const zero = parsePriceInput("0");
  assert.equal(zero, 0);
  assert.notEqual(zero, null);
  assert.equal(parsePriceInput(""), null);
});

test("parsePriceInput: a sanitised fractional value round-trips to the exact number typed", () => {
  assert.equal(parsePriceInput("42.5"), 42.5);
  assert.equal(parsePriceInput("12.34"), 12.34);
  assert.equal(parsePriceInput("100"), 100);
});
