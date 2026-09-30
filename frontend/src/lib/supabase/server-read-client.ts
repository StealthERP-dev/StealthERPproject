import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable.",
  );
}

// Narrowed once here, at module scope, immediately after the guard above —
// a nested function closing over the bare module-level consts cannot see
// that narrowing (a known TypeScript limitation for control-flow analysis
// across function boundaries), which would otherwise force a non-null
// assertion inside createServerReadClient below.
const SUPABASE_URL: string = supabaseUrl;
const SUPABASE_ANON_KEY: string = supabaseAnonKey;

/**
 * A fresh, minimal anon-key-only client for server-side reads (currently
 * just generateMetadata). There is no session on this path, ever: every
 * caller is an anonymous crawler or an anonymous visitor. persistSession is
 * false and nothing here is memoized as a module-level singleton — call this
 * per request, never hold onto the returned client across requests.
 *
 * This is deliberately NOT the shared browser client re-exported for server
 * use. That client's every read internally awaits a session-recovery check,
 * which is machinery this always-anonymous path has no use for and should
 * not pay for or depend on. This factory also intentionally is not a
 * cookie-synced session helper of any kind — there is no signed-in user to
 * synchronize a session for here, so that entire category of tooling would
 * be solving a problem this file does not have.
 */
export function createServerReadClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
