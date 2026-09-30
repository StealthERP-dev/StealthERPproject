// Unit test (no database, no browser): pins greetingFor's three time-of-day
// bands at both of their exact boundaries (HOME-01).

import { test } from "node:test";
import assert from "node:assert/strict";
import { greetingFor } from "../../src/features/home/lib/greeting.ts";

test("greetingFor: hours 0 and 11 give the morning greeting", () => {
  assert.equal(greetingFor(0), "Good morning");
  assert.equal(greetingFor(11), "Good morning");
});

test("greetingFor: hours 12 and 16 give the afternoon greeting", () => {
  assert.equal(greetingFor(12), "Good afternoon");
  assert.equal(greetingFor(16), "Good afternoon");
});

test("greetingFor: hours 17 and 23 give the evening greeting", () => {
  assert.equal(greetingFor(17), "Good evening");
  assert.equal(greetingFor(23), "Good evening");
});

test("greetingFor: the 11/12 boundary switches from morning to afternoon", () => {
  assert.equal(greetingFor(11), "Good morning");
  assert.equal(greetingFor(12), "Good afternoon");
});

test("greetingFor: the 16/17 boundary switches from afternoon to evening", () => {
  assert.equal(greetingFor(16), "Good afternoon");
  assert.equal(greetingFor(17), "Good evening");
});

test("greetingFor: the three greeting strings are distinct from one another", () => {
  const strings = new Set([greetingFor(0), greetingFor(12), greetingFor(17)]);
  assert.equal(strings.size, 3);
});
