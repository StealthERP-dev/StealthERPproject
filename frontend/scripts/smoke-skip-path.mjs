#!/usr/bin/env node
// GAP 1 — AUTH-02: Tapping "Skip for now" on the business-type step must emit
// onboarding_completed and land on Home, even with an empty selection.
//
// This tests the specific requirement that skipping completes onboarding:
// D-16 "onboarding_completed fires when the 'What do you sell?' step is finished
// or skipped" and D-18 "After the finish-your-shop recovery, the vendor continues
// to 'What do you sell?', not straight to Home — same journey as everyone else,
// and onboarding_completed always fires".
//
// The original smoke-signup-flow.mjs tests the Continue path with a selection.
// This script tests the Skip path with an empty selection.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness.
//
// Usage: node scripts/smoke-skip-path.mjs [baseUrl]

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9335";

const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Skip Flow Shop";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the form to be INTERACTIVE rather than sleeping a fixed interval.
// A fixed wait flaked on a cold server: the first request after `next start`
// compiles the route, so 3.5s was enough warm and not enough cold, and the
// run failed with every assertion red as though the app were broken. A gate
// that fails for reasons unrelated to the code under test is worse than no
// gate — it teaches you to ignore it.
async function waitForInputs(evaluate, minCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await evaluate(`document.querySelectorAll("input").length`);
    if (typeof n === "number" && n >= minCount) return true;
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
  await send("Page.navigate", { url: `${BASE}/setup` });
  if (!(await waitForInputs(evaluate, 4))) {
    throw new Error(
      "setup form never became interactive (inputs never appeared)",
    );
  }

  // Fill the setup form
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
    setVal(nameEl, "Skip Vendor");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") throw new Error(`could not fill setup form: ${filled}`);
  await sleep(500);

  // Submit the setup form
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^continue/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no enabled Continue";
    b.click();
    return "ok";
  })()`);
  if (clicked !== "ok") throw new Error(`could not submit setup: ${clicked}`);

  // Wait for "What do you sell?" to render
  let sawBusinessType = false;
  for (let i = 0; i < 100; i++) {
    const heading = await evaluate(
      `(document.querySelector("h1") || {}).innerText || ""`,
    );
    if (/what do you sell/i.test(heading)) {
      sawBusinessType = true;
      break;
    }
    await sleep(150);
  }
  if (!sawBusinessType) {
    fail('"What do you sell?" never rendered after signup');
  } else {
    console.log('ok: "What do you sell?" rendered after signup');

    // TAP "Skip for now" button WITHOUT selecting any business type
    const skipped = await evaluate(`(() => {
      const skipBtn = [...document.querySelectorAll("button")]
        .find((b) => /^skip for now$/i.test((b.textContent || "").trim()));
      if (!skipBtn) return "no skip button found";
      if (skipBtn.disabled) return "skip button is disabled";
      skipBtn.click();
      return "ok";
    })()`);
    if (skipped !== "ok") {
      fail(`could not tap skip button: ${skipped}`);
    } else {
      console.log("ok: Skip button tapped");

      // Wait for redirect to Home
      let reachedHome = false;
      for (let i = 0; i < 80; i++) {
        if ((await evaluate("location.pathname")) === "/") {
          reachedHome = true;
          break;
        }
        await sleep(200);
      }
      if (reachedHome) {
        console.log("ok: reached Home after skipping");
      } else {
        fail("never reached Home after skipping");
      }
    }
  }

  // Database assertions
  const types = await query(
    `select coalesce(array_to_string(business_types, ','), '') from public.stores where phone = '${phone}';`,
  );
  if (!types || types === "") {
    console.log("ok: stores.business_types is empty (skipped, not selected)");
  } else {
    fail(`stores.business_types should be empty after skip, but is: ${types}`);
  }

  const events = await query(
    `select coalesce(string_agg(distinct event_name, ','), '') from public.events e
       join public.stores s on s.id = e.store_id where s.phone = '${phone}';`,
  );
  if (events.includes("shop_created")) {
    console.log("ok: shop_created event recorded");
  } else {
    fail("shop_created event missing");
  }
  if (events.includes("onboarding_completed")) {
    console.log(
      "ok: onboarding_completed event recorded after skip (AUTH-02, D-16)",
    );
  } else {
    fail(
      "onboarding_completed event missing — skipping does not complete onboarding (AUTH-02 broken)",
    );
  }

  if (process.exitCode !== 1) console.log("\nskip path: PASS");
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
