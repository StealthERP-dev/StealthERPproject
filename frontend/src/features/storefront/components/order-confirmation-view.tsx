// The terminal confirmation state (STOR-06), UI-SPEC Screen Contract 6.
// Rendered as a BRANCH of the same /store/[slug]/cart route (cart-page.tsx's
// submitted-flow branch), never a second route — this is what keeps the
// submitting form mounted through its own mutation. Pulled into its own
// file purely for length relief, the same discretionary-extraction
// reasoning Phase 5 recorded for its own offers card.

import { Check } from "lucide-react";
import { formatPriceDisplay } from "@/features/products/lib/format-price";

export interface OrderedItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
}

export function OrderConfirmationView({
  shopName,
  phone,
  orderedItems,
  pricedTotal,
  onDone,
}: {
  shopName: string;
  phone: string;
  orderedItems: OrderedItem[];
  pricedTotal: number;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#DCFCE7]">
        <Check className="h-10 w-10 text-[#16A34A]" />
      </div>
      <h2 className="mb-3 text-[26px] font-semibold tracking-tight text-foreground">
        Order received ✓
      </h2>
      <p className="mb-8 text-[15px] leading-relaxed text-muted-foreground">
        {shopName} will contact you{phone ? ` at ${phone}` : ""} to confirm your
        order.
      </p>
      <div className="mb-8 w-full rounded-2xl border border-border bg-card p-4 text-left">
        <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Your order
        </p>
        {orderedItems.map((item) => (
          <div
            key={item.productId}
            className="flex items-center justify-between py-1.5"
          >
            <span className="text-sm text-foreground">{item.name}</span>
            <span className="text-sm text-muted-foreground">
              {item.qty} {item.unit}
            </span>
          </div>
        ))}
        {pricedTotal > 0 && (
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2.5">
            <span className="text-sm font-semibold text-foreground">Total</span>
            <span className="text-sm font-semibold text-foreground">
              ₹{formatPriceDisplay(pricedTotal)}
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDone}
        className="h-14 rounded-2xl bg-foreground px-10 text-base font-semibold text-background transition-transform active:scale-[0.98]"
      >
        Done
      </button>
    </div>
  );
}
