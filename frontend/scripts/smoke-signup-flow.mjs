#!/usr/bin/env node
// End-to-end signup flow check: drives a REAL vendor signup through /setup in
// headless Chrome and asserts the whole journey lands, including the parts
// only the database can confirm.
//
// Why this exists. Phase 2's unit and HTTP suites call the underlying library
// functions directly and never render a component, so nothing caught a defect
// that broke the phase's main flow: signUp() fires onAuthStateChange as soon
// as the auth user exists, which is BEFORE the stores row is inserted, so
// SetupPage briefly saw `user && !store`, swapped SetupForm out for the D-09
// recovery form, and unmounted the component owning the in-flight mutation.
// TanStack drops a mutate(vars, {onSuccess}) callback on unmount, so the shop
// row was created, no error surfaced, and "What do you sell?" never rendered —
// business_types stayed '{}' and onboarding_completed never fired. It looked
// exactly like "nothing happened".
//
// A DOM-only assertion would not have caught it either: the failure is silent
// and leaves the form on screen. So this check asserts the DATABASE outcome
// too, which is the only place the truth was visible.
//
// No new dependency: Chrome is already used by smoke-dom.mjs (CHROME_BIN), and
// WebSocket is global in Node 22+.
//
// Usage: node scripts/smoke-signup-flow.mjs [baseUrl]
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
const CDP_PORT = process.env.CDP_PORT ?? "9334";

// A fresh number every run: one shop per mobile (BR1), so a reused number
// would hit the duplicate path instead of the flow under test.
const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Smoke Flow Shop";

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

  // Fill through React's own value setter so controlled inputs update state;
  // assigning .value directly would leave React's state untouched and leave
  // Continue disabled.
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

  // 1. The business-type step must actually render. This is the assertion the
  //    unmount defect failed: the row was created and the step never appeared.
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

    // 2. Pick a type and continue through to Home.
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
    if (reachedHome) {
      console.log("ok: reached Home after the business-type step");
    } else {
      fail("never reached Home after the business-type step");
    }
  }

  // 3. The database outcome — the only place the silent failure was visible.
  const types = await query(
    `select coalesce(array_to_string(business_types, ','), '') from public.stores where phone = '${phone}';`,
  );
  if (types) {
    console.log(`ok: stores.business_types recorded (${types})`);
  } else {
    fail(
      "stores.business_types is empty — the business-type step did not save",
    );
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
    console.log("ok: onboarding_completed event recorded (DATA-04)");
  } else {
    fail(
      "onboarding_completed event missing — the activation funnel would silently lose this vendor",
    );
  }

  if (process.exitCode !== 1) console.log("\nsignup flow: PASS");
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
