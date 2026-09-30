// HTTP (PostgREST) test: the AUTH-06 per-phone PIN lockout, exercised through
// the three public RPCs with an anon key end to end — no browser code
// involved, proving the lock is real even for a caller that skips the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  anonClient,
  getLocalEnv,
  randomDigits,
  signUpVendor,
} from "./_env.mjs";

test("login lockout: five failures lock a fresh phone, clear_login_attempts unlocks it", async () => {
  const client = anonClient();
  const phone = "9" + randomDigits(9);

  const { data: lockedAtStart, error: lockedAtStartError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(lockedAtStartError, null);
  assert.equal(lockedAtStart, false);

  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data: tripped, error } = await client.rpc("record_login_failure", {
      p_phone: phone,
    });
    assert.equal(error, null);
    assert.equal(tripped, false, `attempt ${attempt} should not trip the lock`);
  }

  const { data: fifthTripped, error: fifthError } = await client.rpc(
    "record_login_failure",
    { p_phone: phone },
  );
  assert.equal(fifthError, null);
  assert.equal(fifthTripped, true);

  const { data: lockedNow, error: lockedNowError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(lockedNowError, null);
  assert.equal(lockedNow, true);

  // clear_login_attempts takes no phone argument — it derives the caller's
  // own phone from their session, so unlocking requires a real signed-in
  // account for this exact phone (a plain anon call, or a call naming a
  // different phone, would be the AUTH-06 bypass this design closes).
  const { error: signUpError } = await client.auth.signUp({
    email: `${phone}@phone.local`,
    password: "123456",
  });
  assert.equal(signUpError, null);

  const { error: clearError } = await client.rpc("clear_login_attempts");
  assert.equal(clearError, null);

  const { data: lockedAfterClear, error: lockedAfterClearError } =
    await client.rpc("check_login_lock", { p_phone: phone });
  assert.equal(lockedAfterClearError, null);
  assert.equal(lockedAfterClear, false);
});

test("login lockout: clear_login_attempts is refused for an unauthenticated caller", async () => {
  const client = anonClient();
  const { error } = await client.rpc("clear_login_attempts");
  assert.notEqual(error, null);
});

test("D-04: a wrong PIN on a registered phone and any PIN on an unregistered phone return the identical error", async () => {
  const { apiUrl, anonKey } = getLocalEnv();
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: wrongPinError } = await client.auth.signInWithPassword({
    email: "9876543210@phone.local",
    password: "000000",
  });
  assert.ok(wrongPinError);
  assert.equal(wrongPinError.code, "invalid_credentials");

  const unknownPhone = "9" + randomDigits(9);
  const { error: unknownNumberError } = await client.auth.signInWithPassword({
    email: `${unknownPhone}@phone.local`,
    password: "000000",
  });
  assert.ok(unknownNumberError);
  assert.equal(unknownNumberError.code, "invalid_credentials");

  assert.equal(wrongPinError.code, unknownNumberError.code);
  assert.equal(wrongPinError.message, unknownNumberError.message);
});

test("login lockout: 10 parallel record_login_failure calls for one fresh phone split exactly 4 false / 6 true", async () => {
  const client = anonClient();
  const phone = "9" + randomDigits(9);

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      client.rpc("record_login_failure", { p_phone: phone }),
    ),
  );

  for (const { error } of results) {
    assert.equal(error, null);
  }

  const falseCount = results.filter((r) => r.data === false).length;
  const trueCount = results.filter((r) => r.data === true).length;
  assert.equal(falseCount, 4);
  assert.equal(trueCount, 6);
});

test("login lockout: a locked phone stays locked after a different vendor clears their own attempts", async () => {
  const client = anonClient();
  const phone = "9" + randomDigits(9);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await client.rpc("record_login_failure", {
      p_phone: phone,
    });
    assert.equal(error, null);
  }

  const { data: locked, error: lockedError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(lockedError, null);
  assert.equal(locked, true);

  // A different, unrelated vendor clearing their OWN attempts must never
  // touch this phone's lock — clear_login_attempts derives the phone from
  // the caller's own session and takes no argument, so there is no way for
  // this call to name our locked phone even by mistake.
  const other = await signUpVendor();
  const { error: otherClearError } = await other.client.rpc(
    "clear_login_attempts",
  );
  assert.equal(otherClearError, null);

  const { data: stillLocked, error: stillLockedError } = await client.rpc(
    "check_login_lock",
    { p_phone: phone },
  );
  assert.equal(stillLockedError, null);
  assert.equal(stillLocked, true);
});
