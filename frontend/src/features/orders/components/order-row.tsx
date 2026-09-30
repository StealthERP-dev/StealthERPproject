// One order's row (ORDR-01, ORDR-05, D-01). Owns the confirm mutation
// directly (use-confirm-order.ts) so a failed confirm's message stays local
// to the row that failed, never a page banner — offer-row.tsx's own
// accessible-name and row-local-alert discipline, adapted for a row that is
// not itself a tap target. Owns only ONE mutation directly; Cancel opens
// cancel-reason-sheet.tsx instead of acting immediately — that sheet owns
// the cancel mutation itself, per its own header.
//
// The action pair is gated on `order.status === "new"` ALONE — the
// LIFECYCLE column — independent of which section (New/Earlier) the row is
// in, per divergence 2: an Earlier-section order the vendor has read but not
// yet decided still shows Confirm/Cancel. Neither action ever removes a row
// from the list array — both re-render this row's own status label in place
// — so Phase 5's pending-removal filter helper has nothing to do here and is
// deliberately not imported.
//
// The three cancel-label tiers (UI-SPEC Revision 1/1a): this row's own
// button is the FIRST tier, "Cancel order" — it only opens the sheet, never
// the sheet's own accessible name/heading or its destructive submit, which
// live in cancel-reason-sheet.tsx alone. The row's own Cancel button stays
// neutral (`border border-border bg-card`) — the destructive fill belongs
// only to the sheet's own submit, the point of no return.
//
// The cancelled status label resolves the stored preset code through the
// shared rejection-reasons.ts module's own resolver, never the raw code —
// see that module's header for why a second, inline list here would be a
// drift risk against the database constraint.
//
// Per-row `aria-label` (offer-row.tsx's own discipline, adapted for a
// non-interactive row via `role="group"`): a screen-reader user scanning
// several rows must be able to tell them apart by accessible name alone. The
// Confirm and Cancel buttons each carry their own per-order accessible name
// for the same reason.
//
// The displayed time is a UI-contract gap, resolved here rather than left
// unresolved (06-CONTEXT.md's own flagged assumption): a time-of-day for an
// order on today's IST date, a short day-and-month otherwise, deriving
// "today" from the shipped IST module (isSameIstDay) rather than
// introducing a third notion of today.

import { Check, X } from "lucide-react";
import { isSameIstDay } from "@/lib/date/ist";
import { useConfirmOrder } from "@/features/orders/hooks/use-confirm-order";
import { rejectionReasonLabel } from "@/features/orders/lib/rejection-reasons";
import type { Order } from "@/features/orders/hooks/use-orders";

const GENERIC_ERROR = "Something went wrong. Try again.";

const TIME_OF_DAY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DAY_AND_MONTH = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

function formatOrderTime(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  return isSameIstDay(created, now)
    ? TIME_OF_DAY.format(created)
    : DAY_AND_MONTH.format(created);
}

export function OrderRow({
  order,
  onOpenCancel,
}: {
  order: Order;
  /** Opens the cancel-reason sheet for this order. Lives above this row
   * (orders-view.tsx) so the row stays presentational and only one sheet is
   * ever mounted, regardless of how many rows this screen renders. */
  onOpenCancel: (order: Order) => void;
}) {
  const confirmOrder = useConfirmOrder(order.store_id);
  const itemsLine = order.order_items
    .map((item) => `${item.product_name} ×${String(item.qty)}`)
    .join(" · ");
  const time = formatOrderTime(order.created_at, new Date());
  const accessibleName = `${order.customer_name}${order.is_new ? ", new" : ""} — ${itemsLine}, ${time}`;

  function handleConfirm() {
    confirmOrder.mutate(order.id);
  }

  return (
    <div
      role="group"
      aria-label={accessibleName}
      className={`rounded-2xl border bg-card p-4 ${
        order.is_new ? "border-[#FDE68A]" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {order.customer_name}
            </span>
            {order.is_new && (
              <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#D97706]">
                New
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{itemsLine}</p>
        </div>
        <span className="flex-shrink-0 text-xs text-muted-foreground">
          {time}
        </span>
      </div>

      {order.status === "new" && (
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmOrder.isPending}
            aria-label={`Confirm ${order.customer_name}'s order`}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Confirm
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenCancel(order);
            }}
            disabled={confirmOrder.isPending}
            aria-label={`Cancel ${order.customer_name}'s order`}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
            Cancel order
          </button>
        </div>
      )}
      {order.status === "confirmed" && (
        <p className="mt-3 text-xs font-semibold text-[#16A34A]">Confirmed</p>
      )}
      {order.status === "cancelled" && (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          Cancelled · {rejectionReasonLabel(order.rejection_reason)}
        </p>
      )}

      {confirmOrder.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {GENERIC_ERROR}
        </p>
      )}
    </div>
  );
}
