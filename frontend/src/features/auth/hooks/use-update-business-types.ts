import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";
import { AuthError } from "@/features/auth/lib/auth-error";
import { logEvent } from "@/lib/analytics/log-event";
import { UpdateStoreInputSchema } from "@shared/api-contract";

export interface UpdateBusinessTypesInput {
  businessTypes: string[];
}

/** The AUTH-02 second write: stamps what the vendor sells. The caller passes
 * an empty array when the vendor skips (D-16/D-18) — skipping still
 * completes onboarding, so the analytics event below fires unconditionally,
 * outside any branch on whether the array is empty. */
export function useUpdateBusinessTypes() {
  const { store, refresh } = useAuth();

  // TData is `undefined` rather than the interface contract's literal `void`
  // spelling: `useMutation<void, ...>` trips
  // @typescript-eslint/no-invalid-void-type, which disallows `void` as an
  // explicit type argument on a call expression (as opposed to a type
  // reference such as `UseMutationResult<void, ...>`) regardless of the
  // allowInGenericTypeArguments option. `undefined` carries the identical
  // "no meaningful return value" meaning for every caller of this hook.
  return useMutation<undefined, AuthError, UpdateBusinessTypesInput>({
    mutationFn: async ({ businessTypes }) => {
      if (!store) {
        throw new AuthError("no active shop");
      }

      const parsed = UpdateStoreInputSchema.pick({
        business_types: true,
      }).safeParse({ business_types: businessTypes });
      if (!parsed.success) {
        throw new AuthError(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { error } = await supabase
        .from("stores")
        .update({ business_types: businessTypes })
        .eq("id", store.id);

      if (error) {
        throw new AuthError(error.message);
      }

      void logEvent({ eventName: "onboarding_completed" });
      await refresh();

      return undefined;
    },
  });
}
