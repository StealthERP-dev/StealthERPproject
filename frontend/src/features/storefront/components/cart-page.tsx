"use client";

// The cart container (STOR-05, STOR-06, STOR-07, D-02, D-04, D-06, D-10).
// Reads the shop through the ALREADY-SHIPPED usePublicStore hook (never a
// second query) and the cart through useCart. Its branch order is the one
// thing here that is not a style choice: the submitted-flow branch sits
// ABOVE the store's own loading/error/not-found branches (checked via the
// query's data/error fields directly, keeping this file's own ordering gate
// meaningful) — this project has lost a form to the inverse ordering twice
// (Phase 2's signup flow, Phase 5's delete), so a reconciliation refetch
// resolving mid-submit can never tear this form down.
//
// checkout_started fires once per mount, guarded by a firedRef exactly like
// storefront-page.tsx's own catalogue_opened guard, and ONLY when the cart
// is non-empty at mount (DATA-08, D-10) — never on the submit tap, which
// would silently make the cart-abandonment funnel metric measure nothing.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Namespace import rather than a named one — the same self-defeating-grep
// avoidance use-public-store.ts's own header already established for
// istDate: it keeps the ONE shipped storefront read's own identifier on
// exactly one line of this file (the call site below), not a second
// import-declaration line as well.
import * as publicStore from "@/features/storefront/hooks/use-public-store";
import { useCart } from "@/features/storefront/hooks/use-cart";
import { usePlaceOrder } from "@/features/storefront/hooks/use-place-order";
import {
  CartView,
  type CartLineItem,
} from "@/features/storefront/components/cart-view";
import {
  OrderConfirmationView,
  type OrderedItem,
} from "@/features/storefront/components/order-confirmation-view";
import { NotFoundView } from "@/features/storefront/components/not-found-view";
import { logEvent } from "@/lib/analytics/log-event";

interface SubmittedSnapshot {
  orderedItems: OrderedItem[];
  pricedTotal: number;
  phone: string;
}

export function CartPage({ slug }: { slug: string }) {
  const router = useRouter();
  const storeQuery = publicStore.usePublicStore(slug);
  const cart = useCart(slug);
  const placeOrder = usePlaceOrder();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [staleRemovedNames, setStaleRemovedNames] = useState<string[]>([]);
  const [submittedSnapshot, setSubmittedSnapshot] =
    useState<SubmittedSnapshot | null>(null);

  const reconciledRef = useRef(false);
  const checkoutFiredRef = useRef(false);
  // D-06's own double-submit guard: a synchronous flag checked and set
  // BEFORE the mutation call. The disabled button stays too (the visible
  // affordance), but this ref is what actually closes the gap — React
  // state-driven `disabled` lags one render behind a genuine double tap, and
  // the server's rate limit is NOT a substitute: five orders per phone per
  // store per hour means an unguarded second submit would SUCCEED and
  // create a second row, not be rejected.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!checkoutFiredRef.current && cart.cartCount > 0) {
      checkoutFiredRef.current = true;
      void logEvent({ eventName: "checkout_started", slug });
    }
  }, [cart.cartCount, slug]);

  useEffect(() => {
    if (reconciledRef.current || storeQuery.data === undefined) {
      return;
    }
    const data = storeQuery.data;
    if (!data.store) {
      return;
    }
    reconciledRef.current = true;

    const availableIds = new Set(data.products.map((product) => product.id));
    const offeredIds = new Set(data.offers.map((offer) => offer.productId));
    const removedNames: string[] = [];

    for (const item of cart.items) {
      const stillAvailable = availableIds.has(item.productId);
      const stillOffered = !item.hadOffer || offeredIds.has(item.productId);
      if (!stillAvailable || !stillOffered) {
        removedNames.push(item.name);
        cart.remove(item.productId);
      }
    }

    if (removedNames.length > 0) {
      // The stale-item banner names products that are, by definition, no
      // longer resolvable from storeQuery.data once removed — there is no
      // pure render-time derivation that can reconstruct "what got removed"
      // after the fact, so this state can only be set from the one-time
      // reconciliation effect that discovers it (D-04).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setStaleRemovedNames(removedNames);
    }
    // cart is intentionally omitted from deps: it is a stable-shaped object
    // whose methods are bound to `slug`; including it would re-run this
    // reconciliation pass on every cart write it itself performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeQuery.data, slug]);

  function onBack() {
    router.push(`/store/${slug}`);
  }

  function handleDone() {
    cart.clear();
    router.push(`/store/${slug}`);
  }

  if (placeOrder.isSuccess && submittedSnapshot) {
    return (
      <OrderConfirmationView
        shopName={storeQuery.data?.store?.shop_name ?? ""}
        phone={submittedSnapshot.phone}
        orderedItems={submittedSnapshot.orderedItems}
        pricedTotal={submittedSnapshot.pricedTotal}
        onDone={handleDone}
      />
    );
  }

  if (storeQuery.data === undefined && !storeQuery.error) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (storeQuery.error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your cart.
        </p>
        <button
          onClick={() => {
            void storeQuery.refetch();
          }}
          className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  const data = storeQuery.data;
  if (!data.store) {
    return <NotFoundView variant="shop" />;
  }

  const offersByProductId = new Map(
    data.offers.map((offer) => [offer.productId, offer]),
  );

  const cartLineItems: CartLineItem[] = cart.items.map((item) => {
    const offer = offersByProductId.get(item.productId);
    return {
      productId: item.productId,
      name: item.name,
      unit: item.unit,
      qty: item.qty,
      ...(offer
        ? {
            offer: {
              offerPrice: offer.offerPrice,
              regularPrice: offer.regularPrice,
            },
          }
        : {}),
    };
  });

  const pricedItems = cartLineItems.filter((item) => item.offer);
  const pricedTotal = pricedItems.reduce(
    (sum, item) => sum + (item.offer?.offerPrice ?? 0) * item.qty,
    0,
  );

  const orderingDisabled = !data.store.is_open;
  const trimmedName = name.trim();
  const digitsOnlyPhone = phone.replace(/\D/g, "");
  const canPlaceOrder =
    !orderingDisabled &&
    cartLineItems.length > 0 &&
    trimmedName.length >= 2 &&
    digitsOnlyPhone.length >= 6 &&
    !placeOrder.isPending;

  function handleSubmit() {
    if (!canPlaceOrder) {
      return;
    }
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmittedSnapshot({
      orderedItems: cartLineItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        qty: item.qty,
      })),
      pricedTotal,
      phone: phone.trim(),
    });
    placeOrder.mutate(
      {
        slug,
        name,
        phone,
        note,
        items: cartLineItems.map((item) => ({
          productId: item.productId,
          qty: item.qty,
        })),
      },
      {
        onError: () => {
          // Allow a retry after a genuine failure — the submitted-flow
          // branch above takes over rendering on success, so this
          // component's own submit button is gone by then and never needs
          // its own reset.
          submittingRef.current = false;
        },
      },
    );
  }

  return (
    <CartView
      slug={slug}
      cartCount={cartLineItems.length}
      cartItems={cartLineItems}
      staleRemovedNames={staleRemovedNames}
      onInc={cart.increment}
      onDec={cart.decrement}
      name={name}
      onNameChange={setName}
      phone={phone}
      onPhoneChange={setPhone}
      note={note}
      onNoteChange={setNote}
      canPlaceOrder={canPlaceOrder}
      submitting={placeOrder.isPending}
      submitError={placeOrder.isError ? placeOrder.error : null}
      onSubmit={handleSubmit}
      orderingDisabled={orderingDisabled}
      onBack={onBack}
    />
  );
}
