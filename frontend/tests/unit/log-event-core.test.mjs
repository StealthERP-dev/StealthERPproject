// Unit test (no database, no browser): the mechanical proof of D-05 — a
// returned error, a rejected promise, and a synchronous throw from the
// injected client's rpc() all resolve logEventWith rather than rejecting it.
// If any of these could reject, a later phase's save/toggle/share/order
// action could be aborted by an analytics failure, which doc §17 forbids.

import { test } from "node:test";
import assert from "node:assert/strict";
import { logEventWith } from "../../src/lib/analytics/log-event-core.ts";

const EXPECTED_KEYS = [
  "p_event_name",
  "p_slug",
  "p_visitor_id",
  "p_app_version",
  "p_product_id",
  "p_order_id",
  "p_offer_id",
  "p_props",
].sort();

test("logEventWith: a client whose rpc resolves with a non-null error field resolves (never rejects)", async () => {
  const client = {
    rpc: () => Promise.resolve({ error: { message: "boom" } }),
  };

  await assert.doesNotReject(() =>
    logEventWith(client, { eventName: "catalogue_opened" }),
  );
});

test("logEventWith: a client whose rpc rejects with an Error resolves (never rejects)", async () => {
  const client = {
    rpc: () => Promise.reject(new Error("network error")),
  };

  await assert.doesNotReject(() =>
    logEventWith(client, { eventName: "catalogue_opened" }),
  );
});

test("logEventWith: a client whose rpc throws synchronously resolves (never rejects)", async () => {
  const client = {
    rpc: () => {
      throw new Error("synchronous failure");
    },
  };

  await assert.doesNotReject(() =>
    logEventWith(client, { eventName: "catalogue_opened" }),
  );
});

test("logEventWith: a happy-path client receives the exact p_-prefixed params and the unchanged event name", async () => {
  let receivedName;
  let receivedParams;
  const client = {
    rpc: (name, params) => {
      receivedName = name;
      receivedParams = params;
      return Promise.resolve({ error: null });
    },
  };

  await logEventWith(client, {
    eventName: "order_placed",
    slug: "priya-stores",
    visitorId: "11111111-1111-4111-8111-111111111111",
    appVersion: "0.1.0-beta",
    productId: "22222222-2222-4222-8222-222222222222",
    orderId: "33333333-3333-4333-8333-333333333333",
    offerId: "44444444-4444-4444-8444-444444444444",
    props: { extra: "value" },
  });

  assert.equal(receivedName, "log_event");
  assert.deepEqual(Object.keys(receivedParams).sort(), EXPECTED_KEYS);
  assert.equal(receivedParams.p_event_name, "order_placed");
});
