"use client";

// The Store open/closed switch (HOME-01). This mutation writes exactly one
// column — is_open — on the caller's own stores row, under the owner-scoped
// RLS policy in supabase/migrations/20260922000200_rls.sql. It never inserts
// or upserts: a missing row is an error worth surfacing, not a row worth
// creating.
//
// Home reads its store row from AuthProvider's context rather than from a
// TanStack Query cache keyed on the store id, so there is no query cache for
// this hook to optimistically patch. Instead the optimistic value lives in
// the container's own state (src/features/home/components/home-page.tsx),
// and this hook takes that container's apply/rollback callbacks as part of
// its mutation input — onMutate calls apply() synchronously before the
// request leaves (the "flips immediately on tap" contract), onError calls
// rollback() to restore the pre-tap value. On success,
// resetToAuthoritative() clears the optimistic override (WR-03: a
// successful write must relinquish control back to the server row, the
// same way rollback() already does on failure -- otherwise the container's
// override stays pinned to this tap's value forever and a later divergence
// from another source would be silently masked) before the provider's
// refresh() replaces store with the authoritative row.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";
import { UpdateStoreInputSchema } from "@shared/api-contract";

export interface ToggleOpenInput {
  storeId: string;
  nextOpen: boolean;
  /** Flip the UI's displayed value. Called from onMutate, before the request leaves. */
  apply: () => void;
  /** Restore the pre-tap value and surface a short error. Called from onError. */
  rollback: () => void;
  /**
   * Clear the optimistic override so the authoritative row takes over again.
   * Called from onSuccess, mirroring rollback()'s reset on the error path
   * (WR-03) — without this, a successful toggle would pin the override to
   * this tap's value forever and mask any later divergence from the server.
   */
  resetToAuthoritative: () => void;
}

export function useToggleOpen() {
  const { refresh } = useAuth();

  return useMutation<undefined, Error, ToggleOpenInput>({
    mutationFn: async ({ storeId, nextOpen }) => {
      const parsed = UpdateStoreInputSchema.pick({ is_open: true }).safeParse({
        is_open: nextOpen,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { error } = await supabase
        .from("stores")
        .update({ is_open: nextOpen })
        .eq("id", storeId);

      if (error) {
        throw new Error(error.message);
      }

      return undefined;
    },
    onMutate: ({ apply }) => {
      apply();
    },
    onError: (_error, { rollback }) => {
      rollback();
    },
    onSuccess: (_data, { resetToAuthoritative }) => {
      resetToAuthoritative();
      void refresh();
    },
  });
}
