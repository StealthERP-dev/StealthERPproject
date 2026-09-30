// The single derivation of a vendor's identity from a typed phone number
// (plan 02-02's assumption-delta decision: `promote`). Every call site —
// signup, login, the `stores.phone` write, and each of the three AUTH-06
// lockout RPCs' `p_phone` argument — MUST go through `toCanonicalPhone`.
// Skipping it and normalising locally (e.g. a bare `replace(/\D/g, "")` at
// some other call site) reproduces the two-devices/two-formats failure this
// module exists to prevent: a vendor who types `+91 98765 43210` at setup
// and `98765 43210` at login would otherwise silently become two different
// accounts.
//
// Imports nothing — not a type, not the `@/` alias — so `node --test` can
// load this file directly, the same zero-project-import convention
// `src/lib/analytics/log-event-core.ts` and `src/lib/analytics/visitor-id.ts`
// already establish.

/** Strip every character outside 0-9. The exact client-side twin of
 * `place_order`'s SQL-side canonicalisation
 * (`supabase/migrations/20260922000300_place_order.sql:43`:
 * `regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')`). */
export function toDigits(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

/** Digits-only, with an Indian country/trunk prefix stripped ONLY when doing
 * so leaves exactly ten digits: a 12-digit value beginning `91`, a 13-digit
 * value beginning `091`, a 14-digit value beginning `0091`, and an 11-digit
 * value beginning `0` each lose that prefix. Anything else — a foreign
 * number, a malformed one, one that is already 10 digits — is returned
 * as-is, so this function never mangles a number it doesn't recognise. */
export function toCanonicalPhone(input: string): string {
  const digits = toDigits(input);

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 13 && digits.startsWith("091")) {
    return digits.slice(3);
  }
  if (digits.length === 14 && digits.startsWith("0091")) {
    return digits.slice(4);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }

  return digits;
}

/** The literal synthetic-email domain (D-02 of Phase 01, carried forward). */
export const SYNTHETIC_EMAIL_DOMAIN = "phone.local";

/** The canonical digits joined to the synthetic domain — the exact string
 * used as both the `auth.users` email and, via its local part, the value
 * `toCanonicalPhone` also produces for `stores.phone`. */
export function toSyntheticEmail(input: string): string {
  return `${toCanonicalPhone(input)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
