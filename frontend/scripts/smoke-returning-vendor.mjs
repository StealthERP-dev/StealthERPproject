#!/usr/bin/env node
// GAP 2 — AUTH-07: A vendor who already has a session and a shop must be sent
// from /setup and /login straight to Home without needing to enter anything.
//
// This tests D-12 "signed-out visit to a vendor route goes to login and, after
// signing in, continues to the originally requested page" and AUTH-07 "Session
// persists; unauthenticated → setup/login".
//
// The specific gap: after completing a signup in the same browser session,
// navigating to /setup or /login should land on / (Home), not show those
// entry screens again.
//
// No new dependency: reuses the same Chrome/WebSocket harness.
//
// Usage: node scripts/smoke-returning-vendor.mjs [baseUrl]

import { spawn } from "node:child_process";

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100";
const CHROME_BIN = process.env.CHROME_BIN ?? "google-chrome";
const CDP_PORT = process.env.CDP_PORT ?? "9336";

const phone = "9" + String(Date.now()).slice(-9);
const SHOP = "Returning Vendor Shop";

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

  // Fill and submit the signup form
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
    setVal(nameEl, "Returning Vendor");
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
  if (!sawBusinessType) throw new Error("business-type step never appeared");

  // Skip to complete onboarding and reach Home
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
  console.log("ok: reached Home after signup");

  // Test 1: Navigate to /setup — should redirect to /
  console.log("testing redirect from /setup to /...");
  await send("Page.navigate", { url: `${BASE}/setup` });
  await sleep(2000);

  let setupRedirected = false;
  for (let i = 0; i < 40; i++) {
    const pathname = await evaluate("location.pathname");
    if (pathname === "/") {
      setupRedirected = true;
      break;
    }
    await sleep(200);
  }
  if (setupRedirected) {
    console.log("ok: /setup redirected to / for returning vendor");
  } else {
    fail("/setup did not redirect to / for returning vendor (AUTH-07 broken)");
  }

  // Test 2: Navigate to /login — should redirect to /
  console.log("testing redirect from /login to /...");
  await send("Page.navigate", { url: `${BASE}/login` });
  await sleep(2000);

  let loginRedirected = false;
  for (let i = 0; i < 40; i++) {
    const pathname = await evaluate("location.pathname");
    if (pathname === "/") {
      loginRedirected = true;
      break;
    }
    await sleep(200);
  }
  if (loginRedirected) {
    console.log("ok: /login redirected to / for returning vendor");
  } else {
    fail("/login did not redirect to / for returning vendor (AUTH-07 broken)");
  }

  if (process.exitCode !== 1) console.log("\nreturning vendor redirect: PASS");
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
