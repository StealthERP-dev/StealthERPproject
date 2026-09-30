"use client";

// The D-09 recovery: an already-authenticated vendor whose shop insert
// failed the first time finds their details waiting instead of a dead end.
// Reuses setup-form.tsx's shop name / vendor name / area field markup
// verbatim — same classes, same bound labels, same Optional badge — but
// carries neither a mobile-number field (the session already knows the
// number) nor a credential field (the vendor is already authenticated;
// re-asking something they already set would read as an error, not a
// step). No footer link either — finishing this form is the only way out.
//
// This state is reachable only after a genuinely successful account
// creation whose shop insert then failed (RESEARCH Pitfall 4) — a repeat
// signup on a number that already has a shop is refused at the signup call
// itself and never reaches here.

import { useState, type ChangeEvent } from "react";
import { Store } from "lucide-react";
import { useFinishShop } from "@/features/auth/hooks/use-finish-shop";
import { authErrorMessage } from "@/features/auth/lib/auth-error";

const inputClass =
  "w-full h-12 px-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all";
const fieldLabelClass = "block text-sm font-medium text-foreground mb-2";
const noteLabelClass = "text-sm font-medium text-foreground";

function setValue(setter: (value: string) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
  };
}

export function FinishYourShopForm({
  onSubmitStart,
  onSuccess,
}: {
  // See SetupForm: fired before the mutation runs, so the container knows
  // this vendor is mid-flow before refresh() makes their store visible.
  onSubmitStart: () => void;
  onSuccess: () => void;
}) {
  const [shopName, setShopName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [area, setArea] = useState("");
  const finishShop = useFinishShop();

  const isValid = shopName.trim().length >= 2 && vendorName.trim().length >= 2;
  const canSubmit = isValid && !finishShop.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmitStart();
    finishShop.mutate({ shopName, vendorName, area }, { onSuccess });
  }

  return (
    <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto px-6">
      <div className="flex justify-center pt-14 pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Store className="h-7 w-7 text-foreground/50" strokeWidth={1.5} />
        </div>
      </div>
      <p className="mb-3 text-center text-sm text-muted-foreground">
        You&apos;re signed in — just a few more details.
      </p>
      <h1 className="mb-9 text-center text-[28px] font-semibold tracking-tight text-foreground">
        Finish setting up your shop
      </h1>
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="finish-shop-name" className={fieldLabelClass}>
            Shop name
          </label>
          <input
            id="finish-shop-name"
            type="text"
            autoFocus
            placeholder="Green Valley Grocers"
            value={shopName}
            onChange={setValue(setShopName)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="finish-vendor-name" className={fieldLabelClass}>
            Your name
          </label>
          <input
            id="finish-vendor-name"
            type="text"
            placeholder="Priya"
            value={vendorName}
            onChange={setValue(setVendorName)}
            className={inputClass}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="finish-area" className={noteLabelClass}>
              Area / market
            </label>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <input
            id="finish-area"
            type="text"
            placeholder="Kadavanthra"
            value={area}
            onChange={setValue(setArea)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-auto py-8">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`h-14 w-full rounded-2xl text-base font-semibold transition-all ${
            isValid
              ? "bg-foreground text-background active:scale-[0.98]"
              : "cursor-not-allowed bg-foreground/15 text-foreground/35"
          }`}
        >
          {finishShop.isPending ? "Finishing…" : "Finish setup"}
        </button>
        {finishShop.isError && (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            {authErrorMessage(finishShop.error)}
          </p>
        )}
      </div>
    </div>
  );
}
