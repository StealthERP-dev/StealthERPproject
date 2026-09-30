"use client";

// The shared masked six-digit PIN field (D-06) — used by Login here and by
// Setup in plan 02-06. Renders the browser's native password-masking glyphs
// (dots), not six auto-advancing boxes; a show/hide button toggles the
// input's type between "password" and "text". Digits-only, capped at six
// characters, is filtered inside this component so both screens get
// identical behaviour from one place (UI-SPEC section 1, byte-for-byte).
//
// The field's own <label> is left to the caller (bound via `id`, matching
// UI-SPEC's markup) rather than rendered in here — each screen owns its own
// label/input pairing directly, the same accessibility contract every other
// field on these screens follows.

import { useState, type ChangeEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

// Deliberately takes NO `describedById`/`aria-describedby` prop (D-04).
// 02-UI-SPEC.md's own PinField sample wires the shared error region to this
// field via aria-describedby; doing that would tell a screen-reader user
// WHICH field was wrong, which is exactly the disclosure the single
// "Wrong mobile number or PIN" message exists to prevent. Both callers
// already pass nothing, so the prop was dead code that a future
// unused-variable cleanup could have "fixed" into a real leak. If you are
// here to add it back: don't — the error belongs to the form, not the field.
export function PinField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [pinVisible, setPinVisible] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const digitsOnly = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
    onChange(digitsOnly);
  }

  return (
    <div className="relative">
      <input
        id={id}
        type={pinVisible ? "text" : "password"}
        inputMode="numeric"
        pattern="\d*"
        maxLength={6}
        placeholder="••••••"
        value={value}
        onChange={handleChange}
        className="h-12 w-full rounded-xl border border-border bg-muted pr-12 pl-4 tracking-[6px] text-foreground transition-all placeholder:tracking-normal placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          setPinVisible((v) => !v);
        }}
        aria-label={pinVisible ? "Hide PIN" : "Show PIN"}
        aria-pressed={pinVisible}
        // Real arithmetic (WR-01): the icon itself is `h-4 w-4` (16px), not the
        // 36px/44px inner elements `back-button.tsx`/`toggle.tsx` wrap with this
        // same `-m-N p-N` technique — so mirroring their `-m-2.5 p-2.5` (10px)
        // only reaches 16 + 10 + 10 = 36px, below the project's ≥44px floor.
        // `-m-3.5 p-3.5` (14px) reaches 16 + 14 + 14 = 44px. The negative margin
        // exactly cancels the padding's position offset (both are the same
        // magnitude), so the rendered icon position is unchanged — only the
        // invisible hit area grows. Do not "simplify" this back to `-2.5`/`2.5`.
        className="absolute top-1/2 right-1 -m-3.5 -translate-y-1/2 p-3.5"
      >
        {pinVisible ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
