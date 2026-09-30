// The bound fire-and-forget event helper every later phase calls (DATA-03,
// DATA-04..08). Thin binding of log-event-core.ts's pure send to the real
// Supabase client and the real app version — see 01.1-04-PLAN.md's
// module_split_rationale for why this is split from log-event-core.ts.
//
// Deliberately NOT shaped like use-place-order.ts's useMutation hook: this is
// a plain async function with no loading/error state, no retry queue, no
// setTimeout. A dropped event stays dropped (D-05).

import { supabase } from "@/lib/supabase/client";
import { logEventWith, type LogEventInput } from "./log-event-core";
import { getVisitorId } from "./visitor-id";

export type { LogEventInput, LogEventName } from "./log-event-core";

/** process.env.NEXT_PUBLIC_APP_VERSION is inlined at build time by
 * next.config.ts's `env` map from package.json's version. An absent or
 * empty value is coerced to `null`, never `""` — "we do not know which
 * release this came from" and "a release literally named with an empty
 * string" must stay distinguishable in the stored column. */
function resolveAppVersion(): string | null {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return version && version.length > 0 ? version : null;
}

/** Fire-and-forget: record an event without ever risking the product action
 * that triggered it (D-05, doc §17). Never throws, never rejects, no retry.
 *
 * When the caller supplies no visitor id, it is filled from `getVisitorId()`.
 * A signed-in vendor's events don't need one — `log_event` prefers the
 * session branch and ignores the slug/visitor id whenever `auth.uid()` is
 * present — but sending it unconditionally is harmless and keeps this
 * helper's shape uniform for every call site. */
export async function logEvent(input: LogEventInput): Promise<void> {
  await logEventWith(supabase, {
    ...input,
    visitorId: input.visitorId ?? getVisitorId(),
    appVersion: input.appVersion ?? resolveAppVersion(),
  });
}
