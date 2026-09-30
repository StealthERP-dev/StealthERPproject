"use client";

// Setup's container: a small state machine over the signup form, the
// finish-your-shop recovery and the business-type step, plus the AUTH-07
// returning-vendor redirect (Task 3). Follows the house container pattern
// (storefront-page.tsx / home-page.tsx): branch on the provider's loading
// state before rendering anything — the "query" here is AuthProvider's
// context, not a TanStack Query hook. The step is held in local state (not
// derived from the provider) because this is one route with a linear flow,
// matching how the prototype itself moves between these two screens.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { SetupForm } from "@/features/auth/components/setup-form";
import { BusinessTypeStep } from "@/features/auth/components/business-type-step";
import { FinishYourShopForm } from "@/features/auth/components/finish-your-shop-form";

type Step = "form" | "business-type";
// Which submitted flow owns this page. "none" means the vendor has not acted
// here, which is the only state in which the AUTH-07 redirect may fire.
type Flow = "none" | "signup" | "recovery";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function SetupPage() {
  const { user, store, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");

  // WHICH flow is running on this page — not merely "did something get
  // submitted". Both distinctions below were learned by breaking them.
  //
  // The original guard asked `step === "form"`, assuming a fresh signup
  // would have advanced the step before its store appeared. It does not:
  // useSignUp/useFinishShop `await refresh()` INSIDE mutationFn, so `store`
  // goes non-null and commits a render while `step` is still "form";
  // TanStack only runs onSuccess (which calls setStep) after mutationFn
  // resolves. So the redirect won every time — deterministically, not as a
  // rare race — and sent every new vendor straight to Home. "What do you
  // sell?" never rendered, business_types stayed '{}' and
  // onboarding_completed never fired. Reproduced live 3/3 in dev and in a
  // production build.
  //
  // A single "submitted" boolean is NOT enough, and using one was a real
  // regression: `user && !store` is both the transient mid-signup state AND
  // the condition that renders the recovery form. One flag suppressing that
  // branch fixed signup and broke recovery — the recovery form unmounted
  // itself the instant it was submitted, dropping its own onSuccess exactly
  // as the signup bug did. The flow identity is what keeps each form mounted
  // through its own mutation.
  //
  // Set from a submit handler, so it is an event-handler fact rather than
  // state derived from the provider — no effect, no render-order guesswork.
  // A returning vendor never submits, so this stays "none" for them and the
  // redirect below still fires.
  const [flow, setFlow] = useState<Flow>("none");

  // AUTH-07: a vendor who already has a session and a shop needs no entry
  // screen — reopening the app reaches Home without a PIN. Effect, never
  // during render; router.replace (never push) so the back button does not
  // return them to a screen they have no use for.
  useEffect(() => {
    if (loading || !user || !store || flow !== "none") {
      return;
    }
    router.replace("/");
  }, [loading, user, store, flow, router]);

  // Declared once and reused by both the mid-flight branch and the entry
  // branch below: the same element, so React keeps the one instance mounted
  // across the transition instead of remounting it and losing the mutation.
  const setupForm = (
    <SetupForm
      onSubmitStart={() => {
        setFlow("signup");
      }}
      onSuccess={() => {
        setStep("business-type");
      }}
    />
  );
  const recoveryForm = (
    <FinishYourShopForm
      onSubmitStart={() => {
        setFlow("recovery");
      }}
      onSuccess={() => {
        setStep("business-type");
      }}
    />
  );

  if (loading) {
    return <LoadingShell />;
  }

  if (step === "business-type") {
    return (
      <BusinessTypeStep
        onSuccess={() => {
          router.replace("/");
        }}
      />
    );
  }

  // A submitted form stays mounted until its own mutation finishes and
  // advances the step. These two branches sit above every provider-derived
  // branch below precisely so a mid-flight change to user/store cannot swap
  // the running form out from under its mutation — the failure mode that
  // silently dead-ended both the signup and the recovery paths.
  if (flow === "signup") {
    return setupForm;
  }

  if (flow === "recovery") {
    return recoveryForm;
  }

  if (user && store) {
    // A returning vendor: the redirect above is in flight, so render nothing
    // rather than flash an entry screen they have no use for. Only reachable
    // with flow === "none", which is exactly when that redirect fires.
    return null;
  }

  // D-09: a signed-in vendor with no shop row yet (the shop insert failed
  // after a genuinely successful signUp) sees the recovery form instead of
  // a second signup attempt, and — per D-18 — continues to the
  // business-type step on success, the same journey everyone else takes.
  // The trigger is the resolved user+null-store pair, never a caught error
  // and never the loading flag above — conflating "no shop" with "not
  // resolved yet" would flash this screen at every vendor for a moment on
  // every load.
  if (user && !store) {
    // Reachable only when no flow is running (the branches above return
    // first), so this is a genuine D-09 arrival: signed in, no shop row.
    // During a signup this state also occurs transiently — signUp() fires
    // onAuthStateChange before the stores row is inserted — but the
    // flow === "signup" branch above already claimed the render by then.
    return recoveryForm;
  }

  return setupForm;
}
