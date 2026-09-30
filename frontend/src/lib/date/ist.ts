// The client-side counterpart of the database's own India-offset "today"
// expression (public.today_ist(), supabase/migrations/20260922000100_schema.sql
// lines 20-27) — the two must agree on which calendar day an instant belongs
// to, and Phase 5 (offers expiring at midnight IST) already depends on there
// being exactly one definition of this reused across client and database.
// Imports nothing at all, so `node --test` loads it directly — the same
// zero-import convention src/features/home/lib/greeting.ts already
// establishes — and takes the instant as a parameter rather than reading the
// clock, so its boundaries are testable without freezing time.
//
// India Standard Time is a fixed UTC+5:30 offset with no daylight saving, so
// the calendar day for any instant is exact integer arithmetic on the
// instant's epoch milliseconds. No timezone database and no locale-formatted
// date string (whose result depends on the runtime's own data) is needed or
// used.

const IST_OFFSET_MINUTES = 330; // 5 hours 30 minutes ahead of UTC, fixed.
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A comparable India-offset calendar day: the number of whole days since the
 * Unix epoch, computed on the IST-shifted instant. Two instants share this
 * value exactly when they fall on the same India calendar day.
 */
export function istDay(instant: Date): number {
  return Math.floor((instant.getTime() + IST_OFFSET_MS) / MS_PER_DAY);
}

/** True when both instants fall on the same India-offset calendar day. */
export function isSameIstDay(a: Date, b: Date): boolean {
  return istDay(a) === istDay(b);
}

/**
 * The India-offset calendar date as a Postgres-comparable `'YYYY-MM-DD'`
 * string — a second output format of the SAME computation `istDay` already
 * proves correct, not a third "today" (D-08). Needed because, unlike the
 * anonymous/customer read path (whose RLS policy already carries
 * `offer_date = today_ist()`), the owner-scoped "offers: owner manages"
 * policy has NO date bound of its own — so every vendor-facing offers read
 * must supply this string as an explicit `.eq("offer_date", ...)` filter
 * itself (D-13). Shifts the instant by the same IST_OFFSET_MS this file
 * already declares, then takes the date portion of the ISO rendering.
 */
export function istDateString(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
