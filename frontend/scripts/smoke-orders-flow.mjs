#!/usr/bin/env node
// Phase 6's vendor Orders browser flow (ORDR-01, ORDR-02, ORDR-03, ORDR-04,
// D-08, D-09, D-12, D-13). Drives a REAL vendor session through /orders in
// headless Chrome and asserts the DATABASE outcome of what happens there —
// never only what the screen shows.
//
// This flow's central gate is D-13: the bottom-nav badge has NEVER rendered
// a number in this app's history (the layout renders the nav with no count
// prop, the nav defaults it to zero, and the badge markup only renders above
// zero), so an assertion of the badge's ABSENCE would pass against the
// broken code. Every count this file asserts is read out of the database at
// the moment of the assertion — never a seed literal — because the seed's
// own counts hold only immediately after a reset and every run of this file
// adds real orders that accumulate across runs against the same database.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established (scaffolding copied from
// scripts/smoke-offers-flow.mjs; the seeded-vendor sign-in copied from
// scripts/smoke-cart-flow.mjs's own signInAsVendor).
//
// Usage: node scripts/smoke-orders-flow.mjs [baseUrl]
//   BASE / argv[2]  default http://127.0.0.1:3100
//   CHROME_BIN      default google-chrome
//   DB_URL          default the local supabase postgres
// Requires the app to be already running at baseUrl and local Supabase up.
// Debugging port 9343 — 9334-9342 are already claimed by sibling flows.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9343";

const SLUG = "priya-stores";
const STORE_ID = "00000000-0000-4000-8000-000000000002";
const TOMATOES_ID = "00000000-0000-4000-8000-000000000020";

// A strict subset of our own freshly-placed orders is cleared to establish
// the discriminator this file's divergence assertion needs — never a
// literal matching the seed's own 8/2 counts.
const DIVERGENCE_ORDER_COUNT = 4;
const CLEARED_SUBSET_COUNT = 2;

let phoneCounter = 0;
function freshPhone() {
  phoneCounter += 1;
  return `9${String(Date.now()).slice(-8)}${String(phoneCounter).padStart(1, "0")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`not ok: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
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

// The New/Earlier section labels render through an `uppercase` CSS class —
// `innerText` reflects that CSS text-transform, so a plain
// `innerText.includes("Earlier")` check silently never matches (it sees
// "EARLIER"). This polls `textContent` on the exact label elements, which is
// the actual DOM text and is never case-transformed by CSS (the same trap
// and the same fix scripts/smoke-offers-flow.mjs's own waitForLabelText
// already documents for "Today's offers").
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

async function waitForInputs(minCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await evaluate(`document.querySelectorAll("input").length`);
    if (typeof n === "number" && n >= minCount) return true;
    await sleep(250);
  }
  return false;
}

async function waitForCondition(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  return false;
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

// Task 2's constraint pass: a write that is EXPECTED to fail — VERBOSITY=
// verbose is what makes psql's own stderr include the literal SQLSTATE
// (23514 for a CHECK-constraint violation), never just the human-readable
// message, so the pass can assert the exact error code rather than pattern-
// matching English prose that could equally mean something else went wrong.
async function queryExpectError(sql) {
  try {
    const { stdout } = await execFileAsync("psql", [
      DB_URL,
      "-At",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      sql,
    ]);
    return { failed: false, stdout: stdout.trim() };
  } catch (err) {
    return { failed: true, stderr: String(err.stderr ?? err.message ?? "") };
  }
}

// Polls rather than reading once: the mark-seen invalidation and the 30s
// poll both settle asynchronously after the DOM assertion that triggered
// them, so a bare single read can race a write that hasn't landed yet.
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

// Direct-SQL order placement — calling the function itself (bypassing
// PostgREST/RLS, matching scripts/smoke-cart-flow.mjs's own precedent),
// never a hand-rolled insert, so every order this file creates goes through
// the real place_order contract (rate limit, pricing, customer upsert)
// exactly as a customer's would.
async function placeOrder({ name, phone, qty = 1 }) {
  const orderId = await query(
    `select public.place_order('${SLUG}', '${name}', '${phone}', null, '[{"product_id":"${TOMATOES_ID}","qty":${String(qty)}}]'::jsonb);`,
  );
  if (!orderId) {
    throw new Error(`placeOrder failed for ${name}/${phone}`);
  }
  return orderId;
}

async function countByIsNew(storeId) {
  return Number(
    await query(
      `select count(*) from public.orders where store_id = '${storeId}' and is_new = true;`,
    ),
  );
}

async function countByStatusNew(storeId) {
  return Number(
    await query(
      `select count(*) from public.orders where store_id = '${storeId}' and status = 'new';`,
    ),
  );
}

async function signInAsVendor() {
  // Clears any prior session BEFORE navigating to /login: a signed-in
  // visitor (e.g. the fresh vendor this file just signed up) is redirected
  // straight past /login to Home (AUTH-07's own returning-vendor
  // behaviour), so /login's own form never renders unless the session is
  // cleared first.
  await evaluate(`localStorage.clear()`);
  await send("Page.navigate", { url: `${BASE}/login` });
  if (!(await waitForText("Open your shop"))) return false;
  const filled = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const phoneEl = document.querySelector("#login-phone");
    const pinEl = document.querySelector("#login-pin");
    if (!phoneEl || !pinEl) return "missing login inputs";
    setVal(phoneEl, "9876543210");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") return false;
  await sleep(300);
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === "Open" && !x.disabled,
    );
    if (!b) return "no enabled Open button";
    b.click();
    return "ok";
  })()`);
  if (clicked !== "ok") return false;
  return waitForPathname("/");
}

// Clicks the bottom nav's own <Link>, a genuine Next.js CLIENT-SIDE
// transition — required wherever a test needs the Orders page to actually
// UNMOUNT via React's own lifecycle (D-08's mark-seen effect cleanup). A
// raw `Page.navigate` to a new URL is a hard browser navigation: it tears
// down the whole JS realm immediately, which can cancel the cleanup's own
// in-flight async supabase call before it completes — a false negative for
// this exact assertion, not a defect in the production code.
async function clickHomeNavLink() {
  return evaluate(`(() => {
    const link = document.querySelector('nav a[href="/"]');
    if (!link) return "no home nav link";
    link.click();
    return "ok";
  })()`);
}

// Drives a REAL hidden-then-visible transition through the query library's
// OWN focus subscription (TanStack Query's FocusManager listens for a
// `visibilitychange` event on `window` and re-checks
// `document.visibilityState` — verified live against
// node_modules/@tanstack/query-core's own source this session) — never
// calling the query's own `refetch()` function, which would prove only that
// the test can call a function, not that the trigger fires on its own.
async function simulateVisibilityRefocus() {
  return evaluate(`(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
    return "ok";
  })()`);
}

// Reads the badge scoped to the nav's own Orders link — never
// document.body — so this assertion cannot be satisfied by a number
// rendered anywhere else on the page (Home's own tile renders the identical
// numeral, which is exactly why each assertion in this file must be scoped
// to its own element).
async function readBadge() {
  return evaluate(`(() => {
    const link = document.querySelector('nav a[href="/orders"]');
    if (!link) return { linkFound: false };
    const badge = link.querySelector("span.absolute");
    return {
      linkFound: true,
      badgeFound: badge !== null,
      text: badge ? badge.textContent.trim() : null,
    };
  })()`);
}

// Reads Home's own New-orders tile, scoped to the tile's own subtree (the
// number span immediately preceding the "New orders" label span) — never
// document.body.
async function readHomeTile() {
  return evaluate(`(() => {
    const label = [...document.querySelectorAll("span")].find(
      (s) => s.textContent.trim() === "New orders",
    );
    const tile = label ? label.parentElement : null;
    const numberSpan = tile ? tile.querySelector("span") : null;
    return {
      tileFound: tile !== null,
      text: numberSpan ? numberSpan.textContent.trim() : null,
    };
  })()`);
}

// Every row this screen renders is a role="group" element (order-row.tsx) —
// this reads each one's own last child (the timestamp span) so the time
// pass below can check every visible row without a page-wide text scrape.
async function readOrderRowTimes() {
  return evaluate(`(() => {
    return [...document.querySelectorAll('[role="group"]')].map((row) => {
      const spans = row.querySelectorAll("span");
      const last = spans[spans.length - 1];
      return last ? last.textContent.trim() : null;
    });
  })()`);
}

const TIME_OF_DAY_RE = /^\d{1,2}:\d{2}\s?[AP]M$/i;
// 3-4 letters: the en-IN ICU short-month form renders September as "Sept"
// (4 letters) while every other month is 3 — both are "a short
// day-and-month", the shape this assertion actually cares about.
const DAY_MONTH_RE = /^\d{1,2}\s[A-Za-z]{3,4}$/;

// This plan's own fault injection (Task 1's confirm failure, Task 2's
// cancel failure) — the same established technique
// scripts/smoke-offers-flow.mjs's own FAULT_INJECTION_SCRIPT uses: a
// monkey-patched window.fetch forces a PATCH to /rest/v1/orders to fail
// while a flag is armed, otherwise every request passes through untouched.
// Seeded from localStorage (survives a full Page.navigate) as well as a
// live window property (same-document toggling, no navigation needed),
// registered once via Page.addScriptToEvaluateOnNewDocument so it survives
// every later navigation in this file.
const ORDER_FAULT_INJECTION_SCRIPT = `
(() => {
  window.__forceOrderUpdateError = localStorage.getItem("gsdForceOrderUpdateError") === "1";
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (window.__forceOrderUpdateError && url.includes("/rest/v1/orders") && method === "PATCH") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "forced failure for this plan's own falsifiability gate" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return realFetch(input, init);
  };
})();
`;

function armOrderUpdateFault() {
  return evaluate(
    `window.__forceOrderUpdateError = true; localStorage.setItem("gsdForceOrderUpdateError", "1");`,
  );
}

function disarmOrderUpdateFault() {
  return evaluate(
    `window.__forceOrderUpdateError = false; localStorage.setItem("gsdForceOrderUpdateError", "0");`,
  );
}

// Pass: establishes a state in which the lifecycle-filtered count and the
// seen-ness-filtered count for the seeded shop genuinely DIFFER, against
// this file's OWN freshly-placed orders — never the seed's own literals,
// which drift with every run of this file against the same database. Fails
// loudly (not silently) if the fixture ever stops producing the divergence,
// per this plan's own instruction: a gate that cannot tell the two columns
// apart proves nothing.
async function passEstablishDivergence() {
  const placed = [];
  for (let i = 0; i < DIVERGENCE_ORDER_COUNT; i++) {
    const name = `Smoke Orders Customer ${String(i + 1)}`;
    const phone = freshPhone();
    const orderId = await placeOrder({ name, phone });
    placed.push({ orderId, name, phone });
  }
  ok(
    `placed ${String(DIVERGENCE_ORDER_COUNT)} orders against the seeded shop, each with its own phone`,
  );

  // Clear a STRICT SUBSET (never all of them) — the middle two of the four,
  // so both an older and a newer order stay unseen for the ordering
  // assertion below.
  const toClear = placed.slice(1, 1 + CLEARED_SUBSET_COUNT);
  const clearIds = toClear.map((p) => `'${p.orderId}'`).join(",");
  await query(
    `update public.orders set is_new = false where id in (${clearIds});`,
  );
  ok(
    `cleared the seen-ness flag on a strict subset (${String(CLEARED_SUBSET_COUNT)} of ${String(DIVERGENCE_ORDER_COUNT)}) of the freshly-placed orders`,
  );

  const lifecycleCount = await countByStatusNew(STORE_ID);
  const seenNessCount = await countByIsNew(STORE_ID);

  if (!(seenNessCount < lifecycleCount)) {
    fail(
      `expected the seen-ness count (${String(seenNessCount)}) to be strictly less than the lifecycle count (${String(lifecycleCount)}) after clearing a subset — the fixture failed to establish the discriminator`,
    );
    throw new Error("divergence fixture failed — aborting the flow");
  }
  if (!(seenNessCount >= 1)) {
    fail(
      `expected the seen-ness count to be at least one, got ${String(seenNessCount)}`,
    );
    throw new Error("divergence fixture failed — aborting the flow");
  }
  ok(
    `the two database counts genuinely differ before any screen assertion runs: lifecycle=${String(lifecycleCount)}, seen-ness=${String(seenNessCount)}`,
  );

  const oldestUnseen = placed[0];
  const newestUnseen = placed[placed.length - 1];
  return {
    placed,
    toClear,
    lifecycleCount,
    seenNessCount,
    oldestUnseen,
    newestUnseen,
  };
}

// Pass: signs in as the seeded vendor, lands on Home, and asserts ORDR-02 —
// the badge APPEARS with the seen-ness number, scoped to the nav's own
// Orders link, and Home's own tile, scoped to its own subtree, reads the
// SAME number. The badge assertion is the one that would have caught D-13:
// asserting only agreement (never presence) would pass against a badge that
// never renders at all, since 0 === 0 there too.
async function passBadgeAndHomeTile({ seenNessCount }) {
  const signedIn = await signInAsVendor();
  if (!signedIn) {
    fail("could not sign in as the seeded demo vendor");
    return;
  }
  ok("the seeded demo vendor signs in and reaches Home");

  await waitForCondition(async () => {
    const badge = await readBadge();
    return badge?.badgeFound === true;
  });

  const badge = await readBadge();
  if (!badge?.linkFound) {
    fail("the bottom nav's Orders link was not found at all");
    return;
  }
  if (!badge.badgeFound) {
    fail(
      'the bottom-nav badge is ABSENT even with a real unseen order present (D-13) — scoped to nav a[href="/orders"] span.absolute',
    );
    return;
  }
  ok(
    'the bottom-nav badge EXISTS, scoped to nav a[href="/orders"] span.absolute — the assertion that would have caught D-13',
  );
  if (badge.text !== String(seenNessCount)) {
    fail(
      `expected the badge to read the seen-ness count (${String(seenNessCount)}), got ${JSON.stringify(badge.text)}`,
    );
    return;
  }
  ok(
    `the badge's text equals the seen-ness count read from the database a moment ago (${String(seenNessCount)})`,
  );

  const tile = await readHomeTile();
  if (!tile?.tileFound) {
    fail("Home's own New-orders tile was not found");
    return;
  }
  if (tile.text !== String(seenNessCount)) {
    fail(
      `expected Home's tile to read the same seen-ness count (${String(seenNessCount)}), got ${JSON.stringify(tile.text)}`,
    );
    return;
  }
  ok(
    "Home's own New-orders tile, scoped to its own element, reads the identical number the badge does",
  );
}

// Pass: opens the Orders tab and asserts ORDR-01's shape against real data —
// the header subtext, the New section's newest-first ordering (by document
// position of two known customer names), the Earlier section containing the
// seeded orthogonality fixture (is_new=false, status still 'new'), one row's
// exact quoted items-line form, and every visible row's time shape.
async function passOrdersScreen({ seenNessCount, oldestUnseen, newestUnseen }) {
  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("Orders"))) {
    fail("the Orders screen never rendered its own header");
    return;
  }

  if (!(await waitForText(`${String(seenNessCount)} new`))) {
    fail(
      `the header subtext never read the new-and-total form with the seen-ness count (${String(seenNessCount)})`,
    );
    return;
  }
  ok(
    `the header subtext reads the new-and-total form with the same seen-ness-derived number (${String(seenNessCount)})`,
  );

  if (!(await waitForLabelText("New"))) {
    fail("the New section header never rendered");
    return;
  }
  if (!(await waitForLabelText("Earlier"))) {
    fail("the Earlier section header never rendered");
    return;
  }
  ok("both the New and Earlier section headers render");

  const orderingState = await evaluate(`(() => {
    const text = document.body.innerText || "";
    return {
      newestIndex: text.indexOf(${JSON.stringify(newestUnseen.name)}),
      oldestIndex: text.indexOf(${JSON.stringify(oldestUnseen.name)}),
    };
  })()`);
  if (orderingState.newestIndex === -1 || orderingState.oldestIndex === -1) {
    fail(
      `expected both known customer names to render, got ${JSON.stringify(orderingState)}`,
    );
    return;
  }
  if (!(orderingState.newestIndex < orderingState.oldestIndex)) {
    fail(
      `expected the newer order (${newestUnseen.name}) to appear before the older one (${oldestUnseen.name}) in document order, got ${JSON.stringify(orderingState)}`,
    );
    return;
  }
  ok(
    "the New section lists unseen orders newest first, by document order of two known customer names",
  );

  if (!(await waitForText("Anita P."))) {
    fail(
      "the seeded orthogonality fixture (Anita P. — unseen-cleared but still undecided) never rendered",
    );
    return;
  }
  ok(
    "the Earlier section contains the seeded order that is unseen-cleared but still undecided (Anita P.)",
  );

  const meeraRowText = await evaluate(`(() => {
    const groups = [...document.querySelectorAll('[role="group"]')];
    const row = groups.find((g) => (g.textContent || "").includes("Meera S."));
    return row ? row.textContent : null;
  })()`);
  if (!meeraRowText || !meeraRowText.includes("Tomatoes ×2")) {
    fail(
      `expected Meera S.'s row to render the exact quoted items-line form "Tomatoes ×2", got ${JSON.stringify(meeraRowText)}`,
    );
    return;
  }
  ok(
    'one row renders the exact quoted example items-line form from a seeded order\'s own two lines ("Tomatoes ×2")',
  );

  const times = await readOrderRowTimes();
  const badShapes = (times ?? []).filter(
    (t) => t !== null && !TIME_OF_DAY_RE.test(t) && !DAY_MONTH_RE.test(t),
  );
  if (!times || times.length === 0) {
    fail("no order rows were found to check for a time shape");
    return;
  }
  if (badShapes.length > 0) {
    fail(
      `expected every visible row's time to match a plausible shape, found: ${JSON.stringify(badShapes)}`,
    );
    return;
  }
  ok(
    `every visible row (${String(times.length)}) carries a time matching a plausible shape`,
  );
}

// Pass: a freshly signed-up vendor with no orders at all sees the shipped
// empty-state sentence and neither section header — proving the "no
// scaffolding for an absent section" discipline against a genuinely empty
// store, not merely an unseeded one.
async function passFreshVendorEmptyOrders() {
  const phone = freshPhone();

  await send("Page.navigate", { url: `${BASE}/setup` });
  if (!(await waitForInputs(4))) {
    fail("setup form never became interactive for the empty-orders pass");
    return;
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
    setVal(shopEl, "Smoke Orders Empty Shop");
    setVal(nameEl, "Smoke Orders Vendor");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") {
    fail(`could not fill setup form for the empty-orders pass: ${filled}`);
    return;
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
    fail(`could not submit setup for the empty-orders pass: ${clicked}`);
    return;
  }

  if (!(await waitForText("What do you sell?"))) {
    fail(
      '"What do you sell?" never rendered after signup for the empty-orders pass',
    );
    return;
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
    fail("never reached Home after signup for the empty-orders pass");
    return;
  }
  ok("a fresh vendor with no orders at all signs up and reaches Home");

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("No orders yet"))) {
    fail("the empty-state sentence never rendered for a shop with no orders");
    return;
  }
  ok("a shop with no orders renders the shipped empty-state sentence");

  const scaffolding = await evaluate(`(() => {
    const els = [...document.querySelectorAll("p,h1,h2")];
    const texts = els.map((el) => el.textContent.trim());
    return { hasNew: texts.includes("New"), hasEarlier: texts.includes("Earlier") };
  })()`);
  if (scaffolding.hasNew || scaffolding.hasEarlier) {
    fail(
      `a section header rendered for a shop with no orders: ${JSON.stringify(scaffolding)}`,
    );
    return;
  }
  ok("neither section header renders for a shop with no orders");
}

// Pass (Task 2, ORDR-03/D-08): leaving the Orders tab marks every currently
// unseen order of the seeded shop seen, AT THE DATABASE — proven with a
// database read, never merely the badge disappearing on screen — while
// leaving the lifecycle column untouched. Runs against the seeded vendor's
// own session, left active by the passes above.
//
// Deliberately visits Home FIRST: whatever the passes above left mounted on
// /orders would otherwise turn this file's own OWN navigation into a
// same-URL reload rather than a genuine mount transition, and a reload
// fires the OLD mount's unmount cleanup before this pass ever captures its
// own baseline. Visiting Home first makes the next navigation to /orders a
// clean, single, attributable mount.
async function passMarkSeenOnUnmount() {
  // The pass above (Task 1) leaves the Orders page mounted with its own
  // fixtures still unseen. Click Home's own nav link — a genuine
  // client-side transition — so THAT mount's cleanup runs to completion
  // before this pass builds a clean baseline of its own; a hard
  // Page.navigate here could cut its async cleanup off mid-flight and leave
  // stray unseen rows that would corrupt this pass's own store-wide zero
  // assertion below.
  const initialClick = await clickHomeNavLink();
  if (initialClick !== "ok") {
    fail(
      `could not click Home's nav link before the mark-seen pass: ${initialClick}`,
    );
    return;
  }
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home before the mark-seen pass");
    return;
  }

  const nameA = `Smoke MarkSeen Customer A ${String(Date.now())}`;
  const nameB = `Smoke MarkSeen Customer B ${String(Date.now())}`;
  const orderIdA = await placeOrder({ name: nameA, phone: freshPhone() });
  const orderIdB = await placeOrder({ name: nameB, phone: freshPhone() });
  const idList = `'${orderIdA}','${orderIdB}'`;

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText(nameA))) {
    fail("the freshly-placed order never rendered in the New section");
    return;
  }
  ok(
    "a freshly-placed order renders in the New section while the Orders tab is mounted",
  );

  const statusesBefore = await query(
    `select string_agg(distinct status, ',') from public.orders where id in (${idList});`,
  );

  // A genuine CLIENT-SIDE transition (never Page.navigate — see
  // clickHomeNavLink's own header) so the Orders page unmounts via React's
  // own lifecycle and the mark-seen effect's async cleanup has a live JS
  // realm to complete in.
  const navClicked = await clickHomeNavLink();
  if (navClicked !== "ok") {
    fail(
      `could not click Home's nav link to trigger the unmount: ${navClicked}`,
    );
    return;
  }
  if (!(await waitForPathname("/"))) {
    fail("clicking Home's nav link did not reach Home");
    return;
  }

  const stillUnseen = await pollQuery(
    `select count(*) from public.orders where id in (${idList}) and is_new = true;`,
    (out) => out === "0",
  );
  if (stillUnseen !== "0") {
    fail(
      `expected both captured orders to read seen after leaving the tab, ${stillUnseen} still unseen`,
    );
    return;
  }
  ok("leaving the Orders tab marks both captured orders seen AT THE DATABASE");

  const storeUnseenCount = await query(
    `select count(*) from public.orders where store_id = '${STORE_ID}' and is_new = true;`,
  );
  if (storeUnseenCount !== "0") {
    fail(
      `expected the store's unseen count to be zero after leaving the tab, got ${storeUnseenCount}`,
    );
    return;
  }
  ok("the store's unseen count is zero at the database after leaving the tab");

  const statusesAfter = await query(
    `select string_agg(distinct status, ',') from public.orders where id in (${idList});`,
  );
  if (statusesAfter !== statusesBefore) {
    fail(
      `expected the lifecycle column to stay unchanged by the bulk clear, before=${statusesBefore} after=${statusesAfter}`,
    );
    return;
  }
  ok(
    `the lifecycle column is unchanged by the bulk clear (still "${statusesAfter}") — one column touched, not two`,
  );

  // The badge must clear faster than the 30s interval alone could explain —
  // proving the invalidation ran, not merely that the poll caught up.
  const badgeCleared = await waitForCondition(async () => {
    const badge = await readBadge();
    return badge?.badgeFound === false;
  }, 8000);
  if (!badgeCleared) {
    fail(
      "the bottom-nav badge did not clear within a few seconds of leaving the tab",
    );
    return;
  }
  ok(
    "the badge clears within a few seconds of leaving the tab — faster than the 30s interval alone could explain, proving the invalidation fired (Task 1 already proved the badge's presence in this same run, so asserting its absence here is safe)",
  );
}

// Pass (Task 2, Pitfall 2): a newly-arrived order picked up by the 30s poll
// while the vendor is STILL on the Orders tab must NOT be marked seen — the
// gate that would catch a mark-seen effect whose dependency list ever widens
// beyond `[storeId]`. Deliberately slow (waits out the real interval); runs
// once.
async function passPollDoesNotMarkSeen() {
  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home before the poll pass");
    return;
  }

  const firstName = `Smoke Poll Customer First ${String(Date.now())}`;
  const firstOrderId = await placeOrder({
    name: firstName,
    phone: freshPhone(),
  });

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText(firstName))) {
    fail("the first freshly-placed order never rendered before the poll pass");
    return;
  }
  // Lets the fresh mount's own initial fetch fully settle before
  // introducing the second stimulus, so this pass's own timing is
  // deterministic rather than racing the first render. Also the pass's
  // OWN falsifiability gate for the widened-dependency-list regression:
  // if the effect's dependency list ever includes ordersQuery.data (or any
  // orders-derived value), the transition from no-data to first-loaded-data
  // is ITSELF a dependency change, and its cleanup fires immediately — the
  // first order gets marked seen the instant the screen finishes loading,
  // before the vendor has done anything at all. A correct `[storeId]`-only
  // list never fires this cleanup on a mere data load.
  await sleep(3000);
  const firstStillUnseen = await query(
    `select is_new from public.orders where id = '${firstOrderId}';`,
  );
  if (firstStillUnseen !== "t") {
    fail(
      `merely loading the Orders tab cleared the first order's seen-ness flag on its own (is_new=${firstStillUnseen}) — the mark-seen effect must only fire on a true unmount, never on a data load`,
    );
    return;
  }
  ok(
    "merely loading the Orders tab does not, on its own, clear anything — confirms the mark-seen effect fires only on true unmount, not on a data change",
  );

  // With the tab STILL MOUNTED and no navigation of any kind, place a
  // second order and wait for the screen to pick it up on its own — the
  // 30s refetchInterval, no focus event, no reload.
  const secondName = `Smoke Poll Customer Second ${String(Date.now())}`;
  const secondOrderId = await placeOrder({
    name: secondName,
    phone: freshPhone(),
  });

  if (!(await waitForText(secondName, 40000))) {
    fail(
      "the second order, placed while the tab stayed mounted, never appeared via the poll",
    );
    return;
  }
  ok(
    "an order placed while the Orders tab stays mounted appears on its own via the 30s poll, no navigation and no focus event",
  );

  // Polled, not read once: if the mark-seen effect's dependency list were
  // ever widened, the cleanup's own mutation is async — a bare single read
  // taken immediately after the name appears can race ahead of that write
  // and observe a false "still true" before it lands. Waiting a few seconds
  // for a flip to false is the correct falsifiable shape for both
  // directions: it catches a real flip quickly, and a healthy
  // implementation simply exhausts the window with no flip.
  const isNew = await pollQuery(
    `select is_new from public.orders where id = '${secondOrderId}';`,
    (out) => out === "f",
    5000,
  );
  if (isNew !== "t") {
    fail(
      `expected the newly-arrived order's seen-ness flag to still read true (unseen) while the vendor is still on the screen, got is_new=${isNew}`,
    );
    return;
  }
  ok(
    "the newly-arrived order's seen-ness flag is STILL true while the vendor stays on the screen, even after a settle window — the poll did not silently mark it seen (Pitfall 2)",
  );
}

// Pass (Task 3, ORDR-04 focus trigger): proven INSIDE the 30s staleness
// window, where only `refetchOnWindowFocus: "always"` can explain the
// appearance — the plain boolean default only refetches on focus once the
// data is already stale, which src/app/providers.tsx's project-wide 30s
// staleTime would otherwise silently defeat for almost every real focus
// event. Never calls the query's own refetch(); drives a real
// hidden-then-visible transition instead (simulateVisibilityRefocus).
async function passFocusRefetchInsideWindow() {
  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("Orders"))) {
    fail("the Orders screen never rendered for the focus pass");
    return;
  }
  ok("the Orders tab loads fresh, well inside the 30s staleness window");

  const focusName = `Smoke Focus Customer ${String(Date.now())}`;
  await placeOrder({ name: focusName, phone: freshPhone() });

  const simulated = await simulateVisibilityRefocus();
  if (simulated !== "ok") {
    fail(`could not drive a visibility transition: ${simulated}`);
    return;
  }
  ok(
    "a real hidden-then-visible transition is driven through the query library's own focus subscription, never a direct call to the query's own refetch function",
  );

  // A tight window: the initial fetch just happened a moment ago, so
  // nothing here has had time to go stale under the project-wide 30s
  // staleTime, and no 30s interval tick could have fired yet either — only
  // the always-refetch setting explains an appearance this fast.
  const appeared = await waitForText(focusName, 8000);
  if (!appeared) {
    fail(
      "the focus-triggered order never appeared inside the staleness window — refetchOnWindowFocus is not bypassing the project-wide staleTime",
    );
    return;
  }
  ok(
    "the focus refetch surfaced a brand-new order within 8s of the initial fetch — well inside the 30s staleness window, where only refetchOnWindowFocus:'always' can explain it",
  );
}

// Pass (Task 3, ORDR-04 interval trigger): NO event of any kind — proves
// the 30s refetchInterval alone. Deliberately slow; runs once.
async function passIntervalRefetchNoEvent() {
  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home before the interval pass");
    return;
  }
  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("Orders"))) {
    fail("the Orders screen never rendered for the interval pass");
    return;
  }

  const intervalName = `Smoke Interval Customer ${String(Date.now())}`;
  await placeOrder({ name: intervalName, phone: freshPhone() });
  ok("a new order is placed with the Orders tab mounted and no event fired");

  const appeared = await waitForText(intervalName, 40000);
  if (!appeared) {
    fail(
      "the order never appeared via the interval alone — refetchInterval is not configured",
    );
    return;
  }
  ok(
    "the order appears on its own via the 30s refetchInterval, with no focus event and no navigation of any kind",
  );
}

// Pass (Task 1, ORDR-05): one tap confirms — the row re-renders its own
// confirmed label in place (never removed), the lifecycle column and its
// timestamp land at the database, both rejection columns and the seen-ness
// flag stay untouched, and exactly one order_confirmed event is recorded.
async function passConfirmOrder() {
  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("Orders"))) {
    fail("the Orders screen never rendered before the confirm pass");
    return null;
  }

  const confirmName = `Smoke Confirm Customer ${String(Date.now())}`;
  const orderId = await placeOrder({
    name: confirmName,
    phone: freshPhone(),
  });

  if (!(await waitForText(confirmName))) {
    fail("the freshly-placed order to confirm never rendered");
    return null;
  }

  const isNewBefore = await query(
    `select is_new::text from public.orders where id = '${orderId}';`,
  );

  const confirmLabel = `Confirm ${confirmName}'s order`;
  const rendered = await waitForCondition(() =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === ${JSON.stringify(confirmLabel)},
      );
      return b !== undefined && b !== null;
    })()`),
  );
  if (!rendered) {
    fail(
      `the Confirm control never rendered with its per-order accessible name ("${confirmLabel}")`,
    );
    return null;
  }
  ok(
    `the Confirm control renders with its per-order accessible name ("${confirmLabel}")`,
  );

  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-label") === ${JSON.stringify(confirmLabel)},
    );
    b.click();
    return "ok";
  })()`);

  const confirmedRendered = await waitForCondition(() =>
    evaluate(`(() => {
      const groups = [...document.querySelectorAll('[role="group"]')];
      const row = groups.find((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(confirmName)}));
      return row ? row.textContent.includes("Confirmed") : false;
    })()`),
  );
  if (!confirmedRendered) {
    fail(`the row's confirmed label never appeared for "${confirmName}"`);
    return null;
  }
  ok(
    `the row's confirmed label appears immediately after tapping Confirm ("${confirmName}")`,
  );

  const stillPresent = await evaluate(
    `document.body.innerText.includes(${JSON.stringify(confirmName)})`,
  );
  if (stillPresent !== true) {
    fail(
      `the row for "${confirmName}" vanished after confirming — it should re-render in place, not be removed`,
    );
    return null;
  }
  ok(
    `the row for "${confirmName}" is still present in the list after confirming — it changed, it did not vanish`,
  );

  const dbRow = await query(
    `select status, (confirmed_at is not null)::text, coalesce(rejection_reason,''), coalesce(rejection_note,''), is_new::text from public.orders where id = '${orderId}';`,
  );
  const [status, hasConfirmedAt, rejectionReason, rejectionNote, isNewAfter] =
    dbRow.split("|");
  if (status !== "confirmed" || hasConfirmedAt !== "true") {
    fail(
      `expected the lifecycle column to read confirmed with a non-null timestamp, got ${JSON.stringify(dbRow)}`,
    );
    return null;
  }
  if (rejectionReason !== "" || rejectionNote !== "") {
    fail(
      `expected both rejection columns to stay null on a confirm, got ${JSON.stringify(dbRow)}`,
    );
    return null;
  }
  if (isNewAfter !== isNewBefore) {
    fail(
      `expected the seen-ness flag to stay unchanged by a confirm, before=${isNewBefore} after=${isNewAfter}`,
    );
    return null;
  }
  ok(
    "confirming writes the lifecycle column and its timestamp, leaves both rejection columns null, and leaves the seen-ness flag unchanged — one column family touched, not two",
  );

  const eventCount = await pollQuery(
    `select count(*) from public.events where event_name = 'order_confirmed' and order_id = '${orderId}';`,
    (out) => out === "1",
  );
  if (eventCount !== "1") {
    fail(
      `expected exactly one order_confirmed event for this order, got ${eventCount}`,
    );
    return null;
  }
  ok(
    "exactly one order_confirmed event was recorded, carrying this order's id",
  );

  return orderId;
}

// Pass (Task 1, ORDR-05 failure case): a confirm that fails leaves a
// row-local message, no database change, and no event — the assertion set
// that would catch an event fired from the settle path (which also runs
// after this exact failure).
async function passConfirmOrderFailure() {
  const failName = `Smoke Confirm Fail Customer ${String(Date.now())}`;
  const orderId = await placeOrder({ name: failName, phone: freshPhone() });

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText(failName))) {
    fail(
      "the freshly-placed order for the confirm-failure pass never rendered",
    );
    return;
  }

  await armOrderUpdateFault();
  try {
    const confirmLabel = `Confirm ${failName}'s order`;
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === ${JSON.stringify(confirmLabel)},
      );
      if (!b) return "no Confirm control";
      b.click();
      return "ok";
    })()`);
    if (clicked !== "ok") {
      fail(`could not tap Confirm for the failure pass: ${clicked}`);
      return;
    }

    const alertRendered = await waitForCondition(() =>
      evaluate(`(() => {
        const groups = [...document.querySelectorAll('[role="group"]')];
        const row = groups.find((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(failName)}));
        if (!row) return false;
        const alert = row.querySelector('[role="alert"]');
        return alert !== null && alert.textContent.trim().length > 0;
      })()`),
    );
    if (!alertRendered) {
      fail(
        `a forced confirm failure never rendered the row-local inline alert for "${failName}"`,
      );
      return;
    }
    ok(
      "a forced confirm failure renders a row-local inline alert, never a page banner",
    );

    const stillPresent = await evaluate(
      `document.body.innerText.includes(${JSON.stringify(failName)})`,
    );
    if (stillPresent !== true) {
      fail(`the row for "${failName}" vanished after a failed confirm`);
      return;
    }
    ok(`the row for "${failName}" stays in the list after a failed confirm`);

    const dbRow = await query(
      `select status || '|' || (confirmed_at is not null)::text from public.orders where id = '${orderId}';`,
    );
    if (dbRow !== "new|false") {
      fail(
        `expected the failed confirm to leave the lifecycle column unchanged (new|false), got ${dbRow}`,
      );
      return;
    }
    ok(
      "a failed confirm leaves the lifecycle column at the database unchanged",
    );

    const eventCount = await query(
      `select count(*) from public.events where event_name = 'order_confirmed' and order_id = '${orderId}';`,
    );
    if (eventCount !== "0") {
      fail(
        `expected no order_confirmed event after a failed confirm, got ${eventCount}`,
      );
      return;
    }
    ok(
      "no order_confirmed event was written for a confirm that failed — the assertion that would catch an event fired from the settle path",
    );
  } finally {
    await disarmOrderUpdateFault();
  }
}

// Shared driver (Task 2): places a fresh order, opens its cancel-reason
// sheet, selects the named preset, optionally types a note, and submits —
// waiting for the sheet to close. Used by every Task 2 pass that only needs
// a real cancellation's end state (the KPI pass), not its individual UI
// assertions (those live in passCancelOrder itself, driven step by step).
async function cancelOrderThroughSheet({
  name,
  phone,
  presetLabel,
  note = "",
}) {
  const orderId = await placeOrder({ name, phone });

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText(name))) {
    throw new Error(`"${name}" never rendered before cancelling`);
  }

  const cancelLabel = `Cancel ${name}'s order`;
  await waitForCondition(() =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
      );
      return b !== undefined && b !== null;
    })()`),
  );
  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
    );
    b.click();
    return "ok";
  })()`);
  const opened = await waitForCondition(() =>
    evaluate(
      `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') !== null`,
    ),
  );
  if (!opened) {
    throw new Error(`the cancel-reason sheet never opened for "${name}"`);
  }

  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const preset = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim().includes(${JSON.stringify(presetLabel)}),
    );
    if (!preset) return "no preset";
    preset.click();
    return "ok";
  })()`);

  if (note) {
    await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
      const textarea = dialog ? dialog.querySelector("textarea") : null;
      if (!textarea) return "no textarea";
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value");
      desc.set.call(textarea, ${JSON.stringify(note)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`);
  }

  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const submit = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Confirm cancellation",
    );
    submit.click();
    return "ok";
  })()`);

  const closed = await waitForCondition(
    async () =>
      (await evaluate(
        `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') === null`,
      )) === true,
  );
  if (!closed) {
    throw new Error(`the cancel-reason sheet never closed for "${name}"`);
  }

  return orderId;
}

// Reads BOTH the general cancellation count (orders_cancelled) and the
// KPI-bearing subset (orders_cancelled_stock_discrepancy) as two separately
// named columns — the contrast between the two, not just the one, is what
// the pass below actually asserts.
async function getOrderOutcomeCounts() {
  const row = await query(
    `select
       coalesce(orders_cancelled, 0),
       coalesce(orders_cancelled_stock_discrepancy, 0)
     from private.order_outcomes
     where store_id = '${STORE_ID}';`,
  );
  const [cancelled, discrepancy] = row.split("|").map(Number);
  return { cancelled, discrepancy };
}

// Pass (Task 2, D-01/ORDR-05): cancelling requires a preset reason — the
// sheet's own distinct accessible name (the SECOND cancel-label tier), all
// four presets, a disabled submit before any choice, and a submit tap (the
// THIRD tier) that writes the preset code and the note to their own
// columns, leaves the customer's own note and the seen-ness flag untouched,
// and records exactly one cancel event.
async function passCancelOrder() {
  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText("Orders"))) {
    fail("the Orders screen never rendered before the cancel pass");
    return null;
  }

  const cancelName = `Smoke Cancel Customer ${String(Date.now())}`;
  const orderId = await placeOrder({ name: cancelName, phone: freshPhone() });

  if (!(await waitForText(cancelName))) {
    fail("the freshly-placed order to cancel never rendered");
    return null;
  }

  const customerNoteBefore = await query(
    `select coalesce(note, '') from public.orders where id = '${orderId}';`,
  );
  const isNewBefore = await query(
    `select is_new::text from public.orders where id = '${orderId}';`,
  );

  const cancelLabel = `Cancel ${cancelName}'s order`;
  const rowCancelRendered = await waitForCondition(() =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
      );
      return b !== undefined && b !== null;
    })()`),
  );
  if (!rowCancelRendered) {
    fail(
      `the row's Cancel control never rendered with its per-order accessible name ("${cancelLabel}")`,
    );
    return null;
  }
  ok(
    `the row's Cancel control ("Cancel order", the FIRST label tier) renders with its per-order accessible name ("${cancelLabel}")`,
  );

  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
    );
    b.click();
    return "ok";
  })()`);

  const sheetOpen = await waitForCondition(() =>
    evaluate(
      `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') !== null`,
    ),
  );
  if (!sheetOpen) {
    fail(
      'the cancel-reason sheet never opened with its own distinct accessible name ("Cancel this order", the SECOND label tier)',
    );
    return null;
  }
  ok(
    'the cancel-reason sheet opens, scoped to its own distinct accessible name ("Cancel this order") — the assertion Revision 1 exists to make possible',
  );

  const presetLabels = [
    "Out of stock",
    "Customer unreachable",
    "Order placed by mistake",
    "Other",
  ];
  const presetsRendered = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    if (!dialog) return false;
    const text = dialog.textContent || "";
    return ${JSON.stringify(presetLabels)}.every((label) => text.includes(label));
  })()`);
  if (presetsRendered !== true) {
    fail("not all four preset labels rendered inside the cancel-reason sheet");
    return null;
  }
  ok("all four preset labels render inside the cancel-reason sheet");

  const submitDisabledBefore = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const submit = dialog ? [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Confirm cancellation",
    ) : null;
    return submit ? submit.disabled : null;
  })()`);
  if (submitDisabledBefore !== true) {
    fail(
      `expected the submit to be disabled before any preset is chosen, got disabled=${JSON.stringify(submitDisabledBefore)}`,
    );
    return null;
  }
  ok(
    "the destructive submit is disabled before any preset is chosen — the required selection IS the confirmation step",
  );

  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const preset = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim().includes("Out of stock"),
    );
    if (preset) preset.click();
    return "ok";
  })()`);

  const noteText = `Smoke test note ${String(Date.now())}`;
  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const textarea = dialog ? dialog.querySelector("textarea") : null;
    if (!textarea) return "no textarea";
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value");
    desc.set.call(textarea, ${JSON.stringify(noteText)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);

  const submitEnabledAfter = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const submit = dialog ? [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Confirm cancellation",
    ) : null;
    return submit ? submit.disabled : null;
  })()`);
  if (submitEnabledAfter !== false) {
    fail(
      `expected the submit to be enabled once a preset is chosen, got disabled=${JSON.stringify(submitEnabledAfter)}`,
    );
    return null;
  }
  ok('choosing "Out of stock" enables the destructive submit');

  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const submit = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Confirm cancellation",
    );
    submit.click();
    return "ok";
  })()`);

  const sheetClosed = await waitForCondition(
    async () =>
      (await evaluate(
        `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') === null`,
      )) === true,
  );
  if (!sheetClosed) {
    fail("the cancel-reason sheet never closed after a successful submit");
    return null;
  }
  ok(
    "the sheet closes on a successful cancellation (the THIRD label tier submit tap)",
  );

  const cancelledLabelRendered = await waitForCondition(() =>
    evaluate(`(() => {
      const groups = [...document.querySelectorAll('[role="group"]')];
      const row = groups.find((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(cancelName)}));
      return row ? row.textContent.includes("Cancelled · Out of stock") : false;
    })()`),
  );
  if (!cancelledLabelRendered) {
    fail(
      `the row's cancelled status label never rendered with the chosen preset's human label for "${cancelName}"`,
    );
    return null;
  }
  ok(
    'the row re-renders its cancelled status label with the chosen preset\'s human label ("Cancelled · Out of stock")',
  );

  const dbRow = await query(
    `select status, (cancelled_at is not null)::text, coalesce(rejection_reason,''), coalesce(rejection_note,''), is_new::text, coalesce(note,'') from public.orders where id = '${orderId}';`,
  );
  const [
    status,
    hasCancelledAt,
    rejectionReason,
    rejectionNote,
    isNewAfter,
    customerNoteAfter,
  ] = dbRow.split("|");
  if (status !== "cancelled" || hasCancelledAt !== "true") {
    fail(
      `expected the lifecycle column to read cancelled with a non-null timestamp, got ${JSON.stringify(dbRow)}`,
    );
    return null;
  }
  if (rejectionReason !== "out_of_stock") {
    fail(
      `expected the preset code column to hold out_of_stock, got ${JSON.stringify(rejectionReason)}`,
    );
    return null;
  }
  if (rejectionNote !== noteText) {
    fail(
      `expected the note column to hold exactly what was typed, got ${JSON.stringify(rejectionNote)} want ${JSON.stringify(noteText)}`,
    );
    return null;
  }
  if (customerNoteAfter !== customerNoteBefore) {
    fail(
      `expected the customer's own note column to stay unchanged, before=${JSON.stringify(customerNoteBefore)} after=${JSON.stringify(customerNoteAfter)}`,
    );
    return null;
  }
  if (isNewAfter !== isNewBefore) {
    fail(
      `expected the seen-ness flag to stay unchanged by a cancel, before=${isNewBefore} after=${isNewAfter}`,
    );
    return null;
  }
  ok(
    "cancelling writes the lifecycle column, its timestamp, the preset code and the note to their own columns, and leaves both the customer's own note and the seen-ness flag unchanged",
  );

  const eventCount = await pollQuery(
    `select count(*) from public.events where event_name = 'order_cancelled' and order_id = '${orderId}';`,
    (out) => out === "1",
  );
  if (eventCount !== "1") {
    fail(
      `expected exactly one order_cancelled event for this order, got ${eventCount}`,
    );
    return null;
  }
  ok(
    "exactly one order_cancelled event was recorded, carrying this order's id",
  );

  return orderId;
}

// Pass (Task 2, ORDR-06): the only end-to-end assertion ORDR-06 actually
// asks for — the Catalog Accuracy Score's own column counts a
// stock-discrepancy cancellation made through the REAL screen, and does NOT
// count a same-store cancellation made for a different reason. Fully
// self-contained (its own two cancellations via cancelOrderThroughSheet),
// independent of any earlier pass's own side effects.
async function passCancelKpi() {
  const before = await getOrderOutcomeCounts();

  const firstName = `Smoke KPI Stock Customer ${String(Date.now())}`;
  await cancelOrderThroughSheet({
    name: firstName,
    phone: freshPhone(),
    presetLabel: "Out of stock",
  });

  const afterFirst = await getOrderOutcomeCounts();
  if (afterFirst.discrepancy !== before.discrepancy + 1) {
    fail(
      `expected the stock-discrepancy column to rise by exactly 1 after a real out_of_stock cancellation, before=${String(before.discrepancy)} after=${String(afterFirst.discrepancy)}`,
    );
    return;
  }
  ok(
    "the Catalog Accuracy Score's own column counts the stock-discrepancy cancellation made through the real screen",
  );

  const secondName = `Smoke KPI Other Customer ${String(Date.now())}`;
  await cancelOrderThroughSheet({
    name: secondName,
    phone: freshPhone(),
    presetLabel: "Customer unreachable",
  });

  const afterSecond = await getOrderOutcomeCounts();
  if (afterSecond.cancelled !== afterFirst.cancelled + 1) {
    fail(
      `expected the general cancellation count to rise by exactly 1 after the second cancellation, before=${String(afterFirst.cancelled)} after=${String(afterSecond.cancelled)}`,
    );
    return;
  }
  if (afterSecond.discrepancy !== afterFirst.discrepancy) {
    fail(
      `expected the stock-discrepancy count to stay unchanged for a non-stock cancellation, before=${String(afterFirst.discrepancy)} after=${String(afterSecond.discrepancy)}`,
    );
    return;
  }
  ok(
    "a cancellation for a different reason raises the general cancellation count without raising the stock-discrepancy count — the contrast that tells the two counts apart",
  );
}

// Pass (Task 2, T-06-31): a preset code the shared module does not contain
// is rejected by the database's own CHECK constraint — attempted by a
// direct write bypassing the sheet, because the sheet structurally cannot
// send a fifth code, and the only honest way to test a backstop is to go
// around the thing in front of it.
async function passRejectionReasonConstraint() {
  const name = `Smoke Constraint Customer ${String(Date.now())}`;
  const orderId = await placeOrder({ name, phone: freshPhone() });

  const attempt = await queryExpectError(
    `update public.orders set status = 'cancelled', cancelled_at = now(), rejection_reason = 'not_a_real_code' where id = '${orderId}';`,
  );
  if (!attempt.failed) {
    fail(
      "expected the database to reject a preset code outside the shared module's four values, but the write succeeded",
    );
    return;
  }
  if (!attempt.stderr.includes("23514")) {
    fail(`expected a 23514 CHECK-constraint rejection, got: ${attempt.stderr}`);
    return;
  }
  ok(
    "a preset code outside the shared module's four values is rejected by the database's own CHECK constraint (23514) — attempted by a direct write, since the sheet structurally cannot send a fifth code",
  );

  const untouched = await query(
    `select status || '|' || coalesce(rejection_reason, 'null') from public.orders where id = '${orderId}';`,
  );
  if (untouched !== "new|null") {
    fail(
      `expected the rejected write to leave the order untouched (new|null), got ${untouched}`,
    );
    return;
  }
  ok("the rejected write left the order's own columns untouched");
}

// Pass (Task 2, ORDR-05 failure case): a cancel submit that fails keeps the
// sheet OPEN with its own inline message, leaves the row and the database
// unchanged, and writes no event.
async function passCancelOrderFailure() {
  const failName = `Smoke Cancel Fail Customer ${String(Date.now())}`;
  const orderId = await placeOrder({ name: failName, phone: freshPhone() });

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (!(await waitForText(failName))) {
    fail("the freshly-placed order for the cancel-failure pass never rendered");
    return;
  }

  const cancelLabel = `Cancel ${failName}'s order`;
  await waitForCondition(() =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
      );
      return b !== undefined && b !== null;
    })()`),
  );
  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-label") === ${JSON.stringify(cancelLabel)},
    );
    b.click();
    return "ok";
  })()`);
  const sheetOpen = await waitForCondition(() =>
    evaluate(
      `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') !== null`,
    ),
  );
  if (!sheetOpen) {
    fail("the cancel-reason sheet never opened for the failure pass");
    return;
  }

  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
    const preset = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent.trim().includes("Other"),
    );
    if (preset) preset.click();
    return "ok";
  })()`);

  await armOrderUpdateFault();
  try {
    await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
      const submit = [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Confirm cancellation",
      );
      submit.click();
      return "ok";
    })()`);

    const alertInSheet = await waitForCondition(() =>
      evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
        if (!dialog) return false;
        const alert = dialog.querySelector('[role="alert"]');
        return alert !== null && alert.textContent.trim().length > 0;
      })()`),
    );
    if (!alertInSheet) {
      fail(
        "a forced cancel failure never rendered the sheet's own inline alert",
      );
      return;
    }
    ok(
      "a forced cancel failure renders the sheet's own inline message — the sheet owns this mutation",
    );

    const sheetStillOpen = await evaluate(
      `document.querySelector('[role="dialog"][aria-label="Cancel this order"]') !== null`,
    );
    if (sheetStillOpen !== true) {
      fail("the cancel-reason sheet closed after a failed submit");
      return;
    }
    ok(
      "the sheet stays OPEN after a failed submit — a dismissed sheet has nowhere to show the error",
    );

    const dbRow = await query(
      `select status || '|' || coalesce(rejection_reason, 'null') from public.orders where id = '${orderId}';`,
    );
    if (dbRow !== "new|null") {
      fail(
        `expected the failed cancel to leave the order unchanged (new|null), got ${dbRow}`,
      );
      return;
    }
    ok(
      "a failed cancel leaves the order's own columns at the database unchanged",
    );

    const eventCount = await query(
      `select count(*) from public.events where event_name = 'order_cancelled' and order_id = '${orderId}';`,
    );
    if (eventCount !== "0") {
      fail(
        `expected no order_cancelled event after a failed cancel, got ${eventCount}`,
      );
      return;
    }
    ok("no order_cancelled event was written for a cancel that failed");
  } finally {
    await disarmOrderUpdateFault();
    // Close the still-open sheet so later passes start from a clean screen.
    await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Cancel this order"]');
      const close = dialog ? dialog.querySelector('button[aria-label="Close"]') : null;
      if (close) close.click();
      return "ok";
    })()`);
  }
}

// Pass (Task 3, the phase's own goal sentence): the whole vendor journey in
// ONE sequence, with nothing seeded by SQL in the middle of it — a customer
// places an order (through the real place_order RPC, the same server-side
// contract 06-02/06-03's own customer browser flow drives through the UI;
// this file owns no customer-facing browser flow of its own, so calling the
// function directly is the closest honest equivalent without duplicating
// that flow here), the vendor opens the app and sees the badge, opens
// Orders and finds it under New, confirms it in one tap, leaves the tab,
// and returns to find it under Earlier with its confirmed label and the
// badge gone. Asserted as a single narrative, not as independently-passing
// parts.
async function passEndToEndJourney() {
  const journeyName = `Smoke Journey Customer ${String(Date.now())}`;
  const orderId = await placeOrder({
    name: journeyName,
    phone: freshPhone(),
  });

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForPathname("/"))) {
    fail("could not reach Home for the end-to-end journey pass");
    return;
  }
  const badgeAppeared = await waitForCondition(async () => {
    const badge = await readBadge();
    return badge?.badgeFound === true;
  });
  if (!badgeAppeared) {
    fail(
      "the badge never appeared on Home after the customer's order arrived (end-to-end journey)",
    );
    return;
  }
  ok(
    "the vendor opens the app and sees the badge after a customer's order arrives, with nothing seeded by SQL in between",
  );

  await send("Page.navigate", { url: `${BASE}/orders` });
  const foundInNew = await waitForCondition(() =>
    evaluate(`(() => {
      const groups = [...document.querySelectorAll('[role="group"]')];
      return groups.some((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(journeyName)}) && (g.getAttribute("aria-label") || "").includes(", new"));
    })()`),
  );
  if (!foundInNew) {
    fail(
      `the journey's own order never appeared under New for "${journeyName}"`,
    );
    return;
  }
  ok(
    `the vendor opens Orders and finds the customer's order under New ("${journeyName}")`,
  );

  const confirmLabel = `Confirm ${journeyName}'s order`;
  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-label") === ${JSON.stringify(confirmLabel)},
    );
    b.click();
    return "ok";
  })()`);
  const confirmedRendered = await waitForCondition(() =>
    evaluate(`(() => {
      const groups = [...document.querySelectorAll('[role="group"]')];
      const row = groups.find((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(journeyName)}));
      return row ? row.textContent.includes("Confirmed") : false;
    })()`),
  );
  if (!confirmedRendered) {
    fail(
      `the journey's order never showed its confirmed label after tapping Confirm`,
    );
    return;
  }
  ok("the vendor confirms it in one tap");

  const navClicked = await clickHomeNavLink();
  if (navClicked !== "ok") {
    fail(
      `could not leave the Orders tab for the end-to-end journey: ${navClicked}`,
    );
    return;
  }
  if (!(await waitForPathname("/"))) {
    fail(
      "leaving the Orders tab did not reach Home for the end-to-end journey",
    );
    return;
  }

  const badgeGone = await waitForCondition(async () => {
    const badge = await readBadge();
    return badge?.badgeFound === false;
  }, 8000);
  if (!badgeGone) {
    fail(
      "the badge never cleared after leaving the tab in the end-to-end journey",
    );
    return;
  }
  ok("leaving the tab clears the badge");

  await send("Page.navigate", { url: `${BASE}/orders` });
  const underEarlierHeading = await waitForCondition(() =>
    evaluate(`(() => {
      const headings = [...document.querySelectorAll("p")].filter(
        (p) => p.textContent.trim() === "Earlier",
      );
      const earlierHeading = headings[headings.length - 1];
      if (!earlierHeading) return false;
      const groups = [...document.querySelectorAll('[role="group"]')];
      const row = groups.find((g) => (g.getAttribute("aria-label") || "").includes(${JSON.stringify(journeyName)}));
      if (!row) return false;
      const isUnderEarlier = !!(earlierHeading.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
      const isConfirmed = row.textContent.includes("Confirmed");
      return isUnderEarlier && isConfirmed;
    })()`),
  );
  if (!underEarlierHeading) {
    fail(
      `the journey's order never returned under the Earlier section heading with its confirmed label for "${journeyName}"`,
    );
    return;
  }
  ok(
    "returning to Orders shows the customer's order under Earlier with its confirmed label and the badge cleared — the phase's own goal sentence, proven end to end in one sequence",
  );

  void orderId;
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
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: ORDER_FAULT_INJECTION_SCRIPT,
  });

  const divergence = await passEstablishDivergence();
  // Runs BEFORE any sign-in in this file: a signed-in vendor who already
  // has a shop is redirected away from /setup, so the fresh-signup pass
  // needs a browser with no session at all — the seeded vendor's sign-in
  // below must come after this, not before.
  await passFreshVendorEmptyOrders();
  await passBadgeAndHomeTile(divergence);
  await passOrdersScreen(divergence);
  await passMarkSeenOnUnmount();
  await passPollDoesNotMarkSeen();
  await passFocusRefetchInsideWindow();
  await passIntervalRefetchNoEvent();
  await passConfirmOrder();
  await passConfirmOrderFailure();
  await passCancelOrder();
  await passCancelKpi();
  await passRejectionReasonConstraint();
  await passCancelOrderFailure();
  await passEndToEndJourney();

  if (process.exitCode !== 1) console.log("\norders smoke flow: PASS");
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
