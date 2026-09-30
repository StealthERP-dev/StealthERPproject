// Lazy, persisted, non-personal anonymous visitor identifier (D-03). A
// single random UUID generated once per browser and reused on every later
// anonymous event; carries no personal data and resets when the browser's
// storage is cleared. Never derived from a phone, an email, an IP or a
// fingerprint — see the plan's threat register (T-01.1-23).
//
// Uses only erasable TypeScript syntax so `node --test` can load this file
// directly (Node 24 strips types natively).

const VISITOR_ID_KEY = "visitor_id";

/** Structural shape of Web Storage's read/write surface — deliberately not
 * the DOM lib's `Storage` type, so a plain in-memory fake can be injected in
 * a test without a browser. */
export interface VisitorIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Generated once, reused for the lifetime of this module instance, whenever
// storage is unavailable (server-side render, no `localStorage`) or throws
// on every access (Safari private browsing). Keeps one browsing session
// grouped under one id even when nothing can be persisted.
let inMemoryFallback: string | undefined;

function fallbackId(): string {
  inMemoryFallback ??= crypto.randomUUID();
  return inMemoryFallback;
}

function resolveStorage(
  storage: VisitorIdStorage | undefined,
): VisitorIdStorage | undefined {
  if (storage) {
    return storage;
  }
  // Guard for a server-side render (or any environment with neither
  // `localStorage` nor `crypto`) — fall back to the in-memory id rather than
  // referencing a global that does not exist there.
  if (typeof localStorage === "undefined" || typeof crypto === "undefined") {
    return undefined;
  }
  return localStorage;
}

/** Returns a stable, random, non-personal visitor id: the first call
 * generates and persists one, every later call returns the same value.
 * Never throws — a storage read/write failure (private browsing, SSR) falls
 * back to one in-memory value generated once per module instance. */
export function getVisitorId(storage?: VisitorIdStorage): string {
  const store = resolveStorage(storage);
  if (!store) {
    return fallbackId();
  }

  try {
    const existing = store.getItem(VISITOR_ID_KEY);
    if (existing) {
      return existing;
    }

    const id = crypto.randomUUID();
    store.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    // Safari private browsing throws on setItem (and sometimes getItem).
    // Never throw into the caller — fall back to the in-memory id.
    return fallbackId();
  }
}
