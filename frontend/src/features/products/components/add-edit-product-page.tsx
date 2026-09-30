"use client";

// The Add/Edit product container — this phase's most important analog:
// setup-page.tsx's flow-identity mechanism (setup-page.tsx:37-63,114-131).
// Every form in this phase that saves inherits Phase 2's exact defect class
// (see 03-03-PLAN.md's <the_hazard>): signUp() fired onAuthStateChange
// before the shop row existed, the container re-rendered onto a different
// branch, the form unmounted, and TanStack dropped the mutate(vars,
// {onSuccess}) callback the form had passed in. The row was created, no
// error surfaced, the next step never ran, and it looked exactly like
// nothing happened.
//
// This container carries no side-effect hook at all, and the ONLY code
// permitted to navigate after a save is the save mutation's own success
// callback — never a hook reacting to some other piece of state, and never
// an eager "the vendor is probably done" navigation fired the instant
// `.mutate()` returns. A future editor who adds either reintroduces a
// defect that leaves the row written, no error on screen, and the vendor
// staring at a form that looks like it did nothing.
//
// The flow identity below is set from the form's own onSubmitStart
// callback — an event-handler fact, never state derived from the auth
// provider and never computed during render — and the "saving" branch sits
// above the loading/store branch for exactly the reason setup-page.tsx's
// post-mortem comment explains: so a mid-flight change to some other piece
// of state cannot swap the running form out from under its own mutation.
// This container has no competing async branch today (unlike Setup's
// AUTH-07 redirect racing signUp), but the shape is not stylistic — it is
// the mitigation, applied before a future edit needs it.
//
// The container's onSuccess steps the browser history back one entry,
// never a forward navigation to a hardcoded path: the vendor arrived here
// via a forward navigation from /manage or from a product's detail screen
// (products-view.tsx / product-detail-view.tsx), so stepping back returns
// them to that exact screen with its status filter intact (NAV-02, D-08) —
// the same fallback BackButton already uses when given no handler.
//
// Update mode (plan 03-05, PROD-07): the existing row is resolved from the
// SAME shared products cache the list and detail screens already read —
// never a second fetch — and handed to the form as its pre-fill source. The
// flow-identity guard above is completely unchanged by this: an edit is the
// same hazard as an insert, so the container still carries no side-effect
// hook, and navigation after a save still lives only in the mutation's own
// success callback.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";
import { useProducts } from "@/features/products/hooks/use-products";
import { ProductForm } from "@/features/products/components/product-form";

type Flow = "none" | "saving";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function AddEditProductPage({
  mode = "create",
  productId,
}: {
  mode?: "create" | "update";
  productId?: string;
}) {
  const { store, loading } = useAuth();
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("none");

  const storeId = store?.id ?? "";
  const productsQuery = useProducts(storeId);
  const existingProduct =
    mode === "update"
      ? (productsQuery.data?.find((row) => row.id === productId) ?? null)
      : null;

  // Declared once and reused by both branches below: the same element, so
  // React keeps the one instance mounted across the loading -> saving
  // transition instead of remounting it and losing the mutation.
  const form = (
    <ProductForm
      storeId={storeId}
      mode={mode}
      initialProduct={existingProduct}
      onSubmitStart={() => {
        setFlow("saving");
      }}
      onSuccess={() => {
        router.back();
      }}
    />
  );

  // Sits above every provider-derived branch below precisely so a mid-save
  // vendor is never swapped onto the loading branch by an unrelated change
  // in `loading`/`store` — see the file header.
  if (flow === "saving") {
    return form;
  }

  if (loading || !store || (mode === "update" && productsQuery.isPending)) {
    return <LoadingShell />;
  }

  if (mode === "update" && !existingProduct) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Product not found</p>
      </div>
    );
  }

  return form;
}
