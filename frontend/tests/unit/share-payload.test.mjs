// Unit test (no database, no browser): pins share-payload.ts's URL/payload
// shapes exactly, so a wrong link discovered later in the browser flow can
// be traced to either the string builder (caught here) or the dispatch
// (caught in scripts/smoke-share-flow.mjs) — never both at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStorefrontUrl,
  buildProductUrl,
  buildSharePayload,
  buildWhatsAppUrl,
} from "../../src/features/share/lib/share-payload.ts";

test("buildStorefrontUrl: joins origin and slug with exactly one slash", () => {
  assert.equal(
    buildStorefrontUrl("http://127.0.0.1:3100", "priya-stores"),
    "http://127.0.0.1:3100/store/priya-stores",
  );
});

test("buildStorefrontUrl: a trailing slash on the origin produces the same URL as one without", () => {
  const withSlash = buildStorefrontUrl(
    "http://127.0.0.1:3100/",
    "priya-stores",
  );
  const withoutSlash = buildStorefrontUrl(
    "http://127.0.0.1:3100",
    "priya-stores",
  );
  assert.equal(withSlash, withoutSlash);
  assert.equal(withSlash, "http://127.0.0.1:3100/store/priya-stores");
});

test("buildProductUrl: joins origin, slug and product id with the /p/ segment", () => {
  assert.equal(
    buildProductUrl("http://127.0.0.1:3100", "priya-stores", "abc-123"),
    "http://127.0.0.1:3100/store/priya-stores/p/abc-123",
  );
});

test("buildProductUrl: a trailing slash on the origin produces the same URL as one without", () => {
  const withSlash = buildProductUrl(
    "http://127.0.0.1:3100/",
    "priya-stores",
    "abc-123",
  );
  const withoutSlash = buildProductUrl(
    "http://127.0.0.1:3100",
    "priya-stores",
    "abc-123",
  );
  assert.equal(withSlash, withoutSlash);
});

test("buildSharePayload: the catalogue shape uses the shop name as the title and the storefront URL", () => {
  const payload = buildSharePayload({
    origin: "http://127.0.0.1:3100",
    slug: "priya-stores",
    shopName: "Priya Stores",
  });
  assert.deepEqual(payload, {
    title: "Priya Stores",
    text: "Available today at Priya Stores",
    url: "http://127.0.0.1:3100/store/priya-stores",
  });
});

test("buildSharePayload: the product shape titles '<product> · <shop>' and links to the product URL", () => {
  const payload = buildSharePayload({
    origin: "http://127.0.0.1:3100",
    slug: "priya-stores",
    shopName: "Priya Stores",
    product: { id: "abc-123", name: "Fresh Mango" },
  });
  assert.deepEqual(payload, {
    title: "Fresh Mango · Priya Stores",
    text: "Available today at Priya Stores",
    url: "http://127.0.0.1:3100/store/priya-stores/p/abc-123",
  });
});

test("buildWhatsAppUrl: contains the encoded newline and the encoded URL exactly once each, and the URL is not double-encoded", () => {
  const payload = buildSharePayload({
    origin: "http://127.0.0.1:3100",
    slug: "priya-stores",
    shopName: "Priya Stores",
  });
  const waUrl = buildWhatsAppUrl(payload);

  assert.ok(waUrl.startsWith("https://wa.me/?text="));

  const encodedNewline = "%0A";
  const encodedUrl = encodeURIComponent(payload.url);

  const newlineOccurrences = waUrl.split(encodedNewline).length - 1;
  assert.equal(newlineOccurrences, 1);

  const urlOccurrences = waUrl.split(encodedUrl).length - 1;
  assert.equal(urlOccurrences, 1);

  // Not double-encoded: encoding the already-encoded URL again would
  // produce a string containing "%25" (the encoded '%'), which must not
  // appear anywhere in the final link.
  assert.ok(!waUrl.includes("%25"));

  const decoded = decodeURIComponent(
    waUrl.slice("https://wa.me/?text=".length),
  );
  assert.equal(decoded, `${payload.title}\n${payload.url}`);
});
