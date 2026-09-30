"use client";

// The Add offer screen (OFFR-01). Copies product-form.tsx's screen skeleton
// (header / scrollable body / non-fixed in-flow footer) and its EXACT price
// input mechanics — D-06 mandates reuse, not reinvention: both price fields
// here run every keystroke through the same shared sanitiser/parser pair
// format-price.ts exports, the same ₹-prefixed positioned-span layout, so an
// unparseable amount can never be typed. No second money mechanic exists
// anywhere in this file.
//
// This form stays presentational (mirrors product-form.tsx's own division
// of labour with add-edit-product-page.tsx): it owns its own field state and
// its own save mutation (useSaveOffer(storeId), exactly like product-form.tsx
// owns useSaveProduct(storeId)), but reads no session/auth hook itself — the
// container resolves storeId and the available-product list.
//
// The product picker is a sheet this form owns the open/closed boolean for
// and renders as a conditional sibling of its own fields — copying
// product-form.tsx's own photoSheetOpen + conditional <PhotoSourceSheet>
// shape, the closest in-file precedent for "a form owns a sheet-toggle
// boolean," even closer than a list container's category-sheet pattern
// because it also lives inside a form.
//
// D-04's pre-fill (the simple case: no offer exists yet today for the
// selected product) happens inside the picker's OWN selection handler — an
// event-handler fact, never a mount effect and never derived during render.
// Today's price always starts empty on a fresh pick.
//
// canSave mirrors the database's own offers_regular_price_gte_offer_price
// check client-side (UI-SPEC's own instruction), computed the same plain
// derived-boolean way product-form.tsx computes isValid/canSubmit.

import { useState, type ChangeEvent } from "react";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import {
  sanitizePriceInput,
  parsePriceInput,
  formatPriceDisplay,
} from "@/features/products/lib/format-price";
import type { Product } from "@/features/products/hooks/use-products";
import { useSaveOffer } from "@/features/offers/hooks/use-save-offer";
import type { Offer } from "@/features/offers/hooks/use-offers";
import { ProductPickerSheet } from "@/features/offers/components/product-picker-sheet";

// The one shared sanitiser call site both price fields run every keystroke
// through — a single wrapped setter, not two separately-written calls, so
// there is exactly one place in this file that could ever drift from
// format-price.ts's own sanitisation rule.
function priceInputHandler(setter: (value: string) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    setter(sanitizePriceInput(e.target.value));
  };
}

export function OfferForm({
  storeId,
  availableProducts,
  productsLoading,
  existingOffers,
  onSubmitStart,
  onSuccess,
}: {
  storeId: string;
  /** Already filtered to `available === true` by the container (D-01) —
   * never a second filtering step in here. */
  availableProducts: Product[];
  /** True while the shared product cache has not resolved yet — the trigger
   * shows a distinct label rather than opening onto an empty picker. */
  productsLoading: boolean;
  /** Today's offers, so the picker's selection handler can tell whether the
   * product just picked already carries a live offer (D-02's replace-case
   * seed) — read by the container, never fetched in here. */
  existingOffers: Offer[];
  // Fired the instant a submit is accepted, BEFORE the mutation runs — the
  // container needs this to hold its flow identity before anything else
  // could swap the form out from under its own mutation.
  onSubmitStart: () => void;
  onSuccess: () => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [offerPriceText, setOfferPriceText] = useState("");
  const [regularPriceText, setRegularPriceText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const saveOffer = useSaveOffer(storeId);

  const selectedProduct =
    availableProducts.find((product) => product.id === selectedProductId) ??
    null;

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    const product = availableProducts.find((p) => p.id === productId);
    const liveOffer = existingOffers.find((o) => o.product_id === productId);
    // D-02/D-04: a product that already carries an offer today seeds BOTH
    // fields from that existing offer's own stored numbers — the vendor is
    // correcting a live offer, not starting from the product's base price.
    // Otherwise, the simple case: today's price starts empty, regular price
    // seeds from the product's own stored price. Still one handler, still
    // an event-handler fact, never a mount effect.
    if (liveOffer) {
      setOfferPriceText(formatPriceDisplay(liveOffer.offer_price));
      setRegularPriceText(formatPriceDisplay(liveOffer.regular_price));
    } else {
      setOfferPriceText("");
      setRegularPriceText(product ? formatPriceDisplay(product.price) : "");
    }
    setPickerOpen(false);
  }

  const offerPriceValue = parsePriceInput(offerPriceText);
  const regularPriceValue = parsePriceInput(regularPriceText);
  const regularBelowOffer =
    offerPriceValue !== null &&
    regularPriceValue !== null &&
    regularPriceValue < offerPriceValue;

  const isValid =
    selectedProduct !== null &&
    offerPriceValue !== null &&
    offerPriceValue >= 0 &&
    !regularBelowOffer;
  const canSubmit = isValid && !saveOffer.isPending;

  function handleSubmit() {
    if (!selectedProduct || offerPriceValue === null || regularBelowOffer) {
      return;
    }
    onSubmitStart();
    saveOffer.mutate(
      {
        productId: selectedProduct.id,
        unit: selectedProduct.unit,
        offerPrice: offerPriceValue,
        regularPrice: regularPriceValue,
      },
      { onSuccess },
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 pt-5 pb-4">
        <BackButton />
        <h1 className="text-[17px] font-semibold text-foreground">
          Add today&apos;s offer
        </h1>
      </div>
      <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 pt-5 pb-32">
          <div>
            <label className="mb-2.5 block text-sm font-medium text-foreground">
              Choose a product
            </label>
            <button
              type="button"
              onClick={() => {
                setPickerOpen(true);
              }}
              disabled={productsLoading || availableProducts.length === 0}
              className="flex h-12 w-full items-center justify-between rounded-xl border border-border bg-muted px-4 transition-opacity active:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {selectedProduct ? (
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg bg-background">
                    {selectedProduct.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a remote demo/product photo URL, not a next/image-optimisable local asset.
                      <img
                        src={selectedProduct.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="h-3.5 w-3.5 rounded-md bg-muted-foreground/20" />
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {selectedProduct.name}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {productsLoading
                    ? "Loading products…"
                    : availableProducts.length === 0
                      ? "No available products"
                      : "Select a product…"}
                </span>
              )}
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>
            {!productsLoading && availableProducts.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Turn on a product first — offers can only be added to available
                products.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="offer-price"
              className="mb-2.5 block text-sm font-medium text-foreground"
            >
              Today&apos;s price
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-muted-foreground">
                ₹
              </span>
              <input
                id="offer-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={offerPriceText}
                onChange={priceInputHandler(setOfferPriceText)}
                className="h-12 w-full rounded-xl border border-border bg-muted pr-4 pl-8 text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-baseline justify-between">
              <label
                htmlFor="offer-regular-price"
                className="text-sm font-medium text-foreground"
              >
                Regular price
              </label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-muted-foreground">
                ₹
              </span>
              <input
                id="offer-regular-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={regularPriceText}
                onChange={priceInputHandler(setRegularPriceText)}
                className="h-12 w-full rounded-xl border border-border bg-muted pr-4 pl-8 text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
              />
            </div>
            {regularBelowOffer && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                Regular price can&apos;t be lower than today&apos;s price.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-muted px-4 py-3">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#D97706]" />
            <p className="text-sm text-muted-foreground">
              Offer ends today automatically
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-border bg-background px-5 pt-4 pb-8">
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
            {saveOffer.isPending ? "Saving…" : "Add offer"}
          </button>
          {saveOffer.isError && (
            <p
              role="alert"
              className="mt-3 text-center text-sm text-destructive"
            >
              Something went wrong. Try again.
            </p>
          )}
        </div>
      </div>
      {pickerOpen && (
        <ProductPickerSheet
          products={availableProducts}
          onSelect={selectProduct}
          onClose={() => {
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
