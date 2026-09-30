import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { toCanonicalPhone, toSyntheticEmail } from "@/features/auth/lib/phone";
import { AuthError, authErrorMessage } from "@/features/auth/lib/auth-error";
import { setRememberedPhone } from "@/features/auth/lib/remembered-phone";
import { SignInInputSchema } from "@shared/api-contract";

// The AUTH-06 lockout orchestration (RESEARCH "Client orchestration (Login
// screen submit handler)"): check the lock BEFORE signing in — skipping this
// step would leave the lock affecting only the message shown while a lucky
// guess on the sixth attempt still returned a session. On success, clear
// this phone's recorded failures without blocking on it — the provider's
// own onAuthStateChange listener picks up the new session on its own. On an
// invalid_credentials error, record the failure and let its own return value
// say whether this failure is the one that tripped the lock, so the fifth
// wrong PIN shows the locked message with no second round trip.

export interface SignInInput {
  phone: string;
  pin: string;
}

export function useSignIn() {
  return useMutation<undefined, AuthError, SignInInput>({
    mutationFn: async ({ phone, pin }) => {
      const parsed = SignInInputSchema.safeParse({ phone, pin });
      if (!parsed.success) {
        throw new AuthError(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const canonicalPhone = toCanonicalPhone(phone);

      const { data: locked, error: lockCheckError } = await supabase.rpc(
        "check_login_lock",
        { p_phone: canonicalPhone },
      );

      if (lockCheckError) {
        // WR-02: deliberate fail-OPEN, not fail-closed. If this health-check
        // RPC itself fails (transient network error, a schema/permission
        // change, the local Supabase instance mid-restart), we cannot know
        // whether this phone is actually locked. Falsely reporting
        // "locked_out" would shut a legitimate vendor out of their own shop
        // for 15 minutes because a health check hiccupped -- worse than
        // letting one sign-in attempt through unchecked. `record_login_failure`
        // and Supabase Auth's own rate limit (D-01b) still apply underneath,
        // so this is not a full defeat of AUTH-06, just an unchecked window.
        // The failure must not be silent, though: run it through the same
        // authErrorMessage taxonomy every other auth error uses (no new
        // string) so it is visible to logging, without throwing and blocking
        // this attempt.
        console.error(
          "check_login_lock RPC failed; proceeding without a lock check:",
          authErrorMessage(new AuthError(lockCheckError.message)),
          lockCheckError,
        );
      } else if (locked) {
        throw new AuthError("locked_out");
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: toSyntheticEmail(phone),
        password: pin,
      });

      if (!error) {
        // The number is remembered only now that it has actually worked
        // (D-07) — never the PIN, which this writer has no parameter shape
        // to accept in the first place.
        setRememberedPhone(canonicalPhone);
        void supabase.rpc("clear_login_attempts");
        return undefined;
      }

      if (error.code === "invalid_credentials") {
        const { data: justLocked } = await supabase.rpc(
          "record_login_failure",
          { p_phone: canonicalPhone },
        );
        throw new AuthError(justLocked ? "locked_out" : "invalid_credentials");
      }

      throw new AuthError(error.message);
    },
  });
}
