// The ONE preset vocabulary for cancelling an order (D-01). Three consumers
// read this module — cancel-reason-sheet.tsx (the selectable preset rows),
// order-row.tsx (the cancelled status label's resolver), and this plan's own
// smoke gate — and a database CHECK constraint
// (supabase/migrations/20260927000100_order_rejection_reason.sql) mirrors
// its four codes exactly. A list declared inside any one consumer becomes a
// second source of truth that can drift from the constraint without
// anything failing; this module is the one place that can't happen, and a
// gate compares this list against the live constraint definition rather
// than trusting the two were typed identically.
//
// The codes below are 06-01's own landed constraint values (read from its
// SUMMARY, not assumed): out_of_stock, customer_unreachable, mistake, other.
// `out_of_stock` is the KPI-bearing value — the client PRD §5 Catalog
// Accuracy Score's own filter (`orders_cancelled_stock_discrepancy`).

export interface RejectionReason {
  code: string;
  label: string;
}

export const REJECTION_REASONS: RejectionReason[] = [
  { code: "out_of_stock", label: "Out of stock" },
  { code: "customer_unreachable", label: "Customer unreachable" },
  { code: "mistake", label: "Order placed by mistake" },
  { code: "other", label: "Other" },
];

const GENERIC_CANCELLED_LABEL = "Cancelled";

/** Resolves a stored preset code to its human label, for the row's own
 * "Cancelled · {label}" status. Falls back to the generic cancelled word —
 * never the raw stored code, never an empty string — if a code ever fails
 * to resolve; that is only possible if the vocabulary changed without a
 * data migration, and a shopkeeper's screen must never leak an
 * implementation string in that case. */
export function rejectionReasonLabel(code: string | null): string {
  const found = REJECTION_REASONS.find((reason) => reason.code === code);
  return found ? found.label : GENERIC_CANCELLED_LABEL;
}
