import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useAuth } from "@/features/auth/auth-provider";
import { AuthError } from "@/features/auth/lib/auth-error";
import { slugify, insertStoreWithUniqueSlug } from "@/features/auth/lib/slug";
import { logEvent } from "@/lib/analytics/log-event";
import { FinishShopInputSchema } from "@shared/api-contract";

type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

export interface FinishShopInput {
  shopName: string;
  vendorName: string;
  area: string;
}

/** The D-09 recovery: the vendor is already signed in (signUp's auth step
 * succeeded) but has no stores row yet, because the insert failed the first
 * time. Structurally the same as useSignUp minus the signUp step — the
 * session already exists. */
export function useFinishShop() {
  const { user, refresh } = useAuth();

  return useMutation<StoreRow, AuthError, FinishShopInput>({
    mutationFn: async ({ shopName, vendorName, area }) => {
      if (!user) {
        throw new AuthError("no active session");
      }

      const parsed = FinishShopInputSchema.safeParse({
        shopName,
        vendorName,
        area,
      });
      if (!parsed.success) {
        throw new AuthError(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      // The synthetic email's local part IS the canonical phone
      // (toSyntheticEmail's construction) — derived from the session, never
      // re-typed by the vendor at this step.
      const canonicalPhone = (user.email ?? "").split("@")[0] ?? "";

      let row: Record<string, unknown>;
      try {
        row = await insertStoreWithUniqueSlug(supabase, slugify(shopName), {
          owner_id: user.id,
          phone: canonicalPhone,
          shop_name: shopName.trim(),
          vendor_name: vendorName.trim(),
          location: area.trim() === "" ? null : area.trim(),
        });
      } catch (insertError) {
        throw new AuthError(
          insertError instanceof Error ? insertError.message : "unknown",
        );
      }

      // Same event as the normal path: the same thing happened — a shop
      // row came into existence.
      void logEvent({ eventName: "shop_created" });
      await refresh();

      return row as StoreRow;
    },
  });
}
