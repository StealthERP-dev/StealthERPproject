"use client";

// Orders screen, presentational half (ORDR-01, ORDR-02, D-08, D-09). Header
// and empty-state markup carry over byte-for-byte from the shipped Phase 3
// stub, whose own comment already anticipated this exact replacement. The
// New/Earlier split below is net-new.
//
// The split is on `order.is_new` — SEEN-NESS — and NEVER `order.status`, the
// lifecycle column. The two are orthogonal and both default to a state
// named "new" (see use-orders.ts / use-new-order-count.ts headers): an order
// can sit in Earlier — already read — while still awaiting a Confirm or
// Cancel (06-05). The header's own "N new" count and the New section's own
// row count both derive from the SAME `newOrders` array the list beneath
// renders, so the count can never disagree with what it labels — matching
// this project's own "one derivation, many consumers" discipline
// (Phase 4's D-06, Phase 5's D-03).
//
// A section with no rows renders no header and no divider at all — the
// no-scaffolding-for-an-absent-section discipline Manage Offers already
// established (visibleOffers/manage-offers-view.tsx's own empty branch).
//
// The cancel-reason sheet's open state lives HERE, above every row, rather
// than inside order-row.tsx: this keeps the row presentational and ensures
// only ONE sheet is ever mounted regardless of how many rows this screen
// renders. Holding the whole `Order` being cancelled (not just its id) lets
// the sheet read that order's own `store_id` without this view needing a
// `storeId` prop of its own.

import { useState } from "react";
import { OrderRow } from "@/features/orders/components/order-row";
import { CancelReasonSheet } from "@/features/orders/components/cancel-reason-sheet";
import type { Order } from "@/features/orders/hooks/use-orders";

export function OrdersView({ orders }: { orders: Order[] }) {
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const newOrders = orders.filter((order) => order.is_new);
  const pastOrders = orders.filter((order) => !order.is_new);

  return (
    <div className="scrollbar-hide flex-1 overflow-y-auto pb-6">
      <div className="px-5 pt-7 pb-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Orders
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {newOrders.length > 0
            ? `${String(newOrders.length)} new · ${String(orders.length)} total`
            : `${String(orders.length)} orders`}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">No orders yet</p>
        </div>
      ) : (
        <>
          {newOrders.length > 0 && (
            <div className="mb-5 px-5">
              <p className="mb-3 text-[11px] font-semibold tracking-wider text-[#D97706] uppercase">
                New
              </p>
              <div className="flex flex-col gap-2.5">
                {newOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onOpenCancel={setCancellingOrder}
                  />
                ))}
              </div>
            </div>
          )}
          {pastOrders.length > 0 && (
            <div className="mb-5 px-5">
              <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Earlier
              </p>
              <div className="flex flex-col gap-2.5">
                {pastOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onOpenCancel={setCancellingOrder}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {cancellingOrder && (
        <CancelReasonSheet
          orderId={cancellingOrder.id}
          storeId={cancellingOrder.store_id}
          onClose={() => {
            setCancellingOrder(null);
          }}
        />
      )}
    </div>
  );
}
