"use client";

// "What do you sell?" (AUTH-02, BusinessTypeStep in the prototype,
// App.tsx:271-325) ported near-verbatim, with exactly one deliberate
// deviation from the prototype: chip height and the Skip control's height
// go from the prototype's h-10 (40px) to h-11 (44px) — the global
// touch-target floor overriding a 4px prototype detail (UI-SPEC's own
// documented exception, not drift). Both Continue and Skip call the same
// business-types mutation, Skip with an empty selection, so
// onboarding_completed always fires (D-16/D-18) — there is no conditional
// around the event and no second code path.

import { useState } from "react";
import { Check } from "lucide-react";
import { BUSINESS_TYPE_OPTIONS } from "@/features/auth/constants";
import { useUpdateBusinessTypes } from "@/features/auth/hooks/use-update-business-types";
import { authErrorMessage } from "@/features/auth/lib/auth-error";

export function BusinessTypeStep({ onSuccess }: { onSuccess: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const updateBusinessTypes = useUpdateBusinessTypes();

  function toggle(businessType: string) {
    setSelected((prev) =>
      prev.includes(businessType)
        ? prev.filter((type) => type !== businessType)
        : [...prev, businessType],
    );
  }

  function handleContinue() {
    updateBusinessTypes.mutate({ businessTypes: selected }, { onSuccess });
  }

  function handleSkip() {
    updateBusinessTypes.mutate({ businessTypes: [] }, { onSuccess });
  }

  return (
    <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto px-6">
      <div className="pt-12 pb-7">
        <h1 className="mb-2.5 text-[26px] font-semibold tracking-tight text-foreground">
          What do you sell?
        </h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Choose what fits your shop. You can change this later.
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5 pb-8">
        {BUSINESS_TYPE_OPTIONS.map((businessType) => {
          const isSelected = selected.includes(businessType);
          return (
            <button
              key={businessType}
              type="button"
              onClick={() => {
                toggle(businessType);
              }}
              className={`flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium transition-all active:scale-[0.96] ${
                isSelected
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground"
              }`}
            >
              {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              {businessType}
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-3 pb-8">
        <button
          type="button"
          onClick={handleContinue}
          disabled={updateBusinessTypes.isPending}
          className="h-14 w-full rounded-2xl bg-foreground text-base font-semibold text-background transition-all active:scale-[0.98]"
        >
          {/* In-flight feedback, matching setup-form's "Creating shop…",
              login-form's "Opening…" and finish-your-shop's "Finishing…".
              Both Continue and Skip run the same mutation (D-16: skipping
              still completes onboarding), so this label covers either tap —
              a vendor who tapped Skip still sees that something is happening
              rather than a dead screen. */}
          {updateBusinessTypes.isPending
            ? "Saving…"
            : selected.length > 0
              ? `Continue · ${String(selected.length)} selected`
              : "Continue"}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={updateBusinessTypes.isPending}
          className="h-11 w-full text-sm font-medium text-muted-foreground transition-opacity active:opacity-60"
        >
          Skip for now
        </button>
        {updateBusinessTypes.isError && (
          <p role="alert" className="text-center text-sm text-destructive">
            {authErrorMessage(updateBusinessTypes.error)}
          </p>
        )}
      </div>
    </div>
  );
}
