// Unit test (no database, no browser): proves slugify's encoding rules and
// length boundary, and withSuffix's shape — pure functions, no Supabase
// import, matching visitor-id.test.mjs's fully-isolated style.

import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, withSuffix } from "../../src/features/auth/lib/slug.ts";

test("slugify: the ordinary case — a two-word shop name becomes a lowercase hyphenated slug", () => {
  assert.equal(slugify("Priya Stores"), "priya-stores");
});

test("slugify: uppercase is lowered", () => {
  assert.equal(slugify("PRIYA STORES"), "priya-stores");
});

test("slugify: runs of spaces, punctuation and symbols collapse to a single hyphen", () => {
  assert.equal(slugify("Priya's   Fresh & Fruits!!!"), "priya-s-fresh-fruits");
});

test("slugify: leading and trailing separators are stripped", () => {
  assert.equal(slugify("  --Priya Stores--  "), "priya-stores");
});

test("slugify: a name of only punctuation produces the literal fallback base", () => {
  assert.equal(slugify("!!! --- ???"), "shop");
});

test("slugify: a name written entirely in a non-Latin script produces the literal fallback base", () => {
  assert.equal(slugify("പ്രിയ സ്റ്റോഴ്‌സ്"), "shop");
});

test("slugify: the empty string produces the literal fallback base", () => {
  assert.equal(slugify(""), "shop");
});

test("slugify: a name producing exactly 60 slug characters is unchanged", () => {
  const name = "a".repeat(60);
  const result = slugify(name);
  assert.equal(result.length, 60);
  assert.equal(result, "a".repeat(60));
});

test("slugify: a name producing 61 slug characters is cut to 60 and does not end in a hyphen", () => {
  const name = "a".repeat(61);
  const result = slugify(name);
  assert.equal(result.length, 60);
  assert.equal(result, "a".repeat(60));
  assert.ok(!result.endsWith("-"), "truncated result must not end in a hyphen");
});

test("slugify: truncation that lands mid-hyphen-run strips the trailing hyphen left behind, going below 60 characters", () => {
  // 59 'a's followed by a run of punctuation that becomes hyphens at the
  // truncation boundary — position 60 lands inside that hyphen run.
  const name = "a".repeat(59) + "!!!!!!" + "b".repeat(10);
  const result = slugify(name);
  assert.ok(!result.endsWith("-"), "must not end in a hyphen after truncation");
  assert.ok(result.length <= 60);
});

test("withSuffix: produces a value that starts with the base and is exactly five characters longer", () => {
  const base = "priya-stores";
  const suffixed = withSuffix(base);
  assert.ok(suffixed.startsWith(base));
  assert.equal(suffixed.length, base.length + 5);
});

test("withSuffix: differs across two calls for the same base", () => {
  const base = "priya-stores";
  const first = withSuffix(base);
  const second = withSuffix(base);
  assert.notEqual(first, second);
});
