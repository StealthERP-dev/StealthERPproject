#!/usr/bin/env node
// GAP 3 — D-09: A vendor who is signed in but has NO stores row (shop insert
// failed during signup) must see the finish-your-shop form, not the signup form,
// and on finishing must continue to "What do you sell?" — same journey as
// everyone else, so onboarding_completed fires (D-18).
//
// This is the recovery path that guards against a halfway-failed signup: if
// auth succeeds but the shop row insert fails, the next time the vendor opens
// the app they should not see "enter your phone again", they should see
// "you're signed in, just finish your shop details".
//
// The challenge: to create the state, we need to:
// 1. Complete a normal signup (have both user + store)
// 2. Delete the stores row while keeping the session alive
// 3. Reload the setup page
// 4. Vendor is now signed-in-with-no-shop
//
// This tests that the recovery form renders and the full journey continues.
//
// No new dependency: reuses the same Chrome/WebSocket/psql harness.
//
// Usage: node scripts/smoke-recovery.mjs [baseUrl]

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CDP_PORT = process.env.CDP_PORT ?? "9337";

const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Recovery Shop";

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

async function execute(sql) {
  await execFileAsync("psql", [DB_URL, "-At", "-c", sql]);
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

  // Fill and submit the signup form to create both user + store
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
      return "missing inputs";
    }
    setVal(phoneEl, ${JSON.stringify(phone)});
    setVal(shopEl, ${JSON.stringify(SHOP)});
    setVal(nameEl, "Recovery Vendor");
    setVal(pinEl, "123456");
    return "ok";
  })()`);
  if (filled !== "ok") throw new Error("could not fill setup form");
  await sleep(500);

  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^continue/i.test((x.textContent || "").trim()) && !x.disabled);
    if (!b) return "no button";
    b.click();
    return "ok";
  })()`);
  if (clicked !== "ok") throw new Error("could not submit setup");

  // Wait for "What do you sell?" to render (normal signup flow)
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
  if (!sawBusinessType) throw new Error("business-type step never appeared");

  // Skip to complete the flow and reach Home
  await evaluate(`(() => {
    const skipBtn = [...document.querySelectorAll("button")]
      .find((b) => /^skip for now$/i.test((b.textContent || "").trim()));
    if (skipBtn) skipBtn.click();
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
  if (!reachedHome) throw new Error("never reached Home after signup");
  console.log("ok: completed normal signup and reached Home");

  // NOW: Delete the stores row to simulate a half-failed signup recovery scenario
  await execute(`delete from public.stores where phone = '${phone}';`);
  console.log("ok: deleted stores row (simulating half-failed signup)");

  // Verify the row is gone from the database
  const storeCheck = await query(
    `select count(*) from public.stores where phone = '${phone}';`,
  );
  if (storeCheck !== "0") {
    throw new Error("stores row was not deleted");
  }
  console.log("ok: verified stores row is deleted");

  // Reload /setup while the session is still active — vendor is now signed-in-with-no-shop
  await send("Page.navigate", { url: `${BASE}/setup` });
  await sleep(2000);

  // The app should detect "user && !store" and render FinishYourShopForm instead of SetupForm
  // FinishYourShopForm has the text "Finish setting up your shop"
  let sawRecoveryForm = false;
  for (let i = 0; i < 50; i++) {
    const heading = await evaluate(
      `(document.querySelector("h1") || {}).innerText || ""`,
    );
    if (/finish setting up your shop/i.test(heading)) {
      sawRecoveryForm = true;
      break;
    }
    await sleep(200);
  }
  if (!sawRecoveryForm) {
    fail("recovery form (finish-your-shop) never rendered (D-09 broken)");
  } else {
    console.log("ok: recovery form rendered for signed-in-with-no-shop vendor");

    // Fill the recovery form (no phone or PIN needed, just shop name and vendor name)
    const recoveryFilled = await evaluate(`(() => {
      const setVal = (el, v) => {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
        desc.set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll("input")];
      const byId = (frag) => inputs.find((i) => (i.id || "").includes(frag));
      const shopEl = byId("finish-shop-name"), nameEl = byId("finish-vendor-name");
      if (!shopEl || !nameEl) {
        return "missing recovery form inputs";
      }
      setVal(shopEl, "New Shop Name");
      setVal(nameEl, "New Vendor Name");
      return "ok";
    })()`);
    if (recoveryFilled !== "ok") {
      fail(`could not fill recovery form: ${recoveryFilled}`);
    } else {
      console.log("ok: recovery form filled");

      // Submit the recovery form
      const recoverySubmitted = await evaluate(`(() => {
        const b = [...document.querySelectorAll("button")]
          .find((x) => /^finish setup/i.test((x.textContent || "").trim()) && !x.disabled);
        if (!b) return "no finish setup button";
        b.click();
        return "ok";
      })()`);
      if (recoverySubmitted !== "ok") {
        fail(`could not submit recovery form: ${recoverySubmitted}`);
      } else {
        console.log("ok: recovery form submitted");

        // D-18: After finish-your-shop recovery, the vendor continues to "What do you sell?"
        let sawBusinessTypeAfterRecovery = false;
        for (let i = 0; i < 100; i++) {
          const heading = await evaluate(
            `(document.querySelector("h1") || {}).innerText || ""`,
          );
          if (/what do you sell/i.test(heading)) {
            sawBusinessTypeAfterRecovery = true;
            break;
          }
          await sleep(150);
        }
        if (!sawBusinessTypeAfterRecovery) {
          fail(
            "business-type step did not render after recovery (D-18 broken: should continue to 'What do you sell?', not straight to Home)",
          );
        } else {
          console.log("ok: business-type step rendered after recovery (D-18)");

          // Skip the business-type step to reach Home
          await evaluate(`(() => {
            const skipBtn = [...document.querySelectorAll("button")]
              .find((b) => /^skip for now$/i.test((b.textContent || "").trim()));
            if (skipBtn) skipBtn.click();
            return "ok";
          })()`);

          let reachedHomeAfterRecovery = false;
          for (let i = 0; i < 80; i++) {
            if ((await evaluate("location.pathname")) === "/") {
              reachedHomeAfterRecovery = true;
              break;
            }
            await sleep(200);
          }
          if (reachedHomeAfterRecovery) {
            console.log("ok: reached Home after recovery flow");
          } else {
            fail("never reached Home after recovery flow");
          }
        }
      }
    }
  }

  // Database assertions: verify the new stores row exists and onboarding_completed fired
  const newStoreCheck = await query(
    `select count(*) from public.stores where phone = '${phone}';`,
  );
  if (newStoreCheck === "0") {
    fail("no new stores row created by recovery form (D-09 recovery broken)");
  } else {
    console.log("ok: new stores row created by recovery form");
  }

  const events = await query(
    `select coalesce(string_agg(distinct event_name, ','), '') from public.events e
       join public.stores s on s.id = e.store_id where s.phone = '${phone}';`,
  );
  if (events.includes("shop_created")) {
    console.log("ok: shop_created event recorded (recovery path)");
  } else {
    fail("shop_created event missing from recovery path");
  }
  if (events.includes("onboarding_completed")) {
    console.log(
      "ok: onboarding_completed event recorded (recovery path, D-18)",
    );
  } else {
    fail("onboarding_completed event missing from recovery path (D-18 broken)");
  }

  if (process.exitCode !== 1) console.log("\nrecovery flow: PASS");
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
