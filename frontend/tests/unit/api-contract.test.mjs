// Unit test (no database, no browser): guards api-contract's own stated risk
// — "kept in sync BY HAND... nothing enforces this file tree from the
// database automatically" — by asserting every closed vocabulary in
// shared/api-contract.ts matches the one frontend constants file that
// is its actual source of truth today. A future edit to either side without
// the other breaks this test instead of silently drifting.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_TYPE_VALUES,
  UNIT_VALUES,
  SHARE_DESTINATION_VALUES,
  ORDER_REJECTION_REASON_VALUES,
  EVENT_NAME_VALUES,
} from "../../../shared/api-contract.ts";
import { BUSINESS_TYPE_OPTIONS } from "../../src/features/auth/constants.ts";
import { UNIT_OPTIONS } from "../../src/features/products/constants.ts";
import {
  SHARE_DESTINATIONS,
  COPY_LINK_DESTINATION,
} from "../../src/features/share/constants.ts";
import { REJECTION_REASONS } from "../../src/features/orders/lib/rejection-reasons.ts";

test("BUSINESS_TYPE_VALUES matches auth/constants.ts's BUSINESS_TYPE_OPTIONS exactly", () => {
  assert.deepEqual(BUSINESS_TYPE_VALUES, BUSINESS_TYPE_OPTIONS);
});

test("UNIT_VALUES matches products/constants.ts's UNIT_OPTIONS exactly", () => {
  assert.deepEqual(UNIT_VALUES, UNIT_OPTIONS);
});

test("SHARE_DESTINATION_VALUES matches share/constants.ts's SHARE_DESTINATIONS labels plus COPY_LINK_DESTINATION", () => {
  const expected = [
    ...SHARE_DESTINATIONS.map((destination) => destination.label),
    COPY_LINK_DESTINATION,
  ];
  assert.deepEqual(SHARE_DESTINATION_VALUES, expected);
});

test("ORDER_REJECTION_REASON_VALUES matches rejection-reasons.ts's REJECTION_REASONS codes exactly", () => {
  const expected = REJECTION_REASONS.map((reason) => reason.code);
  assert.deepEqual(ORDER_REJECTION_REASON_VALUES, expected);
});

test("EVENT_NAME_VALUES is the 17-name allow-list src/lib/analytics/log-event-core.ts's LogEventName type declares", () => {
  // LogEventName is a type-only union (no runtime array to import), so this
  // list is a hand-mirrored literal — keep it byte-for-byte identical to
  // log-event-core.ts's own union if that file ever changes.
  const expected = [
    "shop_created",
    "onboarding_completed",
    "product_added",
    "product_updated",
    "product_marked_available",
    "product_marked_unavailable",
    "offer_created",
    "offer_shared",
    "catalogue_shared",
    "catalogue_opened",
    "product_viewed",
    "add_to_cart",
    "checkout_started",
    "order_placed",
    "order_confirmed",
    "order_cancelled",
    "orders_opened",
  ];
  assert.deepEqual(EVENT_NAME_VALUES, expected);
});
