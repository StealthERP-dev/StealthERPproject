// Zero-import money parsing and display (D-06). Imports nothing at all —
// not a type, not the `@/` alias — so `node --test` can load this file
// directly, the same zero-import convention `phone.ts` and
// `log-event-core.ts` already establish.
//
// The price field runs every keystroke through `sanitizePriceInput`, so an
// unparseable value can never be typed in the first place and therefore can
// never be silently dropped at save time — the Save-enabled condition stays
// name-only (PROD-03) while nothing the vendor typed is lost.

/** Reduce raw typed text to what the price field is allowed to hold: digits
 * and at most one decimal separator, with at most two fractional digits
 * kept. A second '.' is dropped rather than accepted; a third or later
 * fractional digit is truncated rather than rounded into a different
 * amount. */
export function sanitizePriceInput(raw: string): string {
  let sawSeparator = false;
  let wholeDigits = "";
  let fractionDigits = "";

  for (const char of raw) {
    if (char >= "0" && char <= "9") {
      if (sawSeparator) {
        if (fractionDigits.length < 2) {
          fractionDigits += char;
        }
      } else {
        wholeDigits += char;
      }
      continue;
    }
    if (char === "." && !sawSeparator) {
      sawSeparator = true;
    }
  }

  // Collapse leading zeros the way the stored number already implies:
  // "005" -> "5", "00" -> "0". Only strips a zero when another digit
  // follows it, so a lone "0" (mid-typing "0.5") is left intact.
  wholeDigits = wholeDigits.replace(/^0+(?=\d)/, "");

  return sawSeparator ? `${wholeDigits}.${fractionDigits}` : wholeDigits;
}

/** The stored numeric value's display string — whole units when the value
 * has no fractional part, two decimals otherwise. Returns "" for an absent
 * value: D-06 is explicit that no placeholder line is manufactured for an
 * unset optional field, so there is nothing renderable to return. */
export function formatPriceDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** The sanitised field text converted to the numeric value the row stores.
 * Empty text maps to no value (null) — distinct from zero, which is a real
 * value a shop giving something away can genuinely mean. */
export function parsePriceInput(text: string): number | null {
  if (text.trim() === "") {
    return null;
  }
  const value = Number(text);
  return Number.isNaN(value) ? null : value;
}
