// The real /orders route (ORDR-01), replacing the Phase 3 stub's hardcoded
// empty state with the container. No Suspense needed — the container reads
// no search params, matching the shipped /offers route's own shape.

export { OrdersPage as default } from "@/features/orders/components/orders-page";
