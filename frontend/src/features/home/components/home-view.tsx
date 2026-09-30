"use client";

// Home's presentational view (HOME-01, HOME-02, HOME-05, D-15). Fully-resolved
// props in — no data-fetching or session hooks live here, matching
// StorefrontView's convention. Navigation is the one exception: the three
// count tiles call useRouter directly, the same pattern products-view.tsx
// already establishes for a component that isn't itself a data container.
//
// Scope boundary (D-15, Phase 3 scope boundary; updated 04-03, 04-04): this
// renders the greeting block and store-open card (ported verbatim,
// App.tsx:976-995), the section-labelled count-tile row, the catalogue
// status card below it — HOME-02's status text — and both deferred controls
// inside that same card: the customer-preview link (HOME-03, SHAR-04) and
// now the catalogue-sharing button that opens the share sheet (HOME-03,
// SHAR-01). Phase 5's offers card (05-02) is mounted below the catalogue
// card as this file's own new last section — the slot this header comment
// used to record as deliberately empty is filled.

import { useRouter } from "next/navigation";
import { Check, ExternalLink, Share2 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { OffersCard } from "@/features/home/components/offers-card";
import type { Offer } from "@/features/offers/hooks/use-offers";

export function HomeView({
  greeting,
  vendorName,
  storeOpen,
  onToggleOpen,
  availableCount,
  unavailableCount,
  newOrderCount,
  updatedToday,
  onShareCatalogue,
  onPreviewCustomer,
  activeOffers,
  onAddOffer,
  onManageOffers,
}: {
  greeting: string;
  vendorName: string;
  storeOpen: boolean;
  onToggleOpen: () => void;
  availableCount: number;
  unavailableCount: number;
  newOrderCount: number;
  updatedToday: boolean;
  onShareCatalogue: () => void;
  onPreviewCustomer: () => void;
  activeOffers: Offer[];
  onAddOffer: () => void;
  onManageOffers: () => void;
}) {
  const router = useRouter();

  return (
    <div className="scrollbar-hide flex-1 overflow-y-auto pb-6">
      <div className="px-5 pt-7 pb-5">
        <p className="mb-1 text-[15px] leading-none font-normal text-muted-foreground">
          {greeting}
        </p>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-foreground">
          {vendorName}
        </h1>
      </div>

      <div className="mx-5 mb-5 flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${
              storeOpen ? "bg-[#16A34A]" : "bg-muted-foreground/40"
            }`}
          />
          <span className="text-sm font-medium text-foreground">
            {storeOpen ? "Store open" : "Store closed"}
          </span>
        </div>
        <Toggle checked={storeOpen} onChange={onToggleOpen} />
      </div>

      <div className="mx-5 mb-4">
        <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Today at your shop
        </p>
        <div className="flex divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card">
          <button
            type="button"
            onClick={() => {
              router.push("/manage?filter=available");
            }}
            className="flex flex-1 flex-col items-center gap-1 py-4 transition-colors active:bg-muted/60"
          >
            <span className="text-[20px] leading-none font-semibold text-foreground">
              {availableCount}
            </span>
            <span className="text-[11px] leading-none text-muted-foreground">
              Available
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              router.push("/manage?filter=unavailable");
            }}
            className="flex flex-1 flex-col items-center gap-1 py-4 transition-colors active:bg-muted/60"
          >
            <span className="text-[20px] leading-none font-semibold text-foreground">
              {unavailableCount}
            </span>
            <span className="text-[11px] leading-none text-muted-foreground">
              Unavailable
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              router.push("/orders");
            }}
            className="flex flex-1 flex-col items-center gap-1 py-4 transition-colors active:bg-muted/60"
          >
            <span
              className={`text-[20px] leading-none font-semibold ${
                newOrderCount > 0 ? "text-[#D97706]" : "text-foreground"
              }`}
            >
              {newOrderCount}
            </span>
            <span className="text-[11px] leading-none text-muted-foreground">
              New orders
            </span>
          </button>
        </div>
      </div>

      <div className="mx-5 mb-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="px-4 pt-4 pb-4">
          <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Today&apos;s catalogue
          </p>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[22px] leading-none font-semibold tracking-tight text-foreground">
              Live
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-semibold text-[#166534]">
              <Check className="h-3 w-3" />
              Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {availableCount} products available
            {updatedToday ? " · Updated today" : ""}
          </p>
        </div>
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={onShareCatalogue}
            className="flex h-12 w-full items-center justify-between rounded-xl bg-foreground px-4 text-background transition-transform active:scale-[0.98]"
          >
            <span className="text-[14px] font-semibold">
              Share today&apos;s catalogue
            </span>
            <Share2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onPreviewCustomer}
            className="mt-2.5 flex h-11 w-full items-center justify-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors active:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Preview as customer
          </button>
        </div>
      </div>

      <OffersCard
        activeOffers={activeOffers}
        onAddOffer={onAddOffer}
        onManageOffers={onManageOffers}
      />
    </div>
  );
}
