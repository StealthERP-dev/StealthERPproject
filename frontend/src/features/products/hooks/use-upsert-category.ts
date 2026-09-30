"use client";

// Category create-or-reuse (PROD-05, D-12). A plain conflict-aware upsert
// against the existing unique(store_id, name) constraint — no new database
// function, no check-then-insert. A pre-check select followed by an insert
// is a time-of-check-to-time-of-use race that the constraint already
// prevents; plan 03-01 falsification-tested two concurrent writes of the
// same (store_id, name) resolving to the identical row id under this exact
// call shape, both in SQL and under parallel HTTP calls.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { CreateCategoryInputSchema } from "@shared/api-contract";

export interface UpsertCategoryInput {
  storeId: string;
  name: string;
}

export interface UpsertCategoryResult {
  id: string;
  name: string;
}

export function useUpsertCategory() {
  return useMutation<UpsertCategoryResult, Error, UpsertCategoryInput>({
    mutationFn: async ({ storeId, name }) => {
      const payload = { store_id: storeId, name: name.trim() };

      const parsed = CreateCategoryInputSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "invalid_input");
      }

      const { data, error } = await supabase
        .from("categories")
        .upsert(payload, { onConflict: "store_id,name" })
        .select("id, name")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
  });
}
