#!/usr/bin/env node
// DOM smoke check for client-rendered routes: polls a URL until it answers,
// dumps the rendered DOM via headless Chrome, and asserts expected/absent text.
//
// Usage: node scripts/smoke-dom.mjs <url> [expected text ...] [--absent=<text> ...]

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const [, , url, ...rest] = process.argv;

if (!url) {
  console.error(
    "usage: node scripts/smoke-dom.mjs <url> [expected text ...] [--absent=<text> ...]",
  );
  process.exit(1);
}

const expected = [];
const absent = [];

for (const arg of rest) {
  if (arg.startsWith("--absent=")) {
    absent.push(arg.slice("--absent=".length));
  } else {
    expected.push(arg);
  }
}

const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1000;

async function waitForUrl(target) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target);
      if (res.ok || res.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for ${target} to respond: ${String(lastError)}`,
  );
}

async function dumpDom(target) {
  const chromeBin = process.env.CHROME_BIN ?? "google-chrome";
  const { stdout } = await execFileAsync(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=15000",
      "--dump-dom",
      target,
    ],
    { maxBuffer: 1024 * 1024 * 32 },
  );
  return stdout;
}

async function main() {
  await waitForUrl(url);
  const dom = await dumpDom(url);

  const missing = expected.filter((text) => !dom.includes(text));
  const present = absent.filter((text) => dom.includes(text));

  for (const text of missing) {
    console.log(`missing: ${text}`);
  }
  for (const text of present) {
    console.log(`present: ${text}`);
  }

  if (missing.length > 0 || present.length > 0) {
    process.exit(1);
  }

  console.log(`ok: ${url}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
