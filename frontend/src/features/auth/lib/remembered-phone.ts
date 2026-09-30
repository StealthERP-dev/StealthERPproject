// Device-memory for D-07: the mobile number is remembered on this device
// and prefilled next time. The PIN is never stored — this module's public
// surface makes that structurally impossible rather than merely discouraged
// (T-02-27): the writer takes exactly one required argument, a phone
// number, and nothing else, so there is no call shape that could carry a
// PIN. Mirrors src/lib/analytics/visitor-id.ts's shape: a structural
// storage interface instead of the DOM type, resolved lazily, and a
// try/catch that never throws into the caller — a device that refuses
// storage (private browsing) must still let a vendor sign in.
//
// Divergence from visitor-id.ts: that module lazily generates a value on
// read; this one is written explicitly at a known moment (the sign-in
// hook's success path), never generated.
//
// Uses only erasable TypeScript syntax so `node --test` can load this file
// directly (Node 24 strips types natively).

const REMEMBERED_PHONE_KEY = "remembered_phone";

/** Structural shape of Web Storage's read/write surface — deliberately not
 * the DOM lib's `Storage` type, so a plain in-memory fake can be injected in
 * a test without a browser. */
export interface RememberedPhoneStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(
  storage: RememberedPhoneStorage | undefined,
): RememberedPhoneStorage | undefined {
  if (storage) {
    return storage;
  }
  // Guard for a server-side render or any environment with no
  // `localStorage` (this module's own unit test, run under plain Node).
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return localStorage;
}

/** Returns the remembered mobile number, or an empty string when there is
 * none or storage is unavailable. Never throws. */
export function getRememberedPhone(storage?: RememberedPhoneStorage): string {
  const store = resolveStorage(storage);
  if (!store) {
    return "";
  }

  try {
    return store.getItem(REMEMBERED_PHONE_KEY) ?? "";
  } catch {
    // Safari private browsing throws on getItem too. Never throw into the
    // caller — a vendor with no readable storage still sees an empty field.
    return "";
  }
}

/** Writes the remembered mobile number. Takes a single phone argument and
 * nothing else — no options object, no generic value setter — so there is
 * no shape in which a PIN could be passed to it. The optional `storage`
 * parameter carries a default, so it never counts toward the function's
 * arity (`setRememberedPhone.length` is 1): it exists only so a test can
 * inject a fake store, and every production call resolves the real browser
 * storage on its own. Never throws — a device that refuses storage still
 * signs the vendor in. */
export function setRememberedPhone(
  phone: string,
  storage: RememberedPhoneStorage | undefined = resolveStorage(undefined),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(REMEMBERED_PHONE_KEY, phone);
  } catch {
    // Safari private browsing throws on setItem. Never throw into the
    // caller.
  }
}
