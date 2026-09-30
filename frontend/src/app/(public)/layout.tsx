import type { Metadata } from "next";
import type { ReactNode } from "react";

// Customer pages must not offer the shopkeeper's app for install (PRD §8
// "nothing to install for customers"; the per-shop storefront manifest is
// PWA-v2-01, deferred). The root's file-convention manifest is applied at
// the root segment, and this segment's explicit null replaces it for every
// route under (public) (resolve-metadata.js:159-160 and 268-269). The
// favicon and apple-touch-icon are left inherited — a neutral glyph on a
// customer's own bookmark is harmless.
export const metadata: Metadata = { manifest: null, appleWebApp: null };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[390px] bg-background">
      {children}
    </div>
  );
}
