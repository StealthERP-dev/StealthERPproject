"use client";

// The cart screen (STOR-05, STOR-06, STOR-07), UI-SPEC Screen Contract 5 +
// Screen Contract 7 (empty state). Presentational: cart-page.tsx owns every
// branch (loading/error/submitted/empty), the cart read, the reconciliation
// and the submit-in-flight guard; this file only renders whatever it is
// handed. The four field-class constants below were copied from Phase 1's
// retired walking-skeleton order form (D-05, deleted once this file's
// markup fully superseded it).

import { Minus, Plus, ShoppingCart } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { formatPriceDisplay } from "@/features/products/lib/format-price";
import { orderErrorMessage } from "@/features/storefront/hooks/use-place-order";

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-muted px-4 text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none";
const fieldLabelClass = "mb-2 block text-sm font-medium text-foreground";
const sectionLabelClass =
  "mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
const noteLabelClass = "text-sm font-medium text-foreground";

export interface CartLineItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  /** Present only when this line is currently offer-priced — absent means
   * "price on request" (PROD-03's default), never a placeholder zero. */
  offer?: { offerPrice: number; regularPrice: number | null };
}

export function CartView({
  slug,
  cartCount,
  cartItems,
  staleRemovedNames,
  onInc,
  onDec,
  name,
  onNameChange,
  phone,
  onPhoneChange,
  note,
  onNoteChange,
  canPlaceOrder,
  submitting,
  submitError,
  onSubmit,
  orderingDisabled,
  onBack,
}: {
  slug: string;
  cartCount: number;
  cartItems: CartLineItem[];
  staleRemovedNames: string[];
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  canPlaceOrder: boolean;
  submitting: boolean;
  /** The raw mutation error (or null) — this view maps it through the
   * shipped orderErrorMessage helper itself, so it always renders whatever
   * the one mapper returns and never re-spells a server code locally. */
  submitError: unknown;
  onSubmit: () => void;
  orderingDisabled: boolean;
  onBack: () => void;
}) {
  if (cartCount === 0) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 pt-5 pb-4">
          <BackButton onBack={onBack} />
          <div>
            <h1 className="text-[17px] font-semibold text-foreground">
              Your cart
            </h1>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <ShoppingCart className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p className="mb-1 text-sm font-semibold text-foreground">
            Your cart is empty
          </p>
          <p className="mb-6 max-w-[240px] text-xs text-muted-foreground">
            {staleRemovedNames.length > 0
              ? `${String(staleRemovedNames.length)} item${staleRemovedNames.length !== 1 ? "s" : ""} were removed because they're no longer available.`
              : "Add items from the shop to get started."}
          </p>
          <a
            href={`/store/${slug}`}
            className="flex h-12 w-full max-w-[240px] items-center justify-center rounded-2xl bg-foreground text-sm font-semibold text-background transition-transform active:scale-[0.98]"
          >
            Browse the shop
          </a>
        </div>
      </div>
    );
  }

  const pricedItems = cartItems.filter((item) => item.offer);
  const hasPricedItems = pricedItems.length > 0;
  const hasUnpricedItems = cartItems.some((item) => !item.offer);
  const pricedTotal = pricedItems.reduce(
    (sum, item) => sum + (item.offer?.offerPrice ?? 0) * item.qty,
    0,
  );
  const totalSaving = pricedItems.reduce((sum, item) => {
    const regular = item.offer?.regularPrice;
    if (regular == null) return sum;
    return sum + (regular - (item.offer?.offerPrice ?? 0)) * item.qty;
  }, 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 pt-5 pb-4">
        <BackButton onBack={onBack} />
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">
            Your cart
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cartCount} item{cartCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 pt-4 pb-32">
          {staleRemovedNames.length > 0 && (
            <div className="rounded-xl bg-muted px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {staleRemovedNames.length === 1
                  ? `${staleRemovedNames[0] ?? ""} is no longer available and was removed from your cart.`
                  : `${String(staleRemovedNames.length)} items are no longer available and were removed from your cart.`}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {cartItems.map((item) => (
              <div
                key={item.productId}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <div className="h-[52px] w-[52px] flex-shrink-0 overflow-hidden rounded-xl bg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {item.name}
                  </p>
                  {item.offer ? (
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-sm font-semibold text-foreground">
                        ₹{formatPriceDisplay(item.offer.offerPrice)}
                      </span>
                      {item.offer.regularPrice != null && (
                        <span className="text-xs text-muted-foreground line-through">
                          ₹{formatPriceDisplay(item.offer.regularPrice)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      per {item.unit} · Price on request
                    </p>
                  )}
                </div>
                <div className="flex h-11 flex-shrink-0 items-center gap-1 rounded-xl bg-muted px-0">
                  <button
                    type="button"
                    onClick={() => {
                      onDec(item.productId);
                    }}
                    aria-label={`Remove one ${item.name}`}
                    className="flex h-11 w-11 items-center justify-center transition-transform active:scale-90"
                  >
                    <Minus className="h-3 w-3 text-foreground" />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs font-semibold text-foreground">
                    {item.qty} {item.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onInc(item.productId);
                    }}
                    disabled={item.qty >= 99}
                    aria-label={`Add one more ${item.name}`}
                    className="flex h-11 w-11 items-center justify-center transition-transform active:scale-90 disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3 text-foreground" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasPricedItems && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-4 pt-4 pb-4">
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Order summary
                </p>
                <div className="flex flex-col gap-2">
                  {pricedItems.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">
                        {item.name} × {item.qty}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        ₹
                        {formatPriceDisplay(
                          (item.offer?.offerPrice ?? 0) * item.qty,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {totalSaving > 0 && (
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span className="text-sm font-medium text-[#D97706]">
                      You save
                    </span>
                    <span className="text-sm font-semibold text-[#D97706]">
                      −₹{formatPriceDisplay(totalSaving)}
                    </span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-[15px] font-semibold text-foreground">
                    {hasUnpricedItems ? "Total (priced items)" : "Total"}
                  </span>
                  <span className="text-[15px] font-semibold text-foreground">
                    ₹{formatPriceDisplay(pricedTotal)}
                  </span>
                </div>
                {hasUnpricedItems && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Other items priced by seller on confirmation.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <p className={sectionLabelClass}>Your details</p>
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="cart-name" className={fieldLabelClass}>
                  Your name
                </label>
                <input
                  id="cart-name"
                  type="text"
                  placeholder="Meera"
                  value={name}
                  onChange={(event) => {
                    onNameChange(event.target.value);
                  }}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="cart-phone" className={fieldLabelClass}>
                  Mobile number
                </label>
                <input
                  id="cart-phone"
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(event) => {
                    onPhoneChange(event.target.value);
                  }}
                  className={inputClass}
                />
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <label htmlFor="cart-note" className={noteLabelClass}>
                    Note to seller
                  </label>
                  <span className="text-xs text-muted-foreground">
                    Optional
                  </span>
                </div>
                <textarea
                  id="cart-note"
                  rows={3}
                  placeholder="Any requests or delivery notes…"
                  value={note}
                  onChange={(event) => {
                    onNoteChange(event.target.value);
                  }}
                  className="w-full resize-none rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-background px-5 pt-4 pb-8">
        {orderingDisabled ? (
          <div className="flex h-14 w-full items-center justify-center rounded-2xl bg-muted">
            <p className="text-sm font-semibold text-muted-foreground">
              Store is closed · Orders paused
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={canPlaceOrder ? onSubmit : undefined}
              disabled={!canPlaceOrder || submitting}
              className={`h-14 w-full rounded-2xl text-base font-semibold transition-all ${
                canPlaceOrder
                  ? "bg-foreground text-background active:scale-[0.98]"
                  : "cursor-not-allowed bg-foreground/15 text-foreground/35"
              }`}
            >
              {submitting ? "Sending…" : "Place order request"}
            </button>
            {!canPlaceOrder && (
              <p className="mt-2.5 text-center text-xs text-muted-foreground">
                Add your name and phone to continue
              </p>
            )}
            {submitError !== null && submitError !== undefined && (
              <p
                role="alert"
                className="mt-2.5 text-center text-sm text-destructive"
              >
                {orderErrorMessage(submitError)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
