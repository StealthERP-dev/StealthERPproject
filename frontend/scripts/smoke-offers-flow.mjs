#!/usr/bin/env node
// Phase 5's own browser flow — the offer itself (OFFR-01, D-01, D-02, D-04,
// DATA-07). Drives a REAL vendor session through /offers/add in headless
// Chrome and asserts the DATABASE outcome of what happens there — the row,
// its price, its NOT NULL display label and its creation event — never only
// what the screen shows. This project has repeatedly shipped a screen that
// looked correct while the write behind it was wrong or missing; the two
// live-verified traps this phase's read hook guards against (D-13, D-14)
// are exactly that shape, invisible on a screen that renders correctly.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established (scaffolding copied from
// scripts/smoke-share-flow.mjs, fresh-vendor setup-and-seed pass adapted
// from its passSetupAndSeedShop).
//
// Usage: node scripts/smoke-offers-flow.mjs [baseUrl]
//   BASE / argv[2]  default http://127.0.0.1:3100
//   CHROME_BIN      default google-chrome
//   DB_URL          default the local supabase postgres
// Requires the app to be already running at baseUrl and local Supabase up.
// Debugging port 9341 — 9334-9340 are already claimed by sibling flows.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9341";

// A fresh number every run: one shop per mobile (BR1), so a reused number
// would take the duplicate path instead of the flow under test.
const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Smoke Offers Shop";
const PRODUCT_A = `Smoke Offer Product A ${String(Date.now())}`;
const PRODUCT_B = `Smoke Offer Product B ${String(Date.now())}`;
const PRODUCT_A_PRICE = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForInputs(minCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await evaluate(`document.querySelectorAll("input").length`);
    if (typeof n === "number" && n >= minCount) return true;
    await sleep(250);
  }
  return false;
}

async function waitForText(text, timeoutMs = 30000) {
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

async function waitForSelector(selector, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
    );
    if (found === true) return true;
    await sleep(250);
  }
  return false;
}

// The offers-card and offer-row section labels render through an
// `uppercase` CSS class (matching every other section label in this app) —
// `innerText` reflects that CSS text-transform, so a plain
// `innerText.includes("Today's offers")` check silently never matches
// (it would see "TODAY'S OFFERS"). This polls `textContent`, which is the
// actual DOM text and is never case-transformed by CSS.
async function waitForLabelText(text, timeoutMs = 30000) {
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

async function waitForPathname(path, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await evaluate("location.pathname")) === path) return true;
    await sleep(200);
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

// Installed once, before the FIRST Page.navigate of this script's run —
// exactly where scripts/smoke-share-flow.mjs installs its own identical
// script (04-RESEARCH.md Pattern 3), so every pass in THIS file, including
// 05-01's and 05-02's own passes above, runs with the recorders already in
// place. Additive and harmless there: none of those passes touches a share
// API, so nothing about their assertions' meaning changes — the injection
// only matters from this point in the file forward, where the offer share
// sheet's own passes read it. Replaces navigator.share,
// navigator.clipboard.writeText and window.open with in-page recorders, and
// probes (recording on window) whether the real native functions existed at
// this origin BEFORE being replaced, so the SUMMARY can state plainly which
// destinations were exercised only through the injected recorders. The
// clipboard object is CREATED if the origin does not already provide one —
// assigning straight through a missing object would throw before the app's
// own JS ever runs.
const SHARE_SPY_SCRIPT = `
(() => {
  window.__nativeShareExisted = typeof navigator.share === "function";
  window.__nativeClipboardExisted =
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.writeText === "function";
  window.__shareSpy = null;
  window.__clipboardSpy = null;
  window.__windowOpenSpy = null;

  navigator.share = (payload) => {
    window.__shareSpy = payload;
    return Promise.resolve();
  };

  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  navigator.clipboard.writeText = (text) => {
    window.__clipboardSpy = text;
    return Promise.resolve();
  };

  window.open = (url, target, features) => {
    window.__windowOpenSpy = { url, target, features };
    return null;
  };
})();
`;

// Two independent, off-by-default fault injections for this file's own
// required falsifiability gates (05-REVIEW.md WR-01, WR-02), both gated
// behind a `window` flag this script flips only for the duration of the one
// pass that needs it — every other pass in this file runs with both flags
// false, so this injection is additive and harmless everywhere else, the
// same discipline SHARE_SPY_SCRIPT above already established. Registered
// once, before the first Page.navigate, alongside SHARE_SPY_SCRIPT — a
// monkey-patched `window.fetch` survives every later client-side navigation
// within the same document (this app's own supabase-js client calls the
// page's own global `fetch`, never a bundled copy), which is exactly the
// property WR-01's own cross-screen repro depends on: the patch must still
// be in effect after a client-side tap on the BottomNav's Home link, not
// just on the /offers document it was installed on.
//   - `__delayOfferDelete`: WR-01's gate. Holds a DELETE to /rest/v1/offers
//     open for 3s instead of forwarding it immediately — long enough that
//     an ordinary, un-delayed client-side tap on the Home nav link (no
//     sleep, no artificial timing) lands well inside the window before
//     onSettled's own invalidate can ever resolve, so the repro is
//     deterministic rather than a race against a fast localhost round trip.
//   - `__forceProductsError`: WR-02's gate. Makes any GET to
//     /rest/v1/products resolve as a 500 instead of reaching the real
//     Supabase — a genuine fetch failure, distinguishable from a genuinely
//     empty catalogue (which this flag never touches). Its own pass sets
//     this one BEFORE a full Page.navigate (it needs the fault active from
//     the very first mount of the Add offer screen, unlike WR-01's flag,
//     which only ever needs to survive a client-side transition within the
//     SAME document). A plain `window` property does not survive a full
//     navigation — the browser tears down the whole JS realm — so this one
//     initializes itself from `localStorage` (origin-scoped, survives a
//     full reload) instead, and the pass writes to localStorage, not the
//     window property directly, before it navigates.
const FAULT_INJECTION_SCRIPT = `
(() => {
  window.__delayOfferDelete = false;
  window.__forceProductsError = localStorage.getItem("gsdForceProductsError") === "1";
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (window.__delayOfferDelete && url.includes("/rest/v1/offers") && method === "DELETE") {
      return new Promise((resolve) => {
        setTimeout(() => resolve(realFetch(input, init)), 3000);
      });
    }
    if (window.__forceProductsError && url.includes("/rest/v1/products") && method === "GET") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "forced failure for WR-02's own falsifiability gate" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return realFetch(input, init);
  };
})();
`;

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

// Polls rather than reading once: offer_created fires fire-and-forget from
// inside the already-resolved mutation body, so the event row can land a
// tick after the DOM assertions and the offers-row read already passed.
async function pollQuery(sql, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await query(sql);
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

function setInputValue(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return "no element for ${selector}";
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`;
}

// Preparation pass: sign up a fresh vendor through the setup form (one shop
// per mobile — a reused number would hit the duplicate path instead of the
// flow under test), land on Home, read the new store's id back through
// psql, and seed two AVAILABLE products directly through psql — one with a
// known stored price (D-04's pre-fill source), one without — so the picker
// has two rows to list and the pre-fill assertion has a real number to
// check against.
async function passSetupAndSeedShop() {
  await send("Page.navigate", { url: `${BASE}/setup` });
  if (!(await waitForInputs(4))) {
    fail("setup form never became interactive (inputs never appeared)");
    return {};
  }

  const filled = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll("input")];
    const byId = (frag) => inputs.find((i) => (i.id || "").includes(frag));
    const phoneEl = byId("phone"), shopEl = byId("shop"),
          nameEl = byId("vendor"), pinEl = byId("pin");
    if (!phoneEl || !shopEl || !nameEl || !pinEl) {
      return "missing inputs: " + inputs.map((i) => i.id).join(",");
    }
    setVal(phoneEl, ${JSON.stringify(phone)});
    setVal(shopEl, ${JSON.stringify(SHOP)});
    setVal(nameEl, "Smoke Offers Vendor");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") {
    fail(`could not fill setup form: ${filled}`);
    return {};
  }
  await sleep(500);

  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^continue/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Continue";
    b.click();
    return "ok";
  })()`);
  if (clicked !== "ok") {
    fail(`could not submit setup: ${clicked}`);
    return {};
  }

  if (!(await waitForText("What do you sell?"))) {
    fail('"What do you sell?" never rendered after signup');
    return {};
  }

  await evaluate(`(() => {
    const chip = [...document.querySelectorAll("button")]
      .find((b) => /^(fruits|vegetables)$/i.test((b.textContent || "").trim()));
    if (chip) chip.click();
    return "ok";
  })()`);
  await sleep(400);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^continue/i.test((x.textContent || "").trim()) && !x.disabled);
    if (b) b.click();
    return "ok";
  })()`);

  if (!(await waitForPathname("/"))) {
    fail("never reached Home after the business-type step");
    return {};
  }
  ok("a fresh vendor signs up and reaches Home");

  const storeId = await query(
    `select id from public.stores where phone = '${phone}';`,
  );
  if (!storeId) {
    fail("no stores row found for the freshly signed-up vendor");
    return {};
  }

  await query(
    `insert into public.products (store_id, name, unit, available, price) values ('${storeId}', '${PRODUCT_A}', 'kg', true, ${String(PRODUCT_A_PRICE)});`,
  );
  await query(
    `insert into public.products (store_id, name, unit, available) values ('${storeId}', '${PRODUCT_B}', 'piece', true);`,
  );
  const productAId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_A}';`,
  );
  const productBId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_B}';`,
  );
  ok(
    "two available products seeded for the fresh shop — one with a stored price, one without",
  );

  return { storeId, productAId, productBId };
}

// Behaviour pass (Task 1): navigate to Add offer from Home (so BackButton's
// plain router.back() has a real prior entry to return to — exactly the
// mechanism UI-SPEC's routing note describes, with zero new state), assert
// the screen and the picker's available-only contract, select a product,
// assert D-04's simple pre-fill, save, and read the WRITTEN ROW and its
// EVENT back out of the database — never trusting the screen alone.
async function passAddOfferFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail("no store id / product id available for the Add offer pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home before navigating to Add offer");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/offers/add` });
  if (!(await waitForText("Add today's offer"))) {
    fail("Add offer's own header never rendered");
    return;
  }
  ok("the Add offer screen renders its own header");

  if (
    !(await evaluate(
      `document.body.innerText.includes("Today's price") && document.body.innerText.includes("Regular price")`,
    ))
  ) {
    fail("both price field labels did not render");
    return;
  }
  ok("both price field labels render");

  const openedPicker = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /select a product/i.test((x.textContent || "").trim()));
    if (!b) return "no enabled product trigger";
    b.click();
    return "ok";
  })()`);
  if (openedPicker !== "ok") {
    fail(`could not open the product picker: ${openedPicker}`);
    return;
  }

  const dialogSelector = '[role="dialog"][aria-label="Choose a product"]';
  if (!(await waitForSelector(dialogSelector))) {
    fail("the product picker never rendered as the shipped dialog");
    return;
  }
  ok(
    "the product picker renders as the shipped dialog by its own accessible name",
  );

  const dialogState = await evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    if (!dialog) return null;
    const text = dialog.innerText || "";
    return {
      hasA: text.includes(${JSON.stringify(PRODUCT_A)}),
      hasB: text.includes(${JSON.stringify(PRODUCT_B)}),
      statusWordCount: (text.match(/available|unavailable/gi) || []).length,
    };
  })()`);
  if (!dialogState?.hasA || !dialogState.hasB) {
    fail("the picker did not list both available product names");
    return;
  }
  ok("the picker lists both available product names");
  if (dialogState.statusWordCount !== 0) {
    fail(
      `the picker rendered a status word on a row (count ${String(dialogState.statusWordCount)}) — D-01/divergence 5 requires none`,
    );
    return;
  }
  ok("the picker shows no per-row status word (D-01/divergence 5)");

  const selected = await evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = [...dialog.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return "no row for product A";
    b.click();
    return "ok";
  })()`);
  if (selected !== "ok") {
    fail(`could not select product A in the picker: ${selected}`);
    return;
  }

  await sleep(300);
  const regularPriceValue = await evaluate(
    `document.querySelector("#offer-regular-price")?.value`,
  );
  if (regularPriceValue !== String(PRODUCT_A_PRICE)) {
    fail(
      `expected the regular price field to pre-fill from product A's own stored price (${String(PRODUCT_A_PRICE)}), got ${JSON.stringify(regularPriceValue)}`,
    );
    return;
  }
  ok(
    "selecting a product with no offer yet today pre-fills Regular price from that product's own stored price (D-04)",
  );

  const TYPED_OFFER_PRICE = "18";
  const typed = await evaluate(
    setInputValue("#offer-price", TYPED_OFFER_PRICE),
  );
  if (typed !== "ok") {
    fail(`could not type today's price: ${typed}`);
    return;
  }

  const saved = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add offer" && !x.disabled);
    if (!b) return "no enabled Add offer button";
    b.click();
    return "ok";
  })()`);
  if (saved !== "ok") {
    fail(`could not tap Save: ${saved}`);
    return;
  }

  if (!(await waitForPathname("/"))) {
    fail("the browser did not return to the screen it came from after saving");
    return;
  }
  ok(
    "saving returns the browser to the screen it came from (plain router.back())",
  );

  const offerRow = await pollQuery(
    `select offer_price, today_price_label, offer_date = public.today_ist() as is_today
       from public.offers
      where store_id = '${storeId}' and product_id = '${productAId}';`,
    (out) => out.length > 0,
  );
  const [offerPriceRaw, label, isToday] = offerRow.split("|");
  if (Number(offerPriceRaw) !== Number(TYPED_OFFER_PRICE)) {
    fail(
      `expected the written offer_price to equal the typed amount ${TYPED_OFFER_PRICE}, got ${JSON.stringify(offerRow)}`,
    );
    return;
  }
  if (isToday !== "t") {
    fail(
      `the written offer_date did not equal the database's own today expression: ${offerRow}`,
    );
    return;
  }
  if (!label || !label.includes(TYPED_OFFER_PRICE)) {
    fail(
      `the written today_price_label did not contain the typed number: ${JSON.stringify(label)}`,
    );
    return;
  }
  ok(
    "exactly the typed price and today's own date landed in public.offers, with a non-null label containing that number",
  );

  const rowCount = await query(
    `select count(*) from public.offers where store_id = '${storeId}' and product_id = '${productAId}' and offer_date = public.today_ist();`,
  );
  if (rowCount !== "1") {
    fail(
      `expected exactly one offers row for this (product, day), got ${rowCount}`,
    );
    return;
  }

  const [offerId, createdAt] = (
    await query(
      `select id, created_at from public.offers where store_id = '${storeId}' and product_id = '${productAId}' and offer_date = public.today_ist();`,
    )
  ).split("|");
  const eventCount = await pollQuery(
    `select count(*) from public.events where event_name = 'offer_created' and offer_id = '${offerId}';`,
    (out) => out === "1",
  );
  if (eventCount !== "1") {
    fail(
      `expected exactly one offer_created event carrying the new offer's id, got count ${eventCount}`,
    );
    return;
  }
  ok(
    "exactly one offer_created event was recorded, carrying the new offer's id",
  );

  return { offerId, createdAt };
}

// Behaviour pass (Task 2, the replace case): with the offer the pass above
// just created still in place, return to Add offer, pick the SAME product,
// assert D-02/D-04's replace-case pre-fill (BOTH fields seed from the
// existing offer's own stored numbers, not the product's base price), save
// a changed price, and prove at the database that the row was REPLACED, not
// duplicated: same id, same created_at, new numbers.
async function passReplaceOfferFlow({
  storeId,
  productAId,
  firstOfferId,
  firstCreatedAt,
}) {
  if (!storeId || !productAId || !firstOfferId) {
    fail("no prior offer available for the replace pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home before the replace pass");
    return;
  }
  await send("Page.navigate", { url: `${BASE}/offers/add` });
  if (!(await waitForText("Add today's offer"))) {
    fail("Add offer's header never rendered for the replace pass");
    return;
  }

  const openedPicker = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /select a product/i.test((x.textContent || "").trim()));
    if (!b) return "no enabled product trigger";
    b.click();
    return "ok";
  })()`);
  if (openedPicker !== "ok") {
    fail(`could not open the picker for the replace pass: ${openedPicker}`);
    return;
  }

  const dialogSelector = '[role="dialog"][aria-label="Choose a product"]';
  if (!(await waitForSelector(dialogSelector))) {
    fail("the picker never rendered for the replace pass");
    return;
  }

  const selected = await evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = [...dialog.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return "no row for product A";
    b.click();
    return "ok";
  })()`);
  if (selected !== "ok") {
    fail(`could not re-select product A in the replace pass: ${selected}`);
    return;
  }

  await sleep(300);
  const [offerPriceFieldValue, regularPriceFieldValue] = await Promise.all([
    evaluate(`document.querySelector("#offer-price")?.value`),
    evaluate(`document.querySelector("#offer-regular-price")?.value`),
  ]);
  if (!offerPriceFieldValue) {
    fail(
      "selecting a product that already has an offer today left Today's price empty — it must pre-fill from the existing offer (D-02 replace-case), not behave like the simple case",
    );
    return;
  }
  if (!regularPriceFieldValue) {
    fail(
      "selecting a product that already has an offer today left Regular price empty",
    );
    return;
  }
  ok(
    "selecting a product that already has an offer today pre-fills BOTH fields from that existing offer's own stored numbers (D-02/D-04)",
  );

  const NEW_OFFER_PRICE = "22";
  const changed = await evaluate(
    setInputValue("#offer-price", NEW_OFFER_PRICE),
  );
  if (changed !== "ok") {
    fail(`could not change today's price in the replace pass: ${changed}`);
    return;
  }

  const saved = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add offer" && !x.disabled);
    if (!b) return "no enabled Add offer button";
    b.click();
    return "ok";
  })()`);
  if (saved !== "ok") {
    fail(`could not tap Save in the replace pass: ${saved}`);
    return;
  }

  if (!(await waitForPathname("/"))) {
    fail(
      "the browser did not return to the screen it came from after the replace save",
    );
    return;
  }

  const rowCount = await pollQuery(
    `select count(*) from public.offers where store_id = '${storeId}' and product_id = '${productAId}' and offer_date = public.today_ist();`,
    (out) => out === "1",
  );
  if (rowCount !== "1") {
    fail(
      `expected the replace to leave exactly one row for this (product, day), got ${rowCount}`,
    );
    return;
  }

  const [id, createdAt, offerPriceRaw, label] = (
    await query(
      `select id, created_at, offer_price, today_price_label from public.offers where store_id = '${storeId}' and product_id = '${productAId}' and offer_date = public.today_ist();`,
    )
  ).split("|");
  if (id !== firstOfferId) {
    fail(
      `expected the replace to keep the SAME row id (${firstOfferId}), got ${id}`,
    );
    return;
  }
  if (createdAt !== firstCreatedAt) {
    fail(
      `expected the replace to keep the SAME created_at (${firstCreatedAt}), got ${createdAt}`,
    );
    return;
  }
  if (Number(offerPriceRaw) !== Number(NEW_OFFER_PRICE)) {
    fail(
      `expected the replace to carry the new price ${NEW_OFFER_PRICE}, got ${offerPriceRaw}`,
    );
    return;
  }
  if (!label.includes(NEW_OFFER_PRICE)) {
    fail(`expected the replaced label to carry the new number: ${label}`);
    return;
  }
  ok(
    "a second save for the same product the same day REPLACES the first — same id, same created_at, new price and label (D-02)",
  );
}

// Behaviour pass (Task 2, the empty branch): with every one of this
// vendor's products marked unavailable, Add offer's trigger is disabled and
// names the fix, and opens no dialog when tapped (D-01). Restored in a
// finally-equivalent block below so no LATER pass in this file (there are
// none after this one today, but the discipline matters) inherits a shop
// with nothing switched on.
async function passEmptyShopFlow({ storeId, productAId, productBId }) {
  if (!storeId || !productAId || !productBId) {
    fail("no product ids available for the empty-shop pass");
    return;
  }

  try {
    await query(
      `update public.products set available = false where id in ('${productAId}', '${productBId}');`,
    );

    await send("Page.navigate", { url: `${BASE}/offers/add` });
    if (!(await waitForText("Add today's offer"))) {
      fail("Add offer's header never rendered for the empty-shop pass");
      return;
    }

    const disabledState = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /no available products/i.test((x.textContent || "").trim()));
      if (!b) return { found: false };
      return { found: true, disabled: b.disabled };
    })()`);
    if (!disabledState?.found || !disabledState.disabled) {
      fail(
        `expected a disabled trigger reading "No available products", got ${JSON.stringify(disabledState)}`,
      );
      return;
    }
    ok("with zero available products the trigger renders disabled (D-01)");

    if (
      !(await evaluate(
        `document.body.innerText.includes("Turn on a product first")`,
      ))
    ) {
      fail("the helper line naming the fix never rendered");
      return;
    }
    ok("the disabled trigger's helper line names the fix");

    const tapResult = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /no available products/i.test((x.textContent || "").trim()));
      b.click();
      return document.querySelector('[role="dialog"]') !== null;
    })()`);
    if (tapResult !== false) {
      fail("tapping the disabled trigger opened a dialog — it must not");
      return;
    }
    ok("tapping the disabled trigger opens no dialog");
  } finally {
    await query(
      `update public.products set available = true where id in ('${productAId}', '${productBId}');`,
    );
  }
}

// Behaviour pass (Task 1, HOME-04): runs BEFORE any offer exists for this
// vendor, so the empty branch is genuinely empty, not merely unasserted.
// Uses PRODUCT_B (untouched by the add/replace passes above, which are
// product A's own story) so the one offer this pass creates is the ONLY
// offer in the store when its own count assertion runs.
//
// The count assertion is scoped to the card's own subtree — found by its
// uppercase section label's parentElement, never document.body — and reads
// BOTH the header's own number AND the number of product-name rows actually
// rendered beneath it, so the two claims can never independently satisfy
// the test (see the falsifiability note in 05-02-SUMMARY.md for why a
// header-text-only form of this assertion is insufficient).
async function offersCardState() {
  return evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    if (!card) return null;
    const text = card.innerText || "";
    const match = text.match(/(\\d+) active today/);
    return {
      found: true,
      isEmpty: text.includes("Nothing promoted today"),
      headerCount: match ? Number(match[1]) : null,
      renderedRows: card.querySelectorAll("p.truncate.text-xs.font-semibold").length,
    };
  })()`);
}

async function passHomeOffersCardFlow({ storeId, productBId }) {
  if (!storeId || !productBId) {
    fail("no store id / product id available for the Home offers-card pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForLabelText("Today's offers"))) {
    fail("Home's offers-card section label never rendered");
    return;
  }

  const emptyState = await offersCardState();
  if (!emptyState?.isEmpty) {
    fail(
      `expected Home's offers card to render its empty branch before any offer exists, got ${JSON.stringify(emptyState)}`,
    );
    return;
  }
  ok(
    "with no offer active, Home's offers card renders its own empty-state line",
  );

  const addButtonBox = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    const b = card
      ? [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Add offer"))
      : null;
    if (!b) return null;
    return b.getBoundingClientRect().height;
  })()`);
  if (typeof addButtonBox !== "number" || addButtonBox < 44) {
    fail(
      `expected the empty-state Add offer button to measure at least 44px tall, got ${JSON.stringify(addButtonBox)}`,
    );
    return;
  }
  ok(
    "the empty-state Add offer button measures at least 44px tall by its own geometry",
  );

  const tappedAdd = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    const b = card
      ? [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Add offer"))
      : null;
    if (!b) return "no Add offer button in the empty-state card";
    b.click();
    return "ok";
  })()`);
  if (tappedAdd !== "ok") {
    fail(`could not tap Home's empty-state Add offer button: ${tappedAdd}`);
    return;
  }
  if (!(await waitForText("Add today's offer"))) {
    fail(
      "tapping Home's empty-state Add offer button did not reach the Add offer screen",
    );
    return;
  }
  ok(
    "tapping Home's empty-state Add offer button reaches the real Add offer screen — a real control, not a decoration",
  );

  const openedPicker = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /select a product/i.test((x.textContent || "").trim()));
    if (!b) return "no enabled product trigger";
    b.click();
    return "ok";
  })()`);
  if (openedPicker !== "ok") {
    fail(
      `could not open the product picker from Home's entry point: ${openedPicker}`,
    );
    return;
  }
  const dialogSelector = '[role="dialog"][aria-label="Choose a product"]';
  if (!(await waitForSelector(dialogSelector))) {
    fail("the product picker never rendered from Home's entry point");
    return;
  }
  const selectedB = await evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = [...dialog.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes(${JSON.stringify(PRODUCT_B)}));
    if (!b) return "no row for product B";
    b.click();
    return "ok";
  })()`);
  if (selectedB !== "ok") {
    fail(`could not select product B from Home's entry point: ${selectedB}`);
    return;
  }

  const HOME_CARD_OFFER_PRICE = "12";
  const typed = await evaluate(
    setInputValue("#offer-price", HOME_CARD_OFFER_PRICE),
  );
  if (typed !== "ok") {
    fail(`could not type today's price for product B: ${typed}`);
    return;
  }

  const saved = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add offer" && !x.disabled);
    if (!b) return "no enabled Add offer button";
    b.click();
    return "ok";
  })()`);
  if (saved !== "ok") {
    fail(`could not tap Save for product B's offer: ${saved}`);
    return;
  }
  if (!(await waitForPathname("/"))) {
    fail("the browser did not return to Home after saving product B's offer");
    return;
  }

  await pollQuery(
    `select count(*) from public.offers where store_id = '${storeId}' and product_id = '${productBId}' and offer_date = public.today_ist();`,
    (out) => out === "1",
  );

  if (!(await waitForText("1 active today"))) {
    fail("Home's offers card never read the count for exactly one");
    return;
  }
  const oneActiveState = await offersCardState();
  if (oneActiveState?.headerCount !== 1 || oneActiveState.renderedRows !== 1) {
    fail(
      `expected Home's offers card header count and its own rendered row count to both equal 1, got ${JSON.stringify(oneActiveState)}`,
    );
    return;
  }
  ok(
    "Home's offers card reads the count for exactly one, and that count agrees with the number of rows actually rendered beneath it",
  );

  const rowText = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    return card ? card.innerText : "";
  })()`);
  if (
    !rowText.includes(PRODUCT_B) ||
    !rowText.includes(HOME_CARD_OFFER_PRICE)
  ) {
    fail(
      `expected the compact row to show product B's name and its offer price, got ${JSON.stringify(rowText)}`,
    );
    return;
  }
  ok(
    "the compact row shows the newly-offered product's name and its offer price",
  );

  const tappedManage = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    const b = card
      ? [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Manage offers"))
      : null;
    if (!b) return "no Manage offers link";
    b.click();
    return "ok";
  })()`);
  if (tappedManage !== "ok") {
    fail(`could not tap Home's Manage offers link: ${tappedManage}`);
    return;
  }
  // The Manage offers SCREEN does not render until Task 2 lands — this pass
  // asserts only that the link reaches the real route by its URL, and says
  // so here rather than leaving that a silent, easily-misread weak check.
  if (!(await waitForPathname("/offers"))) {
    fail("Home's Manage offers link did not reach the /offers route");
    return;
  }
  ok(
    "Home's Manage offers link reaches the real /offers route (its screen lands in Task 2)",
  );
}

// Direct-SQL offer insertion — used by Task 2/3's own passes that need a
// known, deterministic offers state rather than one built through the UI.
// today_price_label is NOT NULL with no default, so it is always supplied
// here; regular_price/regular_price_label stay NULL when no regular price
// is given, matching the "no strikethrough element at all" partial case.
async function insertOfferSql({
  storeId,
  productId,
  offerPrice,
  regularPrice = null,
  dateExpr = null,
}) {
  const todayLabel = `₹${String(offerPrice)}`;
  const regularLabel =
    regularPrice === null ? "null" : `'₹${String(regularPrice)}'`;
  const regularValue = regularPrice === null ? "null" : String(regularPrice);
  const dateColumn = dateExpr ? ", offer_date" : "";
  const dateValue = dateExpr ? `, ${dateExpr}` : "";
  // Wrapped in a CTE, never a bare `insert ... returning`: psql's -At mode
  // suppresses a SELECT's row output but NOT an INSERT's own "INSERT 0 1"
  // command-completion tag, which would otherwise land in the same stdout
  // string as the returned id and corrupt every caller that expects a bare
  // UUID (live-verified this session).
  const sql = `with ins as (
    insert into public.offers (store_id, product_id, offer_price, regular_price, today_price_label, regular_price_label${dateColumn})
    values ('${storeId}', '${productId}', ${String(offerPrice)}, ${regularValue}, '${todayLabel}', ${regularLabel}${dateValue})
    returning id
  ) select id from ins;`;
  return query(sql);
}

// Behaviour pass (Task 2, the list and its empty state): starts by
// deleting every offer this store has, so "with one offer active" is a
// fact this pass establishes for itself rather than inheriting from
// whatever passes ran before it in this file. Seeds exactly one offer by
// direct SQL (the point of this pass is the SCREEN, not offer creation,
// which the Add-offer passes above already prove) and reads both branches
// of the one Manage Offers screen against real state.
async function passManageOffersListFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail("no store id / product id available for the Manage offers list pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  await insertOfferSql({
    storeId,
    productId: productAId,
    offerPrice: 15,
    regularPrice: 20,
  });

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText("1 active today"))) {
    fail(
      "Home did not read the count for exactly one before the Manage offers list pass",
    );
    return;
  }

  const tapped = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === "Today's offers");
    const card = label ? label.parentElement : null;
    const b = card
      ? [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Manage offers"))
      : null;
    if (!b) return "no Manage offers link";
    b.click();
    return "ok";
  })()`);
  if (tapped !== "ok") {
    fail(`could not tap Home's Manage offers link: ${tapped}`);
    return;
  }
  if (!(await waitForPathname("/offers"))) {
    fail("Home's Manage offers link did not reach /offers");
    return;
  }

  if (!(await waitForText("1 active today"))) {
    fail(
      "Manage offers' own header subtext never read the count for exactly one",
    );
    return;
  }
  ok("Manage offers reads its own header subtext for exactly one");

  const listState = await evaluate(`(() => {
    const text = document.body.innerText || "";
    return {
      hasProduct: text.includes(${JSON.stringify(PRODUCT_A)}),
      hasEmptyHeading: text.includes("No offers today"),
    };
  })()`);
  if (!listState?.hasProduct) {
    fail("the offer row never rendered the product's name");
    return;
  }
  if (listState.hasEmptyHeading) {
    fail("the empty state's heading rendered even though one offer is active");
    return;
  }
  ok(
    "the offer row shows the active offer's product, and the empty state's heading is absent",
  );

  await query(`delete from public.offers where store_id = '${storeId}';`);
  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText("No offers today"))) {
    fail("the empty state never rendered after removing every offer by SQL");
    return;
  }
  const rowGone = await evaluate(
    `!(document.body.innerText || "").includes(${JSON.stringify(PRODUCT_A)})`,
  );
  if (rowGone !== true) {
    fail("the offer row was still present after every offer was removed");
    return;
  }
  ok(
    "with zero active offers, Manage offers renders its empty state and no row",
  );
}

// Behaviour pass (Task 2, the removal): proves the optimistic remove BOTH
// on screen and in the database (two different claims — a rolled-back
// optimistic patch looks identical to a successful delete for one frame),
// then proves the rollback direction by revoking the DELETE grant for the
// duration of one assertion and restoring it unconditionally afterward.
async function passRemoveOfferFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail("no store id / product id available for the remove-offer pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  const offerId = (
    await insertOfferSql({ storeId, productId: productAId, offerPrice: 30 })
  ).trim();
  if (!offerId) {
    fail("could not seed the offer used by the remove-offer pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText(PRODUCT_A))) {
    fail("the seeded offer's row never rendered before the remove pass");
    return;
  }

  const removeButtonState = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.getAttribute("aria-label") || "").includes("Remove") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return null;
    return { height: b.getBoundingClientRect().height, label: b.getAttribute("aria-label") };
  })()`);
  if (!removeButtonState || removeButtonState.height < 44) {
    fail(
      `expected a remove control at least 44px tall with an aria-label naming the product, got ${JSON.stringify(removeButtonState)}`,
    );
    return;
  }
  ok(
    "the remove control measures at least 44px tall and its accessible name contains the specific product's name",
  );

  const tappedRemove = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.getAttribute("aria-label") || "").includes("Remove") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return "no remove button";
    b.click();
    return "ok";
  })()`);
  if (tappedRemove !== "ok") {
    fail(`could not tap the remove control: ${tappedRemove}`);
    return;
  }

  const disappeared = await waitForCondition(
    async () =>
      !(await evaluate(
        `(document.body.innerText || "").includes(${JSON.stringify(PRODUCT_A)})`,
      )),
  );
  if (!disappeared) {
    fail("the row did not disappear from the screen after tapping remove");
    return;
  }
  ok("the row disappears from the screen the instant remove is tapped");

  const durableCount = await pollQuery(
    `select count(*) from public.offers where id = '${offerId}';`,
    (out) => out === "0",
  );
  if (durableCount !== "0") {
    fail(
      `expected the removed offer to be gone from the database, found count ${durableCount}`,
    );
    return;
  }
  ok(
    "the removed offer is durably gone from the database, not merely hidden on screen",
  );

  // The rollback direction: revoke DELETE, attempt a remove, confirm the
  // row visibly returns with a row-local message and no page-wide banner,
  // then restore the grant unconditionally.
  const rollbackOfferId = (
    await insertOfferSql({ storeId, productId: productAId, offerPrice: 31 })
  ).trim();
  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText(PRODUCT_A))) {
    fail("the rollback pass's own seeded offer never rendered");
    return;
  }

  try {
    await query(`revoke delete on public.offers from authenticated;`);

    const tappedFailingRemove = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.getAttribute("aria-label") || "").includes("Remove") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
      if (!b) return "no remove button";
      b.click();
      return "ok";
    })()`);
    if (tappedFailingRemove !== "ok") {
      fail(
        `could not tap remove for the rollback pass: ${tappedFailingRemove}`,
      );
      return;
    }

    const reappeared = await waitForCondition(async () =>
      evaluate(
        `(document.body.innerText || "").includes(${JSON.stringify(PRODUCT_A)}) && (document.body.innerText || "").includes("Something went wrong")`,
      ),
    );
    if (!reappeared) {
      fail(
        "the row did not reappear with its local failure message after the delete was rejected",
      );
      return;
    }

    const bannerCount = await evaluate(
      `document.querySelectorAll('[role="alert"]').length`,
    );
    if (bannerCount !== 1) {
      fail(
        `expected exactly one role="alert" message (the row-local one), found ${String(bannerCount)}`,
      );
      return;
    }
    ok(
      "a rejected remove rolls back visibly, with exactly one row-local message and no page-wide banner",
    );

    const stillThere = await query(
      `select count(*) from public.offers where id = '${rollbackOfferId}';`,
    );
    if (stillThere !== "1") {
      fail(
        `expected the offer to still exist in the database after the rejected delete, found count ${stillThere}`,
      );
      return;
    }
  } finally {
    await query(`grant delete on public.offers to authenticated;`);
  }
}

async function waitForCondition(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  return false;
}

// Reads the Manage Offers screen's own row-list-or-empty-state region,
// never document.body: the header block (which repeats "Today's offers")
// and the footer sit either side of it as DOM siblings of the one outer
// scroll container, so `h1.closest(".scrollbar-hide").children[1]` is
// exactly the region a product's name should or should not appear in —
// named here once so both Task 3 passes below cite the identical selector.
async function manageOffersListRegionText() {
  return evaluate(`(() => {
    const h1 = [...document.querySelectorAll("h1")]
      .find((el) => el.textContent.trim() === "Today's offers");
    const outer = h1 ? h1.closest(".scrollbar-hide") : null;
    const region = outer ? outer.children[1] : null;
    return region ? region.innerText : null;
  })()`);
}

// Behaviour pass (Task 3, D-13's vendor-side gate): a genuinely
// yesterday-dated offer, expressed relative to the database's own today
// expression (never a literal date), must be invisible on BOTH vendor
// screens — scoped to each screen's own subtree, never document.body,
// because the products list and other cards elsewhere on the vendor's
// screens legitimately render product names too.
async function passStaleDateExclusionFlow({ storeId, productAId, productBId }) {
  if (!storeId || !productAId || !productBId) {
    fail("no store/product ids available for the stale-date pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  // A genuinely-today offer on a DIFFERENT product, so this pass can tell
  // "excludes the stale one" apart from "shows nothing at all".
  await insertOfferSql({ storeId, productId: productBId, offerPrice: 40 });
  // The stale fixture: dated one day before the database's own today
  // expression, with numeric prices so its exclusion cannot be attributed
  // to the priceability filter instead of the date bound.
  await insertOfferSql({
    storeId,
    productId: productAId,
    offerPrice: 50,
    regularPrice: 60,
    dateExpr: "public.today_ist() - 1",
  });

  try {
    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForLabelText("Today's offers"))) {
      fail("Home's offers card never rendered for the stale-date pass");
      return;
    }
    const preCountDebug = await evaluate(`(() => {
      const label = [...document.querySelectorAll("p")]
        .find((p) => p.textContent.trim() === "Today's offers");
      const card = label ? label.parentElement : null;
      return card ? card.innerText : null;
    })()`);
    if (!(await waitForText("1 active today"))) {
      fail(
        `Home did not read the count for exactly one before the stale-date pass; card was: ${JSON.stringify(preCountDebug)}`,
      );
      return;
    }
    const homeCardText = await evaluate(`(() => {
      const label = [...document.querySelectorAll("p")]
        .find((p) => p.textContent.trim() === "Today's offers");
      const card = label ? label.parentElement : null;
      return card ? card.innerText : null;
    })()`);
    if (homeCardText === null) {
      fail("could not locate Home's offers card for the stale-date pass");
      return;
    }
    if (homeCardText.includes(PRODUCT_A)) {
      fail(
        `the stale-dated product's name appeared inside Home's offers card subtree: ${JSON.stringify(homeCardText)}`,
      );
      return;
    }
    if (!homeCardText.includes(PRODUCT_B)) {
      fail("today's genuinely-active offer never rendered on Home's card");
      return;
    }
    ok(
      "Home's offers card excludes a genuinely stale-dated offer (scoped to the card's own subtree) while still showing today's real offer",
    );

    await send("Page.navigate", { url: `${BASE}/offers` });
    if (!(await waitForText("1 active today"))) {
      fail(
        "Manage offers did not read the count for exactly one before the stale-date pass",
      );
      return;
    }
    const listText = await manageOffersListRegionText();
    if (listText === null) {
      fail("could not locate Manage offers' own list region");
      return;
    }
    if (listText.includes(PRODUCT_A)) {
      fail(
        `the stale-dated product's name appeared inside Manage offers' own list region: ${JSON.stringify(listText)}`,
      );
      return;
    }
    if (!listText.includes(PRODUCT_B)) {
      fail("today's genuinely-active offer never rendered in Manage offers");
      return;
    }
    ok(
      "Manage offers excludes the same stale-dated offer (scoped to the list's own region) while still showing today's real offer",
    );
  } finally {
    await query(
      `delete from public.offers where store_id = '${storeId}' and offer_date <> public.today_ist();`,
    );
  }
}

// Behaviour pass (Task 3, D-03/D-14's vendor-side gate): an offer whose
// product is switched unavailable disappears from both vendor screens on
// the next fetch, and reappears once the product is switched back on the
// same day — the row is never deleted, only excluded by the join.
async function passAvailabilityExclusionFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail("no store/product id available for the availability pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  await insertOfferSql({ storeId, productId: productAId, offerPrice: 45 });

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText("1 active today"))) {
    fail(
      "Home did not read the count for exactly one before the availability pass",
    );
    return;
  }
  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText(PRODUCT_A))) {
    fail(
      "Manage offers did not show the active offer before the availability pass",
    );
    return;
  }
  ok(
    "both vendor screens include the active offer while its product is available",
  );

  try {
    await query(
      `update public.products set available = false where id = '${productAId}';`,
    );

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText("Nothing promoted today"))) {
      fail(
        "Home's count did not drop to zero after the product was marked unavailable",
      );
      return;
    }
    ok(
      "Home's count drops to zero once the offer's product is marked unavailable",
    );

    await send("Page.navigate", { url: `${BASE}/offers` });
    if (!(await waitForText("No offers today"))) {
      fail(
        "Manage offers did not show its empty state after the product was marked unavailable",
      );
      return;
    }
    const listText = await manageOffersListRegionText();
    if (listText?.includes(PRODUCT_A)) {
      fail(
        `the offer row was still present in Manage offers' own list region after the product was marked unavailable: ${JSON.stringify(listText)}`,
      );
      return;
    }
    ok(
      "Manage offers also excludes the offer once its product is unavailable — the row was never deleted, only excluded by the join",
    );

    await query(
      `update public.products set available = true where id = '${productAId}';`,
    );

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText("1 active today"))) {
      fail(
        "Home's count did not return after the product was marked available again",
      );
      return;
    }
    ok(
      "Home's count returns once the product is marked available again — the offer reappears, proving it was excluded by a join, not deleted",
    );
  } finally {
    await query(
      `update public.products set available = true where id = '${productAId}';`,
    );
  }
}

// Behaviour pass (05-03 Task 2, D-10's "one" case / D-12 / DATA-06): a
// row's own Share control opens the shipped offer share sheet with exactly
// that one offer, a destination tap dispatches to the PRODUCT deep link
// (the one surface D-05 guarantees shows the offer price to a recipient),
// and the write lands as an OFFER share, not a catalogue or product one —
// asserted at the database independently of the browser recorder, because a
// recorded window.open call proves the browser was asked, not that the
// share was actually recorded with the right type.
async function passSingleOfferShareFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail("no store/product id available for the single-offer share pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  const offerId = (
    await insertOfferSql({
      storeId,
      productId: productAId,
      offerPrice: 33,
      regularPrice: 44,
    })
  ).trim();
  if (!offerId) {
    fail("could not seed the offer used by the single-offer share pass");
    return;
  }
  const slug = await query(
    `select slug from public.stores where id = '${storeId}';`,
  );

  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText(PRODUCT_A))) {
    fail("the seeded offer's row never rendered before the share pass");
    return;
  }

  const shareButtonState = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.getAttribute("aria-label") || "").includes("Share") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return null;
    return { height: b.getBoundingClientRect().height, label: b.getAttribute("aria-label") };
  })()`);
  if (!shareButtonState || shareButtonState.height < 44) {
    fail(
      `expected a share control at least 44px tall with an aria-label naming the product, got ${JSON.stringify(shareButtonState)}`,
    );
    return;
  }
  ok(
    "the row's share control measures at least 44px tall and its accessible name contains the specific product's name",
  );

  const tappedShare = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.getAttribute("aria-label") || "").includes("Share") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
    if (!b) return "no share button";
    b.click();
    return "ok";
  })()`);
  if (tappedShare !== "ok") {
    fail(`could not tap the row's share control: ${tappedShare}`);
    return;
  }

  const dialogSelector = '[role="dialog"][aria-label="Share offer"]';
  if (!(await waitForSelector(dialogSelector))) {
    fail("the offer share sheet never rendered as the shipped dialog");
    return;
  }
  ok(
    'tapping the row\'s share control opens the shipped dialog by its own accessible name ("Share offer")',
  );

  const previewState = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    if (!sheet) return null;
    const text = sheet.innerText || "";
    return {
      hasProduct: text.includes(${JSON.stringify(PRODUCT_A)}),
      hasOfferPrice: text.includes("33"),
      hasRegularPrice: text.includes("44"),
    };
  })()`);
  if (
    !previewState?.hasProduct ||
    !previewState.hasOfferPrice ||
    !previewState.hasRegularPrice
  ) {
    fail(
      `expected the sheet's own preview to show this product's name and both prices, got ${JSON.stringify(previewState)}`,
    );
    return;
  }
  ok(
    "the sheet's preview shows that product's name and both its offer and regular price",
  );

  await evaluate(`window.__windowOpenSpy = null;`);
  const tappedWhatsApp = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = [...sheet.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("WhatsApp"));
    if (!b) return "no WhatsApp button in the sheet";
    b.click();
    return "ok";
  })()`);
  if (tappedWhatsApp !== "ok") {
    fail(`could not tap the WhatsApp destination: ${tappedWhatsApp}`);
    return;
  }

  let spy;
  for (let i = 0; i < 40; i++) {
    spy = await evaluate(`window.__windowOpenSpy`);
    if (spy) break;
    await sleep(200);
  }
  const expectedUrl = `${BASE}/store/${slug}/p/${productAId}`;
  const spyText = spy?.url ? new URL(spy.url).searchParams.get("text") : null;
  const linkedToProduct =
    typeof spyText === "string" && spyText.endsWith(expectedUrl);
  if (!linkedToProduct) {
    fail(
      `expected the recorded WhatsApp dispatch to decode to a URL ending in the product deep link (${expectedUrl}), got ${JSON.stringify(spy)}`,
    );
    return;
  }
  ok(
    "the recorded destination tap decodes to a URL ending in this shop's path followed by the product segment and that product's id — the deep link, not the storefront",
  );

  const shareRow = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'offer' and product_id = '${productAId}' and destination = 'WhatsApp';`,
    (out) => out === "1",
  );
  if (shareRow !== "1") {
    fail(
      `expected exactly one catalogue_shares row carrying the offer share type, that product's id and the WhatsApp destination, got ${shareRow}`,
    );
    return;
  }
  ok(
    "exactly one catalogue_shares row exists carrying the offer share type, that product's id and the WhatsApp destination",
  );

  const eventRow = await pollQuery(
    `select count(*) from public.events where event_name = 'offer_shared' and store_id = '${storeId}' and offer_id = '${offerId}';`,
    (out) => out === "1",
  );
  if (eventRow !== "1") {
    fail(
      `expected exactly one offer_shared event carrying this offer's id, got ${eventRow}`,
    );
    return;
  }
  ok("exactly one offer_shared event was recorded, carrying this offer's id");

  const probe = await evaluate(
    `({ share: window.__nativeShareExisted, clipboard: window.__nativeClipboardExisted })`,
  );
  console.log(
    `probe: at ${BASE}, navigator.share existed natively = ${JSON.stringify(probe?.share)}; navigator.clipboard.writeText existed natively = ${JSON.stringify(probe?.clipboard)}`,
  );

  const closed = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = sheet ? sheet.querySelector('button[aria-label="Close"]') : null;
    if (!b) return "no close button";
    b.click();
    return "ok";
  })()`);
  if (closed !== "ok") {
    fail(`could not close the offer share sheet: ${closed}`);
  }
}

// Behaviour pass (05-03 Task 3, D-10's "all" case / D-12 / DATA-06): the
// footer's share-all button opens the SAME shipped sheet with every offer
// active today, a destination tap dispatches to the STOREFRONT (D-09's own
// strip shows every offer active today, so that page is the one surface
// guaranteed to show all of them), and the write lands as an offer share
// with a NULL product id — the share-all shape, distinguishable at the
// database from the single-offer shape passSingleOfferShareFlow already
// recorded. Ends by removing every offer and asserting the footer button
// itself disappears while the add button remains — D-10's own "renders
// only when at least one offer is active" condition, and the exact defect
// class (a rendered control that opens nothing) this project already
// logged a ledger entry for once.
async function passShareAllOffersFlow({ storeId, productAId, productBId }) {
  if (!storeId || !productAId || !productBId) {
    fail("no store/product ids available for the share-all pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  await insertOfferSql({
    storeId,
    productId: productAId,
    offerPrice: 33,
    regularPrice: 44,
  });
  await insertOfferSql({ storeId, productId: productBId, offerPrice: 12 });
  const slug = await query(
    `select slug from public.stores where id = '${storeId}';`,
  );

  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText("2 active today"))) {
    fail(
      "Manage offers did not read the count for exactly two before the share-all pass",
    );
    return;
  }

  const shareAllButtonState = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Share today's offers"));
    if (!b) return null;
    return { found: true, height: b.getBoundingClientRect().height };
  })()`);
  if (!shareAllButtonState?.found) {
    fail("the footer's share-all button never rendered with two offers active");
    return;
  }
  ok(
    "the footer's share-all button renders while at least one offer is active",
  );

  const tappedShareAll = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Share today's offers"));
    if (!b) return "no share-all button";
    b.click();
    return "ok";
  })()`);
  if (tappedShareAll !== "ok") {
    fail(`could not tap the footer's share-all button: ${tappedShareAll}`);
    return;
  }

  const dialogSelector = `[role="dialog"][aria-label="Share today's offers"]`;
  if (!(await waitForSelector(dialogSelector))) {
    fail(
      "the share-all sheet never rendered as the shipped dialog with its plural label",
    );
    return;
  }
  ok(
    "tapping the footer's share-all button opens the SAME shipped dialog with its plural accessible name (\"Share today's offers\")",
  );

  const previewState = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    if (!sheet) return null;
    const text = sheet.innerText || "";
    return {
      hasProductA: text.includes(${JSON.stringify(PRODUCT_A)}),
      hasProductB: text.includes(${JSON.stringify(PRODUCT_B)}),
      rowCount: sheet.querySelectorAll("p.truncate.text-sm.font-semibold").length,
    };
  })()`);
  if (
    !previewState?.hasProductA ||
    !previewState.hasProductB ||
    previewState.rowCount !== 2
  ) {
    fail(
      `expected the share-all preview to list BOTH product names in exactly two rows, got ${JSON.stringify(previewState)}`,
    );
    return;
  }
  ok(
    "the share-all sheet's preview lists BOTH active offers' product names — two rows, not one",
  );

  await evaluate(`window.__windowOpenSpy = null;`);
  const tappedWhatsApp = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = [...sheet.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("WhatsApp"));
    if (!b) return "no WhatsApp button in the share-all sheet";
    b.click();
    return "ok";
  })()`);
  if (tappedWhatsApp !== "ok") {
    fail(
      `could not tap the WhatsApp destination in the share-all sheet: ${tappedWhatsApp}`,
    );
    return;
  }

  let spy;
  for (let i = 0; i < 40; i++) {
    spy = await evaluate(`window.__windowOpenSpy`);
    if (spy) break;
    await sleep(200);
  }
  const expectedStorefrontUrl = `${BASE}/store/${slug}`;
  const spyText = spy?.url ? new URL(spy.url).searchParams.get("text") : null;
  const linkedToStorefront =
    typeof spyText === "string" &&
    spyText.endsWith(expectedStorefrontUrl) &&
    !spyText.includes("/p/");
  if (!linkedToStorefront) {
    fail(
      `expected the recorded share-all dispatch to decode to the storefront URL (${expectedStorefrontUrl}) with no product path, got ${JSON.stringify(spy)}`,
    );
    return;
  }
  ok(
    "the recorded share-all destination tap decodes to the storefront URL, not a product path — D-09's strip shows every offer there",
  );

  const shareAllRow = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'offer' and product_id is null and destination = 'WhatsApp';`,
    (out) => out === "1",
  );
  if (shareAllRow !== "1") {
    fail(
      `expected exactly one catalogue_shares row carrying the offer share type, a null product id and the WhatsApp destination, got ${shareAllRow}`,
    );
    return;
  }
  ok(
    "exactly one catalogue_shares row exists carrying the offer share type, a null product id and the WhatsApp destination — the share-all shape",
  );

  const eventRow = await pollQuery(
    `select count(*) from public.events where event_name = 'offer_shared' and store_id = '${storeId}' and offer_id is null;`,
    (out) => out === "1",
  );
  if (eventRow !== "1") {
    fail(
      `expected exactly one offer_shared event with no offer id (the share-all shape), got ${eventRow}`,
    );
    return;
  }
  ok(
    "exactly one offer_shared event was recorded with no offer id — distinguishable from the single-offer shape",
  );

  const closed = await evaluate(`(() => {
    const sheet = document.querySelector(${JSON.stringify(dialogSelector)});
    const b = sheet ? sheet.querySelector('button[aria-label="Close"]') : null;
    if (!b) return "no close button";
    b.click();
    return "ok";
  })()`);
  if (closed !== "ok") {
    fail(`could not close the share-all sheet: ${closed}`);
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText("No offers today"))) {
    fail(
      "the empty state never rendered after removing every offer for the share-all absence check",
    );
    return;
  }
  const footerButtonsState = await evaluate(`(() => {
    const hasShareAll = [...document.querySelectorAll("button")]
      .some((x) => (x.textContent || "").includes("Share today's offers"));
    const hasAdd = [...document.querySelectorAll("button")]
      .some((x) => (x.textContent || "").trim() === "Add offer");
    return { hasShareAll, hasAdd };
  })()`);
  if (
    footerButtonsState?.hasShareAll !== false ||
    footerButtonsState?.hasAdd !== true
  ) {
    fail(
      `expected the share-all button absent and the add button present with zero offers, got ${JSON.stringify(footerButtonsState)}`,
    );
    return;
  }
  ok(
    "with zero active offers, the footer's share-all button is absent while the add button remains",
  );
}

// Behaviour pass (05-04 Task 3, D-13's vendor-preview gate): the one
// customer-facing surface an AUTHENTICATED reader can reach — Home's own
// "Preview as customer" overlay renders the same public storefront hooks
// this vendor is signed into, where "offers: owner manages" has no date
// bound of its own and would otherwise leak a stale-dated offer into what
// looks like the customer's own view. Today's offer is created through the
// real Add-offer screen (never SQL) so this fixture's "today" side is the
// same write path a vendor actually uses; the stale one is inserted by
// direct SQL, dated relative to the database's own today expression.
async function passVendorPreviewStaleOfferExclusionFlow({
  storeId,
  productAId,
  productBId,
}) {
  if (!storeId || !productAId || !productBId) {
    fail("no store/product ids available for the vendor-preview pass");
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);

  try {
    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForPathname("/"))) {
      fail("could not reach Home before the vendor-preview pass");
      return;
    }
    await send("Page.navigate", { url: `${BASE}/offers/add` });
    if (!(await waitForText("Add today's offer"))) {
      fail("Add offer's header never rendered for the vendor-preview pass");
      return;
    }

    const openedPicker = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => /select a product/i.test((x.textContent || "").trim()));
      if (!b) return "no enabled product trigger";
      b.click();
      return "ok";
    })()`);
    if (openedPicker !== "ok") {
      fail(
        `could not open the picker for the vendor-preview pass: ${openedPicker}`,
      );
      return;
    }
    const dialogSelector = '[role="dialog"][aria-label="Choose a product"]';
    if (!(await waitForSelector(dialogSelector))) {
      fail("the picker never rendered for the vendor-preview pass");
      return;
    }
    const selectedB = await evaluate(`(() => {
      const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
      const b = [...dialog.querySelectorAll("button")]
        .find((x) => (x.textContent || "").includes(${JSON.stringify(PRODUCT_B)}));
      if (!b) return "no row for product B";
      b.click();
      return "ok";
    })()`);
    if (selectedB !== "ok") {
      fail(
        `could not select product B for the vendor-preview pass: ${selectedB}`,
      );
      return;
    }

    const TODAY_OFFER_PRICE = "16";
    const typed = await evaluate(
      setInputValue("#offer-price", TODAY_OFFER_PRICE),
    );
    if (typed !== "ok") {
      fail(
        `could not type today's price for the vendor-preview pass: ${typed}`,
      );
      return;
    }

    const saved = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim() === "Add offer" && !x.disabled);
      if (!b) return "no enabled Add offer button";
      b.click();
      return "ok";
    })()`);
    if (saved !== "ok") {
      fail(
        `could not save today's offer for the vendor-preview pass: ${saved}`,
      );
      return;
    }
    if (!(await waitForPathname("/"))) {
      fail(
        "saving today's offer did not return to Home for the vendor-preview pass",
      );
      return;
    }
    await pollQuery(
      `select count(*) from public.offers where store_id = '${storeId}' and product_id = '${productBId}' and offer_date = public.today_ist();`,
      (out) => out === "1",
    );

    // The stale fixture: dated one day before the database's own today
    // expression, with numeric prices so its exclusion cannot be
    // attributed to the priceability filter instead of the date bound.
    await insertOfferSql({
      storeId,
      productId: productAId,
      offerPrice: 60,
      regularPrice: 70,
      dateExpr: "public.today_ist() - 1",
    });

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForPathname("/"))) {
      fail("could not reach Home before opening the customer preview");
      return;
    }
    if (!(await waitForText("Preview as customer"))) {
      fail("Home's own 'Preview as customer' control never rendered");
      return;
    }
    const tappedPreview = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").includes("Preview as customer"));
      if (!b) return "no Preview as customer control";
      b.click();
      return "ok";
    })()`);
    if (tappedPreview !== "ok") {
      fail(`could not tap the customer-preview control: ${tappedPreview}`);
      return;
    }
    if (!(await waitForText("Previewing as customer"))) {
      fail("the customer-preview overlay never rendered");
      return;
    }
    ok(
      "tapping Home's own 'Preview as customer' control opens the overlay — the one customer-facing surface an authenticated reader can reach",
    );

    // The preview overlay renders as a DOM SIBLING of Home, not a
    // replacement of it (home-page.tsx's own comment: "rendered as a
    // sibling of HomeView"). Home's own offers card carries the identical
    // "Today's offers" label, so an unscoped document-wide search for that
    // text would silently match Home's own card behind the overlay instead
    // of the overlay's own strip. Every lookup below is resolved from the
    // overlay's own fixed/elevated container first.
    const overlaySelector = ".fixed.inset-0.z-50";
    let previewStripState = null;
    {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        previewStripState = await evaluate(`(() => {
          const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
          if (!overlay) return null;
          const label = [...overlay.querySelectorAll("p")].find(
            (p) => p.textContent.trim() === "Today's offers",
          );
          const strip = label ? label.parentElement : null;
          if (!strip) return { found: false };
          return {
            found: true,
            rowCount: (strip.querySelector(".flex.flex-col.gap-2")?.children.length ?? 0),
            text: strip.innerText || "",
          };
        })()`);
        if (previewStripState?.found) break;
        await sleep(250);
      }
    }
    if (!previewStripState?.found) {
      fail(
        "the offers strip never rendered inside the preview overlay's own container",
      );
      return;
    }
    if (!previewStripState || previewStripState.rowCount !== 1) {
      fail(
        `expected exactly one row in the preview's own strip, got ${JSON.stringify(previewStripState)}`,
      );
      return;
    }
    if (!previewStripState.text.includes(PRODUCT_B)) {
      fail(
        "today's genuinely active offer never rendered inside the preview's own strip",
      );
      return;
    }
    ok(
      "inside the preview overlay, the strip contains exactly one row and it is today's genuinely active offer",
    );
    if (previewStripState.text.includes(PRODUCT_A)) {
      fail(
        `the stale-dated product's name appeared inside the preview's own strip subtree: ${JSON.stringify(previewStripState.text)}`,
      );
      return;
    }
    ok(
      "the stale-dated product's name does not appear inside the preview's own strip subtree — the vendor's authenticated session does not leak yesterday's offer into what looks like the customer's own view",
    );
  } finally {
    await query(
      `delete from public.offers where store_id = '${storeId}' and offer_date <> public.today_ist();`,
    );
  }
}

// WR-01's own repro (05-REVIEW.md), red-then-green: a vendor with exactly
// one active offer taps Remove on Manage Offers, then taps Home in the
// always-visible BottomNav — an ordinary one-tap client-side navigation,
// not a race requiring precise timing — before the delete's own network
// round trip settles. use-remove-offer.ts's onMutate has ALREADY marked the
// shared cache's row `_pendingRemoval: true` (never filtered out — see its
// own header for why) by the time this pass's own un-delayed click reaches
// the Home link; before this phase's fix, offers-card.tsx and
// manage-offers-view.tsx read `activeOffers.length` and an unfiltered row
// map directly, so the just-removed offer rendered on Home as fully active.
// FAULT_INJECTION_SCRIPT's `__delayOfferDelete` holds the DELETE open for 3s
// so this reproduces deterministically rather than by luck of a fast
// localhost round trip finishing before the click lands.
async function passCrossScreenPendingRemovalFlow({ storeId, productAId }) {
  if (!storeId || !productAId) {
    fail(
      "no store id / product id available for the cross-screen pending-removal pass",
    );
    return;
  }

  await query(`delete from public.offers where store_id = '${storeId}';`);
  const offerId = (
    await insertOfferSql({ storeId, productId: productAId, offerPrice: 22 })
  ).trim();
  if (!offerId) {
    fail(
      "could not seed the offer used by the cross-screen pending-removal pass",
    );
    return;
  }

  await send("Page.navigate", { url: `${BASE}/offers` });
  if (!(await waitForText(PRODUCT_A))) {
    fail("the seeded offer's row never rendered before the cross-screen pass");
    return;
  }

  await evaluate(`window.__delayOfferDelete = true;`);

  try {
    const tappedRemove = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.getAttribute("aria-label") || "").includes("Remove") && (x.getAttribute("aria-label") || "").includes(${JSON.stringify(PRODUCT_A)}));
      if (!b) return "no remove button";
      b.click();
      return "ok";
    })()`);
    if (tappedRemove !== "ok") {
      fail(`could not tap remove for the cross-screen pass: ${tappedRemove}`);
      return;
    }

    // The milder, same-screen half of WR-01: Manage Offers' own header and
    // list region must already agree with what OfferRow itself is showing
    // (nothing, for the row mid-delete) — no "1 active today" next to a
    // blank list with no empty-state message either.
    const manageHeaderText = await evaluate(`(() => {
      const h1 = [...document.querySelectorAll("h1")]
        .find((el) => el.textContent.trim() === "Today's offers");
      const header = h1 ? h1.parentElement : null;
      return header ? header.innerText : null;
    })()`);
    if (!manageHeaderText?.includes("Nothing promoted today")) {
      fail(
        `expected Manage Offers' own header to already read the empty state while the remove is still in flight, got ${JSON.stringify(manageHeaderText)}`,
      );
      return;
    }
    const manageListText = await manageOffersListRegionText();
    if (!manageListText?.includes("No offers today")) {
      fail(
        `expected Manage Offers' own list region to already show its empty-state message while the remove is still in flight, got ${JSON.stringify(manageListText)}`,
      );
      return;
    }
    if (manageListText.includes(PRODUCT_A)) {
      fail(
        `the offer's name leaked into Manage Offers' own visible list region while its own row was supposed to render nothing: ${JSON.stringify(manageListText)}`,
      );
      return;
    }
    ok(
      "Manage Offers' own header and list region already agree with the empty state while the remove it owns is still in flight — no stale count/list disagreement on the same screen",
    );

    // The cross-screen repro proper: an ordinary tap on the BottomNav's
    // Home link, a client-side navigation that keeps the same in-memory
    // TanStack Query cache alive (never Page.navigate, which would reload
    // the document and lose the very cache entry this repro depends on).
    const tappedHome = await evaluate(`(() => {
      const a = document.querySelector('nav a[href="/"]');
      if (!a) return "no Home nav link";
      a.click();
      return "ok";
    })()`);
    if (tappedHome !== "ok") {
      fail(
        `could not tap the Home nav link for the cross-screen pass: ${tappedHome}`,
      );
      return;
    }
    if (!(await waitForPathname("/"))) {
      fail(
        "tapping the Home nav link did not reach Home during the cross-screen pass",
      );
      return;
    }
    if (!(await waitForLabelText("Today's offers"))) {
      fail(
        "Home's offers-card section label never rendered during the cross-screen pass",
      );
      return;
    }

    const stateWhilePending = await offersCardState();
    if (!stateWhilePending?.isEmpty || stateWhilePending.headerCount !== null) {
      fail(
        `expected Home to already show its own empty state for the offer the vendor just tapped Remove on (delete still in flight), got ${JSON.stringify(stateWhilePending)}`,
      );
      return;
    }
    ok(
      "Home reads the shared cache's own _pendingRemoval marker: it shows the empty state for an offer whose delete is still in flight, rather than rendering it as fully active",
    );
  } finally {
    await evaluate(`window.__delayOfferDelete = false;`);
  }

  const durableCount = await pollQuery(
    `select count(*) from public.offers where id = '${offerId}';`,
    (out) => out === "0",
    8000,
  );
  if (durableCount !== "0") {
    fail(
      `expected the delayed delete to eventually land once its network round trip completed, found count ${durableCount}`,
    );
    return;
  }
  ok(
    "the delayed delete still lands durably once its own artificially-widened network round trip completes",
  );
}

// WR-02's own repro (05-REVIEW.md), red-then-green, distinguishing a genuine
// products-fetch failure from a genuinely empty catalogue — a gate that
// would pass in both cases proves nothing (this project's own "assertion
// that cannot fail" class). FAULT_INJECTION_SCRIPT's `__forceProductsError`
// forces the products GET to fail without touching the database at all;
// the second half of this pass genuinely empties the catalogue (every
// product unavailable) through the database, with fault injection off, to
// prove the SAME screen still shows D-01's own message in that case.
async function passAddOfferProductsFetchErrorFlow({
  storeId,
  productAId,
  productBId,
}) {
  if (!storeId || !productAId || !productBId) {
    fail(
      "no store/product ids available for the Add offer products-fetch-error pass",
    );
    return;
  }

  // Written to localStorage, not the window property directly: this pass
  // needs the fault active from the very first mount of the Add offer
  // screen (unlike WR-01's flag, which only ever survives a client-side
  // transition), and a plain `window` property does not survive the full
  // Page.navigate below — see FAULT_INJECTION_SCRIPT's own header.
  await evaluate(`localStorage.setItem("gsdForceProductsError", "1");`);
  try {
    await send("Page.navigate", { url: `${BASE}/offers/add` });
    if (!(await waitForText("Couldn't load your products."))) {
      fail(
        "Add offer did not show the products-fetch error message when the products fetch was forced to fail",
      );
      return;
    }
    const wronglyClaimedEmpty = await evaluate(
      `(document.body.innerText || "").includes("No available products") || (document.body.innerText || "").includes("Turn on a product first")`,
    );
    if (wronglyClaimedEmpty) {
      fail(
        "Add offer showed the empty-catalogue message while the products fetch had actually failed — WR-02's exact defect",
      );
      return;
    }
    const retryVisible = await evaluate(
      `[...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Retry")`,
    );
    if (!retryVisible) {
      fail("Add offer's products-fetch-error branch has no Retry affordance");
      return;
    }
    ok(
      "a genuine products-fetch failure shows Add offer's own error message with a Retry affordance, never the 'no available products' copy",
    );

    // Recovery: turn the fault off (the way a real network blip would
    // resolve) and tap the SAME Retry button already on screen — a
    // same-document client action, so clearing the live `window` property
    // is enough here (no further navigation to lose it across).
    await evaluate(
      `window.__forceProductsError = false; localStorage.setItem("gsdForceProductsError", "0");`,
    );
    const clickedRetry = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim() === "Retry");
      if (!b) return "no Retry button";
      b.click();
      return "ok";
    })()`);
    if (clickedRetry !== "ok") {
      fail(
        `could not tap Retry after the forced fetch failure: ${clickedRetry}`,
      );
      return;
    }
    if (!(await waitForText("Add today's offer"))) {
      fail(
        "tapping Retry after the forced fetch failure did not recover to the real Add offer form",
      );
      return;
    }
    ok(
      "tapping Retry recovers to the real Add offer form once the products fetch actually succeeds",
    );
  } finally {
    // Belt-and-braces cleanup: clears BOTH the live window flag (in case an
    // early `return` above skipped the recovery step) and the localStorage
    // value it was seeded from, so no later pass — including this file's
    // own genuinely-empty-catalogue check right below — can inherit a
    // still-forced fault across its own navigation.
    await evaluate(
      `window.__forceProductsError = false; localStorage.setItem("gsdForceProductsError", "0");`,
    );
  }

  // The distinguishing half: a genuinely empty catalogue (fault injection
  // OFF) must still show D-01's own message, not the fetch-error branch.
  try {
    await query(
      `update public.products set available = false where store_id = '${storeId}';`,
    );
    await send("Page.navigate", { url: `${BASE}/offers/add` });
    if (!(await waitForText("No available products"))) {
      fail(
        "Add offer did not show its own empty-catalogue message for a genuinely empty catalogue",
      );
      return;
    }
    const errorTextLeaked = await evaluate(
      `(document.body.innerText || "").includes("Couldn't load your products.")`,
    );
    if (errorTextLeaked) {
      fail(
        "Add offer showed the fetch-error message for a genuinely empty catalogue — the two states are not actually distinguished",
      );
      return;
    }
    ok(
      "a genuinely empty catalogue still shows D-01's own 'no available products' message, not the fetch-error branch — this gate distinguishes both directions, not just one",
    );
  } finally {
    await query(
      `update public.products set available = true where store_id = '${storeId}' and id in ('${productAId}', '${productBId}');`,
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
  // Issued once, before the first Page.navigate of this run (matching
  // scripts/smoke-share-flow.mjs's own placement) — every document loaded
  // for the rest of this run, including passSetupAndSeedShop's own setup-
  // form navigation, has the recorders already installed.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: SHARE_SPY_SCRIPT,
  });
  // WR-01 / WR-02's own fault injection (see FAULT_INJECTION_SCRIPT's own
  // header) — both flags default false, so every pass before the two that
  // flip them on runs exactly as it did before this script existed.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: FAULT_INJECTION_SCRIPT,
  });

  const { storeId, productAId, productBId } = await passSetupAndSeedShop();
  await passHomeOffersCardFlow({ storeId, productBId });
  const firstOffer = await passAddOfferFlow({ storeId, productAId });
  await passReplaceOfferFlow({
    storeId,
    productAId,
    firstOfferId: firstOffer?.offerId,
    firstCreatedAt: firstOffer?.createdAt,
  });
  await passEmptyShopFlow({ storeId, productAId, productBId });
  await passManageOffersListFlow({ storeId, productAId });
  await passRemoveOfferFlow({ storeId, productAId });
  await passStaleDateExclusionFlow({ storeId, productAId, productBId });
  await passAvailabilityExclusionFlow({ storeId, productAId });
  await passSingleOfferShareFlow({ storeId, productAId });
  await passShareAllOffersFlow({ storeId, productAId, productBId });
  await passVendorPreviewStaleOfferExclusionFlow({
    storeId,
    productAId,
    productBId,
  });
  await passCrossScreenPendingRemovalFlow({ storeId, productAId });
  await passAddOfferProductsFetchErrorFlow({
    storeId,
    productAId,
    productBId,
  });

  if (process.exitCode !== 1) console.log("\noffers smoke flow: PASS");
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
