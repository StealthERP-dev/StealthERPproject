"use client";

// Setup's form (AUTH-01) — the five-field entry screen ported from
// SetupScreen (product UI reference/app/App.tsx:196-267), extended with the
// Area/market field and the shared PinField (D-06). Follows Phase 1's
// retired walking-skeleton order form's own file organisation (class
// constants at module scope, a setValue change helper, one derived validity
// boolean) and login-form.tsx's established auth-screen conventions — with
// that retired form's two defects deliberately NOT repeated: every label is
// bound via htmlFor/id, and the error region uses the semantic
// text-destructive token, never a hard-coded red utility.
//
// The mobile-number field carries a plain `autoFocus` rather than a
// ref-driven "first empty field" effect: this screen is never mounted with
// any field pre-filled (unlike Login, which restores a remembered number),
// so the mobile number is always the first empty required field in the
// spec's order at mount, and `autoFocus` alone satisfies that rule here.

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { PinField } from "@/features/auth/components/pin-field";
import { useSignUp } from "@/features/auth/hooks/use-sign-up";
import { AuthError, authErrorMessage } from "@/features/auth/lib/auth-error";
import { toCanonicalPhone, toDigits } from "@/features/auth/lib/phone";
import { setRememberedPhone } from "@/features/auth/lib/remembered-phone";

const inputClass =
  "w-full h-12 px-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all";
const fieldLabelClass = "block text-sm font-medium text-foreground mb-2";
const noteLabelClass = "text-sm font-medium text-foreground";

function setValue(setter: (value: string) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
  };
}

export function SetupForm({
  onSubmitStart,
  onSuccess,
}: {
  // Fired the instant a submit is accepted, BEFORE the mutation runs. The
  // container needs to know this vendor is mid-flow before `refresh()`
  // inside mutationFn makes their new store visible, or its AUTH-07
  // redirect mistakes them for a returning vendor and sends them to Home.
  onSubmitStart: () => void;
  onSuccess: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [area, setArea] = useState("");
  const [pin, setPin] = useState("");
  const signUp = useSignUp();

  const isValid =
    toDigits(phone).length >= 10 &&
    shopName.trim().length >= 2 &&
    vendorName.trim().length >= 2 &&
    pin.length === 6;
  const canSubmit = isValid && !signUp.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmitStart();
    signUp.mutate({ phone, pin, shopName, vendorName, area }, { onSuccess });
  }

  // D-11: the number the vendor already typed is carried to Login rather
  // than making them type it again — reusing D-07's own device-memory
  // module (the exact mechanism Login already reads its prefill from)
  // rather than inventing a second phone-handoff channel. Never overwrites
  // an existing remembered number with a blank one.
  function carryPhoneToLogin() {
    const canonical = toCanonicalPhone(phone);
    if (canonical) {
      setRememberedPhone(canonical);
    }
  }

  const isDuplicatePhone =
    signUp.isError &&
    signUp.error instanceof AuthError &&
    signUp.error.code === "duplicate_phone";

  return (
    <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto px-6">
      <div className="flex justify-center pt-14 pb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Store className="h-7 w-7 text-foreground/50" strokeWidth={1.5} />
        </div>
      </div>
      <p className="mb-3 text-center text-sm text-muted-foreground">
        Keep customers updated on what&apos;s available today.
      </p>
      <h1 className="mb-9 text-center text-[28px] font-semibold tracking-tight text-foreground">
        Set up your store
      </h1>
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="setup-phone" className={fieldLabelClass}>
            Mobile number
          </label>
          <input
            id="setup-phone"
            type="tel"
            autoFocus
            placeholder="+91 98765 43210"
            value={phone}
            onChange={setValue(setPhone)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="setup-shop-name" className={fieldLabelClass}>
            Shop name
          </label>
          <input
            id="setup-shop-name"
            type="text"
            placeholder="Green Valley Grocers"
            value={shopName}
            onChange={setValue(setShopName)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="setup-vendor-name" className={fieldLabelClass}>
            Your name
          </label>
          <input
            id="setup-vendor-name"
            type="text"
            placeholder="Priya"
            value={vendorName}
            onChange={setValue(setVendorName)}
            className={inputClass}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="setup-area" className={noteLabelClass}>
              Area / market
            </label>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <input
            id="setup-area"
            type="text"
            placeholder="Kadavanthra"
            value={area}
            onChange={setValue(setArea)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="setup-pin" className={fieldLabelClass}>
            6-digit PIN
          </label>
          <PinField id="setup-pin" value={pin} onChange={setPin} />
        </div>
      </div>
      {/* LEGAL-01: client-PRD wording ("Preview Terms & Privacy Policy") and
          placement ("right under the sign-up input box") — opens in-app per
          the client's "open a simple page inside PWA" instruction. */}
      <div className="mt-4 text-center">
        <Link
          href="/terms"
          className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2 transition-opacity active:opacity-60"
        >
          Preview Terms & Privacy Policy
        </Link>
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
          {signUp.isPending ? "Creating shop…" : "Continue"}
        </button>
        {signUp.isError && (
          <p role="alert" className="text-center text-sm text-destructive">
            {isDuplicatePhone ? (
              <>
                This number already has a shop —{" "}
                <Link
                  href="/login"
                  onClick={carryPhoneToLogin}
                  className="font-semibold text-foreground underline"
                >
                  open it instead
                </Link>
              </>
            ) : (
              authErrorMessage(signUp.error)
            )}
          </p>
        )}
        <Link
          href="/login"
          onClick={carryPhoneToLogin}
          className="min-h-11 w-full text-center text-sm font-medium text-muted-foreground transition-opacity active:opacity-60"
        >
          Already have a shop?{" "}
          <span className="font-semibold text-foreground underline">
            Open it
          </span>
        </Link>
      </div>
    </div>
  );
}
