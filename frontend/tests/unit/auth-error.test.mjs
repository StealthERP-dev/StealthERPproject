// Unit test (no database, no browser): proves every recognised AuthError
// code maps to its exact UI-SPEC string, that an unrecognised message falls
// back to the generic string, and that authErrorMessage never throws for
// anything a render path might hand it (D-04's message-collision guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  authErrorMessage,
  AUTH_ERROR_MESSAGES,
  GENERIC_AUTH_ERROR,
} from "../../src/features/auth/lib/auth-error.ts";

test("authErrorMessage: invalid_credentials maps to the exact UI-SPEC string", () => {
  const error = new AuthError("invalid_credentials");
  assert.equal(error.code, "invalid_credentials");
  assert.equal(
    authErrorMessage(error),
    AUTH_ERROR_MESSAGES.invalid_credentials,
  );
  assert.equal(authErrorMessage(error), "Wrong mobile number or PIN");
});

test("authErrorMessage: locked_out maps to the exact UI-SPEC string", () => {
  const error = new AuthError("locked_out");
  assert.equal(error.code, "locked_out");
  assert.equal(authErrorMessage(error), AUTH_ERROR_MESSAGES.locked_out);
  assert.equal(
    authErrorMessage(error),
    "Too many wrong PINs. Try again in 15 minutes.",
  );
});

test("authErrorMessage: duplicate_phone maps to the exact UI-SPEC string", () => {
  const error = new AuthError("duplicate_phone");
  assert.equal(error.code, "duplicate_phone");
  assert.equal(authErrorMessage(error), AUTH_ERROR_MESSAGES.duplicate_phone);
  assert.equal(
    authErrorMessage(error),
    "This number already has a shop — open it instead",
  );
});

test("authErrorMessage: an AuthError built from an unrecognised message reports the unknown code and resolves to the generic string", () => {
  const error = new AuthError("some_unmapped_supabase_message");
  assert.equal(error.code, "unknown");
  assert.equal(authErrorMessage(error), GENERIC_AUTH_ERROR);
});

test("authErrorMessage: a plain Error, a string, null and undefined all resolve to the generic string rather than throwing", () => {
  assert.equal(authErrorMessage(new Error("boom")), GENERIC_AUTH_ERROR);
  assert.equal(authErrorMessage("boom"), GENERIC_AUTH_ERROR);
  assert.equal(authErrorMessage(null), GENERIC_AUTH_ERROR);
  assert.equal(authErrorMessage(undefined), GENERIC_AUTH_ERROR);
});

test("authErrorMessage: the wrong-credentials string and the lockout string are different from each other", () => {
  assert.notEqual(
    authErrorMessage(new AuthError("invalid_credentials")),
    authErrorMessage(new AuthError("locked_out")),
  );
});
