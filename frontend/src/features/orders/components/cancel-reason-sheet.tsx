"use client";

// D-01's cancel-reason sheet (net-new — no prototype counterpart,
// UI-SPEC divergence 1). Composes the shipped BottomSheet shell — its
// role="dialog" aria-modal="true" aria-label={label} contract, the scrim,
// the handle and its own close control all come from the shell and are not
// re-derived here, matching product-picker-sheet.tsx's own division of
// labour.
//
// The three cancel-label tiers (UI-SPEC Revision 1/1a) are deliberately
// three distinct strings, never one string reused across surfaces: this
// sheet's own accessible name AND heading are the SECOND tier, "Cancel this
// order" — never the row's own "Cancel order" (which only opens this sheet)
// and never this sheet's own destructive submit label below (the point of
// no return). Identical strings across a control and the dialog it opens is
// the ambiguous-assertion trap this project has hit five times — a smoke
// test could not otherwise tell "the row button exists" from "the sheet is
// open" from "the cancellation went through".
//
// The required single-select preset list gating the destructive submit IS
// D-01's confirmation step — no second are-you-sure layer sits on top of
// it. This sheet owns the cancel mutation directly (use-cancel-order.ts),
// so a failure keeps the sheet open with its own inline message here — a
// dismissed sheet would have nowhere to show it, and the row underneath
// owns no state about this mutation at all (the carried-forward "the
// component that owns the mutation is where its error renders" rule).
//
// `bg-destructive` on the submit is this app's FIRST use of the destructive
// colour as a button FILL (UI-SPEC Color table) — it appears on exactly
// this one control. The row's own Cancel button, which only opens this
// sheet, stays neutral.

import { useState } from "react";
import { Check } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { REJECTION_REASONS } from "@/features/orders/lib/rejection-reasons";
import { useCancelOrder } from "@/features/orders/hooks/use-cancel-order";

const GENERIC_ERROR = "Something went wrong. Try again.";

export function CancelReasonSheet({
  orderId,
  storeId,
  onClose,
}: {
  orderId: string;
  storeId: string;
  onClose: () => void;
}) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const cancelOrder = useCancelOrder(storeId);

  function handleSubmit() {
    if (!selectedReason) return;
    cancelOrder.mutate(
      { orderId, reasonCode: selectedReason, rejectionNote: note },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  return (
    <BottomSheet label="Cancel this order" onClose={onClose}>
      <p className="mb-4 flex-shrink-0 text-[15px] font-semibold text-foreground">
        Cancel this order
      </p>
      <div className="flex flex-col gap-2">
        {REJECTION_REASONS.map((reason) => (
          <button
            key={reason.code}
            type="button"
            onClick={() => {
              setSelectedReason(reason.code);
            }}
            className={`flex items-center justify-between gap-3 rounded-2xl p-3 text-left transition-opacity active:opacity-70 ${
              selectedReason === reason.code
                ? "border border-foreground/15 bg-foreground/[0.07]"
                : "bg-muted"
            }`}
          >
            <span className="text-sm font-medium text-foreground">
              {reason.label}
            </span>
            {selectedReason === reason.code && (
              <Check className="h-4 w-4 flex-shrink-0 text-foreground" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-5">
        <label
          htmlFor="cancel-note"
          className="mb-2 block text-sm font-medium text-foreground"
        >
          Add a note (optional)
        </label>
        <textarea
          id="cancel-note"
          rows={2}
          placeholder="e.g. Ran out of tomatoes this morning"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          className="w-full resize-none rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!selectedReason || cancelOrder.isPending}
        className={`mt-5 h-14 w-full rounded-2xl text-base font-semibold transition-all ${
          selectedReason
            ? "bg-destructive text-white active:scale-[0.98]"
            : "cursor-not-allowed bg-destructive/25 text-white/50"
        }`}
      >
        {cancelOrder.isPending ? "Cancelling…" : "Confirm cancellation"}
      </button>
      {cancelOrder.isError && (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {GENERIC_ERROR}
        </p>
      )}
    </BottomSheet>
  );
}
