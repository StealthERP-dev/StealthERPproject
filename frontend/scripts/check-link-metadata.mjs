#!/usr/bin/env node
// Raw-served-HTML link-preview metadata check (SHAR-05, D-01/D-02). Fetches
// each URL with Node's own fetch and reads res.text(): no browser, no
// JavaScript executed — exactly the position a chat app's crawler is in.
//
// Deliberately NOT scripts/smoke-dom.mjs: that tool renders the page in
// headless Chrome and dumps its markup only AFTER the page's own JavaScript
// has run (a post-hydration snapshot). A crawler never runs JavaScript, so a
// post-hydration assertion would prove nothing about what WhatsApp/Instagram
// actually receive. This script only ever reads the raw bytes the server
// sends, the same way `curl` would.
//
// Every expected value is read from the database through psql, never
// hardcoded — a hardcoded expectation would silently stop testing the route
// the moment the seed changes.
//
// Usage: node scripts/check-link-metadata.mjs [baseUrl]
//   BASE / argv[2]  default http://127.0.0.1:3100
//   DB_URL          default the local supabase postgres
//   SMOKE_SLUG      default priya-stores (the seeded demo shop)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const KNOWN_SLUG = process.env.SMOKE_SLUG ?? "priya-stores";
const UNKNOWN_SLUG = "no-such-shop-xyz";
const UNRESOLVABLE_PRODUCT_ID = "00000000-0000-4000-8000-000000000000";

let failed = false;

function fail(message) {
  console.error(`not ok: ${message}`);
  failed = true;
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
}

async function query(sql) {
  const { stdout } = await execFileAsync("psql", [DB_URL, "-At", "-c", sql]);
  return stdout.trim();
}

// A shop name containing an ampersand or an apostrophe arrives escaped in
// the served HTML — a raw string comparison against the un-escaped database
// value would fail on genuinely correct output.
function unescapeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function extractMetaContent(html, property) {
  // Next may emit either attribute order — match both.
  const patterns = [
    new RegExp(
      `<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["'][^>]*>`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return unescapeHtml(match[1]);
  }
  return null;
}

function hasAnyOgProperty(html) {
  return /<meta[^>]*property=["']og:/i.test(html);
}

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, html: text };
}

async function checkCatalogueKnownSlug() {
  const shopName = await query(
    `select shop_name from public.public_stores where slug = '${KNOWN_SLUG}';`,
  );
  if (!shopName) {
    fail(
      `could not read shop_name for slug '${KNOWN_SLUG}' from the database — is the seed loaded?`,
    );
    return { shopName: null };
  }
  const expectedDescription = `Available today at ${shopName}`;

  const firstPhotoProductImage = await query(
    `select p.image_url from public.products p
       join public.public_stores s on s.id = p.store_id
      where s.slug = '${KNOWN_SLUG}' and p.available = true and p.image_url is not null
      order by p.name limit 1;`,
  );

  const { status, html } = await fetchHtml(`/store/${KNOWN_SLUG}`);

  if (status === 200) {
    ok(`GET /store/${KNOWN_SLUG} returns 200`);
  } else {
    fail(`GET /store/${KNOWN_SLUG} returned ${status}, expected 200`);
  }

  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle === shopName) {
    ok(`og:title for the known slug is exactly "${shopName}"`);
  } else {
    fail(
      `og:title for the known slug expected "${shopName}", got ${JSON.stringify(ogTitle)}`,
    );
  }

  const ogDescription = extractMetaContent(html, "og:description");
  if (ogDescription === expectedDescription) {
    ok(`og:description for the known slug is exactly "${expectedDescription}"`);
  } else {
    fail(
      `og:description for the known slug expected "${expectedDescription}", got ${JSON.stringify(ogDescription)}`,
    );
  }

  const ogImage = extractMetaContent(html, "og:image");
  if (firstPhotoProductImage) {
    if (ogImage === firstPhotoProductImage) {
      ok(
        "og:image for the known slug is exactly the first available photo-carrying product's photo",
      );
    } else {
      fail(
        `og:image for the known slug expected "${firstPhotoProductImage}", got ${JSON.stringify(ogImage)}`,
      );
    }
  } else if (ogImage) {
    fail(
      `og:image present ("${ogImage}") but no available product with a photo was found in the database`,
    );
  } else {
    ok("og:image correctly omitted — no available product with a photo");
  }

  return { shopName };
}

async function checkCatalogueUnknownSlug(realShopName) {
  const { html } = await fetchHtml(`/store/${UNKNOWN_SLUG}`);

  if (!hasAnyOgProperty(html)) {
    ok("unknown slug carries no og-prefixed property at all");
  } else {
    fail("unknown slug unexpectedly carries an og-prefixed property");
  }

  if (realShopName && !html.includes(realShopName)) {
    ok(
      "unknown slug's response contains no occurrence of the real shop's name",
    );
  } else if (realShopName) {
    fail("unknown slug's response unexpectedly contains the real shop's name");
  }
}

async function checkProductKnown(shopName) {
  const productRow = await query(
    `select p.id, p.name, p.image_url from public.products p
       join public.public_stores s on s.id = p.store_id
      where s.slug = '${KNOWN_SLUG}' and p.available = true
      order by p.name limit 1;`,
  );
  const [productId, productName, productImage] = productRow.split("|");
  if (!productId || !productName) {
    fail(
      `could not read a known available product for slug '${KNOWN_SLUG}' from the database`,
    );
    return { productName: null };
  }

  const expectedTitle = `${productName} · ${shopName}`;
  const expectedDescription = `Available today at ${shopName}`;

  const { status, html } = await fetchHtml(
    `/store/${KNOWN_SLUG}/p/${productId}`,
  );

  if (status === 200) {
    ok(`GET /store/${KNOWN_SLUG}/p/${productId} returns 200`);
  } else {
    fail(
      `GET /store/${KNOWN_SLUG}/p/${productId} returned ${status}, expected 200`,
    );
  }

  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle === expectedTitle) {
    ok(`og:title for the known product is exactly "${expectedTitle}"`);
  } else {
    fail(
      `og:title for the known product expected "${expectedTitle}", got ${JSON.stringify(ogTitle)}`,
    );
  }

  const ogDescription = extractMetaContent(html, "og:description");
  if (ogDescription === expectedDescription) {
    ok(
      `og:description for the known product is exactly "${expectedDescription}"`,
    );
  } else {
    fail(
      `og:description for the known product expected "${expectedDescription}", got ${JSON.stringify(ogDescription)}`,
    );
  }

  const ogImage = extractMetaContent(html, "og:image");
  if (productImage) {
    if (ogImage === productImage) {
      ok("og:image for the known product is exactly that product's photo");
    } else {
      fail(
        `og:image for the known product expected "${productImage}", got ${JSON.stringify(ogImage)}`,
      );
    }
  } else if (ogImage) {
    fail(
      `og:image present ("${ogImage}") but the known product has no photo in the database`,
    );
  } else {
    ok("og:image correctly omitted — the known product has no photo");
  }

  return { productName };
}

async function checkProductUnresolvableId(shopName, realProductName) {
  const { html } = await fetchHtml(
    `/store/${KNOWN_SLUG}/p/${UNRESOLVABLE_PRODUCT_ID}`,
  );

  if (!hasAnyOgProperty(html)) {
    ok(
      "a well-formed but unresolvable product id under the valid slug carries no og-prefixed property",
    );
  } else {
    fail(
      "a well-formed but unresolvable product id under the valid slug unexpectedly carries an og-prefixed property",
    );
  }

  const leaked = Boolean(realProductName) && html.includes(realProductName);
  if (shopName && !html.includes(shopName) && !leaked) {
    ok(
      "unresolvable product id's response contains no occurrence of the real product's or shop's name",
    );
  } else {
    fail(
      "unresolvable product id's response unexpectedly contains the real product's or shop's name",
    );
  }
}

async function checkProductUnknownSlug() {
  const { html } = await fetchHtml(
    `/store/${UNKNOWN_SLUG}/p/${UNRESOLVABLE_PRODUCT_ID}`,
  );

  if (!hasAnyOgProperty(html)) {
    ok(
      "an unresolvable slug with any product id carries no og-prefixed property",
    );
  } else {
    fail(
      "an unresolvable slug with any product id unexpectedly carries an og-prefixed property",
    );
  }
}

async function main() {
  const { shopName } = await checkCatalogueKnownSlug();
  await checkCatalogueUnknownSlug(shopName);
  const { productName } = await checkProductKnown(shopName);
  await checkProductUnresolvableId(shopName, productName);
  await checkProductUnknownSlug();

  if (failed) {
    console.error("\ncheck-link-metadata: FAIL");
  } else {
    console.log("\ncheck-link-metadata: PASS");
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
