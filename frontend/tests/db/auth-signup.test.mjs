// HTTP (PostgREST + GoTrue) test: the architectural tracer for the whole
// phase — a brand-new phone number becomes an `auth.users` row and an
// RLS-scoped `stores` row with a unique slug, a shop-name collision is
// resolved by suffix (D-10), and a repeat signup is refused with a typed
// error read from `signUp` itself, never from a `stores`-insert failure
// (D-20).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, randomDigits } from "./_env.mjs";
import {
  toCanonicalPhone,
  toSyntheticEmail,
} from "../../src/features/auth/lib/phone.ts";
import {
  slugify,
  insertStoreWithUniqueSlug,
} from "../../src/features/auth/lib/slug.ts";

test("auth-signup: a brand-new phone becomes an auth user and an RLS-scoped stores row with a unique slug", async () => {
  const phone = "9" + randomDigits(9);
  const client = anonClient();

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: toSyntheticEmail(phone),
    password: "123456",
  });
  assert.equal(signUpError, null);
  assert.ok(signUpData.session, "signUp returns a session");
  assert.ok(signUpData.user, "signUp returns a user");

  const shopName = "Priya's Fresh Produce";
  const store = await insertStoreWithUniqueSlug(client, slugify(shopName), {
    owner_id: signUpData.user.id,
    phone: toCanonicalPhone(phone),
    shop_name: shopName,
    vendor_name: "Priya",
    business_types: ["Vegetables"],
  });

  assert.equal(store.slug, slugify(shopName));
  assert.equal(store.phone, toCanonicalPhone(phone));
  assert.equal(store.location, null);

  // ── Slug collision: a second shop with the SAME shop name gets a suffixed slug (D-10) ──
  const secondPhone = "9" + randomDigits(9);
  const secondClient = anonClient();
  const { data: secondSignUp, error: secondSignUpError } =
    await secondClient.auth.signUp({
      email: toSyntheticEmail(secondPhone),
      password: "123456",
    });
  assert.equal(secondSignUpError, null);

  const secondStore = await insertStoreWithUniqueSlug(
    secondClient,
    slugify(shopName),
    {
      owner_id: secondSignUp.user.id,
      phone: toCanonicalPhone(secondPhone),
      shop_name: shopName,
      vendor_name: "Meera",
      business_types: ["Vegetables"],
    },
  );

  assert.ok(
    secondStore.slug.startsWith(slugify(shopName)),
    "the second slug shares the base",
  );
  assert.notEqual(secondStore.slug, store.slug);
  assert.equal(
    secondStore.slug.length,
    store.slug.length + 5,
    "the suffixed slug is exactly five characters longer (a hyphen + 4 base-36 chars)",
  );

  // ── Repeat signup for the FIRST phone is refused with a typed error (D-20) ──
  const { data: repeatData, error: repeatError } = await client.auth.signUp({
    email: toSyntheticEmail(phone),
    password: "654321",
  });
  assert.equal(repeatData.session, null);
  assert.ok(repeatError, "a repeat signup for the same phone returns an error");
  assert.equal(repeatError.code, "user_already_exists");
  assert.equal(repeatError.status, 422);
});
