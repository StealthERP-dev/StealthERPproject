import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useAuth } from "@/features/auth/auth-provider";
import { AuthError } from "@/features/auth/lib/auth-error";
import { toCanonicalPhone, toSyntheticEmail } from "@/features/auth/lib/phone";
import { slugify, insertStoreWithUniqueSlug } from "@/features/auth/lib/slug";
import { logEvent } from "@/lib/analytics/log-event";
import { SignUpInputSchema } from "@shared/api-contract";

type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

export interface SignUpInput {
  phone: string;
  pin: string;
  shopName: string;
  vendorName: string;
  area: string;
}

/** Create a shop: auth.signUp, then the stores row, in that fixed order.
 * Mirrors use-place-order.ts's typed-error useMutation shape (RESEARCH
 * Pattern: "Signup error handling"). */
export function useSignUp() {
  const { refresh } = useAuth();

  return useMutation<StoreRow, AuthError, SignUpInput>({
    mutationFn: async ({ phone, pin, shopName, vendorName, area }) => {
      const parsed = SignUpInputSchema.safeParse({
        phone,
        pin,
        shopName,
        vendorName,
        area,
      });
      if (!parsed.success) {
        throw new AuthError(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const canonicalPhone = toCanonicalPhone(phone);
      const email = toSyntheticEmail(phone);

      const { data, error } = await supabase.auth.signUp({
        email,
        password: pin,
      });

      // Inspect the signUp result before anything else touches the
      // database (Pitfall 4): a duplicate phone must be detected from
      // signUp's own error, never from a downstream stores-insert failure.
      if (error) {
        if (error.code === "user_already_exists") {
          throw new AuthError("duplicate_phone");
        }
        throw new AuthError(error.message);
      }

      // D-11's defensive fallback: not the expected path under this
      // project's confirm-email-off config (the primary signal above
      // already covers it), but cheap insurance against a future flip.
      if (data.user?.identities?.length === 0) {
        throw new AuthError("duplicate_phone");
      }

      if (!data.user) {
        throw new AuthError("signup returned no user");
      }

      let row: Record<string, unknown>;
      try {
        row = await insertStoreWithUniqueSlug(supabase, slugify(shopName), {
          owner_id: data.user.id,
          phone: canonicalPhone,
          shop_name: shopName.trim(),
          vendor_name: vendorName.trim(),
          location: area.trim() === "" ? null : area.trim(),
        });
      } catch (insertError) {
        // A failure here is NOT a duplicate phone — the auth account is
        // genuinely new. Rethrow generic and let D-09's recovery state
        // handle the vendor on their next open (Pitfall 4).
        throw new AuthError(
          insertError instanceof Error ? insertError.message : "unknown",
        );
      }

      void logEvent({ eventName: "shop_created" });
      await refresh();

      return row as StoreRow;
    },
  });
}
