#!/usr/bin/env node
// End-to-end catalogue check: drives a REAL vendor through /manage in
// headless Chrome and asserts the DATABASE outcome of what happens there,
// not only what the DOM shows.
//
// Why this exists. This phase's defect class is the same one
// smoke-signup-flow.mjs already proved itself against: a screen that looks
// correct while the write behind it never happened (or was rolled back).
// The row toggle in particular applies its optimistic value to the screen
// before the request leaves — a DOM-only assertion would pass on that
// optimistic flip alone even if the underlying `update` never reached
// Postgres, or reached it and then failed. So every assertion below that
// claims something changed reads it back from the database, never just the
// rendered page.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness every
// sibling smoke-*.mjs script already established.
//
// Usage: node scripts/smoke-add-product.mjs [baseUrl]
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
const CDP_PORT = process.env.CDP_PORT ?? "9338";

// A fresh number every run: one shop per mobile (BR1), so a reused number
// would hit the duplicate path instead of the flow under test.
const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Smoke Catalogue Shop";
const FIXTURE_PRODUCT = `Smoke Fixture Product ${String(Date.now())}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the form to be INTERACTIVE rather than sleeping a fixed interval.
// A fixed wait flaked on a cold server: the first request after `next start`
// compiles the route, so a short sleep was enough warm and not enough cold,
// and the run failed with every assertion red as though the app were
// broken. A gate that fails for reasons unrelated to the code under test is
// worse than no gate — it teaches you to ignore it.
async function waitForInputs(evaluate, minCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await evaluate(`document.querySelectorAll("input").length`);
    if (typeof n === "number" && n >= minCount) return true;
    await sleep(250);
  }
  return false;
}

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

// Waits for a specific selector to exist — unlike waitForInputs (a bare
// count), this is safe to use on a screen that navigates FROM another screen
// that already has inputs of its own (e.g. /manage's own search box), where
// a bare "at least N inputs" count would pass instantly before the
// navigation to the target screen has even happened.
async function waitForSelector(evaluate, selector, timeoutMs = 30000) {
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

function fail(message) {
  console.error(`not ok: ${message}`);
  process.exitCode = 1;
  return false;
}

// Pass 1 (Task 1): sign up a fresh vendor, reach Home, seed one product
// directly through psql, navigate to /manage, and confirm the fixture
// product's name renders — proving the vendor's own owner-scoped read
// works end to end against a real database.
async function passSeeOwnProducts() {
  await send("Page.navigate", { url: `${BASE}/setup` });
  if (!(await waitForInputs(evaluate, 4))) {
    throw new Error(
      "setup form never became interactive (inputs never appeared)",
    );
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
    setVal(nameEl, "Smoke Vendor");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") throw new Error(`could not fill setup form: ${filled}`);
  await sleep(500);

  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^continue/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Continue";
    b.click();
    return "ok";
  })()`);
  if (clicked !== "ok") throw new Error(`could not submit setup: ${clicked}`);

  if (!(await waitForText(evaluate, "What do you sell?"))) {
    throw new Error('"What do you sell?" never rendered after signup');
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
    throw new Error("never reached Home after the business-type step");
  }
  console.log("ok: reached Home after signup");

  const storeId = await query(
    `select id from public.stores where phone = '${phone}';`,
  );
  if (!storeId) {
    throw new Error("no stores row found for the freshly signed-up vendor");
  }

  await query(
    `insert into public.products (store_id, name, unit, available) values ('${storeId}', '${FIXTURE_PRODUCT}', 'piece', true);`,
  );

  await send("Page.navigate", { url: `${BASE}/manage` });
  if (!(await waitForText(evaluate, FIXTURE_PRODUCT))) {
    fail(`fixture product "${FIXTURE_PRODUCT}" never appeared on /manage`);
    return { storeId: "" };
  }
  console.log("ok: fixture product rendered on /manage");

  const path = await evaluate("location.pathname");
  if (path !== "/manage") {
    fail(`expected path /manage after navigating there, got ${String(path)}`);
  } else {
    console.log("ok: /manage is the resolved path");
  }

  return { storeId };
}

// Pass 2 (Task 2): flip the fixture product's availability from its row
// toggle and prove BOTH the database write and the matching catalogue
// event, never just the optimistic DOM flip. The switch flips on screen
// before the request leaves — that proves nothing about the database, which
// is exactly why every assertion here reads the database back rather than
// trusting the rendered switch state.
async function passFlipFromRow({ storeId }) {
  const before = await query(
    `select available from public.products where store_id = '${storeId}' and name = '${FIXTURE_PRODUCT}';`,
  );
  if (before !== "t" && before !== "f") {
    throw new Error(`could not read the fixture product's availability`);
  }

  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${FIXTURE_PRODUCT}';`,
  );

  const clicked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(FIXTURE_PRODUCT)}));
    if (!btn) return "no switch found for the fixture product";
    btn.click();
    return "ok";
  })()`);
  if (clicked !== "ok") {
    throw new Error(`could not click the fixture product's toggle: ${clicked}`);
  }

  let flipped = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const after = await query(
      `select available from public.products where id = '${productId}';`,
    );
    if (after !== before) {
      flipped = true;
      break;
    }
    await sleep(300);
  }
  if (!flipped) {
    fail(
      "the fixture product's availability in the database never changed after tapping the row toggle",
    );
    return;
  }
  console.log("ok: row toggle flip persisted to public.products");

  const nextAvailable = before === "t" ? "f" : "t";
  const expectedEvent =
    nextAvailable === "t"
      ? "product_marked_available"
      : "product_marked_unavailable";
  const eventSeen = await query(
    `select exists(select 1 from public.events where store_id = '${storeId}' and product_id = '${productId}' and event_name = '${expectedEvent}');`,
  );
  if (eventSeen === "t") {
    console.log(`ok: ${expectedEvent} event recorded`);
  } else {
    fail(`${expectedEvent} event missing after the toggle flip`);
  }
}

// Pass 2b (Task 1, tracer): open the fixture product from a filtered list,
// flip its availability from the DETAIL screen's own toggle (the same
// mutation hook the row uses, PROD-02's second half), and go back to a list
// that still carries the filter and already shows the flip with no reload.
// Every step after the initial navigation is a client-side transition (row
// tap, detail toggle, the shipped back button) — no further Page.navigate is
// issued mid-pass — so this can only pass if the SPA session, and the
// TanStack Query cache inside it, survives the whole round trip.
async function passDetailFlipAndBack({ storeId }) {
  const filteredUrl = `${BASE}/manage?filter=all`;

  await send("Page.navigate", { url: filteredUrl });
  if (!(await waitForText(evaluate, FIXTURE_PRODUCT))) {
    fail("the fixture product never rendered on the filtered /manage list");
    return;
  }

  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${FIXTURE_PRODUCT}';`,
  );
  if (!productId) {
    fail("could not resolve the fixture product's id for the detail pass");
    return;
  }

  const clickedRow = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("button")];
    const row = rows.find((b) => (b.textContent || "").includes(${JSON.stringify(FIXTURE_PRODUCT)}));
    if (!row) return "no row found for the fixture product";
    row.click();
    return "ok";
  })()`);
  if (clickedRow !== "ok") {
    fail(`could not tap the fixture product's row: ${clickedRow}`);
    return;
  }

  let onDetail = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === `/manage/${productId}`) {
      onDetail = true;
      break;
    }
    await sleep(200);
  }
  if (!onDetail) {
    fail(`tapping the row never navigated to /manage/${productId}`);
    return;
  }
  if (await waitForText(evaluate, FIXTURE_PRODUCT)) {
    console.log(
      "ok: the product detail route resolved and shows the product name",
    );
  } else {
    fail("the product name never rendered on the detail screen");
    return;
  }

  const before = await query(
    `select available from public.products where id = '${productId}';`,
  );

  const clickedToggle = await evaluate(`(() => {
    const btn = document.querySelector('button[role="switch"]');
    if (!btn) return "no switch found on the detail screen";
    btn.click();
    return "ok";
  })()`);
  if (clickedToggle !== "ok") {
    fail(`could not click the detail screen's toggle: ${clickedToggle}`);
    return;
  }

  let flipped = false;
  let after = before;
  const flipDeadline = Date.now() + 15000;
  while (Date.now() < flipDeadline) {
    after = await query(
      `select available from public.products where id = '${productId}';`,
    );
    if (after !== before) {
      flipped = true;
      break;
    }
    await sleep(300);
  }
  if (!flipped) {
    fail(
      "the fixture product's availability never changed after the detail toggle",
    );
    return;
  }
  console.log("ok: detail toggle flip persisted to public.products");

  const expectedEvent =
    after === "t" ? "product_marked_available" : "product_marked_unavailable";
  const eventSeen = await query(
    `select exists(select 1 from public.events where store_id = '${storeId}' and product_id = '${productId}' and event_name = '${expectedEvent}');`,
  );
  if (eventSeen === "t") {
    console.log(`ok: ${expectedEvent} event recorded from the detail toggle`);
  } else {
    fail(`${expectedEvent} event missing after the detail toggle flip`);
  }

  const clickedBack = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Go back"]');
    if (!btn) return "no back button found on the detail screen";
    btn.click();
    return "ok";
  })()`);
  if (clickedBack !== "ok") {
    fail(`could not click the detail screen's back button: ${clickedBack}`);
    return;
  }

  let landedOnList = false;
  for (let i = 0; i < 60; i++) {
    const path = await evaluate("location.pathname");
    const search = await evaluate("location.search");
    if (path === "/manage" && search === "?filter=all") {
      landedOnList = true;
      break;
    }
    await sleep(200);
  }
  if (!landedOnList) {
    fail("going back from detail never returned to /manage?filter=all");
    return;
  }
  console.log(
    "ok: back from detail returned to /manage with its status filter intact",
  );

  const rowChecked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(FIXTURE_PRODUCT)}));
    return btn ? btn.getAttribute("aria-checked") : null;
  })()`);
  const expectedChecked = after === "t" ? "true" : "false";
  if (rowChecked === expectedChecked) {
    console.log("ok: the row already shows the flipped state with no reload");
  } else {
    fail(
      `expected the row's aria-checked to be "${expectedChecked}", got "${String(rowChecked)}"`,
    );
  }
}

// Pass 3 (Task 1): the vendor adds a product with nothing but its name, and
// the form cannot be unmounted out from under its own save (the hazard
// 03-03-PLAN.md's <the_hazard> section names). From the products screen, tap
// Add product, fill only the name, tap Save, and assert in order: the
// database row, the product_added event, and that the browser is back on
// /manage with the new name rendered — database assertions first, since a
// silently-dropped onSuccess looks exactly like a working screen.
//
// The immediate-path check right after the click is the falsifiability
// instrument itself: a real database insert cannot have resolved within the
// same synchronous click handler, so a correct implementation must still be
// on /manage/add at that instant. An eager "navigate the moment mutate()
// returns" regression fails exactly this check — see 03-03-SUMMARY.md's
// Falsifiability Evidence for the recorded red/green run.
async function passAddProduct({ storeId }) {
  const productName = `Smoke Added Product ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage` });
  if (!(await waitForText(evaluate, "Add product"))) {
    fail("the /manage screen with its Add-product button never rendered");
    return {};
  }

  const clickedAdd = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add product");
    if (!b) return "no Add product button";
    b.click();
    return "ok";
  })()`);
  if (clickedAdd !== "ok") {
    fail(`could not tap Add product: ${clickedAdd}`);
    return {};
  }

  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive");
    return {};
  }

  const filled = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    if (!nameEl) return "no product-name input";
    setVal(nameEl, ${JSON.stringify(productName)});
    return "ok";
  })()`);
  if (filled !== "ok") {
    fail(`could not fill the product name: ${filled}`);
    return {};
  }
  await sleep(300);

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not tap Save product: ${clickedSave}`);
    return {};
  }

  const pathImmediatelyAfterClick = await evaluate("location.pathname");
  if (pathImmediatelyAfterClick !== "/manage/add") {
    fail(
      `navigated to "${String(pathImmediatelyAfterClick)}" before the save could possibly have completed — navigation is not gated on the mutation's success`,
    );
    return {};
  }
  console.log(
    "ok: navigation did not fire before the save could have completed",
  );

  let productId = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    productId = await query(
      `select id from public.products where store_id = '${storeId}' and name = '${productName}';`,
    );
    if (productId) break;
    await sleep(300);
  }
  if (!productId) {
    fail(`no products row was created for "${productName}" after Save`);
    return {};
  }
  console.log("ok: name-only product saved to public.products");

  const eventSeen = await query(
    `select exists(select 1 from public.events where store_id = '${storeId}' and product_id = '${productId}' and event_name = 'product_added');`,
  );
  if (eventSeen === "t") {
    console.log("ok: product_added event recorded");
  } else {
    fail("product_added event missing after save");
  }

  let landedOnManage = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === "/manage") {
      landedOnManage = true;
      break;
    }
    await sleep(200);
  }
  if (!landedOnManage) {
    fail("save did not return the vendor to /manage");
    return { productId, productName };
  }
  if (await waitForText(evaluate, productName)) {
    console.log("ok: /manage shows the newly added product");
  } else {
    fail(`the new product "${productName}" never rendered on /manage`);
  }

  return { productId, productName };
}

// Pass 4 (Task 2): a brand-new category, typed through the create-new
// affordance, persists as exactly one category row and the saved product's
// category points at it — then reopening the add screen shows it as a
// chip, the half of PROD-05's "persists" clause a database assertion alone
// can't cover.
async function passAddProductWithNewCategory({ storeId }) {
  const productName = `Smoke Category Product ${String(Date.now())}`;
  const categoryName = `Smoke Category ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive (category pass)");
    return;
  }

  const filledName = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    if (!nameEl) return "no product-name input";
    setVal(nameEl, ${JSON.stringify(productName)});
    return "ok";
  })()`);
  if (filledName !== "ok") {
    fail(`could not fill the product name (category pass): ${filledName}`);
    return;
  }

  const openedCreateNew = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Create new");
    if (!b) return "no Create new chip";
    b.click();
    return "ok";
  })()`);
  if (openedCreateNew !== "ok") {
    fail(`could not open the create-new category input: ${openedCreateNew}`);
    return;
  }

  if (
    !(await waitForSelector(evaluate, 'input[placeholder="Category name…"]'))
  ) {
    fail("the new-category input never appeared");
    return;
  }

  const filledCategory = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const input = document.querySelector('input[placeholder="Category name…"]');
    if (!input) return "no category-name input";
    setVal(input, ${JSON.stringify(categoryName)});
    return "ok";
  })()`);
  if (filledCategory !== "ok") {
    fail(`could not fill the new category name: ${filledCategory}`);
    return;
  }

  const confirmedCategory = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add");
    if (!b) return "no Add confirm button";
    b.click();
    return "ok";
  })()`);
  if (confirmedCategory !== "ok") {
    fail(`could not confirm the new category: ${confirmedCategory}`);
    return;
  }
  await sleep(300);

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not tap Save product (category pass): ${clickedSave}`);
    return;
  }

  let productId = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    productId = await query(
      `select id from public.products where store_id = '${storeId}' and name = '${productName}';`,
    );
    if (productId) break;
    await sleep(300);
  }
  if (!productId) {
    fail(`no products row was created for "${productName}" (category pass)`);
    return;
  }

  const categoryCount = await query(
    `select count(*) from public.categories where store_id = '${storeId}' and name = '${categoryName}';`,
  );
  if (categoryCount === "1") {
    console.log("ok: exactly one category row created for the new name");
  } else {
    fail(
      `expected exactly one category row for "${categoryName}", got ${categoryCount}`,
    );
  }

  const productCategoryId = await query(
    `select category_id from public.products where id = '${productId}';`,
  );
  const newCategoryId = await query(
    `select id from public.categories where store_id = '${storeId}' and name = '${categoryName}';`,
  );
  if (productCategoryId && productCategoryId === newCategoryId) {
    console.log(
      "ok: the new product's category points at the new category row",
    );
  } else {
    fail(
      `product category_id (${productCategoryId}) did not match the new category row (${newCategoryId})`,
    );
  }

  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (await waitForText(evaluate, categoryName)) {
    console.log("ok: the new category renders as a chip on reopen");
  } else {
    fail(
      `the new category "${categoryName}" never appeared as a chip on reopen`,
    );
  }
}

// Pass 5 (Task 3): a non-default selling unit and a fractional amount are
// stored exactly as typed, and the fixture product from Pass 3 — saved
// through the real form with the amount field left blank, back when this
// script's own form had no price field yet — still stores no value in that
// column rather than zero. The zero-value and absent-value cases are two
// separate assertions, never one, matching format-price.test.mjs's own
// distinction.
async function passAddProductUnitAndAmount({ storeId }) {
  const productName = `Smoke Unit Amount Product ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive (unit/amount pass)");
    return;
  }

  const filled = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    const priceEl = document.querySelector("#product-price");
    if (!nameEl || !priceEl) return "missing name/price inputs";
    setVal(nameEl, ${JSON.stringify(productName)});
    setVal(priceEl, "42.567");
    return "ok";
  })()`);
  if (filled !== "ok") {
    fail(`could not fill name/price (unit/amount pass): ${filled}`);
    return;
  }

  const pickedUnit = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "kg");
    if (!b) return "no kg unit chip";
    b.click();
    return "ok";
  })()`);
  if (pickedUnit !== "ok") {
    fail(`could not pick the kg unit chip: ${pickedUnit}`);
    return;
  }
  await sleep(200);

  // Sanitisation happens on every keystroke, so the field can never hold
  // more than two fractional digits by the time Save is tapped — confirm
  // that here rather than assuming it, since the whole point of running the
  // sanitiser at input time is that this can't be typed in the first place.
  const displayedPrice = await evaluate(
    `document.querySelector("#product-price").value`,
  );
  if (displayedPrice === "42.56") {
    console.log(
      "ok: the price field truncated a third fractional digit at input time",
    );
  } else {
    fail(
      `expected the price field to read "42.56", got "${String(displayedPrice)}"`,
    );
  }

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not tap Save product (unit/amount pass): ${clickedSave}`);
    return;
  }

  let row = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    row = await query(
      `select unit || '|' || price from public.products where store_id = '${storeId}' and name = '${productName}';`,
    );
    if (row) break;
    await sleep(300);
  }
  if (!row) {
    fail(`no products row was created for "${productName}" (unit/amount pass)`);
    return;
  }
  if (row === "kg|42.56") {
    console.log(
      "ok: non-default unit and fractional amount stored exactly as typed",
    );
  } else {
    fail(`expected unit/price "kg|42.56", got "${row}"`);
  }

  const absentAmount = await query(
    `select price is null from public.products where store_id = '${storeId}' and name = '${FIXTURE_PRODUCT}';`,
  );
  if (absentAmount === "t") {
    console.log(
      "ok: a product saved with the amount field left empty stores no value",
    );
  } else {
    fail(
      `expected the fixture product's price to be null, got is-null=${absentAmount}`,
    );
  }
}

// Pass 6 (Task 1, tracer): a photo picked through the gallery row is run
// through the browser pipeline (decode/resize/orient/encode) and arrives in
// storage as a small upright JPEG in the vendor's own folder — PROD-04
// proven on real bytes, the only place in this stack it can be proven at
// all. The source image is deliberately generated far larger than the
// 800px target: a regression to a source-resolution canvas allocation
// (D-11) or an unchecked first encode (D-02/D-04) would be caught by the
// measured byte length and longest edge below, not merely assumed from the
// code that produced them.
async function passAddProductWithPhoto({ storeId }) {
  const productName = `Smoke Photo Product ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive (photo pass)");
    return;
  }

  const filledName = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    if (!nameEl) return "no product-name input";
    setVal(nameEl, ${JSON.stringify(productName)});
    return "ok";
  })()`);
  if (filledName !== "ok") {
    fail(`could not fill the product name (photo pass): ${filledName}`);
    return;
  }

  const openedSheet = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add photo");
    if (!b) return "no Add photo button";
    b.click();
    return "ok";
  })()`);
  if (openedSheet !== "ok") {
    fail(`could not open the photo source sheet: ${openedSheet}`);
    return;
  }

  if (!(await waitForSelector(evaluate, 'input[type="file"]:not([capture])'))) {
    fail("the gallery file input never appeared");
    return;
  }

  // Deliberately larger than any real phone camera output on its longest
  // edge (RESEARCH.md's own instruction for Task 2's arithmetic tests,
  // applied here to real browser bytes) — this is what makes a regression
  // to a source-resolution surface allocation (D-11) or an unbounded
  // encode (D-02/D-04) unmistakable in the measurements below rather than
  // hidden by a source image already small enough to pass by accident.
  const attached = await evaluate(`(async () => {
    const input = document.querySelector('input[type="file"]:not([capture])');
    if (!input) return "no gallery input";
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 4000;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no 2d context on the source canvas";
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f9f8f5";
    ctx.fillRect(600, 600, 1800, 1800);
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) return "canvas.toBlob produced no blob for the source image";
    const file = new File([blob], "large-source.jpg", { type: "image/jpeg" });
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`);
  if (attached !== "ok") {
    fail(`could not attach the deliberately-large source photo: ${attached}`);
    return;
  }

  if (!(await waitForSelector(evaluate, 'img[alt="Product"]', 20000))) {
    fail("the photo preview never appeared after picking a valid source image");
    return;
  }
  console.log(
    "ok: photo preview rendered after the pipeline processed the picked file",
  );

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not tap Save product (photo pass): ${clickedSave}`);
    return;
  }

  let productId = "";
  let imageUrl = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const row = await query(
      `select id || '|' || coalesce(image_url, '') from public.products where store_id = '${storeId}' and name = '${productName}';`,
    );
    if (row) {
      const sep = row.indexOf("|");
      productId = sep >= 0 ? row.slice(0, sep) : row;
      imageUrl = sep >= 0 ? row.slice(sep + 1) : "";
      if (productId) break;
    }
    await sleep(300);
  }
  if (!productId) {
    fail(`no products row was created for "${productName}" (photo pass)`);
    return;
  }
  if (!imageUrl) {
    fail(
      `the product row for "${productName}" has no image_url after a photo save`,
    );
    return;
  }
  console.log("ok: the saved product row carries a non-empty image_url");

  const objectPath = imageUrl.split("/product-images/")[1] ?? "";
  const keyFirstSegment = objectPath.split("/")[0] ?? "";
  if (keyFirstSegment === storeId) {
    console.log(
      "ok: the uploaded object's key is under the vendor's own store folder",
    );
  } else {
    fail(
      `expected the uploaded object's first key segment to be the store id "${storeId}", got "${keyFirstSegment}" (url: ${imageUrl})`,
    );
  }

  // Fetched and measured from inside the page (not this Node process): the
  // page already holds the origin the local storage server trusts, and
  // decoding the longest edge needs a real image decoder this Node script
  // doesn't have one of its own.
  const measured = await evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(imageUrl)});
    const contentType = res.headers.get("content-type") || "";
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    bitmap.close();
    return { contentType, byteLength: blob.size, longestEdge };
  })()`);
  if (!measured) {
    fail("could not fetch and measure the uploaded photo from the browser");
    return;
  }

  if (String(measured.contentType).startsWith("image/jpeg")) {
    console.log("ok: the fetched uploaded object has a JPEG content type");
  } else {
    fail(`expected a JPEG content type, got "${String(measured.contentType)}"`);
  }

  const MAX_PHOTO_BYTES = 300 * 1024;
  if (
    typeof measured.byteLength === "number" &&
    measured.byteLength > 0 &&
    measured.byteLength < MAX_PHOTO_BYTES
  ) {
    console.log(
      `ok: the fetched uploaded object is ${String(measured.byteLength)} bytes, under the ${String(MAX_PHOTO_BYTES)}-byte ceiling`,
    );
  } else {
    fail(
      `expected the fetched object's byte length to be under ${String(MAX_PHOTO_BYTES)}, got ${String(measured.byteLength)}`,
    );
  }

  if (typeof measured.longestEdge === "number" && measured.longestEdge <= 800) {
    console.log(
      `ok: the fetched uploaded object's longest edge is ${String(measured.longestEdge)}px, at or under the 800px target`,
    );
  } else {
    fail(
      `expected the fetched object's longest edge to be <= 800, got ${String(measured.longestEdge)}`,
    );
  }
}

// Pass 6b (Task 2): editing the fixture product through the SAME form it was
// added with, already filled in — an UPDATE of the existing row, not a
// second insert, so the shipped history trigger keeps what it used to say.
// From the fixture product's detail screen, tap the edit icon, assert the
// name field is already populated (the pre-fill a database assertion alone
// can't see), change the name and the amount, save, and assert in order:
// the updated row, a history row carrying the PRE-edit name, and the
// matching update event.
async function passEditProduct({ storeId }) {
  const productId = await query(
    `select id from public.products where store_id = '${storeId}' and name = '${FIXTURE_PRODUCT}';`,
  );
  if (!productId) {
    fail("could not resolve the fixture product's id for the edit pass");
    return {};
  }

  const preEditName = await query(
    `select name from public.products where id = '${productId}';`,
  );
  const newName = `Smoke Edited Product ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage/${productId}` });
  if (!(await waitForText(evaluate, preEditName))) {
    fail("the fixture product's detail screen never rendered (edit pass)");
    return {};
  }

  const clickedEdit = await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="Edit product"]');
    if (!b) return "no edit-product button found";
    b.click();
    return "ok";
  })()`);
  if (clickedEdit !== "ok") {
    fail(`could not tap the edit icon: ${clickedEdit}`);
    return {};
  }

  let onEdit = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === `/manage/${productId}/edit`) {
      onEdit = true;
      break;
    }
    await sleep(200);
  }
  if (!onEdit) {
    fail(`tapping the edit icon never navigated to /manage/${productId}/edit`);
    return {};
  }

  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the edit form never became interactive");
    return {};
  }

  const prefilledName = await evaluate(
    `document.querySelector("#product-name")?.value`,
  );
  if (prefilledName === preEditName) {
    console.log(
      "ok: the edit form's name field is pre-filled with the product's current name",
    );
  } else {
    fail(
      `expected the pre-filled name to be "${preEditName}", got "${String(prefilledName)}"`,
    );
  }

  const changed = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    const priceEl = document.querySelector("#product-price");
    if (!nameEl || !priceEl) return "missing name/price inputs (edit pass)";
    setVal(nameEl, ${JSON.stringify(newName)});
    setVal(priceEl, "17.50");
    return "ok";
  })()`);
  if (changed !== "ok") {
    fail(`could not change the name/amount (edit pass): ${changed}`);
    return {};
  }
  await sleep(300);

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not tap Save product (edit pass): ${clickedSave}`);
    return {};
  }

  let updated = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const currentName = await query(
      `select name from public.products where id = '${productId}';`,
    );
    if (currentName === newName) {
      updated = true;
      break;
    }
    await sleep(300);
  }
  if (!updated) {
    fail(`the product row was never updated with the new name "${newName}"`);
    return {};
  }
  console.log("ok: the edited row carries the new name");

  const priceRow = await query(
    `select price from public.products where id = '${productId}';`,
  );
  if (priceRow === "17.50" || priceRow === "17.5") {
    console.log("ok: the edited row carries the new amount");
  } else {
    fail(`expected the edited row's price to be 17.50, got "${priceRow}"`);
  }

  const historyRow = await query(
    `select name from public.product_history where product_id = '${productId}' order by recorded_at desc limit 1;`,
  );
  if (historyRow === preEditName) {
    console.log(
      "ok: a history row exists for the edit, carrying the pre-edit name",
    );
  } else {
    fail(
      `expected the latest history row's name to be "${preEditName}", got "${String(historyRow)}"`,
    );
  }

  const eventSeen = await query(
    `select exists(select 1 from public.events where store_id = '${storeId}' and product_id = '${productId}' and event_name = 'product_updated');`,
  );
  if (eventSeen === "t") {
    console.log("ok: product_updated event recorded");
  } else {
    fail("product_updated event missing after the edit save");
  }

  let landedOnDetail = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === `/manage/${productId}`) {
      landedOnDetail = true;
      break;
    }
    await sleep(200);
  }
  if (!landedOnDetail) {
    fail(
      "saving the edit did not return the vendor to the product's detail screen",
    );
    return { productId, productName: newName };
  }
  if (await waitForText(evaluate, newName)) {
    console.log("ok: the detail screen shows the newly edited name");
  } else {
    fail(`the edited name "${newName}" never rendered on the detail screen`);
  }

  return { productId, productName: newName };
}

// Pass 6c (Task 3): the PROD-02 consistency proof no other test in this
// stack can reach — the shared cache entry, not a synchronised copy, is what
// keeps the row and the detail page in agreement. Every step after the
// initial navigation is a client-side click (row toggle, row tap, detail
// toggle, the shipped back button); no further Page.navigate is issued
// mid-pass, so a pass here can only succeed if no reload of any kind
// occurred anywhere along the way. Takes the edited fixture's id/name from
// passEditProduct so it addresses the product by identity, not by the name
// FIXTURE_PRODUCT no longer carries after that pass renamed it.
async function passRowDetailConsistency({ productId, productName }) {
  if (!productId || !productName) {
    fail("no edited fixture product available for the consistency pass");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/manage?filter=all` });
  if (!(await waitForText(evaluate, productName))) {
    fail("the edited fixture product never rendered for the consistency pass");
    return;
  }

  const before = await query(
    `select available from public.products where id = '${productId}';`,
  );

  const clickedRowToggle = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(productName)}));
    if (!btn) return "no row switch found for the edited fixture product";
    btn.click();
    return "ok";
  })()`);
  if (clickedRowToggle !== "ok") {
    fail(
      `could not click the row toggle (consistency pass): ${clickedRowToggle}`,
    );
    return;
  }

  let afterRowFlip = before;
  let flippedFromRow = false;
  const rowDeadline = Date.now() + 15000;
  while (Date.now() < rowDeadline) {
    afterRowFlip = await query(
      `select available from public.products where id = '${productId}';`,
    );
    if (afterRowFlip !== before) {
      flippedFromRow = true;
      break;
    }
    await sleep(300);
  }
  if (!flippedFromRow) {
    fail("the row toggle never persisted for the consistency pass");
    return;
  }

  const clickedRowNav = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("button")];
    const row = rows.find((b) => (b.textContent || "").includes(${JSON.stringify(productName)}));
    if (!row) return "no row found for the edited fixture product";
    row.click();
    return "ok";
  })()`);
  if (clickedRowNav !== "ok") {
    fail(
      `could not tap the edited fixture product's row (consistency pass): ${clickedRowNav}`,
    );
    return;
  }

  let onDetail = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === `/manage/${productId}`) {
      onDetail = true;
      break;
    }
    await sleep(200);
  }
  if (!onDetail) {
    fail(
      "tapping the row never navigated to the detail screen (consistency pass)",
    );
    return;
  }

  const detailChecked = await evaluate(
    `document.querySelector('button[role="switch"]')?.getAttribute("aria-checked")`,
  );
  const expectedChecked = afterRowFlip === "t" ? "true" : "false";
  if (detailChecked === expectedChecked) {
    console.log(
      "ok: the detail switch already reflects the flip made from the row, with no reload",
    );
  } else {
    fail(
      `expected the detail switch's aria-checked to be "${expectedChecked}", got "${String(detailChecked)}"`,
    );
  }

  const clickedDetailToggle = await evaluate(`(() => {
    const btn = document.querySelector('button[role="switch"]');
    if (!btn) return "no switch found on the detail screen";
    btn.click();
    return "ok";
  })()`);
  if (clickedDetailToggle !== "ok") {
    fail(
      `could not click the detail toggle (consistency pass): ${clickedDetailToggle}`,
    );
    return;
  }

  let afterDetailFlip = afterRowFlip;
  let flippedBack = false;
  const detailDeadline = Date.now() + 15000;
  while (Date.now() < detailDeadline) {
    afterDetailFlip = await query(
      `select available from public.products where id = '${productId}';`,
    );
    if (afterDetailFlip !== afterRowFlip) {
      flippedBack = true;
      break;
    }
    await sleep(300);
  }
  if (!flippedBack) {
    fail("the detail toggle never persisted for the consistency pass");
    return;
  }

  const clickedBack = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Go back"]');
    if (!btn) return "no back button found";
    btn.click();
    return "ok";
  })()`);
  if (clickedBack !== "ok") {
    fail(`could not click back (consistency pass): ${clickedBack}`);
    return;
  }

  let backOnList = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === "/manage") {
      backOnList = true;
      break;
    }
    await sleep(200);
  }
  if (!backOnList) {
    fail("going back from detail never returned to /manage (consistency pass)");
    return;
  }

  const rowChecked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(productName)}));
    return btn ? btn.getAttribute("aria-checked") : null;
  })()`);
  const expectedRowChecked = afterDetailFlip === "t" ? "true" : "false";
  if (rowChecked === expectedRowChecked) {
    console.log(
      "ok: the row already reflects the flip made from detail, with no reload",
    );
  } else {
    fail(
      `expected the row's aria-checked to be "${expectedRowChecked}" after flipping back from detail, got "${String(rowChecked)}"`,
    );
  }
}

// Pass 6d (Task 3): a well-formed id that simply does not resolve to any row
// for this vendor renders the not-found sentence with no retry control —
// the resolved-but-missing branch, distinct from a fetch failure.
async function passDetailNotFound() {
  const bogusId = "00000000-0000-4000-8000-000000000000";

  await send("Page.navigate", { url: `${BASE}/manage/${bogusId}` });
  if (!(await waitForText(evaluate, "Product not found"))) {
    fail("the not-found message never rendered for a non-existent product id");
    return;
  }
  console.log("ok: a non-existent product id renders the not-found message");

  const hasRetry = await evaluate(`document.body.innerText.includes("Retry")`);
  if (hasRetry === false) {
    console.log("ok: the not-found screen renders with no retry control");
  } else {
    fail("the not-found screen unexpectedly shows a retry control");
  }
}

// Pass 6e (Task 1, 03-06): Home's Available/Unavailable count tiles read the
// exact same numbers the database holds for this vendor's store, and tapping
// either one opens the products list already filtered — the same D-08 URL
// contract every other filtered navigation in this stack relies on. The
// database counts are read FIRST, then compared against the rendered tile
// numerals, which is what makes this an assertion rather than a screenshot.
async function readCountTile(caption) {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const tile = buttons.find((b) => {
      const spans = [...b.querySelectorAll("span")];
      return spans.some((s) => s.textContent.trim() === ${JSON.stringify(caption)});
    });
    if (!tile) return null;
    const numeral = tile.querySelector("span");
    return numeral ? numeral.textContent.trim() : null;
  })()`);
}

async function clickCountTile(caption) {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const tile = buttons.find((b) => {
      const spans = [...b.querySelectorAll("span")];
      return spans.some((s) => s.textContent.trim() === ${JSON.stringify(caption)});
    });
    if (!tile) return "no tile found for ${caption}";
    tile.click();
    return "ok";
  })()`);
}

async function passHomeCounts({ storeId }) {
  const dbAvailable = await query(
    `select count(*) from public.products where store_id = '${storeId}' and available = true;`,
  );
  const dbUnavailable = await query(
    `select count(*) from public.products where store_id = '${storeId}' and available = false;`,
  );

  // "New orders" is the count-tile row's own caption text — unlike the
  // uppercase-styled section labels above it, this string is rendered
  // exactly as written (no CSS text-transform), so it is safe to match
  // against document.body.innerText verbatim.
  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText(evaluate, "New orders"))) {
    fail("Home's count-tile section never rendered");
    return;
  }

  const renderedAvailable = await readCountTile("Available");
  if (renderedAvailable === dbAvailable) {
    console.log(
      `ok: Home's Available tile shows ${dbAvailable}, matching the database count`,
    );
  } else {
    fail(
      `expected the Available tile to show "${dbAvailable}", got "${String(renderedAvailable)}"`,
    );
  }

  const renderedUnavailable = await readCountTile("Unavailable");
  if (renderedUnavailable === dbUnavailable) {
    console.log(
      `ok: Home's Unavailable tile shows ${dbUnavailable}, matching the database count`,
    );
  } else {
    fail(
      `expected the Unavailable tile to show "${dbUnavailable}", got "${String(renderedUnavailable)}"`,
    );
  }

  const clickedAvailable = await clickCountTile("Available");
  if (clickedAvailable !== "ok") {
    fail(`could not tap the Available tile: ${clickedAvailable}`);
    return;
  }

  let onAvailableList = false;
  for (let i = 0; i < 60; i++) {
    const path = await evaluate("location.pathname");
    const search = await evaluate("location.search");
    if (path === "/manage" && search === "?filter=available") {
      onAvailableList = true;
      break;
    }
    await sleep(200);
  }
  if (!onAvailableList) {
    fail("tapping the Available tile never landed on /manage?filter=available");
    return;
  }
  console.log(
    "ok: the Available tile opens the products list already filtered",
  );

  const noUnavailableRows = await evaluate(`(() => {
    const badges = [...document.querySelectorAll("span")].filter(
      (s) => s.textContent.trim() === "Unavailable",
    );
    return badges.length === 0;
  })()`);
  if (noUnavailableRows) {
    console.log("ok: every row on the Available-filtered list is available");
  } else {
    fail("the Available-filtered list rendered an Unavailable row");
  }

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText(evaluate, "New orders"))) {
    fail("Home never re-rendered before tapping the Unavailable tile");
    return;
  }

  const clickedUnavailable = await clickCountTile("Unavailable");
  if (clickedUnavailable !== "ok") {
    fail(`could not tap the Unavailable tile: ${clickedUnavailable}`);
    return;
  }

  let onUnavailableList = false;
  for (let i = 0; i < 60; i++) {
    const path = await evaluate("location.pathname");
    const search = await evaluate("location.search");
    if (path === "/manage" && search === "?filter=unavailable") {
      onUnavailableList = true;
      break;
    }
    await sleep(200);
  }
  if (!onUnavailableList) {
    fail(
      "tapping the Unavailable tile never landed on /manage?filter=unavailable",
    );
    return;
  }
  console.log(
    "ok: the Unavailable tile opens the products list already filtered",
  );

  const noAvailableRows = await evaluate(`(() => {
    const badges = [...document.querySelectorAll("span")].filter(
      (s) => s.textContent.trim() === "Available",
    );
    return badges.length === 0;
  })()`);
  if (noAvailableRows) {
    console.log(
      "ok: every row on the Unavailable-filtered list is unavailable",
    );
  } else {
    fail("the Unavailable-filtered list rendered an Available row");
  }
}

// Pass 6f (Task 3, 03-06): Home's New-orders tile reads a real number off
// the vendor's own orders still in the new state — seeded directly via SQL
// since placing an order is Phase 6's own feature, not this phase's — and
// tapping it lands on the real Orders route (Phase 6 replaced the Phase 3
// stub this pass originally exercised), which now lists the two seeded
// orders by customer name instead of the stub's unconditional
// "No orders yet".
async function passHomeOrderTile({ storeId }) {
  await query(
    `insert into public.orders (store_id, customer_name, customer_phone) values ('${storeId}', 'Smoke Order Customer One', '9000000001'), ('${storeId}', 'Smoke Order Customer Two', '9000000002');`,
  );

  const dbNewOrders = await query(
    `select count(*) from public.orders where store_id = '${storeId}' and status = 'new';`,
  );

  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText(evaluate, "New orders"))) {
    fail("Home's count-tile section never rendered (order-tile pass)");
    return;
  }

  let renderedOrders = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    renderedOrders = await readCountTile("New orders");
    if (renderedOrders === dbNewOrders) break;
    await sleep(300);
  }
  if (renderedOrders === dbNewOrders) {
    console.log(
      `ok: Home's New-orders tile shows ${dbNewOrders}, matching the database count`,
    );
  } else {
    fail(
      `expected the New-orders tile to show "${dbNewOrders}", got "${String(renderedOrders)}"`,
    );
  }

  const clickedOrders = await clickCountTile("New orders");
  if (clickedOrders !== "ok") {
    fail(`could not tap the New orders tile: ${clickedOrders}`);
    return;
  }

  let onOrders = false;
  for (let i = 0; i < 60; i++) {
    if ((await evaluate("location.pathname")) === "/orders") {
      onOrders = true;
      break;
    }
    await sleep(200);
  }
  if (!onOrders) {
    fail("tapping the New orders tile never landed on /orders");
    return;
  }
  if (await waitForText(evaluate, "Smoke Order Customer One")) {
    console.log(
      "ok: the New orders tile opens the Orders tab, now listing the two seeded orders (Phase 6's real list, not the retired stub)",
    );
  } else {
    fail(
      "the seeded order's customer name never rendered after tapping the New orders tile",
    );
  }
}

// Pass 6g (Task 3, 03-06; flipped in 04-05 once Phase 4 landed — see below):
// the phase's own scope boundary, proven on the rendered page rather than
// only in source — Home's catalogue status card is present. This pass
// originally also asserted the NEGATIVE — that neither of Phase 4's own
// labels appeared on Home yet — so Phase 4 would inherit a clean starting
// point rather than a placeholder someone had to find and remove. Phase 4
// has since shipped both labels onto Home deliberately (04-02's Share
// control, 04-02's Preview link), so that negative assertion is now
// permanently, structurally false. It is flipped to its positive
// counterpart here rather than deleted outright, so this pass still proves
// something true: Home's catalogue card and BOTH of Phase 4's own labels
// render together, untouched by Phase 4's two newly-wired share handlers
// (04-05's own scope).
async function passHomeScopeBoundary() {
  await send("Page.navigate", { url: `${BASE}/` });
  if (!(await waitForText(evaluate, "New orders"))) {
    fail("Home's count-tile section never rendered (scope-boundary pass)");
    return;
  }
  if (await waitForText(evaluate, "Live")) {
    console.log("ok: Home's catalogue status card is present");
  } else {
    fail("Home's catalogue status card never rendered (scope-boundary pass)");
    return;
  }

  const hasPhase4Labels = await evaluate(`(() => {
    const text = document.body.innerText;
    return (
      text.includes("Share today") && text.includes("Preview as customer")
    );
  })()`);
  if (hasPhase4Labels === true) {
    console.log(
      "ok: both Phase 4 labels (Share today's catalogue / Preview as customer) render on Home, now that Phase 4 exists",
    );
  } else {
    fail("Home is missing one or both of Phase 4's own labels");
  }
}

// Pass 7 (Gap 2): toggle rollback-on-failure is forced and proven. PROD-02's
// rollback logic (onError restoring the prior snapshot) was code-reviewed as
// correct but never behaviorally exercised end to end. This pass creates a
// fresh available product, then forces a toggle mutation to fail by trying
// to update a non-existent product id that will fail the backend update.
// Asserts: (1) the optimistic flip reverted to the prior state (not stuck),
// (2) an error message appeared with role="alert" on the detail screen.
// Uses a fresh product and detail screen to isolate the toggle behavior.
async function passToggleRollbackOnFailure({ storeId }) {
  const rollbackProductName = `Smoke Rollback Test ${String(Date.now())}`;

  // Create a fresh product that starts as available
  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive (rollback pass setup)");
    return;
  }

  const filledName = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    if (!nameEl) return "no product-name input";
    setVal(nameEl, ${JSON.stringify(rollbackProductName)});
    return "ok";
  })()`);
  if (filledName !== "ok") {
    fail(`could not fill product name (rollback pass): ${filledName}`);
    return;
  }

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not save rollback test product: ${clickedSave}`);
    return;
  }

  let productId = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    productId = await query(
      `select id from public.products where store_id = '${storeId}' and name = '${rollbackProductName}';`,
    );
    if (productId) break;
    await sleep(300);
  }
  if (!productId) {
    fail(`no product created for the rollback test: ${rollbackProductName}`);
    return;
  }

  // Navigate to the detail screen of this fresh product (should be available)
  await send("Page.navigate", { url: `${BASE}/manage/${productId}` });
  if (!(await waitForText(evaluate, rollbackProductName))) {
    fail("the rollback test product's detail never rendered");
    return;
  }

  // Record the initial availability state from the database
  const initialAvailable = await query(
    `select available from public.products where id = '${productId}';`,
  );

  // The pre-flip truth comes from the DATABASE snapshot taken above, not from
  // the DOM: the whole point of this pass is that the DOM briefly shows the
  // optimistic (wrong) value, so reading it here would prove nothing.

  // Now force the toggle mutation to fail by temporarily replacing the product id
  // with a non-existent one in the DOM. We do this by clicking the toggle while
  // the page thinks it's working with the real product, but the mutation should
  // fail because we've injected a failure condition.
  //
  // Actually, a cleaner approach: use CDP to intercept/fail the network request.
  // But that's complex. Instead, we'll directly invoke the mutation with a bogus
  // id by using evaluate to manipulate the aria-label which the row-toggling code
  // uses to find the button. Then we'll click a toggle that will fail at the
  // backend because the id doesn't exist in the store.

  // Simpler approach: click the toggle and watch for it to fail. The backend will
  // reject the update because of RLS or because the product doesn't exist. But we
  // own the product, so RLS will pass. Instead, we can force it to fail by
  // modifying the onClick to call with a wrong product ID.
  //
  // Even simpler: use the browser's networking to make the request fail. But
  // that requires CDP network interception which is complex.
  //
  // Best approach for this stack: temporarily remove the authorization token from
  // localStorage before the click, so the request will fail with auth error.
  // Then restore it after we see the rollback.

  const removedAuth = await evaluate(`(() => {
    const url = new URL(location.origin);
    const key = "sb-" + url.hostname + "-auth-token";
    const stored = localStorage.getItem(key);
    if (stored) {
      localStorage.removeItem(key);
      return stored;
    }
    // The key format might vary. Let's find any auth-token key.
    const allKeys = Object.keys(localStorage);
    const authKey = allKeys.find(k => k.includes("auth-token"));
    if (authKey) {
      const val = localStorage.getItem(authKey);
      localStorage.removeItem(authKey);
      return authKey + "|" + val;
    }
    return null;
  })()`);

  if (!removedAuth) {
    fail("could not find or remove auth token for rollback test");
    return;
  }

  // Now click the toggle — it should fail because we removed auth
  const clickedToggleForFailure = await evaluate(`(() => {
    const btn = document.querySelector('button[role="switch"]');
    if (!btn) return "no switch found on the detail screen";
    btn.click();
    return "ok";
  })()`);
  if (clickedToggleForFailure !== "ok") {
    fail(
      `could not click the toggle (rollback pass): ${clickedToggleForFailure}`,
    );
    return;
  }

  // Wait a bit for the mutation to process and fail
  await sleep(1500);

  // Restore the auth token
  const parts = removedAuth.split("|");
  if (parts.length === 2) {
    const [authKey, authValue] = parts;
    await evaluate(`(() => {
      localStorage.setItem(${JSON.stringify(authKey)}, ${JSON.stringify(authValue)});
      return "restored";
    })()`);
  } else if (removedAuth.includes("-")) {
    await evaluate(`(() => {
      const url = new URL(location.origin);
      const key = "sb-" + url.hostname + "-auth-token";
      localStorage.setItem(key, ${JSON.stringify(removedAuth)});
      return "restored";
    })()`);
  }

  // Assert 1: the toggle state reverted to the original (not stuck on optimistic)
  const toggleAfterFailure = await evaluate(
    `document.querySelector('button[role="switch"]')?.getAttribute("aria-checked")`,
  );

  const expectedAfterFailure = initialAvailable === "t" ? "true" : "false";
  if (toggleAfterFailure === expectedAfterFailure) {
    console.log(
      "ok: the availability toggle reverted to the prior state after the mutation failed",
    );
  } else {
    fail(
      `expected toggle aria-checked to be "${expectedAfterFailure}" after rollback, got "${String(toggleAfterFailure)}"`,
    );
  }

  // Assert 2: an error message appeared with role="alert"
  const hasErrorAlert = await evaluate(`(() => {
    const alert = document.querySelector('[role="alert"]');
    return alert ? alert.textContent.trim() : null;
  })()`);

  if (hasErrorAlert && hasErrorAlert.length > 0) {
    console.log(
      `ok: an error message appeared with role="alert" after the toggle failed`,
    );
  } else {
    fail(
      "no error message with role='alert' appeared after the toggle mutation failed",
    );
  }
}

// Pass 7b (Gap: human_verification item 2 of 03-VERIFICATION.md): the ROW
// toggle's own rollback-on-failure, distinct from passToggleRollbackOnFailure
// above (which only exercises the DETAIL screen). product-row.tsx renders its
// own `<p role="alert">` scoped to that row rather than reusing a page-wide
// banner — the whole reason PROD-02's row/detail split matters here is that a
// page-wide banner would look identical to a correctly-scoped one if only one
// product ever existed on the screen. So this pass deliberately runs with
// OTHER rows already present (every product created by earlier passes is
// still on /manage) and asserts the failure message renders inside the
// failed row's own DOM subtree and nowhere else — not merely that some
// role="alert" exists somewhere on the page.
async function passRowToggleRollbackOnFailure({ storeId }) {
  const rowRollbackProductName = `Smoke Row Rollback Test ${String(Date.now())}`;

  await send("Page.navigate", { url: `${BASE}/manage/add` });
  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail(
      "the add-product form never became interactive (row rollback pass setup)",
    );
    return;
  }

  const filledName = await evaluate(`(() => {
    const setVal = (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const nameEl = document.querySelector("#product-name");
    if (!nameEl) return "no product-name input";
    setVal(nameEl, ${JSON.stringify(rowRollbackProductName)});
    return "ok";
  })()`);
  if (filledName !== "ok") {
    fail(`could not fill product name (row rollback pass): ${filledName}`);
    return;
  }

  const clickedSave = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^save product$/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Save product button";
    b.click();
    return "ok";
  })()`);
  if (clickedSave !== "ok") {
    fail(`could not save the row rollback test product: ${clickedSave}`);
    return;
  }

  let productId = "";
  const createDeadline = Date.now() + 15000;
  while (Date.now() < createDeadline) {
    productId = await query(
      `select id from public.products where store_id = '${storeId}' and name = '${rowRollbackProductName}';`,
    );
    if (productId) break;
    await sleep(300);
  }
  if (!productId) {
    fail(
      `no product created for the row rollback test: ${rowRollbackProductName}`,
    );
    return;
  }

  // The true prior value comes from the DATABASE, read before anything else
  // touches this row — the whole point of this pass is that the DOM briefly
  // shows the optimistic (wrong) value, so reading the DOM here would prove
  // nothing about what "prior" actually was.
  const dbBefore = await query(
    `select available from public.products where id = '${productId}';`,
  );
  if (dbBefore !== "t" && dbBefore !== "f") {
    fail("could not read the row rollback product's prior availability");
    return;
  }

  await send("Page.navigate", { url: `${BASE}/manage?filter=all` });
  if (!(await waitForText(evaluate, rowRollbackProductName))) {
    fail("the row rollback test product never rendered on /manage");
    return;
  }

  // Confirm at least one OTHER row is present too. Without another row on
  // the screen, "the message rendered inside this row, not a page banner"
  // would be unfalsifiable — a page-wide banner sitting above a single row
  // could look identical to a correctly-scoped one.
  const otherRowPresent = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    return btns.some((b) => !(b.getAttribute("aria-label") || "").includes(${JSON.stringify(rowRollbackProductName)}));
  })()`);
  if (otherRowPresent !== true) {
    fail(
      "no other product row present alongside the row rollback test product — cannot prove row-scoping",
    );
    return;
  }

  const removedAuth = await evaluate(`(() => {
    const url = new URL(location.origin);
    const key = "sb-" + url.hostname + "-auth-token";
    const stored = localStorage.getItem(key);
    if (stored) {
      localStorage.removeItem(key);
      return key + "|" + stored;
    }
    const allKeys = Object.keys(localStorage);
    const authKey = allKeys.find((k) => k.includes("auth-token"));
    if (authKey) {
      const val = localStorage.getItem(authKey);
      localStorage.removeItem(authKey);
      return authKey + "|" + val;
    }
    return null;
  })()`);
  if (!removedAuth) {
    fail("could not find or remove auth token for the row rollback test");
    return;
  }

  const clickedRowToggle = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(rowRollbackProductName)}));
    if (!btn) return "no row switch found for the row rollback test product";
    btn.click();
    return "ok";
  })()`);
  if (clickedRowToggle !== "ok") {
    fail(
      `could not click the row toggle (row rollback pass): ${clickedRowToggle}`,
    );
    return;
  }

  // Give the (now-doomed) mutation time to round-trip and settle.
  await sleep(1500);

  const authParts = removedAuth.split("|");
  const authKey = authParts[0];
  const authValue = authParts.slice(1).join("|");
  await evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(authKey)}, ${JSON.stringify(authValue)});
    return "restored";
  })()`);

  // Assert (a): the row's switch reverted to the DATABASE's true prior
  // value, never a hardcoded inverse and never left stuck on the optimistic
  // flip. A regression that dropped the row's own onError rollback would
  // leave aria-checked at the flipped value here and fail this exact check.
  const rowCheckedAfterFailure = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const btn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(rowRollbackProductName)}));
    return btn ? btn.getAttribute("aria-checked") : null;
  })()`);
  const expectedChecked = dbBefore === "t" ? "true" : "false";
  if (rowCheckedAfterFailure === expectedChecked) {
    console.log(
      "ok: the row's toggle reverted to the database's true prior value after the mutation failed",
    );
  } else {
    fail(
      `expected the row's aria-checked to be "${expectedChecked}" (the database's prior value) after rollback, got "${String(rowCheckedAfterFailure)}"`,
    );
  }

  const dbAfter = await query(
    `select available from public.products where id = '${productId}';`,
  );
  if (dbAfter === dbBefore) {
    console.log(
      "ok: the database's availability value never changed after the forced row-toggle failure",
    );
  } else {
    fail(
      `expected the database value to remain "${dbBefore}" after the forced failure, got "${dbAfter}"`,
    );
  }

  // Assert (b): the failure message is scoped to THIS row, not a page-wide
  // banner. product-row.tsx renders the switch and the `role="alert"` <p> as
  // siblings inside the same outer wrapper div (switch -> card div -> row
  // wrapper), so the row wrapper is the switch's own grandparent. A
  // page-wide banner would render outside every row wrapper and fail the
  // "alert is a descendant of this row's wrapper" check below; a banner that
  // happened to sit near the top of the list would still fail because the
  // OTHER row confirmed present above would then carry no alert of its own
  // while a stray one existed outside any row.
  const scoping = await evaluate(`(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    const btns = [...document.querySelectorAll('button[role="switch"]')];
    const targetBtn = btns.find((b) => (b.getAttribute("aria-label") || "").includes(${JSON.stringify(rowRollbackProductName)}));
    if (!targetBtn) return { error: "target row switch not found" };
    const rowWrapper = targetBtn.parentElement?.parentElement ?? null;
    if (!rowWrapper) return { error: "could not resolve the row wrapper" };
    const alertInsideTargetRow = rowWrapper.querySelector('[role="alert"]');
    const alertsOutsideTargetRow = alerts.filter((a) => !rowWrapper.contains(a));
    return {
      totalAlerts: alerts.length,
      alertInsideTargetRowText: alertInsideTargetRow ? alertInsideTargetRow.textContent.trim() : null,
      alertsOutsideTargetRowCount: alertsOutsideTargetRow.length,
    };
  })()`);

  if (scoping && scoping.error) {
    fail(
      `could not evaluate row-scoping for the failure message: ${scoping.error}`,
    );
  } else if (
    scoping &&
    scoping.totalAlerts === 1 &&
    scoping.alertInsideTargetRowText &&
    scoping.alertInsideTargetRowText.length > 0 &&
    scoping.alertsOutsideTargetRowCount === 0
  ) {
    console.log(
      "ok: the failure message rendered inside the failed row only — no page-wide banner, no message on any other row",
    );
  } else {
    fail(
      `expected exactly one row-scoped role="alert" inside the failed row and none elsewhere, got: ${JSON.stringify(scoping)}`,
    );
  }
}

// Pass 8 (Gap 3): the Add product screen's back arrow returns to /manage.
// NAV-02 requires all secondary screens' back arrows to return to the
// previous screen. Edit's back arrow is smoke-tested (passDetailFlipAndBack,
// passEditProduct); Add's was added later and needs explicit coverage.
// NAV-02: opens the Add screen and asserts its header back arrow returns to
// /manage. Creates no product -- the arrow must work on an untouched form,
// which is also the case a vendor hits when they open Add and change their
// mind.
async function passAddProductBackArrow() {
  await send("Page.navigate", { url: `${BASE}/manage` });
  if (!(await waitForText(evaluate, "Add product"))) {
    fail("the /manage screen never rendered for the back-arrow pass");
    return;
  }

  const clickedAdd = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => (x.textContent || "").trim() === "Add product");
    if (!b) return "no Add product button";
    b.click();
    return "ok";
  })()`);
  if (clickedAdd !== "ok") {
    fail(`could not tap Add product (back-arrow pass): ${clickedAdd}`);
    return;
  }

  if (!(await waitForSelector(evaluate, "#product-name"))) {
    fail("the add-product form never became interactive (back-arrow pass)");
    return;
  }

  // Verify the back button exists and is labeled correctly
  const hasBackButton = await evaluate(
    `document.querySelector('button[aria-label="Go back"]') !== null`,
  );
  if (!hasBackButton) {
    fail("the Add product screen has no back button with aria-label='Go back'");
    return;
  }
  console.log("ok: the Add product screen renders a back button");

  // Click the back button
  const clickedBack = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Go back"]');
    if (!btn) return "no back button found";
    btn.click();
    return "ok";
  })()`);
  if (clickedBack !== "ok") {
    fail(`could not click the back button (back-arrow pass): ${clickedBack}`);
    return;
  }

  // Assert we returned to /manage
  let backOnManage = false;
  for (let i = 0; i < 60; i++) {
    const path = await evaluate("location.pathname");
    if (path === "/manage") {
      backOnManage = true;
      break;
    }
    await sleep(200);
  }
  if (!backOnManage) {
    fail("clicking the back button on Add never returned to /manage");
    return;
  }
  console.log("ok: the Add product screen's back button returns to /manage");
}

// Pass 9: the status filter's URL residence (D-08) and PROD-01's logged-out
// clause. Runs last deliberately — it signs the vendor out, so every pass
// that needs an authenticated session must run before this one. All three
// assertions read the ACTUAL rendered location/DOM state, never an
// assumption about what the code should do: the chip must visibly read as
// selected, the query string must survive a real reload, and a signed-out
// visit to the exact same filtered URL must land on Login carrying that
// whole path — proven, not assumed.
async function passFilterPersistsAndSignsOut() {
  const filteredUrl = `${BASE}/manage?filter=unavailable`;

  await send("Page.navigate", { url: filteredUrl });
  if (!(await waitForText(evaluate, "Unavailable"))) {
    fail("the manage screen with an explicit filter never rendered");
    return;
  }

  const chipSelected = await evaluate(`(() => {
    const chip = [...document.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "Unavailable");
    if (!chip) return "no Unavailable chip found";
    return chip.className.includes("bg-foreground") ? "ok" : "not selected";
  })()`);
  if (chipSelected === "ok") {
    console.log("ok: Unavailable chip reads as selected");
  } else {
    fail(`Unavailable chip did not read as selected: ${chipSelected}`);
  }

  await send("Page.navigate", { url: filteredUrl });
  await sleep(500);
  const reloadedSearch = await evaluate("location.search");
  if (reloadedSearch === "?filter=unavailable") {
    console.log("ok: filter survives a reload");
  } else {
    fail(
      `filter did not survive a reload, query string was: ${String(reloadedSearch)}`,
    );
  }

  await send("Page.navigate", { url: `${BASE}/orders` });
  if (await waitForText(evaluate, "Smoke Order Customer")) {
    console.log(
      "ok: the Orders route still lists the two orders seeded earlier (Phase 6's real list, not the retired stub's unconditional empty state)",
    );
  } else {
    fail("the seeded orders' customer names never rendered on /orders");
  }

  await evaluate(`(() => { localStorage.clear(); return "ok"; })()`);
  await send("Page.navigate", { url: filteredUrl });

  let landedOnLogin = false;
  let lastPath = "";
  let lastSearch = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    lastPath = await evaluate("location.pathname");
    lastSearch = await evaluate("location.search");
    if (lastPath === "/login") {
      landedOnLogin = true;
      break;
    }
    await sleep(250);
  }
  if (!landedOnLogin) {
    fail(
      `signed-out visit to the filtered URL never redirected to /login (landed on ${String(lastPath)})`,
    );
    return;
  }

  const nextParam = await evaluate(
    `decodeURIComponent(new URLSearchParams(location.search).get("next") || "")`,
  );
  if (nextParam === "/manage?filter=unavailable") {
    console.log(
      "ok: signed-out visit redirects to Login carrying the full requested path",
    );
  } else {
    fail(
      `Login's next param was "${String(nextParam)}", expected "/manage?filter=unavailable" (search was ${String(lastSearch)})`,
    );
  }
}

// Pass 9b (Gap: human_verification item 6 of 03-VERIFICATION.md): HOME-02's
// composed status line in BOTH branches, asserted against the live DOM
// against a database-read expected count — not merely eyeballed once. The
// subtext <p> (home-view.tsx) is the one literal text node UI-SPEC's own
// resolution note identifies as the composed reading's dynamic half; the
// "Live" heading and "Active" badge are checked as present but never
// concatenated into one string, matching that note.
//
// `products_set_updated_at` (supabase/migrations/20260922000100_schema.sql)
// is a BEFORE UPDATE trigger that unconditionally sets `updated_at = now()`
// on any touched row — so branch (a) needs no special fixture SQL at all, a
// plain no-op UPDATE is exactly what a real vendor edit does. Branch (b)
// needs the opposite (a value the trigger would normally refuse to accept),
// so the trigger is disabled for exactly the one statement that backdates
// every one of this vendor's products, then re-enabled immediately —
// touching no migration, just a runtime toggle for this fixture.
//
// Every one of this vendor's products' original `updated_at` is read BEFORE
// either branch runs and restored in a `finally`, so a failure partway
// through still leaves the local fixture database undisturbed for later
// runs.
async function passHomeStatusLineBranches({ storeId }) {
  const snapshotRaw = await query(
    `select id || '|' || updated_at from public.products where store_id = '${storeId}';`,
  );
  const snapshot = snapshotRaw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const sep = line.indexOf("|");
      return { id: line.slice(0, sep), updatedAt: line.slice(sep + 1) };
    });
  if (snapshot.length === 0) {
    fail(
      "no products found for the vendor to exercise the Home status-line branches",
    );
    return;
  }

  async function readStatusSubtext() {
    return evaluate(`(() => {
      const label = [...document.querySelectorAll("p")].find(
        (p) => p.textContent.trim() === "Today's catalogue",
      );
      if (!label) return { error: "no Today's catalogue label found" };
      const container = label.parentElement;
      const paragraphs = container ? [...container.querySelectorAll("p")] : [];
      const subtext = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].textContent : null;
      const hasLive = container
        ? [...container.querySelectorAll("span")].some((s) => s.textContent.trim() === "Live")
        : false;
      const hasActiveBadge = container
        ? [...container.querySelectorAll("span")].some((s) => s.textContent.trim().includes("Active"))
        : false;
      return { subtext, hasLive, hasActiveBadge };
    })()`);
  }

  try {
    // Branch (a): WITH the "Updated today" clause.
    const touchedId = snapshot[0].id;
    await query(
      `update public.products set name = name where id = '${touchedId}';`,
    );

    const dbAvailableWith = await query(
      `select count(*) from public.products where store_id = '${storeId}' and available = true;`,
    );

    await send("Page.navigate", { url: `${BASE}/` });
    // "Today's catalogue" carries Tailwind's `uppercase` class, which
    // transforms the RENDERED text CDP's innerText-based waitForText sees
    // (e.g. "TODAY'S CATALOGUE") without touching the DOM's own textContent
    // — so the readiness wait below checks "Live" instead, which carries no
    // such transform, while readStatusSubtext's own textContent-based match
    // on "Today's catalogue" is unaffected either way.
    if (!(await waitForText(evaluate, "Live"))) {
      fail(
        "Home's catalogue status card never rendered (status-line pass, with-clause branch)",
      );
      return;
    }

    const withClause = await readStatusSubtext();
    const expectedWith = `${dbAvailableWith} products available · Updated today`;
    if (withClause && withClause.error) {
      fail(
        `could not read the status subtext (with-clause branch): ${withClause.error}`,
      );
    } else if (
      withClause &&
      withClause.hasLive &&
      withClause.hasActiveBadge &&
      withClause.subtext === expectedWith
    ) {
      console.log(
        `ok: with a product updated today, Home shows the Live heading, the Active badge, and the subtext "${expectedWith}"`,
      );
    } else {
      fail(
        `expected the Live heading, Active badge, and subtext "${expectedWith}", got: ${JSON.stringify(withClause)}`,
      );
    }

    // Branch (b): WITHOUT the clause. Two IST days back is comfortably clear
    // of the India-offset day boundary under any UTC offset, so this can
    // never accidentally still land on today's IST day.
    await query(
      `alter table public.products disable trigger products_set_updated_at;`,
    );
    await query(
      `update public.products set updated_at = now() - interval '2 days' where store_id = '${storeId}';`,
    );
    await query(
      `alter table public.products enable trigger products_set_updated_at;`,
    );

    const dbAvailableWithout = await query(
      `select count(*) from public.products where store_id = '${storeId}' and available = true;`,
    );

    await send("Page.navigate", { url: `${BASE}/` });
    if (!(await waitForText(evaluate, "Live"))) {
      fail(
        "Home's catalogue status card never rendered (status-line pass, without-clause branch)",
      );
      return;
    }

    const withoutClause = await readStatusSubtext();
    const expectedWithout = `${dbAvailableWithout} products available`;
    // Deliberately an exact `===`, not a `.startsWith`/`.includes` check: a
    // naive implementation that leaves the trailing " · Updated today" (or
    // just a dangling " · ") when the clause should be omitted would
    // produce a longer string that still starts with expectedWithout — only
    // strict equality catches a stray separator or trailing whitespace.
    if (withoutClause && withoutClause.error) {
      fail(
        `could not read the status subtext (without-clause branch): ${withoutClause.error}`,
      );
    } else if (withoutClause && withoutClause.subtext === expectedWithout) {
      console.log(
        `ok: with no product updated today, Home's subtext reads exactly "${expectedWithout}" — no dangling separator, no trailing whitespace`,
      );
    } else {
      fail(
        `expected the subtext to read exactly "${expectedWithout}" with the clause omitted, got: ${JSON.stringify(withoutClause)}`,
      );
    }
  } finally {
    // Restore every one of this vendor's products' ORIGINAL updated_at,
    // exactly as captured before either branch ran, so this pass leaves no
    // trace in the local fixture database for later runs.
    await query(
      `alter table public.products disable trigger products_set_updated_at;`,
    );
    for (const row of snapshot) {
      await query(
        `update public.products set updated_at = '${row.updatedAt}' where id = '${row.id}';`,
      );
    }
    await query(
      `alter table public.products enable trigger products_set_updated_at;`,
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

  const { storeId } = await passSeeOwnProducts();
  if (storeId) {
    await passFlipFromRow({ storeId });
    await passDetailFlipAndBack({ storeId });
    await passAddProduct({ storeId });
    await passAddProductWithNewCategory({ storeId });
    await passAddProductUnitAndAmount({ storeId });
    await passAddProductWithPhoto({ storeId });
    const editedFixture = await passEditProduct({ storeId });
    await passRowDetailConsistency({
      productId: editedFixture?.productId,
      productName: editedFixture?.productName,
    });
    await passDetailNotFound();
    await passHomeCounts({ storeId });
    await passHomeOrderTile({ storeId });
    await passHomeScopeBoundary();
    await passToggleRollbackOnFailure({ storeId });
    await passRowToggleRollbackOnFailure({ storeId });
    await passAddProductBackArrow();
    await passHomeStatusLineBranches({ storeId });
    await passFilterPersistsAndSignsOut();
  }

  if (process.exitCode !== 1) console.log("\ncatalogue smoke flow: PASS");
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
