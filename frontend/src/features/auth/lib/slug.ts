// Shop-name to unique slug, with collision resolved by a short random
// suffix (D-10) — never a counter, which would leak how many shops share a
// name. No pre-check `select` before the insert: the database's unique
// constraint on `stores.slug` is the arbiter, exactly as `place_order`
// already treats its `customers` upsert — a read-then-write here would
// leave a window in which two vendors racing on the same base slug both
// believe they claimed it.
//
// Imports nothing — not a type, not the `@/` alias — so `node --test` can
// load this file directly, the same zero-project-import convention
// `src/lib/analytics/log-event-core.ts` and `src/lib/analytics/visitor-id.ts`
// already establish. `insertStoreWithUniqueSlug` takes the Supabase client
// as its first parameter against a locally-declared structural interface for
// exactly this reason — it lets `tests/db/auth-signup.test.mjs` drive this
// real module with a real anon client without this file ever importing
// `@supabase/supabase-js`.

/** Lowercase, collapse every run of non-alphanumeric characters into a
 * single hyphen, trim leading/trailing hyphens, and cap at 60 characters —
 * bounding slug length by construction, never by the database. When the
 * result is empty (a name written entirely in a non-Latin script, pure
 * punctuation, or pure emoji), fall back to the literal `shop` so the
 * collision-suffix path below always has a non-empty base to work from. */
export function slugify(shopName: string): string {
  const base = shopName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

  return base === "" ? "shop" : base;
}

/** Appends four base-36 characters to `base`, separated by a hyphen — an
 * unpredictable, uncorrelated suffix (D-10), not an incrementing counter.
 * `Math.random()` is not a CSPRNG, but a slug is a public identifier for an
 * intentionally-shareable storefront URL, not an access-control secret, so
 * that's not a property this needs. */
export function withSuffix(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

/** Structural shape of the one PostgREST call this module makes —
 * deliberately not the real `SupabaseClient` type, so this module stays
 * free of the `@supabase/supabase-js` import. Mirrors the
 * client-as-a-parameter, structural-interface convention
 * `src/lib/analytics/log-event-core.ts`'s `RpcCapableClient` already
 * establishes. */
export interface StoresInsertCapableClient {
  from(table: "stores"): {
    insert(values: Record<string, unknown>): {
      select(): {
        single(): PromiseLike<{
          data: Record<string, unknown> | null;
          error: { code?: string; message: string } | null;
        }>;
      };
    };
  };
}

/** Postgres's unique-violation error code, surfaced verbatim by PostgREST /
 * `postgres-js` on a conflicting insert. */
const UNIQUE_VIOLATION = "23505";

/** Inserts a `stores` row, retrying with a freshly-suffixed slug on a
 * unique-violation until one succeeds or five attempts are exhausted. Any
 * other error is rethrown untouched — only a slug collision is retried. */
export async function insertStoreWithUniqueSlug(
  client: StoresInsertCapableClient,
  baseSlug: string,
  rest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let slug = baseSlug;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await client
      .from("stores")
      .insert({ ...rest, slug })
      .select()
      .single();

    if (!error) {
      if (!data) {
        throw new Error(
          "insertStoreWithUniqueSlug: insert succeeded but returned no row.",
        );
      }
      return data;
    }

    if (error.code !== UNIQUE_VIOLATION) {
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    slug = withSuffix(baseSlug);
  }

  throw new Error("Could not generate a unique slug after 5 attempts.");
}
