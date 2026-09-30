// The project's first dedicated full-screen not-found component (STOR-08).
// Purely presentational — no data hooks, no useRouter beyond the shared
// Link component already used project-wide for internal navigation. No
// Retry control on either variant: retrying a slug or id that will never
// resolve cannot succeed, the same distinction this project already draws
// between a dead end and a failure.

import Link from "next/link";
import { Store } from "lucide-react";

type NotFoundVariant =
  { variant: "shop" } | { variant: "product"; slug: string };

const COPY = {
  shop: {
    heading: "Shop not found",
    body: "This link may be out of date. Check with the shop for a new one.",
  },
  product: {
    heading: "Product not found",
    body: "This item may no longer be available.",
  },
} as const;

export function NotFoundView(props: NotFoundVariant) {
  const copy = COPY[props.variant];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Store className="h-7 w-7 text-muted-foreground/50" strokeWidth={1.5} />
      </div>
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
        {copy.heading}
      </h1>
      <p className="max-w-[280px] text-sm text-muted-foreground">{copy.body}</p>
      {props.variant === "product" && (
        <Link
          href={`/store/${props.slug}`}
          className="mt-3 flex h-12 w-full max-w-[280px] items-center justify-center rounded-2xl bg-foreground text-sm font-semibold text-background transition-transform active:scale-[0.98]"
        >
          Browse the shop
        </Link>
      )}
    </div>
  );
}
