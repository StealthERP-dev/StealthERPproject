// NAV-04: executes README.md's own "Reset a vendor's PIN from the
// dashboard" SQL block against the local stack, so the handover doc and its
// proof can never silently drift apart. This is the first tests/db/ test to
// shell out to `psql` directly rather than going through the anon-key
// HTTP/RPC surface — the README's own path IS the SQL Editor, which an
// operator runs as the `postgres` role, and this test exercises that same
// path rather than keeping a second, hand-copied version of the SQL.
//
// A missing heading, a missing fenced block, or a missing placeholder FAILS
// this test (assert.ok/assert.notEqual throw) — it never skips, because a
// silently-skipped test would let the doc and the SQL drift apart with no
// signal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getLocalEnv, randomDigits, signUpVendor } from "./_env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(__dirname, "..", "..", "README.md");

const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const HEADING = "## Reset a vendor's PIN from the dashboard";

// Reads README.md fresh on every call (never cached at import time), so a
// later edit to the doc is re-checked by the next test run, not silently
// bypassed.
function extractPinResetSql() {
  const readme = readFileSync(README_PATH, "utf8");
  const headingIndex = readme.indexOf(HEADING);
  assert.notEqual(
    headingIndex,
    -1,
    `README.md is missing the heading "${HEADING}"`,
  );

  const afterHeading = readme.slice(headingIndex);
  const fenceMatch = /```sql\n([\s\S]*?)```/.exec(afterHeading);
  assert.ok(
    fenceMatch,
    `no fenced \`\`\`sql block found after "${HEADING}" in README.md`,
  );

  const sql = fenceMatch[1].trim();
  assert.ok(
    sql.includes("<PHONE>"),
    "README's PIN-reset SQL block is missing the <PHONE> placeholder",
  );
  assert.ok(
    sql.includes("<NEW_PIN>"),
    "README's PIN-reset SQL block is missing the <NEW_PIN> placeholder",
  );

  return sql;
}

// Substitutes ONLY the two named placeholders and nothing else, then runs
// the exact text README shows an operator, with ON_ERROR_STOP so a broken
// statement fails the test loudly instead of being swallowed.
function runReadmeSql(sql, phone, newPin) {
  const substituted = sql
    .replaceAll("<PHONE>", phone)
    .replaceAll("<NEW_PIN>", newPin);
  return execFileSync(
    "psql",
    [DB_URL, "-v", "ON_ERROR_STOP=1", "-c", substituted],
    { encoding: "utf8" },
  );
}

test("README's PIN-reset SQL clears a lockout, sets a new PIN, and refuses the old one", async () => {
  const sql = extractPinResetSql();

  const { client, phone } = await signUpVendor();

  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await client.rpc("record_login_failure", {
      p_phone: phone,
    });
    assert.equal(error, null);
  }

  const { data: lockedBefore, error: lockedBeforeError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(lockedBeforeError, null);
  assert.equal(lockedBefore, true, "five failures should lock the phone");

  const output = runReadmeSql(sql, phone, "654321");
  const marker = `${phone}@phone.local`;
  const occurrences = output.split(marker).length - 1;
  assert.equal(
    occurrences,
    1,
    `expected the SQL's returned row to contain "${marker}" exactly once, got:\n${output}`,
  );

  const { data: lockedAfter, error: lockedAfterError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(lockedAfterError, null);
  assert.equal(
    lockedAfter,
    false,
    "the README SQL's delete statement should clear the lockout",
  );

  const { apiUrl, anonKey } = getLocalEnv();
  const freshClient = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: newPinSignIn, error: newPinError } =
    await freshClient.auth.signInWithPassword({
      email: marker,
      password: "654321",
    });
  assert.equal(newPinError, null);
  assert.ok(newPinSignIn.session, "the new PIN should sign in successfully");

  const { error: oldPinError } = await freshClient.auth.signInWithPassword({
    email: marker,
    password: "123456",
  });
  assert.ok(oldPinError, "the old PIN must be refused after the reset");
});

// Proves the returned row really does tell the operator whether anything
// changed: running the reset for a phone no vendor owns must touch nothing
// and must not echo that phone's email back as if it had.
test("README's PIN-reset SQL for a phone no vendor owns returns no matching row", async () => {
  const sql = extractPinResetSql();
  const unownedPhone = "9" + randomDigits(9);

  const output = runReadmeSql(sql, unownedPhone, "654321");
  assert.ok(
    !output.includes(`${unownedPhone}@phone.local`),
    "a phone no vendor owns must never appear in the SQL's returned row",
  );
});
