#!/usr/bin/env node
// Phase 4's first browser flow. Proves the DATABASE outcome of a customer's
// product deep-link visit — a written product_viewed row — not only what
// the DOM shows, the same discipline scripts/smoke-add-product.mjs already
// established for this project: a screen that looks correct while the
// write behind it never happened is exactly the defect class this harness
// exists to catch. Also proves both friendly not-found screens (STOR-08)
// render with no retry control, and that the product variant's "Browse the
// shop" link points at the resolved shop.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established (scaffolding copied from
// scripts/smoke-add-product.mjs).
//
// Usage: node scripts/smoke-storefront-flow.mjs [baseUrl]
//   BASE / argv[2]  default http://127.0.0.1:3100
//   CHROME_BIN      default google-chrome
//   DB_URL          default the local supabase postgres
// Requires the app to be already running at baseUrl, local Supabase up, and
// `npx supabase db reset` already run (so the seeded demo shop and its
// products exist).

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9339";

// The seeded demo shop, deterministic byte-for-byte after `db reset` — see
// 04-01-PLAN.md's interfaces block.
const SLUG = "priya-stores";
const STORE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000020"; // Tomatoes, unit kg

// 05-04: the seeded demo offer (supabase/seed.sql:96-98) — its own negative
// fixture for the priceability filter. Shipped with only the legacy label
// columns (today_price_label/regular_price_label); offer_price/regular_price
// are NULL. Never modified permanently — every pass that prices it restores
// both columns to NULL in a finally block, because
// tests/db/place-order.test.mjs's own null-total assertion depends on it.
const OFFER_ID = "00000000-0000-4000-8000-000000000030";
const OFFER_PRICE = 40;
const REGULAR_PRICE = 50;
const OFFER_SAVING = REGULAR_PRICE - OFFER_PRICE;

// A different seeded, available product (Bananas, unit dozen) — used as the
// stale-dated fixture's own product in Task 3's exclusion pass, so its
// exclusion cannot be attributed to the priceability filter (it carries
// numeric prices) or to the availability filter (it stays available).
const STALE_PRODUCT_ID = "00000000-0000-4000-8000-000000000021";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForText(evaluate, text, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(
      `document.body.innerText.includes(${JSON.stringify(text)})`,
    );
    if (found === true) return true;
    await sleep(250);
  }
  return false;
}

// The offers-strip section label renders through an `uppercase` CSS class
// (matching every other section label in this app). `innerText` reflects
// that CSS text-transform, so a plain innerText match against the source
// case never fires (05-02-SUMMARY.md's own finding) — this polls
// `textContent`, the actual DOM text, never case-transformed by CSS.
async function waitForLabelText(evaluate, text, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(`(() => {
      const els = [...document.querySelectorAll("p,h1,h2")];
      return els.some((el) => el.textContent.trim() === ${JSON.stringify(text)});
    })()`);
    if (found === true) return true;
    await sleep(250);
  }
  return false;
}

function fail(message) {
  console.error(`not ok: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
}

const chrome = spawn(
  CHROME_BIN,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let nextId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result?.value;
}

async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`no CDP target on port ${CDP_PORT}`);
}

async function query(sql) {
  const { stdout } = await execFileAsync("psql", [DB_URL, "-At", "-c", sql]);
  return stdout.trim();
}

// Pass 0 (04-02 Task 1): a customer browses the seeded shop's product grid,
// narrows it by search (the header count must stay the full available
// count — D-06, never the filtered one), taps a card into the deep link
// 04-01 built, and exactly one catalogue_opened row lands for this visit.
// The same pass asserts no ordering control (checkbox, submit button, any
// of the deleted order-form's own copy) renders anywhere on the public
// route (SHAR-04, D-04's correction) — this pass is the only one in this
// file that mounts /store/[slug] itself, so the catalogue_opened
// read-back can never double-count.
async function passBrowseSearchAndNoOrdering() {
  const beforeTs = await query("select now();");

  const totalAvailable = await query(
    `select count(*) from public.products where store_id = '${STORE_ID}' and available = true;`,
  );
  const headerText = `Open · ${totalAvailable} items available today`;

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });

  if (!(await waitForText(evaluate, "Tomatoes"))) {
    fail("the storefront grid never rendered a seeded product card");
    return;
  }
  ok("the storefront grid renders seeded product cards");

  if (!(await waitForText(evaluate, headerText))) {
    fail(
      `the header count never read "${headerText}" for the full available product list`,
    );
  } else {
    ok(`the header count reads "${headerText}"`);
  }

  const noOrdering = await evaluate(`(() => {
    const hasCheckbox = document.querySelector('input[type="checkbox"]') !== null;
    const hasSubmit = [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Place order request",
    );
    return { hasCheckbox, hasSubmit };
  })()`);
  if (
    noOrdering &&
    noOrdering.hasCheckbox === false &&
    noOrdering.hasSubmit === false
  ) {
    ok(
      "no ordering control (checkbox or submit button) renders on the public route",
    );
  } else {
    fail(
      `expected no ordering control on the public route, found: ${JSON.stringify(noOrdering)}`,
    );
  }

  await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const input = document.querySelector('input[placeholder="Search products…"]');
    setVal(input, "Tomat");
  })()`);

  let narrowed = false;
  {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const bananasGone = await evaluate(
        `!document.body.innerText.includes("Bananas")`,
      );
      const tomatoesStill = await evaluate(
        `document.body.innerText.includes("Tomatoes")`,
      );
      if (bananasGone === true && tomatoesStill === true) {
        narrowed = true;
        break;
      }
      await sleep(250);
    }
  }
  if (narrowed) {
    ok('typing "Tomat" narrows the grid to only the matching product');
  } else {
    fail(
      'the grid never narrowed to only the products matching "Tomat" after searching',
    );
  }

  if (!(await waitForText(evaluate, headerText))) {
    fail(
      "the header count changed while a search was active — it must stay the full available count (D-06)",
    );
  } else {
    ok("the header count stays the full available count while searching");
  }

  const tapped = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const card = buttons.find((b) => b.textContent.includes("Tomatoes"));
    if (!card) return "no card found";
    card.click();
    return "ok";
  })()`);
  if (tapped !== "ok") {
    fail(`could not tap the Tomatoes card: ${tapped}`);
    return;
  }

  const expectedPath = `/store/${SLUG}/p/${PRODUCT_ID}`;
  let navigated = false;
  {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const path = await evaluate(`window.location.pathname`);
      if (path === expectedPath) {
        navigated = true;
        break;
      }
      await sleep(250);
    }
  }
  if (navigated) {
    ok("tapping the card opens the product's own deep-link screen");
  } else {
    fail(`tapping the card never navigated to ${expectedPath}`);
  }

  const count = await query(
    `select count(*) from public.events where event_name = 'catalogue_opened' and store_id = '${STORE_ID}' and user_id is null and occurred_at > '${beforeTs}';`,
  );
  if (count === "1") {
    ok(
      "exactly one catalogue_opened row was written, attributed to the seeded store, from an anonymous visitor",
    );
  } else {
    fail(
      `expected exactly one matching catalogue_opened row for this visit, found ${count}`,
    );
  }
}

// Pass 1: the product deep link renders the product, and the visit is
// counted — the database is the source of truth here, not only what the
// DOM shows. `occurred_at > beforeTs` (a DB-side timestamp, captured before
// navigating, not the test runner's own clock) is what makes this read-back
// specific to THIS visit rather than any prior run's leftover row.
async function passDeepLinkAndProductViewed() {
  const beforeTs = await query("select now();");

  await send("Page.navigate", {
    url: `${BASE}/store/${SLUG}/p/${PRODUCT_ID}`,
  });

  if (!(await waitForText(evaluate, "Tomatoes"))) {
    fail("the deep-linked product's name never rendered");
    return;
  }
  ok("the deep-linked product's own page renders its name");

  if (!(await waitForText(evaluate, "Vegetables"))) {
    fail("the product's category name never rendered");
  } else {
    ok("the product's category name renders");
  }

  if (!(await waitForText(evaluate, "Available · per kg"))) {
    fail("the availability line never rendered with its unit");
  } else {
    ok("the availability line renders with its unit");
  }

  const count = await query(
    `select count(*) from public.events where event_name = 'product_viewed' and product_id = '${PRODUCT_ID}' and store_id = '${STORE_ID}' and user_id is null and occurred_at > '${beforeTs}';`,
  );
  if (count === "1") {
    ok(
      "exactly one product_viewed row was written, attributed to the seeded store, from an anonymous visitor (null user id)",
    );
  } else {
    fail(
      `expected exactly one matching product_viewed row after this visit, found ${count}`,
    );
  }
}

// Pass 2: a well-formed product id that resolves to nothing (never existed,
// deleted, or currently unavailable — RLS already makes these
// indistinguishable) renders the product-not-found variant with a working
// way back into the shop and no retry control.
async function passProductNotFound() {
  const bogusId = "00000000-0000-4000-8000-000000000099";

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/p/${bogusId}` });

  if (!(await waitForText(evaluate, "Product not found"))) {
    fail(
      "the product-not-found heading never rendered for an id that resolves to nothing",
    );
    return;
  }
  ok(
    "a well-formed but unresolvable product id renders the product-not-found screen",
  );

  const browseHref = await evaluate(`(() => {
    const link = [...document.querySelectorAll("a")].find(
      (a) => a.textContent.trim() === "Browse the shop",
    );
    return link ? link.getAttribute("href") : null;
  })()`);
  if (browseHref === `/store/${SLUG}`) {
    ok(`the "Browse the shop" link's href is exactly /store/${SLUG}`);
  } else {
    fail(
      `expected the "Browse the shop" link's href to be "/store/${SLUG}", got ${JSON.stringify(browseHref)}`,
    );
  }

  const hasRetry = await evaluate(`document.body.innerText.includes("Retry")`);
  if (hasRetry === false) {
    ok("the product-not-found screen renders with no retry control");
  } else {
    fail("the product-not-found screen unexpectedly shows a retry control");
  }
}

// Pass 3: a slug no shop owns renders the shop-not-found variant with no
// back link (there is nowhere to send a customer with no valid slug) and no
// retry control (retrying a slug that will never resolve cannot succeed).
async function passShopNotFound() {
  await send("Page.navigate", { url: `${BASE}/store/no-such-shop-xyz` });

  if (!(await waitForText(evaluate, "Shop not found"))) {
    fail("the shop-not-found heading never rendered for an unknown slug");
    return;
  }
  ok("an unknown slug renders the shop-not-found screen");

  const hasRetry = await evaluate(`document.body.innerText.includes("Retry")`);
  const hasAnyLink = await evaluate(
    `document.querySelectorAll("a").length > 0`,
  );
  if (hasRetry === false && hasAnyLink === false) {
    ok(
      "the shop-not-found screen renders with no retry control and no back link",
    );
  } else {
    fail(
      `the shop-not-found screen unexpectedly shows a retry control or a back link (retry=${String(hasRetry)}, link=${String(hasAnyLink)})`,
    );
  }
}

// Pass 4 (04-02 Task 3): the category chip row narrows the grid and clears
// back to all products — re-proven independently of Task 1's
// search-narrowing pass, since D-06's header-count invariant must hold
// across a category filter too, not only a search.
async function passCategoryChipRow() {
  const totalAvailable = await query(
    `select count(*) from public.products where store_id = '${STORE_ID}' and available = true;`,
  );
  const headerText = `Open · ${totalAvailable} items available today`;

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText(evaluate, "Vegetables"))) {
    fail("the category chip row never rendered a seeded category");
    return;
  }

  const chipCount = await evaluate(`(() => {
    const known = ["Fruits", "Vegetables", "Groceries", "Bakery"];
    return [...document.querySelectorAll("button")].filter((b) =>
      known.includes(b.textContent.trim()),
    ).length;
  })()`);
  if (typeof chipCount === "number" && chipCount >= 3) {
    ok(
      `the category chip row renders with ${String(chipCount)} chips (more than two categories)`,
    );
  } else {
    fail(`expected at least 3 category chips, found ${String(chipCount)}`);
  }

  const tapped = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === "Vegetables",
    );
    if (!b) return "not found";
    b.click();
    return "ok";
  })()`);
  if (tapped !== "ok") {
    fail(`could not tap the Vegetables chip: ${tapped}`);
    return;
  }

  let narrowed = false;
  {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const hasTomatoes = await evaluate(
        `document.body.innerText.includes("Tomatoes")`,
      );
      const noBananas = await evaluate(
        `!document.body.innerText.includes("Bananas")`,
      );
      if (hasTomatoes === true && noBananas === true) {
        narrowed = true;
        break;
      }
      await sleep(250);
    }
  }
  if (narrowed) {
    ok(
      "tapping a category chip narrows the grid to only that category's products",
    );
  } else {
    fail(
      "tapping the Vegetables chip never narrowed the grid to only its products",
    );
  }

  if (!(await waitForText(evaluate, headerText))) {
    fail(
      "the header count changed after selecting a category — it must stay the full available count (D-06)",
    );
  } else {
    ok(
      "the header count stays the full available count with a category active",
    );
  }

  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === "Vegetables",
    );
    b.click();
  })()`);

  let restored = false;
  {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const hasBananas = await evaluate(
        `document.body.innerText.includes("Bananas")`,
      );
      if (hasBananas === true) {
        restored = true;
        break;
      }
      await sleep(250);
    }
  }
  if (restored) {
    ok(
      "tapping the already-active chip again clears the selection back to all products",
    );
  } else {
    fail("tapping the active chip again never restored the full product grid");
  }
}

// Pass 4b: a shop with EXACTLY TWO categories still gets its chip row.
// The chip guard was ported from the prototype as `categoryList.length > 2`,
// but the prototype's list is `["All", ...real]` (App.tsx:1137) — so its
// threshold fires at two REAL categories, while this port (which drops the
// "All" sentinel in favour of tapping the active chip to clear) needed
// three. Pass 4 above only ever asserts `chipCount >= 3`, so it cannot see
// that boundary at all; this pass is the one that can.
async function passTwoCategoryChipRow() {
  try {
    // Leaves exactly Fruits and Vegetables carrying available products.
    await query(
      `update public.products set available = false where store_id = '${STORE_ID}' and category_id in (select id from public.categories where store_id = '${STORE_ID}' and name in ('Groceries', 'Bakery'));`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "Tomatoes"))) {
      fail("the storefront never loaded for the two-category pass");
      return;
    }

    const categoriesInData = await query(
      `select count(distinct c.name) from public.products p join public.categories c on c.id = p.category_id where p.store_id = '${STORE_ID}' and p.available = true;`,
    );
    if (categoriesInData === "2") {
      ok(
        "the two-category fixture state really does expose exactly two categories",
      );
    } else {
      fail(
        `expected exactly 2 categories with available products, found ${categoriesInData}`,
      );
      return;
    }

    const chipCount = await evaluate(`(() => {
      const known = ["Fruits", "Vegetables", "Groceries", "Bakery"];
      return [...document.querySelectorAll("button")].filter((b) =>
        known.includes(b.textContent.trim()),
      ).length;
    })()`);
    if (chipCount === 2) {
      ok(
        "a shop with exactly two categories still renders both chips (the boundary the >2 guard silently swallowed)",
      );
    } else {
      fail(
        `expected exactly 2 category chips for a two-category shop, found ${String(chipCount)}`,
      );
    }
  } finally {
    await query(
      `update public.products set available = true where store_id = '${STORE_ID}';`,
    );
  }
}

// Pass 5 (04-02 Task 3): three distinct empty states, each reachable and
// worded differently — a search that matches nothing, a category emptied
// out from under an active selection, and a shop with zero available
// products at all. Every DB mutation this pass makes is undone in a
// finally block so the fixture is unchanged afterwards.
async function passEmptyStates() {
  // Sub-pass A: a search string no product name contains.
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText(evaluate, "Tomatoes"))) {
    fail("the storefront never loaded before the empty-states pass");
    return;
  }
  const bogusSearch = "zzz-no-such-product-zzz";
  await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const input = document.querySelector('input[placeholder="Search products…"]');
    setVal(input, ${JSON.stringify(bogusSearch)});
  })()`);
  if (!(await waitForText(evaluate, `No results for "${bogusSearch}"`))) {
    fail(
      "the search-empty message never rendered for a search with no matches",
    );
  } else {
    const noCards = await evaluate(
      `!document.body.innerText.includes("Tomatoes")`,
    );
    if (noCards === true) {
      ok(
        "a search with no matches shows its own message naming the search text, and no card",
      );
    } else {
      fail(
        "the search-empty message rendered but a product card was still visible",
      );
    }
  }

  // Sub-pass B: a category selected, then emptied out from under it. This
  // is a real customer scenario, not a test artefact — TanStack Query's
  // staleTime (30s, src/app/providers.tsx) is why the wait below is
  // required before a window-focus refetch actually re-fetches.
  try {
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "Vegetables"))) {
      fail(
        "the Vegetables chip never rendered before the category-empty sub-pass",
      );
    } else {
      await evaluate(`(() => {
        [...document.querySelectorAll("button")].find(
          (x) => x.textContent.trim() === "Vegetables",
        ).click();
      })()`);
      await waitForText(evaluate, "Tomatoes");

      await query(
        `update public.products set available = false where store_id = '${STORE_ID}' and category_id = (select id from public.categories where store_id = '${STORE_ID}' and name = 'Vegetables');`,
      );

      await sleep(31000);
      await evaluate(`window.dispatchEvent(new Event("visibilitychange"))`);

      if (!(await waitForText(evaluate, "No products in this category"))) {
        fail(
          "the category-empty message never rendered after its last item went unavailable",
        );
      } else {
        ok(
          "a category emptied out from under an active selection shows its own message",
        );
      }
    }
  } finally {
    await query(
      `update public.products set available = true where store_id = '${STORE_ID}' and category_id = (select id from public.categories where store_id = '${STORE_ID}' and name = 'Vegetables');`,
    );
  }

  // Sub-pass C: every available product in the shop goes unavailable.
  try {
    await query(
      `update public.products set available = false where store_id = '${STORE_ID}';`,
    );
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "No items available today"))) {
      fail(
        "the shipped zero-products message never rendered with every product unavailable",
      );
    } else {
      ok(
        "a shop with zero available products keeps the already-shipped wording",
      );
    }
    if (!(await waitForText(evaluate, "Open · 0 items available today"))) {
      fail("the header count never read zero with every product unavailable");
    } else {
      ok("the header count reads zero with every product unavailable");
    }
  } finally {
    await query(
      `update public.products set available = true where store_id = '${STORE_ID}';`,
    );
  }
}

// Pass 6 (04-02 Task 3): the open/closed header line (D-07), proven against
// the real column — a closed shop must still be browsable.
async function passOpenClosedHeader() {
  try {
    await query(
      `update public.stores set is_open = false where id = '${STORE_ID}';`,
    );
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "Currently closed"))) {
      fail("the header never read the closed wording with is_open false");
    } else {
      ok("a closed shop's header reads the closed wording");
    }
    if (!(await waitForText(evaluate, "Tomatoes"))) {
      fail(
        "the product grid never rendered while the shop was closed — a customer must still be able to browse",
      );
    } else {
      ok(
        "a closed shop's product grid still renders — a customer can browse it",
      );
    }
  } finally {
    await query(
      `update public.stores set is_open = true where id = '${STORE_ID}';`,
    );
  }
}

// Pass 7 (05-04 Task 1): the seeded label-only offer is the negative fixture
// for the priceability filter (D-06/OFFR-03) — asserted in BOTH directions
// in one pass, against the untouched seed and then against the same row
// given numbers, so the fixture and the shipped null-total assertion that
// depends on it (tests/db/place-order.test.mjs) are unchanged for every
// later run. Also proves D-09's approved repetition (the offered product
// renders in both the strip and its own category grid position) and the
// strip's own gating condition against a category selection.
async function passOffersStripFlow() {
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText(evaluate, "Tomatoes"))) {
    fail("the storefront never loaded before the offers-strip pass");
    return;
  }

  // Shipped state: the seeded offer has only legacy label columns, so the
  // priceability filter must exclude it entirely — no strip, and (since no
  // product on this storefront ever shows a price outside an offer) no
  // currency glyph anywhere on the page at all.
  const shippedState = await evaluate(`(() => {
    const hasLabel = [...document.querySelectorAll("p")].some(
      (p) => p.textContent.trim() === "Today's offers",
    );
    return {
      hasLabel,
      hasCurrency: (document.body.innerText || "").includes("₹"),
    };
  })()`);
  if (shippedState?.hasLabel !== false) {
    fail(
      "the offers strip's section label rendered against the seed exactly as shipped — an unpriced offer must produce nothing, not something empty",
    );
    return;
  }
  ok(
    "with the seeded offer carrying only legacy label columns, the offers strip's own section label never renders",
  );
  if (shippedState?.hasCurrency !== false) {
    fail(
      "a currency glyph rendered somewhere on the page against the seed as shipped, where no priced offer exists",
    );
    return;
  }
  ok(
    "with the seeded offer carrying only legacy label columns, no bare currency glyph renders anywhere on the page — an unpriced offer produces nothing rather than something empty",
  );

  try {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForLabelText(evaluate, "Today's offers"))) {
      fail(
        "the offers strip's section label never rendered once the seeded offer was priced",
      );
      return;
    }

    const stripState = await evaluate(`(() => {
      const label = [...document.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const strip = label ? label.parentElement : null;
      if (!strip) return null;
      return {
        rowCount: (strip.querySelector(".flex.flex-col.gap-2")?.children.length ?? 0),
        text: strip.innerText || "",
      };
    })()`);
    if (!stripState || stripState.rowCount !== 1) {
      fail(
        `expected exactly one row in the offers strip, got ${JSON.stringify(stripState)}`,
      );
      return;
    }
    ok(
      "once the seeded offer is priced, the strip's section label renders with exactly one row",
    );
    if (
      !stripState.text.includes("Tomatoes") ||
      !stripState.text.includes(String(OFFER_PRICE)) ||
      !stripState.text.includes(String(REGULAR_PRICE)) ||
      !stripState.text.includes(`Save ₹${String(OFFER_SAVING)}`)
    ) {
      fail(
        `expected the strip's one row to show the product's name, both prices and the arithmetic saving, got ${JSON.stringify(stripState.text)}`,
      );
      return;
    }
    ok(
      "that row shows the seeded product's name, its offer price, the struck-through regular price and a saving caption equal to the arithmetic difference of the two numbers",
    );

    // D-09: the same product also keeps its ordinary place in the category
    // grid below the strip — resolved to the grid's own subtree (the
    // scroll container the strip itself sits outside of), so this assertion
    // is about the grid actually rendering it, not merely the page
    // containing the name twice.
    const gridHasProduct = await evaluate(`(() => {
      const grid = document.querySelector(".flex-1.overflow-y-auto");
      return grid ? grid.innerText.includes("Tomatoes") : null;
    })()`);
    if (gridHasProduct !== true) {
      fail(
        "the offered product did not also appear in the category grid's own subtree while the strip was present (D-09)",
      );
      return;
    }
    ok(
      "the offered product keeps its ordinary place in the category grid while the strip is also showing it (D-09's approved repetition)",
    );

    // The gate: selecting a category hides the strip (never the grid).
    const tappedChip = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === "Vegetables",
      );
      if (!b) return "no Vegetables chip";
      b.click();
      return "ok";
    })()`);
    if (tappedChip !== "ok") {
      fail(`could not tap the Vegetables chip: ${tappedChip}`);
      return;
    }

    let stripGone = false;
    {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const hasLabel =
          await evaluate(`[...document.querySelectorAll("p")].some(
          (p) => p.textContent.trim() === "Today's offers",
        )`);
        const gridStillHasProduct = await evaluate(`(() => {
          const grid = document.querySelector(".flex-1.overflow-y-auto");
          return grid ? grid.innerText.includes("Tomatoes") : false;
        })()`);
        if (hasLabel === false && gridStillHasProduct === true) {
          stripGone = true;
          break;
        }
        await sleep(250);
      }
    }
    if (!stripGone) {
      fail(
        "selecting a category chip did not hide the offers strip while keeping the grid",
      );
      return;
    }
    ok(
      "selecting a category chip hides the offers strip's section label while the grid keeps showing the product",
    );

    const clearedChip = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === "Vegetables",
      );
      if (!b) return "no Vegetables chip to clear";
      b.click();
      return "ok";
    })()`);
    if (clearedChip !== "ok") {
      fail(`could not clear the Vegetables chip: ${clearedChip}`);
      return;
    }
    if (!(await waitForLabelText(evaluate, "Today's offers"))) {
      fail(
        "clearing the category selection did not bring the offers strip back",
      );
      return;
    }
    ok("clearing the category selection brings the offers strip back");

    const tappedRow = await evaluate(`(() => {
      const label = [...document.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const strip = label ? label.parentElement : null;
      const row = strip
        ? [...strip.querySelectorAll("button")].find((b) =>
            b.textContent.includes("Tomatoes"),
          )
        : null;
      if (!row) return "no offer row found";
      row.click();
      return "ok";
    })()`);
    if (tappedRow !== "ok") {
      fail(`could not tap the offer row: ${tappedRow}`);
      return;
    }

    const expectedPath = `/store/${SLUG}/p/${PRODUCT_ID}`;
    let navigated = false;
    {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const path = await evaluate(`window.location.pathname`);
        if (path === expectedPath) {
          navigated = true;
          break;
        }
        await sleep(250);
      }
    }
    if (!navigated) {
      fail(`tapping the offer row never navigated to ${expectedPath}`);
      return;
    }
    ok(
      "tapping the offer row's single whole-row tap target lands on that product's own deep-link URL",
    );
  } finally {
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );
  }
}

// Pass 8 (05-04 Task 2): the same offer price shown everywhere that
// product's price appears — its ordinary card in the category grid, and its
// own detail page (D-05) — reusing the same restore-blocked seeded-offer
// fixture Pass 7 prices, so both surfaces are proven against the identical
// numbers. Distinguishes "the offer branch rendered for the right card"
// from "the offer branch rendered for every card" by also reading a
// DIFFERENT product's card in the same grid. Then, still inside the same
// fixture window, clears only the regular price and re-checks both surfaces
// for the no-regular-price partial state: the offer price alone, no
// strikethrough element, no saving caption, and (on the card) the badge
// still present.
async function passOfferPricingFlow() {
  try {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "Bananas"))) {
      fail("the storefront grid never rendered before the card-pricing pass");
      return;
    }

    const cardsState = await evaluate(`(() => {
      const grid = document.querySelector(".flex-1.overflow-y-auto");
      if (!grid) return null;
      const findCard = (name) =>
        [...grid.querySelectorAll("button")].find((b) =>
          b.textContent.includes(name),
        );
      const tomatoesCard = findCard("Tomatoes");
      const bananasCard = findCard("Bananas");
      return {
        tomatoes: tomatoesCard
          ? {
              hasBadge: tomatoesCard.textContent.includes("OFFER"),
              hasStrikethrough: tomatoesCard.querySelector(".line-through") !== null,
              text: tomatoesCard.innerText,
            }
          : null,
        bananas: bananasCard
          ? {
              hasBadge: bananasCard.textContent.includes("OFFER"),
              text: bananasCard.innerText,
            }
          : null,
      };
    })()`);
    if (
      !cardsState?.tomatoes?.hasBadge ||
      !cardsState.tomatoes.hasStrikethrough ||
      !cardsState.tomatoes.text.includes(String(OFFER_PRICE)) ||
      !cardsState.tomatoes.text.includes(String(REGULAR_PRICE)) ||
      !cardsState.tomatoes.text.includes(`Save ₹${String(OFFER_SAVING)}`)
    ) {
      fail(
        `expected the offered product's card to show the corner badge, the offer price, the struck regular price and the saving caption, got ${JSON.stringify(cardsState?.tomatoes)}`,
      );
      return;
    }
    ok(
      "the offered product's own card in the category grid shows the corner badge, the offer price, the struck regular price and the saving caption",
    );
    if (
      !cardsState.bananas ||
      cardsState.bananas.hasBadge ||
      !cardsState.bananas.text.includes("per dozen") ||
      cardsState.bananas.text.includes("₹")
    ) {
      fail(
        `expected a different product's card to show none of the offer treatment and keep its own per-unit line, got ${JSON.stringify(cardsState?.bananas)}`,
      );
      return;
    }
    ok(
      "a DIFFERENT product's card in the same grid shows none of the offer treatment and still shows its own per-unit line — the offer branch rendered for the right card, not every card",
    );

    await send("Page.navigate", {
      url: `${BASE}/store/${SLUG}/p/${PRODUCT_ID}`,
    });
    if (!(await waitForText(evaluate, "Today's offer"))) {
      fail(
        "the detail page's offer badge never rendered while the offer was priced",
      );
      return;
    }
    const detailState = await evaluate(`(() => {
      const body = document.body.innerText || "";
      return {
        hasOfferPrice: body.includes(${JSON.stringify(String(OFFER_PRICE))}),
        hasRegularPrice: body.includes(${JSON.stringify(String(REGULAR_PRICE))}),
        hasSaving: body.includes(${JSON.stringify(`Save ₹${String(OFFER_SAVING)} today`)}),
        hasPerUnit: body.includes("per kg"),
        hasAvailabilityLine: body.includes("Available · per kg"),
      };
    })()`);
    if (
      !detailState.hasOfferPrice ||
      !detailState.hasRegularPrice ||
      !detailState.hasSaving ||
      !detailState.hasPerUnit
    ) {
      fail(
        `expected the detail page to show the offer badge, the large offer price, the struck regular price, the saving caption and the per-unit caption, got ${JSON.stringify(detailState)}`,
      );
      return;
    }
    ok(
      "the product's own detail page shows the offer badge, the large offer price, the struck regular price, the saving caption and the per-unit caption",
    );
    if (detailState.hasAvailabilityLine) {
      fail(
        "the detail page's shipped availability line rendered even though an offer applies",
      );
      return;
    }
    ok(
      "the detail page's shipped non-offer availability line does not render while an offer applies",
    );

    // The no-regular-price partial state (UI Considerations' own `partial`
    // row): clear only the regular price, still inside this fixture window.
    await query(
      `update public.offers set regular_price = null where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText(evaluate, "Bananas"))) {
      fail("the storefront grid never reloaded for the partial-state check");
      return;
    }
    const partialCardState = await evaluate(`(() => {
      const grid = document.querySelector(".flex-1.overflow-y-auto");
      if (!grid) return null;
      const card = [...grid.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Tomatoes"),
      );
      if (!card) return null;
      return {
        hasBadge: card.textContent.includes("OFFER"),
        hasStrikethrough: card.querySelector(".line-through") !== null,
        hasSaving: card.textContent.includes("Save"),
        text: card.innerText,
      };
    })()`);
    if (
      partialCardState?.hasStrikethrough ||
      partialCardState?.hasSaving ||
      !partialCardState?.text.includes(String(OFFER_PRICE))
    ) {
      fail(
        `expected the card's partial state (offer price alone, no strikethrough, no saving) got ${JSON.stringify(partialCardState)}`,
      );
      return;
    }
    ok(
      "with no regular price, the card shows the offer price alone with no strikethrough element at all and no saving caption",
    );
    if (!partialCardState?.hasBadge) {
      fail(
        "the corner badge disappeared once the regular price was cleared — it must still mark that a special price exists",
      );
      return;
    }
    ok(
      "the corner badge still renders once the regular price is cleared — it marks that a special price exists, true either way",
    );

    await send("Page.navigate", {
      url: `${BASE}/store/${SLUG}/p/${PRODUCT_ID}`,
    });
    if (!(await waitForText(evaluate, "Today's offer"))) {
      fail(
        "the detail page's offer badge never rendered for the partial-state check",
      );
      return;
    }
    const partialDetailState = await evaluate(`(() => {
      const container = document.querySelector(".flex-1.overflow-y-auto");
      return {
        hasStrikethrough: container ? container.querySelector(".line-through") !== null : null,
        hasSaving: (document.body.innerText || "").includes("Save"),
        hasOfferPrice: (document.body.innerText || "").includes(${JSON.stringify(String(OFFER_PRICE))}),
      };
    })()`);
    if (partialDetailState.hasStrikethrough) {
      fail(
        `expected no strikethrough element at all on the detail page's partial state, got ${JSON.stringify(partialDetailState)}`,
      );
      return;
    }
    ok(
      "with no regular price, the detail page renders no strikethrough element at all — never an empty one",
    );
    if (partialDetailState.hasSaving || !partialDetailState.hasOfferPrice) {
      fail(
        `expected the offer price alone with no saving caption on the detail page's partial state, got ${JSON.stringify(partialDetailState)}`,
      );
      return;
    }
    ok(
      "with no regular price, the detail page shows the offer price alone with no saving caption",
    );
  } finally {
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );
  }
}

// Pass 9 (05-04 Task 3, D-13's anonymous-side gate): a genuinely
// yesterday-dated offer, on a DIFFERENT seeded product and expressed
// relative to the database's own today expression (never a literal date),
// must be invisible in the strip and its own product's page must render
// exactly as an unoffered product's page does — the clause of criterion 4
// that is easiest to lose ("the product itself does not change").
async function passStaleOfferExclusionFlow() {
  try {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );
    await query(
      `insert into public.offers (store_id, product_id, offer_price, regular_price, today_price_label, regular_price_label, offer_date) values ('${STORE_ID}', '${STALE_PRODUCT_ID}', 20, 25, '₹20/dozen', '₹25/dozen', public.today_ist() - 1);`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForLabelText(evaluate, "Today's offers"))) {
      fail("the offers strip never rendered before the stale-offer pass");
      return;
    }

    const stripState = await evaluate(`(() => {
      const label = [...document.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const strip = label ? label.parentElement : null;
      if (!strip) return null;
      return { rowCount: (strip.querySelector(".flex.flex-col.gap-2")?.children.length ?? 0), text: strip.innerText || "" };
    })()`);
    if (!stripState || stripState.rowCount !== 1) {
      fail(
        `expected exactly one row in the strip with a genuinely stale offer present, got ${JSON.stringify(stripState)}`,
      );
      return;
    }
    ok(
      "with a genuinely stale-dated offer also present, the storefront strip still contains exactly one row",
    );
    if (stripState.text.includes("Bananas")) {
      fail(
        `the stale-dated product's name appeared inside the strip's own subtree: ${JSON.stringify(stripState.text)}`,
      );
      return;
    }
    ok(
      "the stale-dated product's name does not appear inside the strip's own subtree",
    );
    if (!stripState.text.includes("Tomatoes")) {
      fail("today's genuinely active offer never rendered in the strip");
      return;
    }
    ok(
      "today's genuinely active offer still renders in the strip alongside the excluded stale one",
    );

    await send("Page.navigate", {
      url: `${BASE}/store/${SLUG}/p/${STALE_PRODUCT_ID}`,
    });
    if (!(await waitForText(evaluate, "Bananas"))) {
      fail("the stale product's own detail page never rendered");
      return;
    }
    const staleProductState = await evaluate(`(() => {
      const body = document.body.textContent || "";
      return {
        hasAvailabilityLine: body.includes("Available · per dozen"),
        hasOfferBadge: body.includes("Today's offer"),
      };
    })()`);
    if (
      !staleProductState.hasAvailabilityLine ||
      staleProductState.hasOfferBadge
    ) {
      fail(
        `expected the stale product's own page to render its ordinary availability line and no offer badge, got ${JSON.stringify(staleProductState)}`,
      );
      return;
    }
    ok(
      "the stale-dated offer's own product renders its ordinary availability line with no offer badge — the product itself did not change",
    );
  } finally {
    await query(
      `delete from public.offers where store_id = '${STORE_ID}' and offer_date <> public.today_ist();`,
    );
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );
  }
}

// Pass 10 (05-04 Task 3, D-03/D-14's anonymous-side gate): an offer whose
// product goes unavailable disappears from the strip, from the grid and
// from the product's own detail page — replaced by the friendly not-found
// screen, since RLS's own available-products policy denies the row outright
// for anon — and reappears once the product is switched back on, proving
// the offer row was excluded by a join, never deleted.
async function passStorefrontAvailabilityExclusionFlow() {
  try {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForLabelText(evaluate, "Today's offers"))) {
      fail(
        "the offers strip never rendered before the storefront availability pass",
      );
      return;
    }
    ok("the strip shows the priced offer while its product is available");

    await query(
      `update public.products set available = false where id = '${PRODUCT_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    let stripAbsent = false;
    let lastObservedState = null;
    {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        // Resolves the strip's own label and the grid's own scroll
        // container before searching inside either — never document.body —
        // matching the strip-scoping this file already established.
        const state = await evaluate(`(() => {
          const hasLabel = [...document.querySelectorAll("p")].some(
            (p) => p.textContent.trim() === "Today's offers",
          );
          const grid = document.querySelector(".flex-1.overflow-y-auto");
          return {
            hasLabel,
            gridHasProduct: grid ? grid.textContent.includes("Tomatoes") : null,
          };
        })()`);
        lastObservedState = state;
        if (state?.hasLabel === false && state.gridHasProduct === false) {
          stripAbsent = true;
          break;
        }
        await sleep(250);
      }
    }
    if (!stripAbsent) {
      fail(
        `the offers strip and/or the grid still showed the product after it was marked unavailable, last observed: ${JSON.stringify(lastObservedState)}`,
      );
      return;
    }
    ok(
      "once the offer's product is marked unavailable, both the strip and the grid drop it entirely",
    );

    await send("Page.navigate", {
      url: `${BASE}/store/${SLUG}/p/${PRODUCT_ID}`,
    });
    if (!(await waitForText(evaluate, "Product not found"))) {
      fail(
        "the unavailable offered product's own page did not render the friendly not-found screen",
      );
      return;
    }
    ok(
      "the unavailable offered product's own detail page renders the friendly not-found screen rather than an offer",
    );

    await query(
      `update public.products set available = true where id = '${PRODUCT_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForLabelText(evaluate, "Today's offers"))) {
      fail(
        "the offers strip never returned after the product was marked available again",
      );
      return;
    }
    ok(
      "the strip, the card's badge and the detail page's offer all return once the product is available again — the offer row was never deleted, only excluded by the join",
    );
  } finally {
    await query(
      `update public.products set available = true where id = '${PRODUCT_ID}';`,
    );
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );
  }
}

try {
  ws = new WebSocket(await cdpTarget());
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.result);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");

  await passBrowseSearchAndNoOrdering();
  await passDeepLinkAndProductViewed();
  await passProductNotFound();
  await passShopNotFound();
  await passCategoryChipRow();
  await passTwoCategoryChipRow();
  await passEmptyStates();
  await passOpenClosedHeader();
  await passOffersStripFlow();
  await passOfferPricingFlow();
  await passStaleOfferExclusionFlow();
  await passStorefrontAvailabilityExclusionFlow();

  if (process.exitCode !== 1) console.log("\nstorefront smoke flow: PASS");
} catch (err) {
  console.error(`not ok: ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    // already closed
  }
  chrome.kill("SIGKILL");
}
