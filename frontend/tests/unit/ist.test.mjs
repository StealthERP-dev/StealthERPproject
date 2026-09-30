// Unit test (no database, no browser): proves istDay/isSameIstDay compute the
// India-offset calendar day correctly at the boundaries D-09's "Updated
// today" claim depends on. The single most valuable assertion here is the
// UTC-evening case: an instant late in the UTC evening already belongs to
// the NEXT India day — exactly the case a naive UTC-date comparison gets
// wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { istDay, isSameIstDay, istDateString } from "../../src/lib/date/ist.ts";

test("isSameIstDay: an instant late in the UTC evening already belongs to the next India day (the naive-UTC-comparison failure case)", () => {
  // 2026-09-23T20:00:00Z is still 23 Sept in UTC, but IST is UTC+5:30, so the
  // India clock already reads 2026-09-24T01:30 — the next calendar day.
  const utcEvening = new Date("2026-09-23T20:00:00.000Z");
  const nextIstMorning = new Date("2026-09-24T01:30:00.000Z");
  assert.equal(
    isSameIstDay(utcEvening, nextIstMorning),
    true,
    "an instant 5h30m later in UTC, but still the same India calendar day, should compare equal",
  );

  const stillSameUtcDayLater = new Date("2026-09-23T23:59:00.000Z");
  assert.equal(
    isSameIstDay(utcEvening, stillSameUtcDayLater),
    true,
    "20:00 UTC and 23:59 UTC on the same UTC date are both already 24 Sept in India",
  );

  const priorUtcDay = new Date("2026-09-23T10:00:00.000Z"); // 15:30 IST, 23 Sept
  assert.equal(
    isSameIstDay(utcEvening, priorUtcDay),
    false,
    "20:00 UTC (next India day) and 10:00 UTC (still that India day's earlier hours) on the same UTC date fall on different India days",
  );
});

test("istDay: an instant just before India midnight and one just after fall on different India days", () => {
  // India midnight (2026-09-24 00:00:00 IST) is 2026-09-23T18:30:00Z.
  const justBeforeIstMidnight = new Date("2026-09-23T18:29:59.999Z");
  const justAfterIstMidnight = new Date("2026-09-23T18:30:00.000Z");
  assert.notEqual(
    istDay(justBeforeIstMidnight),
    istDay(justAfterIstMidnight),
    "one millisecond on either side of India midnight must land on different calendar days",
  );
});

test("isSameIstDay: two instants hours apart within the same India day are the same day", () => {
  const morning = new Date("2026-09-24T04:00:00.000Z"); // 09:30 IST
  const evening = new Date("2026-09-24T15:00:00.000Z"); // 20:30 IST
  assert.equal(isSameIstDay(morning, evening), true);
});

test("istDay: a known instant maps to exactly the expected India calendar day number", () => {
  // 2026-09-24T00:00:00Z + 5h30m = 2026-09-24T05:30 IST, still 24 Sept.
  const known = new Date("2026-09-24T00:00:00.000Z");
  const expectedDay = Math.floor(
    (known.getTime() + 330 * 60 * 1000) / (24 * 60 * 60 * 1000),
  );
  assert.equal(istDay(known), expectedDay);
});

test("isSameIstDay: an instant compared with itself is always the same day", () => {
  const now = new Date();
  assert.equal(isSameIstDay(now, now), true);
});

// istDateString (D-13): the vendor-read date filter's own value — a
// Postgres-comparable 'YYYY-MM-DD' string, not a day number. RLS's
// owner-scoped offers policy carries no date bound of its own (unlike the
// anon policy), so the application supplies one; this is the same
// IST_OFFSET_MS arithmetic istDay already proves correct, rendered as the
// string a `date` column compares against over the wire.

test("istDateString: one millisecond before India midnight and one millisecond after must not produce the same string", () => {
  // India midnight (2026-09-24 00:00:00 IST) is 2026-09-23T18:30:00Z.
  const justBeforeIstMidnight = new Date("2026-09-23T18:29:59.999Z");
  const justAfterIstMidnight = new Date("2026-09-23T18:30:00.000Z");

  assert.equal(
    istDateString(justBeforeIstMidnight),
    "2026-09-23",
    "one millisecond before India midnight is still 23 Sept in India",
  );
  assert.equal(
    istDateString(justAfterIstMidnight),
    "2026-09-24",
    "exactly at India midnight the India calendar date has already rolled to 24 Sept",
  );
  assert.notEqual(
    istDateString(justBeforeIstMidnight),
    istDateString(justAfterIstMidnight),
    "two instants one millisecond apart, straddling India midnight, must not produce the same date string — this is what fails if the offset is dropped or its sign is flipped",
  );
});

test("istDateString: an instant late in the UTC evening already belongs to the following UTC date once shifted into India time (the naive-UTC-date-slice failure case)", () => {
  // 2026-09-23T20:00:00Z is still 23 Sept in UTC, but IST is UTC+5:30, so the
  // India clock already reads 2026-09-24T01:30 — a naive `toISOString().slice(0, 10)`
  // on the UN-shifted instant would wrongly report "2026-09-23".
  const utcEvening = new Date("2026-09-23T20:00:00.000Z");
  assert.equal(
    istDateString(utcEvening),
    "2026-09-24",
    "an instant already past India midnight reports the following UTC date, not the instant's own UTC date",
  );
});

test("istDateString: the returned string is exactly ten characters in Postgres date format (YYYY-MM-DD)", () => {
  const value = istDateString(new Date("2026-09-24T04:00:00.000Z"));
  assert.equal(value.length, 10, "must be exactly 10 characters");
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}$/,
    "must be three hyphen-separated groups of 4-2-2 digits, comparable to a Postgres date rendered over the wire",
  );
});

test("istDateString: agrees with istDay — same day number produces the same string, different day numbers produce different strings", () => {
  const morning = new Date("2026-09-24T04:00:00.000Z"); // 09:30 IST
  const evening = new Date("2026-09-24T15:00:00.000Z"); // 20:30 IST
  assert.equal(istDay(morning), istDay(evening));
  assert.equal(
    istDateString(morning),
    istDateString(evening),
    "two instants sharing istDay's day number must produce the same date string",
  );

  const justBeforeIstMidnight = new Date("2026-09-23T18:29:59.999Z");
  const justAfterIstMidnight = new Date("2026-09-23T18:30:00.000Z");
  assert.notEqual(istDay(justBeforeIstMidnight), istDay(justAfterIstMidnight));
  assert.notEqual(
    istDateString(justBeforeIstMidnight),
    istDateString(justAfterIstMidnight),
    "two instants with different istDay day numbers must produce different date strings",
  );
});
