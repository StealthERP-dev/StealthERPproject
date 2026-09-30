// The /manage route (PROD-01) — a thin wrapper only. ProductsPage is the
// only component that reads the search params (the status filter, D-08),
// which is exactly why the Suspense boundary lives here rather than inside
// the container: Next.js requires one around any client component that
// reads search params during a static render. Same split shape as
// (vendor)/layout.tsx's VendorLayout/VendorGuard, copied not shared.

import { Suspense } from "react";
import { ProductsPage } from "@/features/products/components/products-page";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ProductsPage />
    </Suspense>
  );
}
