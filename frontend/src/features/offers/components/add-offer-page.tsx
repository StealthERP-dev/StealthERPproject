"use client";

// The Add offer container — copies add-edit-product-page.tsx's flow-identity
// shape nearly verbatim (this phase's single most load-bearing analog, per
// CONTEXT's own instruction). A submitted OfferForm must stay mounted
// through its own saveOffer.mutate(vars, { onSuccess }) call: TanStack Query
// drops a mutate() call's own callbacks when the component that issued them
// unmounts, and Phase 2 lost a flow to exactly this twice (see
// add-edit-product-page.tsx's own header for the full post-mortem).
//
// The "saving" flow state is set ONLY from the form's own onSubmitStart
// callback — an event-handler fact, never state derived from the auth
// provider and never computed during render — and it sits ABOVE every
// provider-derived branch below for exactly the reason
// add-edit-product-page.tsx's own comment explains: so a mid-save vendor is
// never swapped onto the not-yet-ready branch by an unrelated change in one
// of those provider values. The session/catalogue readiness check itself is
// deliberately made only AFTER that flow check, below, so nothing about it
// can precede the guard it exists to protect.
//
// This container has one fewer branch than its analog: Add offer is
// create-only, because D-02's replace is an upsert inside the mutation
// itself, not a second container mode.
//
// onSuccess steps the browser history back one entry, never a forward
// navigation to a hardcoded path — the vendor arrived here via a forward
// navigation from Home or from Manage Offers, so stepping back reproduces
// the prototype's own addOfferSource back-destination mechanism for free
// (UI-SPEC Screen Contract 2's routing note), with zero new state.
//
// WR-02 (05-REVIEW.md): a failed productsQuery is a fetch failure, never a
// business fact about the vendor's own catalogue — a genuinely empty
// catalogue and a broken network request must never render the same way.
// This mirrors products-page.tsx:74's own `productsQuery.isError` branch
// (the "Couldn't load your products." + Retry shape this file's own header
// already says it copies nearly verbatim), placed in the SAME relative
// position as that analog: after the loading branch, before the ready
// render. It sits below the "saving" flow branch for the same reason
// stillResolving does — a mid-save vendor must never be swapped onto any
// provider-derived branch. Placed AFTER stillResolving (never before it,
// and never merged into its condition) so a `pending` status is still read
// as "still resolving", not as an error: TanStack Query only reports
// `status === "error"` once a fetch has actually settled and failed. This
// must never short-circuit `stillResolving`'s own render — a real empty
// catalogue (offer-form.tsx's own D-01 "Turn on a product first" message)
// is reached only via a successful, zero-length productsQuery, which this
// branch does not intercept.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { useProducts } from "@/features/products/hooks/use-products";
import * as offersData from "@/features/offers/hooks/use-offers";
import { OfferForm } from "@/features/offers/components/offer-form";

type Flow = "none" | "saving";

function NotReadyShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function ProductsErrorShell({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load your products.
      </p>
      <button
        onClick={onRetry}
        className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
      >
        Retry
      </button>
    </div>
  );
}

export function AddOfferPage() {
  const auth = useAuth();
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("none");

  const storeId = auth.store?.id ?? "";
  const productsQuery = useProducts(storeId);
  const availableProducts = (productsQuery.data ?? []).filter(
    (product) => product.available,
  );
  // Lets the form tell whether the product just picked already carries an
  // offer today (D-02's replace-case seed) — the container fetches, the
  // form stays presentational, exactly like it reads useProducts above.
  const offersQuery = offersData.useOffers(storeId);

  // Declared once and reused by both branches below: the same element, so
  // React keeps the one instance mounted across the not-ready -> saving
  // transition instead of remounting it and losing the mutation.
  const form = (
    <OfferForm
      storeId={storeId}
      availableProducts={availableProducts}
      productsLoading={productsQuery.status === "pending"}
      existingOffers={offersQuery.data ?? []}
      onSubmitStart={() => {
        setFlow("saving");
      }}
      onSuccess={() => {
        router.back();
      }}
    />
  );

  // Sits above every provider-derived branch below precisely so a mid-save
  // vendor is never swapped onto the not-ready branch — see the file header.
  if (flow === "saving") {
    return form;
  }

  const stillResolving =
    auth.loading || !auth.store || productsQuery.status === "pending";
  if (stillResolving) {
    return <NotReadyShell />;
  }

  if (productsQuery.isError) {
    return (
      <ProductsErrorShell
        onRetry={() => {
          void productsQuery.refetch();
        }}
      />
    );
  }

  return form;
}
