#!/usr/bin/env node
// Phase 6's customer browser flow. Proves the cart primitive, the storefront
// card's Add/stepper, the real cart route, checkout and confirmation, the
// double-submit guard, the nine server rejections and the three ordering
// events — asserted against the DATABASE, not only what the DOM shows, the
// same discipline every sibling smoke-*.mjs script already established.
//
// This is a CUSTOMER flow: it runs against the SEEDED demo shop and NEVER
// signs in. That choice is load-bearing, not convenient — log_event prefers
// the session branch whenever one exists, so a signed-in browser would
// attribute every customer event to the vendor's own user id, and the
// anonymous-attribution assertions this flow depends on would silently be
// measuring the wrong actor (matching smoke-storefront-flow.mjs's own
// precedent, which asserts a null user id for exactly this reason).
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established.
//
// Usage: node scripts/smoke-cart-flow.mjs [baseUrl]
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
const CDP_PORT = process.env.CDP_PORT ?? "9342";

// The seeded demo shop, deterministic byte-for-byte after `db reset` — see
// 04-01-PLAN.md's interfaces block. Reused verbatim from
// smoke-storefront-flow.mjs's own fixture ids.
const SLUG = "priya-stores";
const STORE_ID = "00000000-0000-4000-8000-000000000002";
const TOMATOES_ID = "00000000-0000-4000-8000-000000000020"; // unit kg
const BANANAS_ID = "00000000-0000-4000-8000-000000000021"; // unit dozen, no offer
const OFFER_ID = "00000000-0000-4000-8000-000000000030"; // Tomatoes' seeded offer row
const OFFER_PRICE = 40;
const REGULAR_PRICE = 50;

// Task 3's own fault injection, the same established technique
// smoke-offers-flow.mjs's own FAULT_INJECTION_SCRIPT/__forceProductsError
// uses: a monkey-patched window.fetch, initialised from localStorage (a
// plain window property does not survive a full Page.navigate/reload) so
// it can be armed before the cart route's very first mount.
const FAULT_INJECTION_SCRIPT = `
(() => {
  window.__forceProductsError = localStorage.getItem("gsdCartForceProductsError") === "1";
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (window.__forceProductsError && url.includes("/rest/v1/products") && method === "GET") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "forced failure for the cart flow's own degraded-read pass" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return realFetch(input, init);
  };
})();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`not ok: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
}

function randomPhone() {
  // 10 digits, always starting 9 so it never collides with the seeded
  // vendor's own 9876543210 — a fresh random phone per pass, matching
  // smoke-storefront-flow.mjs's own scoping discipline (the seeded shop
  // already carries eight orders and every flow run adds more, so an
  // unscoped count would drift for reasons unrelated to what is being
  // proven).
  let digits = "9";
  for (let i = 0; i < 9; i++) digits += String(Math.floor(Math.random() * 10));
  return digits;
}

async function waitForText(text, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Case-insensitive: a CSS `uppercase` label transforms the rendered
    // text without changing the DOM's own text content, and `innerText`
    // reflects that CSS transform — a case-sensitive match against the
    // source casing never fires for such a label (a pitfall this project
    // has already recorded once).
    const found = await evaluate(
      `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    );
    if (found === true) return true;
    await sleep(250);
  }
  return false;
}

async function waitForPathname(pathname, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const path = await evaluate(`window.location.pathname`);
    if (path === pathname) return true;
    await sleep(250);
  }
  return false;
}

async function pollQuery(sql, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await query(sql);
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
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

// Finds a storefront card's outer container by the product name inside it —
// the card is a <div> holding two sibling buttons after this phase's
// restructuring (divergence 4), so a card can no longer be found by
// `button.textContent`. Returns a small descriptor script fragment reused
// by the tap helpers below.
function cardByName(name) {
  return `[...document.querySelectorAll("div")].filter((d) => {
    const cls = d.className || "";
    return cls.includes("overflow-hidden") && cls.includes("rounded-xl") && cls.includes("bg-card") && cls.includes("border-border");
  }).find((d) => d.textContent.includes(${JSON.stringify(name)}))`;
}

async function tapCardAdd(name) {
  return evaluate(`(() => {
    const card = ${cardByName(name)};
    if (!card) return "no card found for ${name}";
    const addBtn = [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add");
    if (!addBtn) return "no Add button found on the ${name} card";
    addBtn.click();
    return "ok";
  })()`);
}

async function tapCardStepper(name, direction) {
  const label =
    direction === "inc" ? `Add one more ${name}` : `Remove one ${name}`;
  return evaluate(`(() => {
    const card = ${cardByName(name)};
    if (!card) return "no card found for ${name}";
    const btn = card.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!btn) return "no ${direction} button found on the ${name} card";
    btn.click();
    return "ok";
  })()`);
}

async function readCardQty(name) {
  return evaluate(`(() => {
    const card = ${cardByName(name)};
    if (!card) return null;
    const decBtn = card.querySelector('button[aria-label="Remove one ${name}"]');
    if (!decBtn) return null;
    const qtySpan = decBtn.parentElement.querySelector("span");
    return qtySpan ? qtySpan.textContent.trim() : null;
  })()`);
}

// Finds an offers-strip row's outer container by the product name inside
// it — same reasoning as cardByName above (divergence 4's two-sibling-button
// restructuring applies here too): a row can no longer be found by
// `button.textContent`. Matched on the row's own distinctive class set
// (offers-strip.tsx's row div), never on the card's own outer div, which
// carries a different class set (no "p-2.5", no "items-center").
function stripRowByName(name) {
  return `[...document.querySelectorAll("div")].filter((d) => {
    const cls = d.className || "";
    return cls.includes("items-center") && cls.includes("rounded-xl") && cls.includes("border-border") && cls.includes("bg-card") && cls.includes("p-2.5");
  }).find((d) => d.textContent.includes(${JSON.stringify(name)}))`;
}

async function tapStripAdd(name) {
  return evaluate(`(() => {
    const row = ${stripRowByName(name)};
    if (!row) return "no strip row found for ${name}";
    const addBtn = [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add");
    if (!addBtn) return "no Add button found on the ${name} strip row";
    addBtn.click();
    return "ok";
  })()`);
}

// The row's OTHER half — its first button in DOM order, wrapping the
// thumbnail/name/price and never carrying the word "Add" — proving the two
// sibling buttons are genuinely separate click targets (this task's own
// falsifiability requirement).
async function tapStripNav(name) {
  return evaluate(`(() => {
    const row = ${stripRowByName(name)};
    if (!row) return "no strip row found for ${name}";
    const navBtn = row.querySelector("button");
    if (!navBtn) return "no navigation button found on the ${name} strip row";
    navBtn.click();
    return "ok";
  })()`);
}

async function readStripQty(name) {
  return evaluate(`(() => {
    const row = ${stripRowByName(name)};
    if (!row) return null;
    const decBtn = row.querySelector('button[aria-label="Remove one ${name}"]');
    if (!decBtn) return null;
    const qtySpan = decBtn.parentElement.querySelector("span");
    return qtySpan ? qtySpan.textContent.trim() : null;
  })()`);
}

// The product-detail screen's own stepper — unambiguous by document-wide
// query, since only one product's stepper is ever rendered on this route.
async function tapDetailStepper(name, direction) {
  const label =
    direction === "inc" ? `Add one more ${name}` : `Remove one ${name}`;
  return evaluate(`(() => {
    const btn = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!btn) return "no ${direction} button found on the detail screen";
    btn.click();
    return "ok";
  })()`);
}

// Pass 1 (Task 1): a customer adds one product, adjusts the quantity, opens
// the real cart URL, submits, and exactly one correctly-priced order with
// its line item exists in the shop's database, with the cart emptied
// afterwards.
async function passAddOneProductAndReceiveOrder() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();
  const customerName = "Meera Nair";

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Tomatoes"))) {
    fail("the storefront grid never rendered the seeded Tomatoes card");
    return;
  }

  const addResult = await tapCardAdd("Tomatoes");
  if (addResult !== "ok") {
    fail(`could not tap Add on the Tomatoes card: ${addResult}`);
    return;
  }
  await sleep(200);
  const qtyAfterAdd = await readCardQty("Tomatoes");
  if (qtyAfterAdd !== "1") {
    fail(
      `expected the Tomatoes card's stepper to read "1" after Add, got ${JSON.stringify(qtyAfterAdd)}`,
    );
    return;
  }
  ok(
    "tapping Add on the storefront card turns the slot into a stepper reading 1",
  );

  const incResult = await tapCardStepper("Tomatoes", "inc");
  if (incResult !== "ok") {
    fail(`could not tap the Tomatoes card's increment button: ${incResult}`);
    return;
  }
  await sleep(200);
  const qtyAfterInc = await readCardQty("Tomatoes");
  if (qtyAfterInc !== "2") {
    fail(
      `expected the Tomatoes card's stepper to read "2" after one increment, got ${JSON.stringify(qtyAfterInc)}`,
    );
    return;
  }
  ok("tapping the card's increment button advances the stepper to 2");

  if (!(await tapHeaderCartButton())) {
    fail("could not tap the header's cart control");
    return;
  }
  if (!(await waitForPathname(`/store/${SLUG}/cart`))) {
    fail("tapping the header's cart control never navigated to the cart route");
    return;
  }
  ok(
    "tapping the header's cart control opens the real /store/[slug]/cart route",
  );

  if (!(await waitForText("Your cart"))) {
    fail("the cart screen's own header never rendered");
    return;
  }
  ok("the cart screen renders its own header");

  if (!(await waitForText("Tomatoes"))) {
    fail("the cart's line item never rendered the product's name");
    return;
  }
  if (!(await waitForText(String(OFFER_PRICE)))) {
    fail("the cart's line item never rendered the seeded offer price");
    return;
  }
  ok("the cart line item renders the product's name and its offer price");

  if (!(await waitForText("2 kg"))) {
    fail(
      'the cart line item never rendered the full "2 kg" quantity-and-unit stepper form',
    );
    return;
  }
  ok(
    'the cart line item\'s stepper renders the full "2 kg" quantity-and-unit form',
  );

  await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector("#cart-name"), ${JSON.stringify(customerName)});
    setVal(document.querySelector("#cart-phone"), ${JSON.stringify(phone)});
  })()`);

  const submitted = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
    if (!btn) return "no submit button found";
    if (btn.disabled) return "submit button is disabled";
    btn.click();
    return "ok";
  })()`);
  if (submitted !== "ok") {
    fail(`could not submit the order: ${submitted}`);
    return;
  }

  if (!(await waitForText("Order received ✓"))) {
    fail("the confirmation heading never rendered after submit");
    return;
  }
  ok("submitting the order renders the confirmation heading");

  if (!(await waitForText("Your order"))) {
    fail("the confirmation's order card never rendered");
    return;
  }
  ok("the confirmation renders the order card");

  const orderRow = await pollQuery(
    `select id, customer_name, customer_phone, is_new, status, total from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}' and created_at > '${beforeTs}';`,
    (out) => out.length > 0,
  );
  const [orderId, dbName, dbPhone, isNew, status, total] = orderRow.split("|");
  if (!orderId) {
    fail(`expected exactly one order row for phone ${phone}, found none`);
    return;
  }
  if (dbName !== customerName) {
    fail(
      `expected the order's stored name to be "${customerName}", got ${JSON.stringify(dbName)}`,
    );
  } else {
    ok("the order's stored name matches the trimmed, typed name");
  }
  if (dbPhone !== phone) {
    fail(
      `expected the order's stored phone to be the digits-only "${phone}", got ${JSON.stringify(dbPhone)}`,
    );
  } else {
    ok("the order's stored phone matches the digits-only typed number");
  }
  if (isNew !== "t") {
    fail(
      `expected the new order's is_new flag to be true, got ${JSON.stringify(isNew)}`,
    );
  } else {
    ok("the new order's is_new flag is true");
  }
  if (status !== "new") {
    fail(
      `expected the new order's status to be "new", got ${JSON.stringify(status)}`,
    );
  } else {
    ok('the new order\'s lifecycle status is "new"');
  }
  const expectedTotal = String(OFFER_PRICE * 2);
  if (total !== expectedTotal) {
    fail(
      `expected the order's total to equal ${expectedTotal} (offer price × qty 2), got ${JSON.stringify(total)}`,
    );
  } else {
    ok(
      "the order's total equals the seeded offer price times the submitted quantity, read back from the database",
    );
  }

  const itemCount = await query(
    `select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where oi.order_id = '${orderId}' and oi.qty = 2 and oi.product_name = 'Tomatoes' and o.store_id = '${STORE_ID}';`,
  );
  if (itemCount === "1") {
    ok(
      "exactly one order line exists for this order with quantity 2 and the product's name",
    );
  } else {
    fail(
      `expected exactly one order line with qty 2 for Tomatoes, found ${itemCount}`,
    );
  }

  // Anonymous attribution, asserted rather than assumed (matches
  // smoke-storefront-flow.mjs's own precedent): this flow never signs in,
  // so log_event's own resolution must fall through to the visitor-id
  // branch, never the session branch, for every event this order produced.
  const orderPlacedUserId = await query(
    `select user_id::text from public.events where event_name = 'order_placed' and order_id = '${orderId}';`,
  );
  if (orderPlacedUserId === "") {
    ok(
      "the order_placed event's user_id is null — this anonymous customer's event was never attributed to the vendor's own session",
    );
  } else {
    fail(
      `expected the order_placed event's user_id to be null, got ${JSON.stringify(orderPlacedUserId)}`,
    );
  }

  const doneResult = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Done");
    if (!btn) return "no Done button found";
    btn.click();
    return "ok";
  })()`);
  if (doneResult !== "ok") {
    fail(`could not tap Done: ${doneResult}`);
    return;
  }
  if (!(await waitForPathname(`/store/${SLUG}`))) {
    fail("tapping Done never navigated back to the storefront");
  } else {
    ok("tapping Done navigates back to the storefront");
  }

  const cartKeyGone = await evaluate(
    `localStorage.getItem("cart:${SLUG}") === null`,
  );
  if (cartKeyGone === true) {
    ok("this shop's cart key is gone from browser storage after Done");
  } else {
    fail("expected this shop's cart storage key to be removed after Done");
  }
}

async function clearCartStorage() {
  await evaluate(`localStorage.removeItem("cart:${SLUG}")`);
}

async function fillNameAndPhone(name, phone) {
  await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector("#cart-name"), ${JSON.stringify(name)});
    setVal(document.querySelector("#cart-phone"), ${JSON.stringify(phone)});
  })()`);
}

async function tapHeaderCartButton() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("View cart"));
      if (!btn) return "no header cart button found";
      btn.click();
      return "ok";
    })()`);
    if (result === "ok") return true;
    await sleep(250);
  }
  return false;
}

async function openCartWithOneTomato() {
  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Tomatoes"))) return false;
  const added = await tapCardAdd("Tomatoes");
  if (added !== "ok") return false;

  // Poll for the stepper to actually settle at 1 before proceeding — a
  // fixed sleep is a race against React's own commit under headless Chrome.
  const qtyDeadline = Date.now() + 5000;
  let qtySettled = false;
  while (Date.now() < qtyDeadline) {
    if ((await readCardQty("Tomatoes")) === "1") {
      qtySettled = true;
      break;
    }
    await sleep(150);
  }
  if (!qtySettled) return false;

  if (!(await tapHeaderCartButton())) return false;
  return waitForPathname(`/store/${SLUG}/cart`);
}

// Pass 2 (Task 2): a genuine double tap — two clicks dispatched in ONE
// synchronous browser task, before React can re-render `disabled` — creates
// EXACTLY ONE order row. The rate limit cannot be what makes this pass: at
// five orders per phone per store per hour, an unguarded second submit
// would SUCCEED and produce a second row, not a rejection. So this pass
// also asserts the phone's own rolling-hour count sits below the threshold,
// which is what makes a count of one attributable to the guard alone.
async function passDoubleSubmitCreatesOneOrder() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();

  if (!(await openCartWithOneTomato())) {
    fail(
      "could not reach the cart with one Tomatoes item for the double-submit pass",
    );
    return;
  }
  await fillNameAndPhone("Double Tap", phone);

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
    btn.click();
    btn.click();
  })()`);

  if (!(await waitForText("Order received ✓"))) {
    fail("the confirmation never rendered after the double-tapped submit");
    return;
  }

  const orderCount = await pollQuery(
    `select count(*) from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}' and created_at > '${beforeTs}';`,
    () => true,
    3000,
  );
  if (orderCount === "1") {
    ok(
      "a genuine double tap on the submit button produced exactly ONE order row",
    );
  } else {
    fail(
      `expected exactly one order row for a double-tapped submit, found ${orderCount}`,
    );
  }

  const rollingHourCount = await query(
    `select count(*) from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}' and created_at > now() - interval '1 hour';`,
  );
  if (Number(rollingHourCount) < 5) {
    ok(
      `this phone's rolling-hour order count (${rollingHourCount}) sits below the 5-per-hour rate limit — the single row above is attributable to the guard, not the limit`,
    );
  } else {
    fail(
      `expected this phone's rolling-hour order count to sit below the rate limit, got ${rollingHourCount}`,
    );
  }

  const alertPresent = await evaluate(
    `document.querySelector('[role="alert"]') !== null`,
  );
  if (alertPresent === false) {
    ok(
      "no alert element is present after the double-tapped submit succeeded once",
    );
  } else {
    fail("expected no alert element after a successful double-tapped submit");
  }

  const itemRowCount = await query(
    `select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where o.store_id = '${STORE_ID}' and o.customer_phone = '${phone}' and o.created_at > '${beforeTs}';`,
  );
  if (itemRowCount === "1") {
    ok("the double-tapped order also carries exactly one order line, not two");
  } else {
    fail(
      `expected exactly one order line for the double-tapped order, found ${itemRowCount}`,
    );
  }
}

// Pass 3 (Task 2): three of the nine named server rejections, driven
// through the real screen, each asserted against the exact mapped sentence
// read from the alert element itself — never the whole document.
async function passNamedRejections() {
  // invalid_phone: passes this client's own >=6-digit gate but fails the
  // server's 6..15-digit range on the upper bound.
  {
    if (!(await openCartWithOneTomato())) {
      fail("could not reach the cart for the invalid_phone rejection pass");
      return;
    }
    await fillNameAndPhone("Long Phone", "9".repeat(20));
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
      if (btn) btn.click();
    })()`);
    let matched = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const text = await evaluate(
        `(document.querySelector('[role="alert"]') || {}).textContent || ""`,
      );
      if (text === "Please enter a valid mobile number.") {
        matched = true;
        break;
      }
      await sleep(250);
    }
    if (matched) {
      ok(
        'an out-of-range phone is rejected with the exact "Please enter a valid mobile number." sentence, read from the alert element',
      );
    } else {
      fail(
        "the invalid_phone rejection never rendered the exact mapped sentence in the alert element",
      );
    }
    const rejectedPhoneOrderCount = await query(
      `select count(*) from public.orders where store_id = '${STORE_ID}' and customer_phone = '${"9".repeat(20)}';`,
    );
    if (rejectedPhoneOrderCount === "0") {
      ok("the rejected invalid_phone submit created no order row");
    } else {
      fail(
        `expected no order row for the rejected invalid_phone submit, found ${rejectedPhoneOrderCount}`,
      );
    }
  }

  // store_closed: closed by direct SQL immediately before the tap — the
  // client's own cached data still shows the store open, so the tap reaches
  // the server, which is the actual backstop.
  {
    if (!(await openCartWithOneTomato())) {
      fail("could not reach the cart for the store_closed rejection pass");
      return;
    }
    await fillNameAndPhone("Closed Shop", randomPhone());
    try {
      await query(
        `update public.stores set is_open = false where id = '${STORE_ID}';`,
      );
      await evaluate(`(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
        if (btn) btn.click();
      })()`);
      let matched = false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const text = await evaluate(
          `(document.querySelector('[role="alert"]') || {}).textContent || ""`,
        );
        if (text === "Store is closed · Orders paused") {
          matched = true;
          break;
        }
        await sleep(250);
      }
      if (matched) {
        ok(
          'a store closed by direct SQL immediately before the tap is rejected with the exact "Store is closed · Orders paused" sentence',
        );
      } else {
        fail(
          "the store_closed rejection never rendered the exact mapped sentence in the alert element",
        );
      }
      const closedOrderCount = await query(
        `select count(*) from public.orders where store_id = '${STORE_ID}' and customer_name = 'Closed Shop';`,
      );
      if (closedOrderCount === "0") {
        ok("the rejected store_closed submit created no order row");
      } else {
        fail(
          `expected no order row for the rejected store_closed submit, found ${closedOrderCount}`,
        );
      }
    } finally {
      await query(
        `update public.stores set is_open = true where id = '${STORE_ID}';`,
      );
    }
  }

  // rate_limited: five orders placed for one phone directly through the RPC
  // (never through the browser), then a sixth submitted from the real
  // screen.
  {
    const phone = randomPhone();
    for (let i = 0; i < 5; i++) {
      await query(
        `select public.place_order('${SLUG}', 'Rate Limited', '${phone}', null, '[{"product_id":"${TOMATOES_ID}","qty":1}]'::jsonb);`,
      );
    }
    if (!(await openCartWithOneTomato())) {
      fail("could not reach the cart for the rate_limited rejection pass");
      return;
    }
    await fillNameAndPhone("Rate Limited", phone);
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
      if (btn) btn.click();
    })()`);
    let matched = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const text = await evaluate(
        `(document.querySelector('[role="alert"]') || {}).textContent || ""`,
      );
      if (
        text ===
        "Too many orders from this number in the last hour. Please try again later."
      ) {
        matched = true;
        break;
      }
      await sleep(250);
    }
    if (matched) {
      ok(
        "a phone already at the 5-per-hour threshold is rejected with the exact rate_limited sentence, read from the alert element",
      );
    } else {
      fail(
        "the rate_limited rejection never rendered the exact mapped sentence in the alert element",
      );
    }
    const rateLimitedOrderCount = await query(
      `select count(*) from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}';`,
    );
    if (rateLimitedOrderCount === "5") {
      ok(
        "the rejected 6th submit left this phone's order count at exactly 5 — no 6th row leaked through",
      );
    } else {
      fail(
        `expected this phone's order count to stay at 5 after the rejected 6th submit, found ${rateLimitedOrderCount}`,
      );
    }
  }
}

// Pass 4 (Task 2): the three ordering events fire at the moments DATA-08
// requires — checkout_started on cart OPEN (never on submit), add_to_cart
// from add/increment only (never decrement), order_placed from the
// successful submit — with checkout_started proven to precede order_placed.
async function passOrderingEvents() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();

  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Tomatoes"))) {
    fail("the storefront never rendered for the events pass");
    return;
  }
  await tapCardAdd("Tomatoes");
  await sleep(150);
  await tapCardStepper("Tomatoes", "inc");
  await sleep(150);
  await tapCardStepper("Tomatoes", "dec");
  await sleep(150);

  const addToCartCount = await query(
    `select count(*) from public.events where event_name = 'add_to_cart' and store_id = '${STORE_ID}' and product_id = '${TOMATOES_ID}' and occurred_at > '${beforeTs}';`,
  );
  if (addToCartCount === "2") {
    ok(
      "add_to_cart fired exactly twice (one add, one increment) and NOT for the decrement that followed",
    );
  } else {
    fail(
      `expected exactly 2 add_to_cart events (add + increment, none from decrement), found ${addToCartCount}`,
    );
  }

  if (
    !(await tapHeaderCartButton()) ||
    !(await waitForPathname(`/store/${SLUG}/cart`))
  ) {
    fail("could not open the cart for the events pass");
    return;
  }

  const checkoutRow = await pollQuery(
    `select 1 from public.events where event_name = 'checkout_started' and store_id = '${STORE_ID}' and occurred_at > '${beforeTs}';`,
    (out) => out.length > 0,
  );
  const orderPlacedBeforeSubmit = await query(
    `select count(*) from public.events where event_name = 'order_placed' and store_id = '${STORE_ID}' and occurred_at > '${beforeTs}';`,
  );
  if (checkoutRow && orderPlacedBeforeSubmit === "0") {
    ok(
      "checkout_started exists as soon as the cart opens, and no order_placed event exists yet — the ordering gate that goes red if the cart-open event is ever moved onto the submit tap",
    );
  } else {
    fail(
      `expected checkout_started to exist with zero order_placed events before submit; checkoutRow=${JSON.stringify(checkoutRow)} orderPlacedBefore=${orderPlacedBeforeSubmit}`,
    );
  }

  await fillNameAndPhone("Events Pass", phone);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
    if (btn) btn.click();
  })()`);
  if (!(await waitForText("Order received ✓"))) {
    fail("the confirmation never rendered in the events pass");
    return;
  }

  const orderPlacedRow = await pollQuery(
    `select o.id, e.occurred_at >= (select occurred_at from public.events where event_name = 'checkout_started' and store_id = '${STORE_ID}' and occurred_at > '${beforeTs}' order by occurred_at asc limit 1) from public.orders o join public.events e on e.order_id = o.id and e.event_name = 'order_placed' where o.store_id = '${STORE_ID}' and o.customer_phone = '${phone}' and o.created_at > '${beforeTs}';`,
    (out) => out.length > 0,
  );
  const [, atOrAfter] = orderPlacedRow.split("|");
  if (atOrAfter === "t") {
    ok(
      "order_placed exists, carrying the new order's id, at an occurrence time at or after checkout_started's",
    );
  } else {
    fail(
      `expected order_placed to occur at or after checkout_started, got ${JSON.stringify(orderPlacedRow)}`,
    );
  }

  // The non-empty guard's own gate: navigating to the cart route with an
  // EMPTY cart must never add another checkout_started row.
  await clearCartStorage();
  const checkoutCountBeforeEmptyNav = await query(
    `select count(*) from public.events where event_name = 'checkout_started' and store_id = '${STORE_ID}' and occurred_at > '${beforeTs}';`,
  );
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
  await sleep(1000);
  const checkoutCountAfterEmptyNav = await query(
    `select count(*) from public.events where event_name = 'checkout_started' and store_id = '${STORE_ID}' and occurred_at > '${beforeTs}';`,
  );
  if (checkoutCountAfterEmptyNav === checkoutCountBeforeEmptyNav) {
    ok(
      "navigating to the cart route with an empty cart adds no additional checkout_started row",
    );
  } else {
    fail(
      `expected the checkout_started count to stay at ${checkoutCountBeforeEmptyNav} after an empty-cart nav, got ${checkoutCountAfterEmptyNav}`,
    );
  }
}

// Pass 5 (Task 3): STOR-05's own requirement — a real browser reload
// preserves the cart, proven by an actual Page.reload, never a state
// assertion.
async function passRefreshPersistsCart() {
  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Tomatoes"))) {
    fail("the storefront never rendered for the refresh-persistence pass");
    return;
  }
  await tapCardAdd("Tomatoes");
  await sleep(150);
  await tapCardStepper("Tomatoes", "inc");
  await sleep(150);
  await tapCardAdd("Bananas");
  await sleep(150);

  await send("Page.reload", {});
  if (!(await waitForText("Tomatoes"))) {
    fail("the storefront never settled after a real reload");
    return;
  }
  await sleep(500);

  const tomatoesQty = await readCardQty("Tomatoes");
  const bananasQty = await evaluate(`(() => {
    const card = ${cardByName("Bananas")};
    if (!card) return null;
    const decBtn = card.querySelector('button[aria-label="Remove one Bananas"]');
    if (!decBtn) return null;
    const qtySpan = decBtn.parentElement.querySelector("span");
    return qtySpan ? qtySpan.textContent.trim() : null;
  })()`);
  if (tomatoesQty === "2" && bananasQty === "1") {
    ok(
      "after a real page reload, both storefront cards still show their steppers at the stored quantities",
    );
  } else {
    fail(
      `expected Tomatoes=2 and Bananas=1 after reload, got Tomatoes=${JSON.stringify(tomatoesQty)} Bananas=${JSON.stringify(bananasQty)}`,
    );
  }

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
  if (!(await waitForText("Your cart"))) {
    fail(
      "the cart route never rendered when opened directly by URL after a reload",
    );
    return;
  }
  const bothListed = await evaluate(
    `document.body.innerText.includes("Tomatoes") && document.body.innerText.includes("Bananas")`,
  );
  if (bothListed === true) {
    ok(
      "opening the cart route directly by URL in the same session still lists both line items",
    );
  } else {
    fail("expected both line items still listed in the cart after a reload");
  }
}

// Pass 6 (Task 3): the order summary, the savings line and the two total
// labels — every figure read back from the database, never hardcoded.
async function passPricingSummary() {
  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Tomatoes"))) {
    fail("the storefront never rendered for the pricing pass");
    return;
  }
  await tapCardAdd("Tomatoes");
  await sleep(150);
  await tapCardAdd("Bananas");
  await sleep(150);

  if (
    !(await tapHeaderCartButton()) ||
    !(await waitForPathname(`/store/${SLUG}/cart`))
  ) {
    fail("could not open the cart for the pricing pass");
    return;
  }
  if (!(await waitForText("Price on request"))) {
    fail("the unpriced Bananas line never rendered the on-request text");
    return;
  }
  ok("the unpriced line renders the on-request text rather than a price");

  const offerRow = await query(
    `select offer_price, regular_price from public.offers where id = '${OFFER_ID}';`,
  );
  const [dbOfferPrice, dbRegularPrice] = offerRow.split("|").map(Number);
  const expectedSaving = dbRegularPrice - dbOfferPrice;

  if (!(await waitForText(`−₹${String(expectedSaving)}`))) {
    fail(
      `the savings line never rendered the exact database-derived saving of ${String(expectedSaving)}`,
    );
  } else {
    ok(
      "the savings line's value equals the regular price minus the offer price, read back from the database",
    );
  }

  if (!(await waitForText("Total (priced items)"))) {
    fail(
      "the total label never switched to the priced-items variant with an unpriced line present",
    );
  } else {
    ok(
      "the total label reads the priced-items variant while an unpriced line is present",
    );
  }

  if (!(await waitForText("Other items priced by seller on confirmation."))) {
    fail(
      "the priced-by-seller note never rendered with an unpriced line present",
    );
  } else {
    ok("the priced-by-seller note renders with an unpriced line present");
  }

  const summaryOnlyTomatoes = await evaluate(`(() => {
    const label = [...document.querySelectorAll("p")].find((p) => p.textContent.trim() === "Order summary");
    const box = label ? label.closest("div").parentElement : null;
    if (!box) return null;
    return { hasTomatoes: box.textContent.includes("Tomatoes"), hasBananas: box.textContent.includes("Bananas") };
  })()`);
  if (summaryOnlyTomatoes?.hasTomatoes && !summaryOnlyTomatoes.hasBananas) {
    ok(
      "the order summary lists only the offer-priced line, never the unpriced one",
    );
  } else {
    fail(
      `expected the summary to list only Tomatoes, got ${JSON.stringify(summaryOnlyTomatoes)}`,
    );
  }

  // Remove the unpriced line and confirm the total label and note both flip
  // — the pair of assertions distinguishing "the label is correct" from
  // "the label happens to be that string".
  const decBananas = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Remove one Bananas"]');
    if (!btn) return "no Bananas decrement button found";
    btn.click();
    return "ok";
  })()`);
  if (decBananas !== "ok") {
    fail(`could not remove the unpriced Bananas line: ${decBananas}`);
    return;
  }
  if (
    !(await waitForText("Total ", 5000)) ||
    !(await evaluate(
      `!document.body.innerText.includes("Total (priced items)")`,
    ))
  ) {
    ok(
      "removing the unpriced line switches the total label back to the plain variant",
    );
  } else {
    fail(
      "expected the total label to switch away from the priced-items variant once the unpriced line was removed",
    );
  }
  const noteGone = await evaluate(
    `!document.body.innerText.includes("Other items priced by seller on confirmation.")`,
  );
  if (noteGone === true) {
    ok("removing the unpriced line makes the priced-by-seller note disappear");
  } else {
    fail(
      "expected the priced-by-seller note to disappear once the unpriced line was removed",
    );
  }
}

// Pass 7 (Task 3, RESEARCH Pitfall 6 — a documented non-bug, proven rather
// than assumed): the cart's own total can legitimately be LOWER than the
// placed order's total, because place_order falls back to a product's own
// stored price, which PROD-03 forbids the storefront from ever showing.
async function passDocumentedTotalDivergence() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();
  try {
    await query(
      `update public.products set price = 15 where id = '${BANANAS_ID}';`,
    );

    await clearCartStorage();
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText("Tomatoes"))) {
      fail("the storefront never rendered for the divergence pass");
      return;
    }
    await tapCardAdd("Tomatoes");
    await sleep(150);
    await tapCardAdd("Bananas");
    await sleep(150);

    if (
      !(await tapHeaderCartButton()) ||
      !(await waitForPathname(`/store/${SLUG}/cart`))
    ) {
      fail("could not open the cart for the divergence pass");
      return;
    }
    if (!(await waitForText("Price on request"))) {
      fail(
        "the priced product still rendered the on-request line — PROD-03 requires this",
      );
      return;
    }
    const bananasLineHasCurrency = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => d.textContent.includes("Bananas") && d.textContent.includes("Price on request"));
      if (rows.length === 0) return null;
      // The smallest matching container by text length is the actual
      // line-item row, not an ancestor that also happens to contain both
      // strings (e.g. the whole items list, or the whole screen).
      const row = rows.reduce((a, b) => (a.textContent.length <= b.textContent.length ? a : b));
      return row.textContent.includes("₹");
    })()`);
    if (bananasLineHasCurrency === false) {
      ok(
        "Pitfall 6: a product given a stored price still reads Price on request in the cart — PROD-03 forbids showing it, and no currency figure appears in that line",
      );
    } else {
      fail(
        `expected no currency figure in the priced-but-unshown product's cart line, got ${JSON.stringify(bananasLineHasCurrency)}`,
      );
    }

    const pricedTotalText = await evaluate(`(() => {
      const label = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "Total (priced items)" || s.textContent.trim() === "Total");
      if (!label) return null;
      const row = label.parentElement;
      const amount = [...row.querySelectorAll("span")].pop();
      return amount ? amount.textContent.replace(/[^0-9.]/g, "") : null;
    })()`);

    await fillNameAndPhone("Divergence Pass", phone);
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
      if (btn) btn.click();
    })()`);
    if (!(await waitForText("Order received ✓"))) {
      fail("the confirmation never rendered in the divergence pass");
      return;
    }

    const orderTotal = await pollQuery(
      `select total from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}' and created_at > '${beforeTs}';`,
      (out) => out.length > 0,
    );
    if (
      pricedTotalText !== null &&
      Number(orderTotal) > Number(pricedTotalText)
    ) {
      ok(
        `Pitfall 6, proven not assumed: the placed order's total (${orderTotal}) is strictly greater than the cart's own displayed total (${pricedTotalText}) — this divergence is by design and must not be "fixed"`,
      );
    } else {
      fail(
        `expected the order's total to exceed the cart's displayed total, got order=${orderTotal} cart=${JSON.stringify(pricedTotalText)}`,
      );
    }
  } finally {
    await query(
      `update public.products set price = null where id = '${BANANAS_ID}';`,
    );
  }
}

// Pass 8 (Task 3): the empty-cart branch and the degraded-read branch —
// neither a blank screen nor a crash.
async function passEmptyAndDegraded() {
  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
  if (!(await waitForText("Your cart is empty"))) {
    fail(
      "the empty-cart heading never rendered for a direct nav with nothing in it",
    );
    return;
  }
  if (!(await waitForText("Add items from the shop to get started."))) {
    fail("the empty-cart body copy never rendered");
  } else {
    ok("the empty cart renders its heading and default body copy");
  }
  const browseWorks = await evaluate(`(() => {
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Browse the shop");
    if (!link) return "no Browse the shop control found";
    link.click();
    return "ok";
  })()`);
  if (browseWorks !== "ok") {
    fail(`could not tap the empty cart's Browse control: ${browseWorks}`);
  } else if (await waitForPathname(`/store/${SLUG}`)) {
    ok("tapping the empty cart's Browse control lands on the storefront");
  } else {
    fail("tapping Browse never navigated to the storefront");
  }

  try {
    await evaluate(
      `localStorage.setItem("gsdCartForceProductsError", "1"); window.__forceProductsError = true;`,
    );
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
    if (!(await waitForText("Couldn't load your cart."))) {
      fail(
        "the degraded-read error branch never rendered when the products fetch was forced to fail",
      );
      return;
    }
    const retryVisible = await evaluate(
      `[...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Retry")`,
    );
    if (retryVisible === true) {
      ok(
        "a genuine products-fetch failure on the cart route shows the error branch with a Retry control, never a blank screen or a crash",
      );
    } else {
      fail("the degraded-read branch rendered with no Retry affordance");
    }
  } finally {
    await evaluate(
      `window.__forceProductsError = false; localStorage.setItem("gsdCartForceProductsError", "0");`,
    );
  }
}

// Pass 9 (Task 1): a customer fills ONE cart from the offers strip, a
// product's own detail page reached by tapping through, and a SECOND
// product's detail page reached by direct URL — proving all three Add
// surfaces write the SAME shop-scoped cart, which place_order then receives
// as one order with two lines. Also proves the strip's two sibling buttons
// are genuinely separate click targets: tapping Add must never navigate.
async function passThreeSurfacesOneOrder() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();
  const customerName = "Anita Rao";

  await clearCartStorage();
  await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
  if (!(await waitForText("Today's offers"))) {
    fail("the offers strip never rendered for the three-surfaces pass");
    return;
  }

  const stripAddResult = await tapStripAdd("Tomatoes");
  if (stripAddResult !== "ok") {
    fail(`could not tap Add on the strip's Tomatoes row: ${stripAddResult}`);
    return;
  }
  await sleep(200);

  // The falsifiability-relevant assertion: tapping Add must NOT navigate
  // away from the storefront. If the strip's two sibling buttons were ever
  // collapsed back onto one click target, this is the check that catches it.
  const pathAfterStripAdd = await evaluate(`window.location.pathname`);
  if (pathAfterStripAdd !== `/store/${SLUG}`) {
    fail(
      `tapping the strip's Add control navigated to ${JSON.stringify(pathAfterStripAdd)} instead of staying on the storefront — the Add control and the row's navigation half must be genuinely separate click targets`,
    );
    return;
  }
  ok("tapping the offers-strip row's Add control does not navigate away");

  const stripQtyAfterAdd = await readStripQty("Tomatoes");
  if (stripQtyAfterAdd !== "1") {
    fail(
      `expected the strip's Tomatoes row to read "1" after Add, got ${JSON.stringify(stripQtyAfterAdd)}`,
    );
    return;
  }
  ok(
    "tapping Add on the offers-strip row turns the row's slot into a stepper reading 1",
  );

  const stripNavResult = await tapStripNav("Tomatoes");
  if (stripNavResult !== "ok") {
    fail(`could not tap the strip row's navigation half: ${stripNavResult}`);
    return;
  }
  if (!(await waitForPathname(`/store/${SLUG}/p/${TOMATOES_ID}`))) {
    fail(
      "tapping the strip row's navigation half never landed on the product's own route",
    );
    return;
  }
  ok(
    "tapping the strip row's OTHER half (not its Add control) navigates to the product's own route — the two sibling buttons are genuinely separate",
  );

  if (!(await waitForText("1 kg"))) {
    fail(
      'the detail screen never rendered the full "1 kg" quantity-and-unit stepper form for the item already added from the strip',
    );
    return;
  }
  ok(
    'the detail screen\'s stepper shows the full "1 kg" form for the quantity already added from the strip',
  );

  const detailIncResult = await tapDetailStepper("Tomatoes", "inc");
  if (detailIncResult !== "ok") {
    fail(
      `could not tap the detail screen's increment button: ${detailIncResult}`,
    );
    return;
  }
  await sleep(200);
  if (!(await waitForText("2 kg"))) {
    fail(
      "the detail screen's stepper never advanced to 2 kg after one increment",
    );
    return;
  }
  ok(
    "tapping the detail screen's increment button advances its stepper to 2 kg",
  );

  await send("Page.navigate", {
    url: `${BASE}/store/${SLUG}/p/${BANANAS_ID}`,
  });
  if (!(await waitForText("Bananas"))) {
    fail(
      "navigating directly by URL to a different product's own detail route never rendered",
    );
    return;
  }
  const detailAddResult = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add to cart");
    if (!btn) return "no Add to cart button found";
    btn.click();
    return "ok";
  })()`);
  if (detailAddResult !== "ok") {
    fail(
      `could not tap Add to cart on the Bananas detail screen: ${detailAddResult}`,
    );
    return;
  }
  await sleep(200);
  if (!(await waitForText("View cart · 2"))) {
    fail(
      "the detail screen's view-cart button never read \"View cart · 2\" distinct entries after adding from a SECOND product's own page",
    );
    return;
  }
  ok(
    'adding from a SECOND product\'s own detail page makes the view-cart button read "View cart · 2" distinct entries',
  );

  const viewCartResult = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("View cart"));
    if (!btn) return "no View cart button found";
    btn.click();
    return "ok";
  })()`);
  if (viewCartResult !== "ok") {
    fail(
      `could not tap the detail screen's View cart button: ${viewCartResult}`,
    );
    return;
  }
  if (!(await waitForPathname(`/store/${SLUG}/cart`))) {
    fail(
      "tapping the detail screen's View cart button never navigated to the cart route",
    );
    return;
  }
  const bothListed = await evaluate(
    `document.body.innerText.includes("Tomatoes") && document.body.innerText.includes("Bananas")`,
  );
  if (bothListed === true) {
    ok(
      "the cart lists both lines — one added from the strip, one added from a second product's own detail page",
    );
  } else {
    fail(
      "expected the cart to list both Tomatoes and Bananas after adding from the strip and a second detail page",
    );
  }

  await fillNameAndPhone(customerName, phone);
  const submitted = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
    if (!btn) return "no submit button found";
    if (btn.disabled) return "submit button is disabled";
    btn.click();
    return "ok";
  })()`);
  if (submitted !== "ok") {
    fail(`could not submit the three-surfaces order: ${submitted}`);
    return;
  }
  if (!(await waitForText("Order received ✓"))) {
    fail(
      "the confirmation heading never rendered after the three-surfaces submit",
    );
    return;
  }

  const orderIdRow = await pollQuery(
    `select id from public.orders where store_id = '${STORE_ID}' and customer_phone = '${phone}' and created_at > '${beforeTs}';`,
    (out) => out.length > 0,
  );
  const orderId = orderIdRow.trim();
  if (!orderId) {
    fail(`expected exactly one order row for phone ${phone}, found none`);
    return;
  }
  ok("exactly one order row exists for the three-surfaces submission");

  const lineCount = await query(
    `select count(*) from public.order_items where order_id = '${orderId}';`,
  );
  if (lineCount === "2") {
    ok(
      "the order carries exactly TWO order lines — the strip's Tomatoes add and the detail page's Bananas add landed in the SAME cart",
    );
  } else {
    fail(
      `expected exactly 2 order lines from the three-surfaces cart, found ${lineCount}`,
    );
  }

  const tomatoesQty = await query(
    `select qty from public.order_items where order_id = '${orderId}' and product_name = 'Tomatoes';`,
  );
  const bananasQty = await query(
    `select qty from public.order_items where order_id = '${orderId}' and product_name = 'Bananas';`,
  );
  if (tomatoesQty === "2" && bananasQty === "1") {
    ok(
      "the two order lines' quantities match what was actually added on each surface (Tomatoes 2 via strip+detail increment, Bananas 1 via a second product's own detail page)",
    );
  } else {
    fail(
      `expected Tomatoes qty=2 and Bananas qty=1, got Tomatoes=${JSON.stringify(tomatoesQty)} Bananas=${JSON.stringify(bananasQty)}`,
    );
  }
}

// Pass 10 (Task 2): a real customer of a closed shop — the closed banner
// with the exact mandated sentence, mutually exclusive with the (absent)
// preview banner, and the disabled control on all three ordering surfaces
// plus the cart footer. Every closed-sentence check below is scoped to the
// specific element that owns it (its own container's class shape), never a
// whole-document text search — three different surfaces render the exact
// same sentence, so an unscoped check could pass against the wrong one.
async function passRealClosedShopSurfaces() {
  try {
    await query(
      `update public.stores set is_open = false where id = '${STORE_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}` });
    if (!(await waitForText("Currently closed"))) {
      fail("the storefront header never read the closed wording");
      return;
    }

    const bannerState = await evaluate(`(() => {
      const p = [...document.querySelectorAll("p")].find(
        (el) => el.textContent.trim() === "Store is closed · Orders paused",
      );
      if (!p) return { found: false };
      const container = p.parentElement;
      const cls = container ? container.className : "";
      return {
        found: true,
        scoped: cls.includes("rounded-xl") && cls.includes("bg-muted") && cls.includes("px-4"),
      };
    })()`);
    if (!bannerState?.found || !bannerState.scoped) {
      fail(
        `the storefront's closed banner never rendered with the exact mandated sentence in its own container, got ${JSON.stringify(bannerState)}`,
      );
      return;
    }
    ok(
      'the storefront renders the closed banner with the exact "Store is closed · Orders paused" sentence, scoped to the banner\'s own container (selector: a <p> matching that exact text, whose parent carries rounded-xl/bg-muted/px-4)',
    );

    const previewBannerPresent = await evaluate(
      `document.body.innerText.includes("Previewing as customer")`,
    );
    if (previewBannerPresent === false) {
      ok(
        "the preview banner never renders for a real (non-preview) customer — the two banners are mutually exclusive",
      );
    } else {
      fail(
        "the preview banner rendered for a real customer alongside the closed banner",
      );
    }

    const cardClosedLabel = await evaluate(`(() => {
      const card = ${cardByName("Tomatoes")};
      if (!card) return null;
      const span = [...card.querySelectorAll("span")].find(
        (s) => s.textContent.trim() === "Closed" || s.textContent.trim() === "Add",
      );
      return span ? span.textContent.trim() : null;
    })()`);
    if (cardClosedLabel === "Closed") {
      ok(
        "the storefront card's control reads \"Closed\" (selector: the card's own control area's <span>, matched by exact text) — never an Add control while the shop is genuinely closed",
      );
    } else {
      fail(
        `expected the closed shop's card control to read "Closed", got ${JSON.stringify(cardClosedLabel)}`,
      );
    }

    const stripClosedLabel = await evaluate(`(() => {
      const row = ${stripRowByName("Tomatoes")};
      if (!row) return null;
      const span = [...row.querySelectorAll("span")].find(
        (s) => s.textContent.trim() === "Closed" || s.textContent.trim() === "Add",
      );
      return span ? span.textContent.trim() : null;
    })()`);
    if (stripClosedLabel === "Closed") {
      ok(
        "the offers-strip row's control reads \"Closed\" (selector: the row's own trailing <span>, matched by exact text) — the same asymmetry as the card",
      );
    } else {
      fail(
        `expected the closed shop's strip row control to read "Closed", got ${JSON.stringify(stripClosedLabel)}`,
      );
    }

    await send("Page.navigate", {
      url: `${BASE}/store/${SLUG}/p/${TOMATOES_ID}`,
    });
    if (!(await waitForText("Tomatoes"))) {
      fail("the product-detail route never rendered while the shop was closed");
      return;
    }
    const detailClosedState = await evaluate(`(() => {
      const p = [...document.querySelectorAll("p")].find(
        (el) => el.textContent.trim() === "Store is closed · Orders paused",
      );
      if (!p) return { found: false };
      const container = p.parentElement;
      const cls = container ? container.className : "";
      return {
        found: true,
        scoped: cls.includes("rounded-2xl") && cls.includes("bg-muted") && cls.includes("h-14"),
      };
    })()`);
    if (!detailClosedState?.found || !detailClosedState.scoped) {
      fail(
        `the product-detail screen never rendered the closed sentence in place of the Add-to-cart control, got ${JSON.stringify(detailClosedState)}`,
      );
      return;
    }
    ok(
      "the product-detail screen renders the closed sentence in place of the Add-to-cart control, scoped to its own disabled block (selector: a <p> matching that exact text, whose parent carries rounded-2xl/bg-muted/h-14)",
    );

    // A line already in the cart before the shop closes — set directly so
    // the closed-shop pass does not depend on Add being enabled.
    await evaluate(
      `localStorage.setItem("cart:${SLUG}", JSON.stringify([{productId:"${TOMATOES_ID}", name:"Tomatoes", unit:"kg", qty:1, hadOffer:true}]))`,
    );
    await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
    if (!(await waitForText("Your cart"))) {
      fail("the cart route never rendered while the shop was closed");
      return;
    }
    const footerClosedState = await evaluate(`(() => {
      const p = [...document.querySelectorAll("p")].find(
        (el) => el.textContent.trim() === "Store is closed · Orders paused",
      );
      if (!p) return { found: false };
      const container = p.parentElement;
      const cls = container ? container.className : "";
      return {
        found: true,
        scoped: cls.includes("rounded-2xl") && cls.includes("bg-muted") && cls.includes("h-14"),
      };
    })()`);
    if (!footerClosedState?.found || !footerClosedState.scoped) {
      fail(
        `the cart's footer never rendered the closed sentence in place of the submit button, got ${JSON.stringify(footerClosedState)}`,
      );
      return;
    }
    ok(
      "the cart footer renders the closed sentence in place of the submit button, scoped to its own footer block (selector: a <p> matching that exact text, whose parent carries rounded-2xl/bg-muted/h-14)",
    );
  } finally {
    await query(
      `update public.stores set is_open = true where id = '${STORE_ID}';`,
    );
    await clearCartStorage();
  }
}

async function signInAsVendor() {
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

// Pass 11 (Task 2): the vendor's own "Preview as customer" overlay over an
// OPEN shop — the FIRST and ONLY pass in this file that signs in, so it
// runs LAST (log_event prefers the session branch whenever one exists; every
// anonymous-attribution assertion above must complete first). Divergence 6:
// storefront-page.tsx's own `orderingDisabled = Boolean(previewMode) ||
// !data.store.is_open` disables ordering UNCONDITIONALLY whenever previewMode
// is true, independent of the shop's own open state — proven here against an
// OPEN shop specifically, with a database assertion that no order was
// created during the pass.
async function passVendorPreviewOverOpenShop() {
  const beforeTs = await query("select now();");

  const signedIn = await signInAsVendor();
  if (!signedIn) {
    fail("could not sign in as the seeded demo vendor for the preview pass");
    return;
  }
  ok("the seeded demo vendor signs in and reaches Home");

  const storeOpen = await query(
    `select is_open from public.stores where id = '${STORE_ID}';`,
  );
  if (storeOpen !== "t") {
    fail(
      `expected the seeded store to be OPEN before the preview pass (the case a closed-shop-only reading would never exercise), got is_open=${JSON.stringify(storeOpen)}`,
    );
    return;
  }
  ok(
    "the seeded store is OPEN going into the preview pass — the case this gate exists to cover",
  );

  if (!(await waitForText("Preview as customer"))) {
    fail("Home's own 'Preview as customer' control never rendered");
    return;
  }
  const tappedPreview = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").includes("Preview as customer"),
    );
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
    "tapping Home's own 'Preview as customer' control opens the overlay over the vendor's OPEN shop",
  );

  const overlaySelector = ".fixed.inset-0.z-50";
  const closedBannerInOverlay = await evaluate(`(() => {
    const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
    if (!overlay) return null;
    return overlay.textContent.includes("Store is closed · Orders paused");
  })()`);
  if (closedBannerInOverlay === false) {
    ok(
      "the closed banner does NOT render inside the preview overlay — the shop is genuinely open, and preview disables ordering for a different reason entirely",
    );
  } else {
    fail(
      `expected no closed banner inside the preview overlay over an open shop, got ${JSON.stringify(closedBannerInOverlay)}`,
    );
  }

  const previewCardState = await evaluate(`(() => {
    const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
    if (!overlay) return null;
    const card = [...overlay.querySelectorAll("div")].filter((d) => {
      const cls = d.className || "";
      return cls.includes("overflow-hidden") && cls.includes("rounded-xl") && cls.includes("bg-card") && cls.includes("border-border");
    }).find((d) => d.textContent.includes("Tomatoes"));
    if (!card) return { found: false };
    const span = [...card.querySelectorAll("span")].find(
      (s) => s.textContent.trim() === "Closed" || s.textContent.trim() === "Add",
    );
    return { found: true, label: span ? span.textContent.trim() : null };
  })()`);
  if (previewCardState?.found && previewCardState.label === "Add") {
    ok(
      'inside the preview overlay over an OPEN shop, the card\'s Add control renders DISABLED with its text still "Add" — never "Closed", which would be a false claim about an open shop',
    );
  } else {
    fail(
      `expected the preview overlay's card control to read "Add" (disabled), got ${JSON.stringify(previewCardState)}`,
    );
  }

  const previewCardDisabled = await evaluate(`(() => {
    const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
    if (!overlay) return null;
    const card = [...overlay.querySelectorAll("div")].filter((d) => {
      const cls = d.className || "";
      return cls.includes("overflow-hidden") && cls.includes("rounded-xl") && cls.includes("bg-card") && cls.includes("border-border");
    }).find((d) => d.textContent.includes("Tomatoes"));
    if (!card) return null;
    // The enabled Add control is a real <button>; the disabled rendering is
    // a plain <span> inside a non-interactive <div> — so the ABSENCE of a
    // clickable Add <button> in this card is itself the disabled proof.
    const addButton = [...card.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Add",
    );
    return addButton === undefined;
  })()`);
  if (previewCardDisabled === true) {
    ok(
      "the preview overlay's card control is genuinely disabled — no clickable Add button exists in that card, only the inert label",
    );
  } else {
    fail(
      "expected no clickable Add button inside the preview overlay's card — found one, which would let the vendor place a real order against their own open shop",
    );
  }

  const orderCountDuringPreview = await query(
    `select count(*) from public.orders where store_id = '${STORE_ID}' and created_at > '${beforeTs}';`,
  );
  if (orderCountDuringPreview === "0") {
    ok(
      "no order row was created for this store during the preview pass — a preview that could place a real order is exactly the defect divergence 6 exists to prevent",
    );
  } else {
    fail(
      `expected zero new orders during the preview pass, found ${orderCountDuringPreview}`,
    );
  }
}

// Pass 12 (Task 3): the three D-04 reconciliation cases, each proven
// separately — cases two and three are indistinguishable from the outside
// without the cart entry's own stored hadOffer flag, which is exactly why
// they get separate assertions rather than one shared one.
async function passReconciliationDisappearedProduct() {
  try {
    await clearCartStorage();
    await evaluate(
      `localStorage.setItem("cart:${SLUG}", JSON.stringify([
        {productId:"${TOMATOES_ID}", name:"Tomatoes", unit:"kg", qty:1, hadOffer:true},
        {productId:"${BANANAS_ID}", name:"Bananas", unit:"dozen", qty:1, hadOffer:false},
      ]))`,
    );
    await query(
      `update public.products set available = false where id = '${TOMATOES_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
    if (!(await waitForText("Your cart"))) {
      fail(
        "the cart route never rendered for the disappeared-product reconciliation case",
      );
      return;
    }
    if (
      !(await waitForText(
        "Tomatoes is no longer available and was removed from your cart.",
      ))
    ) {
      fail(
        "the stale banner never named Tomatoes in its singular wording after its product was made unavailable",
      );
      return;
    }
    ok(
      "the stale banner names the disappeared product in its singular wording",
    );

    // Scoped to exact <p> matches for the line-item's own name element —
    // the stale banner's own sentence ALSO contains the literal word
    // "Tomatoes", so a whole-document substring check would find it there
    // and produce a false negative on the very case this assertion exists
    // to prove.
    const survivorState = await evaluate(`(() => {
      const names = [...document.querySelectorAll("p")]
        .map((p) => p.textContent.trim())
        .filter((t) => t === "Tomatoes" || t === "Bananas");
      return { tomatoesGone: !names.includes("Tomatoes"), bananasThere: names.includes("Bananas") };
    })()`);
    if (survivorState?.tomatoesGone && survivorState.bananasThere) {
      ok(
        "the disappeared product's line is gone from the list while the other line survives",
      );
    } else {
      fail(
        `expected Tomatoes gone and Bananas surviving, got ${JSON.stringify(survivorState)}`,
      );
    }
  } finally {
    await query(
      `update public.products set available = true where id = '${TOMATOES_ID}';`,
    );
    await clearCartStorage();
  }
}

async function passReconciliationExpiredOffer() {
  try {
    await clearCartStorage();
    await evaluate(
      `localStorage.setItem("cart:${SLUG}", JSON.stringify([
        {productId:"${TOMATOES_ID}", name:"Tomatoes", unit:"kg", qty:1, hadOffer:true},
      ]))`,
    );
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
    if (!(await waitForText("Your cart is empty"))) {
      fail(
        "the cart never reached its empty state after the sole offer-priced line's offer expired",
      );
      return;
    }
    const onRequestTextPresent = await evaluate(
      `document.body.innerText.includes("Price on request")`,
    );
    if (onRequestTextPresent === false) {
      ok(
        "the expired-offer line was DROPPED, never downgraded to the on-request treatment — a re-priced line would render this exact text, and it does not",
      );
    } else {
      fail(
        "expected the expired-offer line to be dropped, not downgraded to the on-request treatment",
      );
    }
  } finally {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );
    await clearCartStorage();
  }
}

async function passReconciliationNeverPricedLine() {
  await clearCartStorage();
  await evaluate(
    `localStorage.setItem("cart:${SLUG}", JSON.stringify([
      {productId:"${BANANAS_ID}", name:"Bananas", unit:"dozen", qty:1, hadOffer:false},
    ]))`,
  );

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
  if (!(await waitForText("Bananas"))) {
    fail(
      "the never-priced line never rendered for the never-priced reconciliation case",
    );
    return;
  }
  const state = await evaluate(
    `({ hasOnRequest: document.body.innerText.includes("Price on request"), hasBanner: document.body.innerText.includes("is no longer available") })`,
  );
  if (state?.hasOnRequest && !state.hasBanner) {
    ok(
      "a line that never had an offer SURVIVES reconciliation and renders the on-request text, with no stale banner naming it",
    );
  } else {
    fail(
      `expected the never-priced line to survive with on-request text and no banner, got ${JSON.stringify(state)}`,
    );
  }
  await clearCartStorage();
}

// Pass 13 (Task 3): reconciliation emptying the cart entirely renders the
// empty state with its removed-items body variant — it does NOT redirect
// (the prototype's own blind auto-redirect is deliberately not ported here).
async function passEmptyAfterReconciliation() {
  try {
    await clearCartStorage();
    await evaluate(
      `localStorage.setItem("cart:${SLUG}", JSON.stringify([
        {productId:"${TOMATOES_ID}", name:"Tomatoes", unit:"kg", qty:1, hadOffer:true},
      ]))`,
    );
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );

    await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
    if (
      !(await waitForText(
        "1 item were removed because they're no longer available.",
      ))
    ) {
      fail(
        "the empty state's removed-items body variant never rendered after reconciliation emptied the cart",
      );
      return;
    }
    ok(
      "reconciliation emptying the cart renders the empty state's removed-items body variant",
    );

    const stillOnCartRoute = await evaluate(
      `window.location.pathname === "/store/${SLUG}/cart"`,
    );
    if (stillOnCartRoute === true) {
      ok(
        "the browser did NOT navigate away when reconciliation emptied the cart — the prototype's own auto-redirect is deliberately not ported",
      );
    } else {
      fail(
        "expected the browser to remain on the cart route after reconciliation emptied it, but it navigated away",
      );
    }

    const browseControlPresent = await evaluate(
      `[...document.querySelectorAll("a")].some((a) => a.textContent.trim() === "Browse the shop")`,
    );
    if (browseControlPresent === true) {
      ok(
        "the empty-after-reconciliation state still offers the Browse control",
      );
    } else {
      fail("expected the Browse control to be present in the empty state");
    }
  } finally {
    await query(
      `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
    );
    await clearCartStorage();
  }
}

// Pass 14 (Task 3): a hand-written over-ceiling quantity is clamped on read
// (cart-store.ts's own sanitizeEntries/clampQty, exercised here via a real
// localStorage write and a real navigation, never a unit-test-only claim) —
// never reaches the server as a raw, unmapped rejection.
async function passQuantityClampOnRead() {
  const beforeTs = await query("select now();");
  const phone = randomPhone();
  await clearCartStorage();
  await evaluate(
    `localStorage.setItem("cart:${SLUG}", JSON.stringify([
      {productId:"${TOMATOES_ID}", name:"Tomatoes", unit:"kg", qty:150, hadOffer:true},
    ]))`,
  );

  await send("Page.navigate", { url: `${BASE}/store/${SLUG}/cart` });
  if (!(await waitForText("99 kg"))) {
    fail(
      "a hand-written over-ceiling quantity (150) never rendered clamped to the 99 ceiling on the cart route",
    );
    return;
  }
  ok(
    "a hand-written over-ceiling cart quantity is clamped to 99 on read, before it can reach the server",
  );

  await fillNameAndPhone("Clamp Pass", phone);
  const submitted = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Place order request");
    if (!btn) return "no submit button found";
    if (btn.disabled) return "submit button is disabled";
    btn.click();
    return "ok";
  })()`);
  if (submitted !== "ok") {
    fail(`could not submit the clamp-pass order: ${submitted}`);
    return;
  }
  if (!(await waitForText("Order received ✓"))) {
    fail("the confirmation never rendered for the clamp-pass submit");
    return;
  }

  const orderLine = await pollQuery(
    `select oi.qty from public.order_items oi join public.orders o on o.id = oi.order_id where o.store_id = '${STORE_ID}' and o.customer_phone = '${phone}' and o.created_at > '${beforeTs}';`,
    (out) => out.length > 0,
  );
  if (orderLine.trim() === "99") {
    ok(
      "the submitted order's line carries the clamped ceiling quantity (99) rather than a server rejection",
    );
  } else {
    fail(
      `expected the order line's quantity to be clamped to 99, got ${JSON.stringify(orderLine)}`,
    );
  }
  await clearCartStorage();
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
    source: FAULT_INJECTION_SCRIPT,
  });

  // This flow's own fixture: give Tomatoes' seeded label-only offer row a
  // real numeric price (the seed ships it null-priced, excluded by the
  // storefront read's priceability filter) and leave Bananas with no offer
  // at all — the second product Task 3's pricing pass needs. Restored to
  // null in the finally block below, matching smoke-storefront-flow.mjs's
  // own established discipline for this exact fixture row.
  await query(
    `update public.offers set offer_price = ${String(OFFER_PRICE)}, regular_price = ${String(REGULAR_PRICE)} where id = '${OFFER_ID}';`,
  );

  await passAddOneProductAndReceiveOrder();
  await passDoubleSubmitCreatesOneOrder();
  await passNamedRejections();
  await passOrderingEvents();
  await passRefreshPersistsCart();
  await passPricingSummary();
  await passDocumentedTotalDivergence();
  await passEmptyAndDegraded();
  await passThreeSurfacesOneOrder();
  await passRealClosedShopSurfaces();
  await passReconciliationDisappearedProduct();
  await passReconciliationExpiredOffer();
  await passReconciliationNeverPricedLine();
  await passEmptyAfterReconciliation();
  await passQuantityClampOnRead();
  // MUST run last — the only pass in this file that signs in.
  await passVendorPreviewOverOpenShop();

  if (process.exitCode !== 1) console.log("\ncart smoke flow: PASS");
} catch (err) {
  console.error(`not ok: ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    await query(
      `update public.offers set offer_price = null, regular_price = null where id = '${OFFER_ID}';`,
    );
  } catch {
    // best-effort restore
  }
  try {
    ws?.close();
  } catch {
    // already closed
  }
  chrome.kill("SIGKILL");
}
