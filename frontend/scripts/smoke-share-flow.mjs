#!/usr/bin/env node
// Phase 4's second browser flow — the one every later plan in this phase
// extends. Proves, with a REAL vendor session in a real browser, that "View
// as customer" (SHAR-04) shows the vendor their own shop exactly as a
// customer sees it, with no ordering control anywhere in it, and that the
// vendor's own look is not written as a catalogue_opened row (DATA-06) — a
// DOM-only assertion would have passed on several of this project's shipped
// defects, so every claim below that something is absent or unwritten reads
// the database or the element's own geometry back, never just what the
// screen happens to render.
//
// 04-04 extends this same flow with the catalogue share sheet itself
// (HOME-03, SHAR-01, SHAR-03, DATA-06): before the first navigation, a CDP
// call replaces navigator.share, navigator.clipboard.writeText and
// window.open with in-page recorders, so every destination's dispatch can
// be asserted without a real OS share sheet — headless Chrome has none to
// hand a payload to. Every assertion below that a destination "worked"
// reads BOTH the recorder AND the database row it should have written,
// because a spy call proves the browser API was invoked, not that the
// share was actually recorded (see the falsifiability run in 04-04-SUMMARY.md).
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established (scaffolding copied from
// scripts/smoke-add-product.mjs).
//
// Usage: node scripts/smoke-share-flow.mjs [baseUrl]
//   BASE / argv[2]  default http://127.0.0.1:3100
//   CHROME_BIN      default google-chrome
//   DB_URL          default the local supabase postgres
// Requires the app to be already running at baseUrl and local Supabase up.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9340";

// A fresh number every run: one shop per mobile (BR1), so a reused number
// would take the duplicate path instead of the flow under test.
const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Smoke Preview Shop";
const PRODUCT_WITH_PHOTO = `Smoke Preview Product Photo ${String(Date.now())}`;
const PRODUCT_NO_PHOTO = `Smoke Preview Product NoPhoto ${String(Date.now())}`;
// CR-01/WR-01 fixture: seeded unavailable (never in either sheet's default
// "available" set), used only by passUnavailableProductShareFlow — kept out
// of passSetupAndSeedShop's own two-product seed so no earlier pass's
// preview/count assertions have to reason about a third, unavailable row.
const PRODUCT_UNAVAILABLE = `Smoke Preview Product Unavailable ${String(Date.now())}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors src/features/home/lib/greeting.ts's own hour boundaries exactly —
// used to wait for Home's real greeting text after leaving the preview,
// rather than a fixed string that only matches at some times of day.
function greetingForHour(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

// Polls rather than reading once: the catalogue_shares insert is
// deliberately not awaited before the browser dispatch (04-RESEARCH.md
// Pattern 3, the correction to its own original code block), so the row can
// land a tick after the DOM/recorder assertions already passed.
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

// Installed once, before the FIRST Page.navigate of this script's run
// (04-RESEARCH.md Pattern 3): replaces navigator.share and
// navigator.clipboard.writeText with recorders, and window.open with a
// recorder that never actually opens a tab. Also probes, and records on
// window, whether the real native functions existed at this origin BEFORE
// being replaced — printed at the end of the run so the SUMMARY can state
// plainly which destinations were exercised only through the injected
// recorders rather than a real platform capability. The clipboard object is
// CREATED if the origin does not already provide one — assigning straight
// through a missing object would throw before the app's own JS ever runs.
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

// Preparation pass: sign up a fresh vendor through the setup form (one shop
// per mobile — a reused number would hit the duplicate path instead of the
// flow under test), land on Home, read the new store's id back through
// psql, and seed two products for it directly through psql — one with a
// photo url, one without — so the preview has something to render and the
// placeholder branch is exercised.
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
    setVal(nameEl, "Smoke Preview Vendor");
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

  let reachedHome = false;
  for (let i = 0; i < 80; i++) {
    if ((await evaluate("location.pathname")) === "/") {
      reachedHome = true;
      break;
    }
    await sleep(200);
  }
  if (!reachedHome) {
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
    `insert into public.products (store_id, name, unit, available, image_url) values ('${storeId}', '${PRODUCT_WITH_PHOTO}', 'piece', true, 'https://example.com/fake-photo.jpg');`,
  );
  await query(
    `insert into public.products (store_id, name, unit, available) values ('${storeId}', '${PRODUCT_NO_PHOTO}', 'piece', true);`,
  );
  ok(
    "two products seeded for the fresh shop — one with a photo url, one without",
  );

  return { storeId };
}

// Behaviour pass: tap Home's preview control, wait for the banner's real
// sentence, then assert the whole D-04 contract at once — both seeded
// products render, no ordering control or copy is present, a back control
// exists, the vendor's own bottom navigation is present but covered (not
// merely unmounted — the overlay covers it, it does not remove it), and no
// catalogue_opened row lands for this store. Finally tap back and confirm
// Home's own greeting text reappears with the preview gone.
async function passPreviewFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the preview pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText("Preview as customer"))) {
    fail(`Home's preview link never rendered`);
    return;
  }

  const tapped = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Preview as customer"));
    if (!b) return "no preview button";
    b.click();
    return "ok";
  })()`);
  if (tapped !== "ok") {
    fail(`could not tap the preview control: ${tapped}`);
    return;
  }

  if (!(await waitForText("Previewing as customer"))) {
    fail(
      "the preview banner sentence never rendered after opening the preview",
    );
    return;
  }
  ok("tapping Home's preview control opens the banner naming it a preview");

  const bothProductsRendered =
    (await waitForText(PRODUCT_WITH_PHOTO)) &&
    (await waitForText(PRODUCT_NO_PHOTO));
  if (bothProductsRendered) {
    ok(
      "both seeded products (with and without a photo) render inside the preview",
    );
  } else {
    fail("one or both seeded products never rendered inside the preview");
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
      "no ordering control (checkbox or submit button) renders inside the preview",
    );
  } else {
    fail(
      `expected no ordering control inside the preview, found: ${JSON.stringify(noOrdering)}`,
    );
  }

  const hasBack = await evaluate(
    `document.querySelector('button[aria-label="Go back"]') !== null`,
  );
  if (hasBack === true) {
    ok("a back control is present inside the preview");
  } else {
    fail("no back control found inside the preview");
  }

  // The overlay COVERS the fixed bottom navigation rather than unmounting
  // it (a preview that just hides the nav from the DOM would pass this
  // check for the wrong reason). elementFromPoint at the nav's own
  // geometric center proves something else is stacked on top of it.
  const navCovered = await evaluate(`(() => {
    const nav = document.querySelector("nav");
    if (!nav) return { found: false };
    const rect = nav.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(cx, cy);
    return { found: true, navContainsTop: nav.contains(topElement) };
  })()`);
  if (navCovered?.found && navCovered.navContainsTop === false) {
    ok(
      "the vendor's bottom navigation is present but covered by the preview overlay",
    );
  } else {
    fail(
      `expected the bottom navigation to be present but covered, found: ${JSON.stringify(navCovered)}`,
    );
  }

  const openEventCount = await query(
    `select count(*) from public.events where event_name = 'catalogue_opened' and store_id = '${storeId}';`,
  );
  if (openEventCount === "0") {
    ok(
      "no catalogue_opened row exists for this store — the vendor's own preview is not counted as a customer visit",
    );
  } else {
    fail(
      `expected zero catalogue_opened rows for this store, found ${openEventCount}`,
    );
  }

  const clickedBack = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Go back"]');
    if (!btn) return "no back button found";
    btn.click();
    return "ok";
  })()`);
  if (clickedBack !== "ok") {
    fail(`could not tap the preview's back control: ${clickedBack}`);
    return;
  }

  const expectedGreeting = greetingForHour(new Date().getHours());
  if (!(await waitForText(expectedGreeting))) {
    fail("Home's own greeting text never reappeared after tapping back");
    return;
  }

  const previewGone = await evaluate(
    `!document.body.innerText.includes("Previewing as customer")`,
  );
  if (previewGone === true) {
    ok("tapping back returns to Home and the preview is gone");
  } else {
    fail("the preview banner text was still present after tapping back");
  }
}

// Catalogue share pass, WhatsApp destination (04-04, HOME-03, SHAR-01,
// SHAR-03, DATA-06): opens the sheet from Home, asserts the preview renders
// the shop identity and both seeded products, taps WhatsApp, and asserts
// BOTH the window.open recorder AND the database rows it should have
// written — a spy call alone proves the browser API was invoked, not that
// the share was recorded (see the plan's required falsifiability run).
async function passCatalogueShareFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the catalogue share pass");
    return;
  }

  const slug = await query(
    `select slug from public.stores where id = '${storeId}';`,
  );
  if (!slug) {
    fail("no slug found for the store under test");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText("Share today's catalogue"))) {
    fail("Home's share button never rendered");
    return;
  }

  const opened = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Share today's catalogue");
    if (!b) return "no share button";
    b.click();
    return "ok";
  })()`);
  if (opened !== "ok") {
    fail(`could not tap Home's share button: ${opened}`);
    return;
  }

  if (!(await waitForText("This is what your customers will see"))) {
    fail("the catalogue share sheet's preview never rendered");
    return;
  }
  ok("tapping Home's share button opens the catalogue preview");

  const previewShowsShop =
    (await waitForText(SHOP)) &&
    (await waitForText(PRODUCT_WITH_PHOTO)) &&
    (await waitForText(PRODUCT_NO_PHOTO));
  if (previewShowsShop) {
    ok(
      "the preview renders the shop name and both seeded products, read from what Home already fetched",
    );
  } else {
    fail("the preview did not render the shop name and both seeded products");
  }

  const tappedWhatsApp = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("WhatsApp"));
    if (!b) return "no WhatsApp button";
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

  const expectedUrl = `${BASE}/store/${slug}`;
  let waValid = false;
  if (spy?.url) {
    const parsed = new URL(spy.url);
    const text = parsed.searchParams.get("text");
    waValid =
      parsed.origin === "https://wa.me" &&
      spy.target === "_blank" &&
      (spy.features || "").includes("noopener") &&
      (spy.features || "").includes("noreferrer") &&
      text === `${SHOP}\n${expectedUrl}`;
  }
  if (waValid) {
    ok(
      "tapping WhatsApp opens a new tab to a wa.me URL whose text decodes to the title and the storefront URL",
    );
  } else {
    fail(
      `WhatsApp dispatch did not match the expected shape: ${JSON.stringify(spy)}`,
    );
  }

  const shareRow = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'catalogue' and product_id is null and destination = 'WhatsApp';`,
    (result) => result === "1",
  );
  if (shareRow === "1") {
    ok(
      "exactly one catalogue_shares row exists for this store with the catalogue share type, a null product id and the WhatsApp destination",
    );
  } else {
    fail(
      `expected exactly one catalogue_shares row for the WhatsApp destination, found ${shareRow}`,
    );
  }

  const eventRow = await pollQuery(
    `select count(*) from public.events e join public.stores s on s.id = e.store_id where e.event_name = 'catalogue_shared' and e.store_id = '${storeId}' and e.user_id = s.owner_id;`,
    (result) => result === "1",
  );
  if (eventRow === "1") {
    ok(
      "exactly one catalogue_shared event exists for this store, attributed to the vendor's own user id",
    );
  } else {
    fail(
      `expected exactly one catalogue_shared event attributed to the vendor, found ${eventRow}`,
    );
  }

  const probe = await evaluate(
    `({ share: window.__nativeShareExisted, clipboard: window.__nativeClipboardExisted })`,
  );
  console.log(
    `probe: at ${BASE}, navigator.share existed natively = ${JSON.stringify(probe?.share)}; navigator.clipboard.writeText existed natively = ${JSON.stringify(probe?.clipboard)}`,
  );

  return { slug };
}

// The three native-share destinations (04-04 Task 2): Status, Instagram and
// Other all call the identical navigator.share function (D-05) — each tap
// below asserts the SAME recorded payload shape, then polls for that
// button's OWN destination label landing as its own row, proving the three
// buttons stay independently attributable even though they're mechanically
// identical.
async function passOtherDestinationsFlow({ storeId, slug }) {
  if (!storeId || !slug) {
    fail("missing storeId/slug for the native-share destinations pass");
    return;
  }

  const expectedUrl = `${BASE}/store/${slug}`;

  for (const label of ["Status", "Instagram", "Other"]) {
    await evaluate(`window.__shareSpy = null;`);

    const tapped = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.textContent || "").includes(${JSON.stringify(label)}),
      );
      if (!b) return "no button";
      b.click();
      return "ok";
    })()`);
    if (tapped !== "ok") {
      fail(`could not tap the ${label} destination: ${tapped}`);
      continue;
    }

    let spy;
    for (let i = 0; i < 40; i++) {
      spy = await evaluate(`window.__shareSpy`);
      if (spy) break;
      await sleep(200);
    }

    const payloadMatches =
      spy?.title === SHOP &&
      spy?.text === `Available today at ${SHOP}` &&
      spy?.url === expectedUrl;
    if (payloadMatches) {
      ok(
        `tapping ${label} calls the native share with the same title/text/url the builders produce`,
      );
    } else {
      fail(
        `${label}'s native-share payload did not match, got: ${JSON.stringify(spy)}`,
      );
    }

    const row = await pollQuery(
      `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'catalogue' and product_id is null and destination = ${JSON.stringify(label).replace(/"/g, "'")};`,
      (result) => result === "1",
    );
    if (row === "1") {
      ok(
        `exactly one catalogue_shares row exists for the ${label} destination`,
      );
    } else {
      fail(
        `expected exactly one catalogue_shares row for the ${label} destination, found ${row}`,
      );
    }
  }
}

// The two edge paths (04-04 Task 2): a dismissed native share must show no
// error and must not stop the sheet from working — and it still records its
// own row, because the write happens before the dispatch, regardless of
// outcome (SHAR-03). Copy link is the fifth recorded destination.
async function passDismissalAndCopyFlow({ storeId, slug }) {
  if (!storeId || !slug) {
    fail("missing storeId/slug for the dismissal-and-copy pass");
    return;
  }

  const beforeDismiss = await query(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and destination = 'Status';`,
  );

  // Replace the recorder with one that rejects the way a dismissed OS share
  // sheet does — a real DOMException named AbortError, not a plain Error,
  // so the hook's own name check is genuinely exercised.
  await evaluate(`(() => {
    navigator.share = () => Promise.reject(new DOMException("dismissed", "AbortError"));
  })()`);

  await evaluate(`window.__clipboardSpy = null;`);

  const tappedDismiss = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Status"),
    );
    if (!b) return "no button";
    b.click();
    return "ok";
  })()`);
  if (tappedDismiss !== "ok") {
    fail(`could not tap Status for the dismissal pass: ${tappedDismiss}`);
    return;
  }

  await sleep(500);

  const noErrorText = await evaluate(
    `!document.body.innerText.toLowerCase().includes("something went wrong")`,
  );
  if (noErrorText === true) {
    ok("a dismissed native share shows no error text");
  } else {
    fail("an error message appeared after a dismissed native share");
  }

  // The behavioural half of "swallowed silently": a genuine dismissal must
  // NOT fall through to the copy-link fallback the way any OTHER
  // native-share rejection does — if this ever regresses to treating a
  // dismissal like a generic failure, the clipboard recorder below would
  // pick up a write it should never have received.
  const clipboardUntouchedByDismiss = await evaluate(
    `window.__clipboardSpy === null`,
  );
  if (clipboardUntouchedByDismiss === true) {
    ok("a dismissed native share does not fall back to copying the link");
  } else {
    fail("a dismissed native share incorrectly fell back to copying the link");
  }

  const sheetStillOpen = await evaluate(
    `document.querySelector('[role="dialog"]') !== null`,
  );
  if (sheetStillOpen === true) {
    ok("the sheet stays open and usable after a dismissed native share");
  } else {
    fail("the sheet closed or became unusable after a dismissed native share");
  }

  const afterDismiss = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and destination = 'Status';`,
    (result) => Number(result) === Number(beforeDismiss) + 1,
  );
  if (Number(afterDismiss) === Number(beforeDismiss) + 1) {
    ok("the dismissed share still recorded its own catalogue_shares row");
  } else {
    fail(
      `expected the Status destination count to increase by one after the dismissed share, was ${beforeDismiss}, now ${afterDismiss}`,
    );
  }

  // Restore the normal recorder — nothing later in this run taps a
  // native-share button again, but leaving the rejecting stub in place
  // would be a landmine for the next person extending this file.
  await evaluate(`(() => {
    navigator.share = (payload) => {
      window.__shareSpy = payload;
      return Promise.resolve();
    };
  })()`);

  await evaluate(`window.__clipboardSpy = null;`);
  const tappedCopy = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Copy"),
    );
    if (!b) return "no copy button";
    b.click();
    return "ok";
  })()`);
  if (tappedCopy !== "ok") {
    fail(`could not tap the copy-link button: ${tappedCopy}`);
    return;
  }

  let clipboardValue;
  for (let i = 0; i < 40; i++) {
    clipboardValue = await evaluate(`window.__clipboardSpy`);
    if (clipboardValue) break;
    await sleep(200);
  }
  const expectedUrl = `${BASE}/store/${slug}`;
  if (clipboardValue === expectedUrl) {
    ok(
      "the copy-link button writes exactly the storefront URL to the clipboard recorder",
    );
  } else {
    fail(
      `expected the clipboard recorder to hold ${expectedUrl}, got ${JSON.stringify(clipboardValue)}`,
    );
  }

  if (await waitForText("Link copied!")) {
    ok("the copy-link button shows its confirmation text");
  } else {
    fail("the copy-link button's confirmation text never appeared");
  }

  const copyRow = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and destination = 'Copy link';`,
    (result) => result === "1",
  );
  if (copyRow === "1") {
    ok("a catalogue_shares row exists for the Copy link destination");
  } else {
    fail(
      `expected exactly one catalogue_shares row for the Copy link destination, found ${copyRow}`,
    );
  }
}

// The sheet-to-preview round trip (04-04 Task 3, SHAR-04 criterion 5): the
// sheet's own "View today's catalogue" button opens the SAME preview 04-03
// built; coming back must show the sheet again in the state it was left in
// — never a fresh, re-opened sheet — because the sheet's state was never
// destroyed. The final assertion checks the sheet's OWN preview content
// (shop name, both seeded products), not merely that some dialog is open.
async function passRoundTripFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the round-trip pass");
    return;
  }

  const sheetOpenBeforeTrip = await waitForText(
    "This is what your customers will see",
  );
  if (!sheetOpenBeforeTrip) {
    fail("the share sheet was not open at the start of the round-trip pass");
    return;
  }

  const tappedViewCatalogue = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").trim() === "View today's catalogue",
    );
    if (!b) return "no view-catalogue button";
    b.click();
    return "ok";
  })()`);
  if (tappedViewCatalogue !== "ok") {
    fail(`could not tap the view-catalogue button: ${tappedViewCatalogue}`);
    return;
  }

  const previewOpened = await waitForText("Previewing as customer");
  const sheetGone = await evaluate(
    `!document.body.innerText.includes("This is what your customers will see")`,
  );
  if (previewOpened && sheetGone === true) {
    ok(
      "tapping the sheet's view-catalogue button opens the preview banner and the sheet is no longer on screen",
    );
  } else {
    fail(
      `expected the preview to open and the sheet to be gone, previewOpened=${previewOpened} sheetGone=${sheetGone}`,
    );
  }

  const clickedBack = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Go back"]');
    if (!btn) return "no back button found";
    btn.click();
    return "ok";
  })()`);
  if (clickedBack !== "ok") {
    fail(`could not tap the preview's back control: ${clickedBack}`);
    return;
  }

  const sheetShowsOwnPreview =
    (await waitForText("This is what your customers will see")) &&
    (await waitForText(SHOP)) &&
    (await waitForText(PRODUCT_WITH_PHOTO)) &&
    (await waitForText(PRODUCT_NO_PHOTO));
  const previewBannerGone = await evaluate(
    `!document.body.innerText.includes("Previewing as customer")`,
  );
  if (sheetShowsOwnPreview && previewBannerGone === true) {
    ok(
      "tapping back reopens the share sheet with its own preview content intact (shop name and both products), not merely some dialog",
    );
  } else {
    fail(
      `expected the sheet's own preview content after returning, got sheetShowsOwnPreview=${sheetShowsOwnPreview} previewBannerGone=${previewBannerGone}`,
    );
  }

  const closedSheet = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Close"]');
    if (!btn) return "no close button found";
    btn.click();
    return "ok";
  })()`);
  if (closedSheet !== "ok") {
    fail(`could not tap the sheet's close control: ${closedSheet}`);
    return;
  }

  const homeInteractive =
    (await waitForText("Share today's catalogue")) &&
    (await evaluate(`document.querySelector('[role="dialog"]') === null`));
  if (homeInteractive) {
    ok(
      "closing the sheet returns to an interactive Home with no dialog left open",
    );
  } else {
    fail("Home did not become interactive again after closing the sheet");
  }
}

// Product share pass, from the product detail page (04-05, SHAR-02,
// DATA-06): navigates to one of the seeded products' own detail page, taps
// its already-shipped "Share this product" control, asserts the preview
// shows that product's own name, taps WhatsApp, and asserts BOTH the
// window.open recorder's payload AND the database rows it should have
// written — the product share type, that product's id, and one
// catalogue_shared event naming it. Finally fetches the captured URL with
// plain HTTP and asserts it resolves to a page, proving the link a
// recipient receives opens the route 04-01 built, not just that a URL
// string was assembled correctly.
async function passProductShareFromDetailFlow({ storeId, slug }) {
  if (!storeId || !slug) {
    fail("missing storeId/slug for the product share (detail page) pass");
    return {};
  }

  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_WITH_PHOTO}';`,
  );
  if (!productId) {
    fail("no product id found for the seeded photo product");
    return {};
  }

  await send("Page.navigate", { url: `${BASE}/manage/${productId}` });
  if (!(await waitForText("Share this product"))) {
    fail("the product detail page's share control never rendered");
    return {};
  }

  const opened = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Share this product"));
    if (!b) return "no share button";
    b.click();
    return "ok";
  })()`);
  if (opened !== "ok") {
    fail(`could not tap the product detail page's share control: ${opened}`);
    return {};
  }

  const previewShowsProduct =
    (await waitForText("View in store")) &&
    (await waitForText(PRODUCT_WITH_PHOTO));
  if (previewShowsProduct) {
    ok(
      "tapping the product detail page's share control opens a preview showing that product's own name",
    );
  } else {
    fail("the product share preview never rendered that product's own name");
  }

  await evaluate(`window.__windowOpenSpy = null;`);

  const tappedWhatsApp = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("WhatsApp"));
    if (!b) return "no WhatsApp button";
    b.click();
    return "ok";
  })()`);
  if (tappedWhatsApp !== "ok") {
    fail(
      `could not tap the WhatsApp destination in the product sheet: ${tappedWhatsApp}`,
    );
    return {};
  }

  let spy;
  for (let i = 0; i < 40; i++) {
    spy = await evaluate(`window.__windowOpenSpy`);
    if (spy) break;
    await sleep(200);
  }

  const expectedUrl = `${BASE}/store/${slug}/p/${productId}`;
  let waValid = false;
  if (spy?.url) {
    const parsed = new URL(spy.url);
    const text = parsed.searchParams.get("text");
    waValid =
      parsed.origin === "https://wa.me" &&
      spy.target === "_blank" &&
      (spy.features || "").includes("noopener") &&
      (spy.features || "").includes("noreferrer") &&
      text === `${PRODUCT_WITH_PHOTO} · ${SHOP}\n${expectedUrl}`;
  }
  if (waValid) {
    ok(
      "tapping WhatsApp on a product share opens a new tab to a wa.me URL whose text decodes to a URL ending in this vendor's shop path and that product's id",
    );
  } else {
    fail(
      `product-share WhatsApp dispatch did not match the expected shape: ${JSON.stringify(spy)}`,
    );
  }

  const shareRow = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'product' and product_id = '${productId}' and destination = 'WhatsApp';`,
    (result) => result === "1",
  );
  if (shareRow === "1") {
    ok(
      "exactly one catalogue_shares row exists carrying the product share type, that product's id and the WhatsApp destination",
    );
  } else {
    fail(
      `expected exactly one catalogue_shares row for the product/WhatsApp pair, found ${shareRow}`,
    );
  }

  const eventRow = await pollQuery(
    `select count(*) from public.events e join public.stores s on s.id = e.store_id where e.event_name = 'catalogue_shared' and e.store_id = '${storeId}' and e.user_id = s.owner_id and e.product_id = '${productId}';`,
    (result) => result === "1",
  );
  if (eventRow === "1") {
    ok(
      "exactly one catalogue_shared event exists naming that product, attributed to the vendor's own user id",
    );
  } else {
    fail(
      `expected exactly one catalogue_shared event naming that product, found ${eventRow}`,
    );
  }

  // WR-01 fix: a plain HTTP fetch only proves the server answered with
  // SOME 200 HTML document — this route never returns a non-200 status,
  // even for an unresolvable product (D-02/A2's deliberate client-side-
  // only not-found handling), and the page itself is a client component
  // ("use client" in product-detail-page.tsx) that renders a generic
  // "Loading…" shell until it hydrates and its own TanStack Query resolves
  // — the SAME shell a plain fetch() would see for the real product and
  // for the not-found page alike. Only a real browser navigation, waited
  // out past hydration, can tell "opens this product" apart from "opens
  // the not-found page." (Confirmed empirically, not just reasoned about —
  // see the falsifiability transcript in the phase's REVIEW-FIX.md: the OLD
  // status+doctype-only check stayed `ok` even when pointed at a link that
  // renders the not-found page.)
  await send("Page.navigate", { url: expectedUrl });
  const sawProductName = await waitForText(PRODUCT_WITH_PHOTO, 15000);
  const sawNotFound = await evaluate(
    `document.body.innerText.includes("Product not found")`,
  );
  const linkResolves = sawProductName === true && sawNotFound !== true;
  if (linkResolves) {
    ok(
      "navigating to the captured product link renders that product's own name, and never the not-found page",
    );
  } else {
    fail(
      `the captured product link did not render the product (sawProductName=${sawProductName}, sawNotFound=${sawNotFound})`,
    );
  }

  return { productId };
}

// Product share pass, from the product LIST row (04-05 Task 2, SHAR-02): the
// same ProductShareSheet the detail page opens is now reachable from the
// row's own Share icon — closes the broken-windows entry Phase 3 opened for
// that no-op handler. Navigates to the list, taps the no-photo product's
// row-share control, asserts the preview shows that row's own product name,
// taps a native-share destination, and asserts BOTH the recorder's captured
// deep link AND the database row — one sheet, one recorded shape, from a
// second entry point.
async function passProductShareFromRowFlow({ storeId, slug }) {
  if (!storeId || !slug) {
    fail("missing storeId/slug for the product share (row) pass");
    return;
  }

  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_NO_PHOTO}';`,
  );
  if (!productId) {
    fail("no product id found for the seeded no-photo product");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/manage` });
  if (!(await waitForText(PRODUCT_NO_PHOTO))) {
    fail("the product list never rendered the seeded no-photo product's row");
    return;
  }

  const opened = await evaluate(`(() => {
    const b = document.querySelector('button[aria-label=${JSON.stringify(`Share ${PRODUCT_NO_PHOTO}`)}]');
    if (!b) return "no row share button";
    b.click();
    return "ok";
  })()`);
  if (opened !== "ok") {
    fail(`could not tap the row's share control: ${opened}`);
    return;
  }

  const previewShowsProduct = await waitForText("View in store");
  if (previewShowsProduct) {
    ok(
      "tapping a row's share control opens the same product sheet, showing that row's own product name",
    );
  } else {
    fail("the row's share control never opened a product share preview");
  }

  await evaluate(`window.__shareSpy = null;`);

  const tappedStatus = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Status"),
    );
    if (!b) return "no button";
    b.click();
    return "ok";
  })()`);
  if (tappedStatus !== "ok") {
    fail(
      `could not tap the Status destination from the row sheet: ${tappedStatus}`,
    );
    return;
  }

  let spy;
  for (let i = 0; i < 40; i++) {
    spy = await evaluate(`window.__shareSpy`);
    if (spy) break;
    await sleep(200);
  }

  const expectedUrl = `${BASE}/store/${slug}/p/${productId}`;
  if (spy?.url === expectedUrl) {
    ok(
      "the row-share sheet's native-share payload carries that row's own product deep link",
    );
  } else {
    fail(
      `expected the row-share payload's url to be ${expectedUrl}, got ${JSON.stringify(spy)}`,
    );
  }

  const row = await pollQuery(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and share_type = 'product' and product_id = '${productId}' and destination = 'Status';`,
    (result) => result === "1",
  );
  if (row === "1") {
    ok(
      "exactly one catalogue_shares row exists carrying the product share type, that row's product id and the Status destination",
    );
  } else {
    fail(
      `expected exactly one catalogue_shares row for the row-share/Status pair, found ${row}`,
    );
  }
}

// Unavailable-product share pass (CR-01 fix, WR-01's new coverage): seeds a
// third product already marked unavailable — kept out of
// passSetupAndSeedShop so no earlier pass's preview/count assertions have
// to reason about it — and proves the honest branch end to end. The Share
// control itself (product-detail-view.tsx's "Share this product" button)
// must stay exactly as shipped: visible and enabled, never hidden or
// dimmed (this project's standing rule against a control that vanishes or
// dead-taps, .planning/WINDOWS.md entry 1). What changes is the SHEET: no
// false "Available today," no destination grid, no copy-link button — only
// an honest status line and a single line telling the vendor what to do.
// The catalogue_shares insert path is only reachable through a destination
// tap, and there is deliberately no destination button here to tap, so the
// negative DB assertion below still waits out a settle window before
// reading — matching this script's own pollQuery discipline for the
// fire-and-not-awaited insert (04-RESEARCH.md Pattern 3) — rather than
// reading immediately and calling an unexercised code path "proven" empty.
async function passUnavailableProductShareFlow({ storeId, slug }) {
  if (!storeId || !slug) {
    fail("missing storeId/slug for the unavailable-product share pass");
    return;
  }

  await query(
    `insert into public.products (store_id, name, unit, available, image_url) values ('${storeId}', '${PRODUCT_UNAVAILABLE}', 'piece', false, 'https://example.com/fake-photo-unavailable.jpg');`,
  );

  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_UNAVAILABLE}';`,
  );
  if (!productId) {
    fail("no product id found for the seeded unavailable product");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/manage/${productId}` });
  if (!(await waitForText("Share this product"))) {
    fail(
      "the product detail page's share control never rendered for an unavailable product",
    );
    return;
  }

  const controlEnabled = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Share this product"));
    return b ? !b.disabled : null;
  })()`);
  if (controlEnabled === true) {
    ok(
      "the detail page's Share control stays visible and enabled for an unavailable product, exactly as it does for an available one",
    );
  } else {
    fail(
      `expected the Share control to be present and enabled for an unavailable product, got controlEnabled=${controlEnabled}`,
    );
  }

  const opened = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").includes("Share this product"));
    if (!b) return "no share button";
    b.click();
    return "ok";
  })()`);
  if (opened !== "ok") {
    fail(
      `could not tap the share control for an unavailable product: ${opened}`,
    );
    return;
  }

  const honestStatus =
    (await waitForText(PRODUCT_UNAVAILABLE)) &&
    (await waitForText("Currently unavailable"));
  if (honestStatus) {
    ok(
      "the sheet for an unavailable product shows its own name with an honest 'Currently unavailable' status",
    );
  } else {
    fail("the unavailable-product sheet never rendered the honest status line");
  }

  // Scoped to the sheet's own dialog subtree, NOT document.body: the vendor
  // product-detail page underneath renders a static "Available today"
  // toggle label of its own (product-detail-view.tsx), so a body-wide check
  // is true no matter what the sheet says — it failed identically with the
  // fix present and absent, which makes it evidence of nothing.
  const noFalseClaim = await evaluate(`(() => {
    const sheet = document.querySelector(
      '[role="dialog"][aria-label="Share product"]',
    );
    if (!sheet) return null;
    return !sheet.innerText.includes("Available today");
  })()`);
  if (noFalseClaim === true) {
    ok(
      "the unavailable-product sheet never claims 'Available today' anywhere on screen",
    );
  } else {
    fail("the unavailable-product sheet still rendered 'Available today'");
  }

  const sheetContent = await evaluate(`(() => {
    const sheet = document.querySelector(
      '[role="dialog"][aria-label="Share product"]',
    );
    if (!sheet) return null;
    // Every read below is scoped to the sheet, so nothing the screen behind
    // it renders can satisfy or defeat these checks.
    //
    // Case-insensitive on purpose: the label carries Tailwind's \`uppercase\`
    // class (share-sheet.tsx), so innerText reads "SHARE VIA" and an
    // exact-case match would be false even when the grid IS rendered —
    // making this negative assertion vacuous rather than protective.
    const hasShareVia = sheet.innerText.toUpperCase().includes("SHARE VIA");
    const hasWhatsApp = [...sheet.querySelectorAll("button")].some((b) =>
      (b.textContent || "").includes("WhatsApp"),
    );
    const hasCopyLink = [...sheet.querySelectorAll("button")].some((b) =>
      (b.textContent || "").trim().includes("Copy link"),
    );
    const hasTurnOnLine = sheet.innerText.includes(
      "Turn this item back on to share it.",
    );
    return { hasShareVia, hasWhatsApp, hasCopyLink, hasTurnOnLine };
  })()`);
  if (
    sheetContent &&
    sheetContent.hasShareVia === false &&
    sheetContent.hasWhatsApp === false &&
    sheetContent.hasCopyLink === false &&
    sheetContent.hasTurnOnLine === true
  ) {
    ok(
      "the unavailable-product sheet offers no destination grid and no copy-link button, only the 'Turn this item back on to share it.' line",
    );
  } else {
    fail(
      `expected no destinations and the turn-on line for an unavailable product, found: ${JSON.stringify(sheetContent)}`,
    );
  }

  // Settle window (see function comment) before the negative DB read.
  await sleep(2000);
  const shareRowCount = await query(
    `select count(*) from public.catalogue_shares where store_id = '${storeId}' and product_id = '${productId}';`,
  );
  if (shareRowCount === "0") {
    ok(
      "no catalogue_shares row exists for the unavailable product — its sheet has no destination path that could write one",
    );
  } else {
    fail(
      `expected zero catalogue_shares rows for the unavailable product, found ${shareRowCount}`,
    );
  }

  // Bonus end-to-end proof, beyond the two required assertions above: the
  // product's own customer-facing deep link renders the not-found page,
  // never the product — the same content-based technique WR-01's
  // strengthened assertion above uses, applied to the case CR-01 was
  // actually about.
  const productUrl = `${BASE}/store/${slug}/p/${productId}`;
  await send("Page.navigate", { url: productUrl });
  const notFoundRendered = await waitForText("Product not found", 15000);
  const unavailableNameLeaked = await evaluate(
    `document.body.innerText.includes(${JSON.stringify(PRODUCT_UNAVAILABLE)})`,
  );
  if (notFoundRendered === true && unavailableNameLeaked === false) {
    ok(
      "an unavailable product's own deep link renders the not-found page for a customer, never the product",
    );
  } else {
    fail(
      `expected the unavailable product's deep link to render not-found, got notFoundRendered=${notFoundRendered} unavailableNameLeaked=${unavailableNameLeaked}`,
    );
  }
}

// Validation-audit gap 1 (SHAR-01): every other pass in this file only ever
// seeds the shop's original two products, so the catalogue preview's own
// `.slice(0, 6)` cap and its "+N" overflow tile
// (catalogue-share-sheet.tsx:57-58) have never been exercised — nothing in
// this suite could go red if that cap were off by one, or if the overflow
// tile silently stopped rendering. This pass pushes the shop to seven
// available products (past the six-tile cap) and asserts the DOM actually
// shows six named tiles plus one overflow tile reading the correct count,
// then restores the fixture in a finally block.
async function passCatalogueOverflowFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the catalogue-overflow pass");
    return;
  }

  const extraNames = Array.from(
    { length: 5 },
    (_, i) => `Smoke Overflow Product ${String(i)} ${String(Date.now())}`,
  );

  try {
    for (const name of extraNames) {
      await query(
        `insert into public.products (store_id, name, unit, available, image_url) values ('${storeId}', '${name}', 'piece', true, 'https://example.com/fake-photo-overflow.jpg');`,
      );
    }

    const totalAvailable = await query(
      `select count(*) from public.products where store_id = '${storeId}' and available = true;`,
    );
    if (totalAvailable !== "7") {
      fail(
        `expected exactly 7 available products for the overflow pass, found ${totalAvailable}`,
      );
      return;
    }

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText("Share today's catalogue"))) {
      fail("Home's share button never rendered for the overflow pass");
      return;
    }

    const opened = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim() === "Share today's catalogue");
      if (!b) return "no share button";
      b.click();
      return "ok";
    })()`);
    if (opened !== "ok") {
      fail(
        `could not tap Home's share button for the overflow pass: ${opened}`,
      );
      return;
    }

    if (!(await waitForText(`Available today · 7 items`))) {
      fail(
        "the preview header never counted all 7 available products (not the 6 shown)",
      );
    } else {
      ok(
        "the preview header counts all 7 available products, not just the 6 tiles shown",
      );
    }

    const grid = await evaluate(`(() => {
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Share today\\'s catalogue"]',
      );
      const container = dialog ? dialog.querySelector(".grid-cols-3") : null;
      if (!container) return null;
      const children = [...container.children];
      return {
        tileCount: children.length,
        lastTileText: children[children.length - 1]?.textContent?.trim(),
      };
    })()`);

    if (grid && grid.tileCount === 7 && grid.lastTileText === "+1") {
      ok(
        "the catalogue preview caps the grid at 6 product tiles and renders a '+1' overflow tile for the 7th available product",
      );
    } else {
      fail(
        `expected 6 product tiles plus one '+1' overflow tile (7 grid children total), found: ${JSON.stringify(grid)}`,
      );
    }
  } finally {
    for (const name of extraNames) {
      await query(
        `delete from public.products where store_id = '${storeId}' and name = '${name}';`,
      );
    }
  }
}

// Direct-SQL offer insertion for this pass only — the flow's shop has no
// offers at any other point in this file, so this helper and the pass below
// are entirely self-contained: they seed their own products AND their own
// offers, and delete both in a restore block, leaving every other pass in
// this file (including passCatalogueOverflowFlow immediately above, and its
// own overflow gate) running against its own unchanged fixtures regardless
// of execution order. today_price_label is NOT NULL with no default, so it
// is always supplied; regular_price/regular_price_label stay NULL for the
// one offer given no regular price, matching the "no strikethrough element
// at all" partial case (05-04's own convention in smoke-offers-flow.mjs).
async function insertOfferSql({
  storeId,
  productId,
  offerPrice,
  regularPrice = null,
}) {
  const todayLabel = `₹${String(offerPrice)}`;
  const regularLabel =
    regularPrice === null ? "null" : `'₹${String(regularPrice)}'`;
  const regularValue = regularPrice === null ? "null" : String(regularPrice);
  const sql = `with ins as (
    insert into public.offers (store_id, product_id, offer_price, regular_price, today_price_label, regular_price_label)
    values ('${storeId}', '${productId}', ${String(offerPrice)}, ${regularValue}, '${todayLabel}', ${regularLabel})
    returning id
  ) select id from ins;`;
  return query(sql);
}

// D-11 (OFFR-02): the catalogue share preview's own offers block, above the
// untouched mini-grid, capped at three with its own independent overflow
// line, and the partial ("no regular price") row rendering no strikethrough
// element at all. Four temporary products are seeded so four distinct
// offers can exist at once (D-02: one offer per product per day) without
// touching the flow's own two long-lived seeded products — the mini-grid's
// own product count for this pass is therefore the flow's original two plus
// these four temporaries (six total, still within the grid's own six-tile
// cap), which is also what proves the identity band's count tracks
// PRODUCTS, not offers (six items, four offers — the two numbers disagree,
// so a band that silently switched to counting offers would be caught).
async function passCatalogueOffersBlockFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the catalogue offers-block pass");
    return;
  }

  const stamp = String(Date.now());
  const offerProductNames = [
    `Smoke Offer Preview Product A ${stamp}`,
    `Smoke Offer Preview Product B ${stamp}`,
    `Smoke Offer Preview Product C ${stamp}`,
    `Smoke Offer Preview Product D ${stamp}`,
  ];
  const offerIds = [];

  try {
    const productIds = [];
    for (const name of offerProductNames) {
      const id = await query(
        `with ins as (insert into public.products (store_id, name, unit, available) values ('${storeId}', '${name}', 'piece', true) returning id) select id from ins;`,
      );
      productIds.push(id);
    }

    const totalAvailable = await query(
      `select count(*) from public.products where store_id = '${storeId}' and available = true;`,
    );
    if (totalAvailable !== "6") {
      fail(
        `expected exactly 6 available products for the offers-block pass (2 long-lived + 4 temporary), found ${totalAvailable}`,
      );
      return;
    }

    // Inserted oldest-to-newest; use-offers.ts orders by created_at
    // descending, so product D (last inserted) lands first and product A
    // (first inserted) is the one excluded by the three-offer cap. Product
    // D — one of the three SHOWN rows — is given no regular price, so the
    // partial state is exercised inside the visible cap, not the excluded row.
    offerIds.push(
      await insertOfferSql({
        storeId,
        productId: productIds[0],
        offerPrice: 30,
        regularPrice: 40,
      }),
    );
    offerIds.push(
      await insertOfferSql({
        storeId,
        productId: productIds[1],
        offerPrice: 15,
        regularPrice: 20,
      }),
    );
    offerIds.push(
      await insertOfferSql({
        storeId,
        productId: productIds[2],
        offerPrice: 25,
        regularPrice: 35,
      }),
    );
    offerIds.push(
      await insertOfferSql({
        storeId,
        productId: productIds[3],
        offerPrice: 12,
      }),
    );

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText("Share today's catalogue"))) {
      fail("Home's share button never rendered for the offers-block pass");
      return;
    }

    const opened = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim() === "Share today's catalogue");
      if (!b) return "no share button";
      b.click();
      return "ok";
    })()`);
    if (opened !== "ok") {
      fail(
        `could not tap Home's share button for the offers-block pass: ${opened}`,
      );
      return;
    }

    // "Today's offers" is CSS `uppercase` (same gotcha the share sheet's own
    // "Share via" label has, per this script's own operating notes) — the
    // browser's rendered innerText is what waitForText reads, so this checks
    // the rendered case, not the JSX literal. The scoped evaluate() below
    // reads textContent instead, which is case-faithful to the source.
    if (!(await waitForText("TODAY'S OFFERS"))) {
      fail(
        "the offers block's section label never rendered inside the catalogue preview",
      );
      return;
    }
    ok("the catalogue preview's offers block section label renders");

    const state = await evaluate(`(() => {
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Share today\\'s catalogue"]',
      );
      if (!dialog) return null;
      const label = [...dialog.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const block = label ? label.parentElement : null;
      const rowsContainer = block ? block.querySelector(":scope > div") : null;
      const rows = rowsContainer
        ? [...rowsContainer.children].filter((c) => c.tagName === "DIV")
        : [];
      const grid = dialog.querySelector(".grid-cols-3");
      const productD = ${JSON.stringify(offerProductNames[3])};
      const rowForD = rows.find((r) => (r.textContent || "").includes(productD));
      let blockBeforeGrid = null;
      if (block && grid) {
        blockBeforeGrid =
          !!(block.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING);
      }
      return {
        rowCount: rows.length,
        overflowText: block ? block.textContent : "",
        rowDHasStrikethrough: rowForD
          ? !!rowForD.querySelector(".line-through")
          : null,
        blockBeforeGrid,
        gridTileCount: grid ? grid.children.length : null,
        headerText: dialog.textContent.includes("Available today")
          ? [...dialog.querySelectorAll("p")]
              .map((p) => p.textContent || "")
              .find((t) => t.includes("Available today"))
          : null,
      };
    })()`);

    if (!state || state.rowCount !== 3) {
      fail(
        `expected exactly 3 rows in the offers block, got ${JSON.stringify(state)}`,
      );
    } else {
      ok(
        "the offers block contains exactly 3 rows, capped independently of the mini-grid",
      );
    }

    if (state && state.overflowText.includes("+1 more offers")) {
      ok(
        "the offers block names exactly one more offer beyond its three-row cap",
      );
    } else {
      fail(
        `expected the offers block's overflow line to read "+1 more offers", got ${JSON.stringify(state?.overflowText)}`,
      );
    }

    if (state && state.rowDHasStrikethrough === false) {
      ok(
        "the offer with no regular price renders inside the visible cap with no strikethrough element at all",
      );
    } else {
      fail(
        `expected the no-regular-price offer's row to contain no strikethrough element, got ${JSON.stringify(state)}`,
      );
    }

    if (state && state.blockBeforeGrid === true) {
      ok("the offers block appears before the mini-grid in document order");
    } else {
      fail(
        `expected the offers block to precede the mini-grid in document order, got ${JSON.stringify(state?.blockBeforeGrid)}`,
      );
    }

    if (state && state.gridTileCount === 6) {
      ok(
        "the mini-grid still renders exactly 6 tiles for this shop's own available-product count, unaffected by the offers block above it",
      );
    } else {
      fail(
        `expected the mini-grid to still render 6 tiles, got ${JSON.stringify(state?.gridTileCount)}`,
      );
    }

    if (state && state.headerText && state.headerText.includes("6 items")) {
      ok(
        "the identity band's item count still reads the products count (6), not the offers count (4)",
      );
    } else {
      fail(
        `expected the identity band to read 6 items (the products count, not the 4 offers), got ${JSON.stringify(state?.headerText)}`,
      );
    }
  } finally {
    for (const id of offerIds) {
      if (id) await query(`delete from public.offers where id = '${id}';`);
    }
    for (const name of offerProductNames) {
      await query(
        `delete from public.products where store_id = '${storeId}' and name = '${name}';`,
      );
    }
  }
}

// Validation-audit gap 2 (SHAR-03, D-05): passDismissalAndCopyFlow only ever
// exercises a DOMException named AbortError (a genuine dismissal, which must
// NOT fall back to copying) and the explicit Copy Link button. D-05's other
// stated branch — "any OTHER native-share rejection falls through to
// copying the link" (use-share-destination.ts's selectDestination) — has
// never been exercised by any pass in this file. Nothing here could go red
// if that catch block were deleted or its condition inverted. This pass
// rejects with a plain Error (not a DOMException/AbortError) and proves the
// link still lands in the clipboard recorder.
async function passNativeShareGenericErrorFallsBackToCopyFlow({
  storeId,
  slug,
}) {
  if (!storeId || !slug) {
    fail(
      "missing storeId/slug for the native-share generic-error fallback pass",
    );
    return;
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText("Share today's catalogue"))) {
    fail(
      "Home's share button never rendered for the generic-error fallback pass",
    );
    return;
  }
  const opened = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Share today's catalogue");
    if (!b) return "no share button";
    b.click();
    return "ok";
  })()`);
  if (opened !== "ok") {
    fail(
      `could not tap Home's share button for the generic-error fallback pass: ${opened}`,
    );
    return;
  }
  if (!(await waitForText("This is what your customers will see"))) {
    fail(
      "the catalogue share sheet's preview never rendered for the generic-error fallback pass",
    );
    return;
  }

  // A plain rejection — no DOMException, no "AbortError" name — is what any
  // non-dismissal native-share failure looks like (a permission error, a
  // transient platform failure). Deliberately NOT the dismissal shape
  // passDismissalAndCopyFlow already covers.
  await evaluate(`(() => {
    navigator.share = () => Promise.reject(new Error("some other native-share failure"));
  })()`);
  await evaluate(`window.__clipboardSpy = null;`);

  const tapped = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Status"),
    );
    if (!b) return "no button";
    b.click();
    return "ok";
  })()`);
  if (tapped !== "ok") {
    fail(`could not tap Status for the generic-error fallback pass: ${tapped}`);
    return;
  }

  const expectedUrl = `${BASE}/store/${slug}`;
  let clipboardValue;
  for (let i = 0; i < 40; i++) {
    clipboardValue = await evaluate(`window.__clipboardSpy`);
    if (clipboardValue) break;
    await sleep(200);
  }
  if (clipboardValue === expectedUrl) {
    ok(
      "a native-share rejection that is NOT a dismissal (no AbortError) falls through to copying the storefront link, exactly as D-05 specifies",
    );
  } else {
    fail(
      `expected a non-dismissal native-share rejection to copy ${expectedUrl} to the clipboard recorder, got ${JSON.stringify(clipboardValue)}`,
    );
  }

  // Restore the normal recorder immediately, regardless of what runs after
  // this pass in the file — leaving the rejecting stub in place would be a
  // landmine for the next person extending it.
  await evaluate(`(() => {
    navigator.share = (payload) => {
      window.__shareSpy = payload;
      return Promise.resolve();
    };
  })()`);
}

// 05-05 Task 2 (D-11, D-13, D-03/D-14, criterion 4's third and last
// vendor-facing surface): the catalogue preview's own offers block reads the
// same filtered array Home's count and Manage Offers read, so this asserts
// the day boundary and the availability join on the block's own subtree —
// placed last in the file, after the native-share fallback pass above,
// which restores its own stub before this pass ever navigates.
async function passCatalogueOffersDayBoundaryFlow({ storeId }) {
  if (!storeId) {
    fail("no store id available for the catalogue offers day-boundary pass");
    return;
  }

  const todayProductId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_WITH_PHOTO}';`,
  );
  const staleProductId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${PRODUCT_NO_PHOTO}';`,
  );
  if (!todayProductId || !staleProductId) {
    fail(
      "could not resolve this flow's own two seeded product ids for the day-boundary pass",
    );
    return;
  }

  let todayOfferId;
  let staleOfferId;

  async function openCatalogueSheetFromHome(label) {
    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText("Share today's catalogue"))) {
      fail(`Home's share button never rendered ${label}`);
      return false;
    }
    const opened = await evaluate(`(() => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim() === "Share today's catalogue");
      if (!b) return "no share button";
      b.click();
      return "ok";
    })()`);
    if (opened !== "ok") {
      fail(`could not tap Home's share button ${label}: ${opened}`);
      return false;
    }
    if (!(await waitForText("This is what your customers will see"))) {
      fail(`the catalogue preview never rendered ${label}`);
      return false;
    }
    return true;
  }

  async function readOffersBlockState() {
    return evaluate(`(() => {
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Share today\\'s catalogue"]',
      );
      if (!dialog) return { dialogMissing: true };
      const label = [...dialog.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const block = label ? label.parentElement : null;
      const grid = dialog.querySelector(".grid-cols-3");
      return {
        blockPresent: !!block,
        blockText: block ? block.textContent : "",
        gridText: grid ? grid.textContent : "",
      };
    })()`);
  }

  try {
    todayOfferId = await insertOfferSql({
      storeId,
      productId: todayProductId,
      offerPrice: 18,
    });
    // D-13: a genuinely stale offer, expressed relative to the database's
    // own today expression, never a literal date.
    staleOfferId = await query(
      `with ins as (
        insert into public.offers (store_id, product_id, offer_price, today_price_label, offer_date)
        values ('${storeId}', '${staleProductId}', 22, '₹22', public.today_ist() - 1)
        returning id
      ) select id from ins;`,
    );

    if (!(await openCatalogueSheetFromHome("before the day-boundary pass"))) {
      return;
    }

    let state = await readOffersBlockState();
    if (!state || !state.blockPresent) {
      fail(
        `expected the offers block to be present with today's offer active, got ${JSON.stringify(state)}`,
      );
      return;
    }
    const rowCountToday = await evaluate(`(() => {
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Share today\\'s catalogue"]',
      );
      const label = [...dialog.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's offers",
      );
      const block = label ? label.parentElement : null;
      const rowsContainer = block ? block.querySelector(":scope > div") : null;
      return rowsContainer
        ? [...rowsContainer.children].filter((c) => c.tagName === "DIV").length
        : null;
    })()`);
    if (rowCountToday !== 1) {
      fail(
        `expected exactly 1 row in the offers block with one genuinely active offer, got ${JSON.stringify(rowCountToday)}`,
      );
    } else {
      ok(
        "the offers block contains exactly 1 row while a genuinely stale-dated offer also exists for this store",
      );
    }
    if (!state.blockText.includes(PRODUCT_WITH_PHOTO)) {
      fail("today's genuinely active offer never rendered inside the block");
      return;
    }
    ok("today's genuinely active offer renders inside the block's own subtree");
    // Scoped to the block's OWN text, never the dialog or the document: the
    // mini-grid below legitimately shows every available product including
    // the stale one's — a wider search would pass for the wrong reason,
    // exactly the mistake this project has already shipped once.
    if (state.blockText.includes(PRODUCT_NO_PHOTO)) {
      fail(
        `the stale-dated offer's product name appeared inside the offers block's own subtree: ${JSON.stringify(state.blockText)}`,
      );
      return;
    }
    ok(
      "the stale-dated offer's product name does not appear inside the offers block's own subtree",
    );

    await query(
      `update public.products set available = false where id = '${todayProductId}';`,
    );

    if (
      !(await openCatalogueSheetFromHome(
        "after today's offered product was marked unavailable",
      ))
    ) {
      return;
    }
    state = await readOffersBlockState();
    if (!state || state.blockPresent) {
      fail(
        `expected the offers block to be absent entirely once its only active offer's product went unavailable, got ${JSON.stringify(state)}`,
      );
    } else {
      ok(
        "the offers block is absent entirely once the only active offer's product is marked unavailable",
      );
    }
    if (!state || !state.gridText.includes(PRODUCT_NO_PHOTO)) {
      fail(
        `expected the mini-grid to still render the shop's remaining available product, got ${JSON.stringify(state?.gridText)}`,
      );
    } else {
      ok(
        "the mini-grid still renders the shop's remaining available products while the offers block is absent",
      );
    }

    await query(
      `update public.products set available = true where id = '${todayProductId}';`,
    );

    if (
      !(await openCatalogueSheetFromHome(
        "after the product was made available again",
      ))
    ) {
      return;
    }
    state = await readOffersBlockState();
    if (
      !state ||
      !state.blockPresent ||
      !state.blockText.includes(PRODUCT_WITH_PHOTO)
    ) {
      fail(
        `expected the offers block to return with its one row once availability was restored, got ${JSON.stringify(state)}`,
      );
    } else {
      ok(
        "the offers block returns with its one row once the product's availability is restored — the offer row was excluded by a join, never deleted",
      );
    }
  } finally {
    if (todayOfferId) {
      await query(`delete from public.offers where id = '${todayOfferId}';`);
    }
    if (staleOfferId) {
      await query(`delete from public.offers where id = '${staleOfferId}';`);
    }
    await query(
      `update public.products set available = true where id = '${todayProductId}';`,
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
  // Issued once, before the first Page.navigate of this run — every
  // subsequent document (including the setup form's own navigation below)
  // loads with the recorders already installed.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: SHARE_SPY_SCRIPT,
  });

  const { storeId } = await passSetupAndSeedShop();
  await passPreviewFlow({ storeId });
  const { slug } = await passCatalogueShareFlow({ storeId });
  await passOtherDestinationsFlow({ storeId, slug });
  await passDismissalAndCopyFlow({ storeId, slug });
  await passRoundTripFlow({ storeId });
  await passProductShareFromDetailFlow({ storeId, slug });
  await passProductShareFromRowFlow({ storeId, slug });
  await passUnavailableProductShareFlow({ storeId, slug });
  await passCatalogueOverflowFlow({ storeId });
  await passCatalogueOffersBlockFlow({ storeId });
  await passNativeShareGenericErrorFallsBackToCopyFlow({ storeId, slug });
  await passCatalogueOffersDayBoundaryFlow({ storeId });

  if (process.exitCode !== 1) console.log("\nshare smoke flow: PASS");
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
