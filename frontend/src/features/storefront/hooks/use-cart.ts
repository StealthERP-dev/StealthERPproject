"use client";

// The thin React binding over the pure cart-store.ts module (D-02, D-03).
// Same "pure module + thin bound hook" split log-event.ts/log-event-core.ts
// already established, but this is the first time that split is a
// React external-store subscription rather than a plain async function —
// the first genuinely reactive, multi-reader client store this project has
// needed (a repo-wide search for that React primitive by name returns
// nothing before this file — see RESEARCH Pattern 1).
//
// D-03's rules — whole numbers, the 1..99 bound, and a decrement at one
// removing the entry — are enforced by cart-store.ts's own pure transforms;
// this hook's job is composing read -> transform -> write for each mutating
// call and firing DATA-08's add_to_cart event fire-and-forget from every
// call that ADDS quantity (add, increment) and never from decrement, which
// has no event of its own.
//
// Namespace import for React itself — the same self-defeating-grep
// avoidance use-public-store.ts's own header established for istDate — so
// the external-store primitive's own name appears on exactly one line of
// this file: the call site below, not a second import-declaration line.
import * as React from "react";
import {
  addOrIncrementItem,
  decrementItemQty,
  incrementItemQty,
  readCart,
  removeCartItem,
  subscribeToCart,
  writeCart,
  type CartItem,
} from "@/features/storefront/lib/cart-store";
import { logEvent } from "@/lib/analytics/log-event";

const EMPTY_CART: readonly CartItem[] = Object.freeze([]);

export function useCart(slug: string) {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeToCart(slug, listener),
    [slug],
  );
  const getSnapshot = React.useCallback(() => readCart(slug), [slug]);
  const getServerSnapshot = React.useCallback(() => EMPTY_CART, []);

  const items = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const cartCount = items.length;

  const getQty = React.useCallback(
    (productId: string) =>
      items.find((item) => item.productId === productId)?.qty ?? 0,
    [items],
  );

  const add = React.useCallback(
    (entry: {
      productId: string;
      name: string;
      unit: string;
      hadOffer: boolean;
    }) => {
      writeCart(slug, addOrIncrementItem(readCart(slug), entry));
      void logEvent({
        eventName: "add_to_cart",
        slug,
        productId: entry.productId,
      });
    },
    [slug],
  );

  const increment = React.useCallback(
    (productId: string) => {
      writeCart(slug, incrementItemQty(readCart(slug), productId));
      void logEvent({ eventName: "add_to_cart", slug, productId });
    },
    [slug],
  );

  const decrement = React.useCallback(
    (productId: string) => {
      writeCart(slug, decrementItemQty(readCart(slug), productId));
    },
    [slug],
  );

  const remove = React.useCallback(
    (productId: string) => {
      writeCart(slug, removeCartItem(readCart(slug), productId));
    },
    [slug],
  );

  const clear = React.useCallback(() => {
    writeCart(slug, []);
  }, [slug]);

  return { items, cartCount, getQty, add, increment, decrement, remove, clear };
}

export type { CartItem };
