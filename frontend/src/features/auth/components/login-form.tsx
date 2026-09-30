"use client";

// The net-new Login screen's form (D-05/D-06/D-08), built in Setup's visual
// language: one screen, both fields, a single "Open" button. Follows Phase
// 1's retired walking-skeleton order form's own file organisation (class
// constants at module scope, a setValue change helper, one derived validity
// boolean) — with two defects from that form deliberately NOT repeated
// (UI-SPEC's explicit callout): labels bound via htmlFor/id, and
// text-destructive instead of a hard-coded red utility for the error region.

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { PinField } from "@/features/auth/components/pin-field";
import { useSignIn } from "@/features/auth/hooks/use-sign-in";
import { authErrorMessage } from "@/features/auth/lib/auth-error";
import { toDigits } from "@/features/auth/lib/phone";
import { getRememberedPhone } from "@/features/auth/lib/remembered-phone";

const inputClass =
  "w-full h-12 px-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all";
const fieldLabelClass = "block text-sm font-medium text-foreground mb-2";

function setValue(setter: (value: string) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
  };
}

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  // D-07: the mobile number is remembered on this device and prefilled next
  // time; the PIN is never prefilled (or stored anywhere — see
  // remembered-phone.ts). Seeded via useState's lazy initializer (runs once,
  // at mount) rather than a setState-in-effect — getRememberedPhone already
  // resolves to an empty string with no localStorage (server render), so
  // this needs no separate branch for that case; React does not warn on a
  // hydration mismatch for a form control's `value`, the one prop where
  // browsers routinely disagree with server-rendered markup (autofill).
  const [phone, setPhone] = useState(() => getRememberedPhone());
  const [pin, setPin] = useState("");
  const signIn = useSignIn();

  const isValid = toDigits(phone).length >= 10 && pin.length === 6;
  const canSubmit = isValid && !signIn.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    signIn.mutate(
      { phone, pin },
      {
        onSuccess: () => {
          onSuccess();
        },
      },
    );
  }

  return (
    <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto px-6">
      <div className="flex justify-center pt-14 pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Store className="h-7 w-7 text-foreground/50" strokeWidth={1.5} />
        </div>
      </div>
      <p className="mb-3 text-center text-sm text-muted-foreground">
        Enter your shop&apos;s mobile number and PIN.
      </p>
      <h1 className="mb-9 text-center text-[28px] font-semibold tracking-tight text-foreground">
        Open your shop
      </h1>
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="login-phone" className={fieldLabelClass}>
            Mobile number
          </label>
          <input
            id="login-phone"
            type="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={setValue(setPhone)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="login-pin" className={fieldLabelClass}>
            6-digit PIN
          </label>
          <PinField id="login-pin" value={pin} onChange={setPin} />
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-3 py-8">
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
          {signIn.isPending ? "Opening…" : "Open"}
        </button>
        {signIn.isError && (
          <p role="alert" className="text-center text-sm text-destructive">
            {authErrorMessage(signIn.error)}
          </p>
        )}
        <Link
          href="/setup"
          className="min-h-11 w-full text-center text-sm font-medium text-muted-foreground transition-opacity active:opacity-60"
        >
          New here?{" "}
          <span className="font-semibold text-foreground underline">
            Set up your shop
          </span>
        </Link>
      </div>
    </div>
  );
}
