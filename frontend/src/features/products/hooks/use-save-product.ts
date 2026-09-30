"use client";

// The orchestrating save mutation (PROD-03/04/05/07). Copies
// use-place-order.ts's "typed error class + a single orchestrating mutation"
// shape and use-finish-shop.ts's "several awaited steps inside one
// mutationFn, event fired fire-and-forget from inside it" shape.
//
// Inserts a row with the typed name, the chosen unit, availability and the
// entered amount, fires the creation event, invalidates the shared
// ['products', storeId] cache the vendor returns to. Task 2 extends the
// mutationFn body with category resolution (D-12): a newly-typed or
// newly-picked category name (a suggestion chip never before created, or a
// name typed through "Create new") is resolved through useUpsertCategory's
// conflict-aware write before the insert — no new database function, no
// check-then-insert, matching D-12's own reasoning. If the form already
// knows a chip's id (it matched a persisted row), that id is used directly
// and no upsert call happens.
//
// Plan 03-04 (photo pipeline) extends this same union rather than inventing
// a second error type: `undecodable`/`too_large` surface at pick time in
// product-form.tsx (the picked file never reaches this mutation), and
// `upload_failed` surfaces here when the already-processed blob fails to
// reach storage. The upload step runs before the row write, exactly once,
// and passes the blob object directly with no fileOptions — per the
// interfaces block, the storage client's Blob-body path never reads a
// content-type option; it takes the blob's own `.type`, already verified
// as `image/jpeg` by process-photo.ts before this ever runs.
//
// logEvent and cache invalidation live INSIDE mutationFn, never in the
// per-call onSuccess a caller passes to `.mutate()` — mutationFn's own
// promise chain runs to completion regardless of whether the component that
// called it is still mounted, exactly like use-finish-shop.ts's `void
// logEvent(...)`. The per-call onSuccess stays reserved for the one thing
// that legitimately belongs to the calling component: navigation.
//
// Plan 03-05 extends the mode field to cover an edit as well as a create,
// inside this SAME mutation rather than a second one — two modes, one
// orchestration, so the event name and the cache invalidation can never
// drift apart between them. An edit issues a genuine table UPDATE scoped by
// the existing row's id, never a delete-then-insert: the shipped history
// trigger writes the pre-edit values on every UPDATE regardless of which
// code path issued it, so replacing the row instead of updating it would
// silently lose what PROD-07 exists to preserve. The image column is only
// ever included in an edit's write when a NEW photo was processed this
// time — omitting the key entirely (never writing an explicit null) is what
// leaves an untouched photo untouched on a save that didn't change it.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/analytics/log-event";
import { useUpsertCategory } from "@/features/products/hooks/use-upsert-category";
import type { Database } from "@/lib/supabase/database.types";
import {
  CreateProductInputSchema,
  UpdateProductInputSchema,
} from "@shared/api-contract";

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export const SAVE_PRODUCT_ERROR_CODES = [
  "save_failed",
  "undecodable",
  "too_large",
  "upload_failed",
] as const;

export type SaveProductErrorCode = (typeof SAVE_PRODUCT_ERROR_CODES)[number];

export const GENERIC_SAVE_PRODUCT_ERROR = "Something went wrong. Try again.";

const SAVE_PRODUCT_ERROR_MESSAGES: Record<SaveProductErrorCode, string> = {
  save_failed: GENERIC_SAVE_PRODUCT_ERROR,
  // The three photo-pipeline sentences, verbatim from UI-SPEC's Copywriting
  // Contract — three distinct things for the vendor to do something about,
  // not one generic failure (D-01).
  undecodable: "Couldn't read this photo. Try taking a new one.",
  too_large: "Photo is too large. Try a different one.",
  upload_failed: "Couldn't upload photo. Try again.",
};

function isSaveProductErrorCode(value: string): value is SaveProductErrorCode {
  return (SAVE_PRODUCT_ERROR_CODES as readonly string[]).includes(value);
}

export class SaveProductError extends Error {
  readonly code: SaveProductErrorCode | "unknown";

  constructor(message: string) {
    super(message);
    this.name = "SaveProductError";
    this.code = isSaveProductErrorCode(message) ? message : "unknown";
  }
}

export function saveProductMessage(error: unknown): string {
  if (error instanceof SaveProductError && error.code !== "unknown") {
    return SAVE_PRODUCT_ERROR_MESSAGES[error.code];
  }
  return GENERIC_SAVE_PRODUCT_ERROR;
}

export interface SaveProductInput {
  mode: "create" | "update";
  /** The row being edited. Required when mode is "update"; ignored
   * otherwise. */
  productId?: string;
  name: string;
  /** An existing category's id, resolved by the form when the vendor picked
   * a chip that already matches a persisted row. Null means either the
   * "None" chip or a name that still needs resolving via newCategoryName. */
  categoryId: string | null;
  /** A category name with no persisted row yet — a suggestion chip never
   * before created for this shop, or a brand-new name typed through
   * "Create new". Resolved through the upsert before the product insert.
   * Null when categoryId already names an existing row, or when the "None"
   * chip is selected. */
  newCategoryName: string | null;
  unit: string;
  price: number | null;
  available: boolean;
  /** A blob process-photo.ts has already decoded, resized, oriented and
   * verified as JPEG — or null when the vendor saved with no photo (D-05:
   * no image is stored, and the product renders the neutral placeholder). */
  photoBlob: Blob | null;
}

export function useSaveProduct(storeId: string) {
  const upsertCategory = useUpsertCategory();

  return useMutation<string, SaveProductError, SaveProductInput>({
    mutationFn: async (input) => {
      let categoryId = input.categoryId;

      if (input.newCategoryName) {
        let resolvedCategory: { id: string };
        try {
          resolvedCategory = await upsertCategory.mutateAsync({
            storeId,
            name: input.newCategoryName,
          });
        } catch {
          throw new SaveProductError("save_failed");
        }
        categoryId = resolvedCategory.id;
      }

      // Validated here, ABOVE the photo upload below: an update with no
      // target row can never succeed, and this phase ships no delete path
      // for Storage, so a save that is going to be rejected must never
      // first write a durable blob into the vendor's own folder. Do not
      // let a future refactor move the upload back above this check.
      if (input.mode === "update" && !input.productId) {
        throw new SaveProductError("save_failed");
      }

      let imageUrl: string | null = null;
      if (input.photoBlob) {
        const path = `${storeId}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, input.photoBlob);
        if (uploadError) {
          throw new SaveProductError("upload_failed");
        }
        imageUrl = supabase.storage.from("product-images").getPublicUrl(path)
          .data.publicUrl;
      }

      if (input.mode === "update") {
        if (!input.productId) {
          // Unreachable: already validated above, before the photo
          // upload. Kept so TypeScript narrows input.productId to string
          // for the rest of this branch without a non-null assertion.
          throw new SaveProductError("save_failed");
        }

        // A normal UPDATE of the existing row, scoped by its own id — never
        // a replace. The stored image column is included only when a new
        // blob was actually uploaded this save; leaving the key out
        // entirely keeps an untouched photo untouched, since PostgREST only
        // writes the columns a payload names.
        const updatePayload: ProductUpdate = {
          name: input.name.trim(),
          category_id: categoryId,
          unit: input.unit,
          price: input.price,
          available: input.available,
        };
        if (imageUrl) {
          updatePayload.image_url = imageUrl;
        }

        const updateParsed = UpdateProductInputSchema.safeParse(updatePayload);
        if (!updateParsed.success) {
          throw new SaveProductError("save_failed");
        }

        const { error } = await supabase
          .from("products")
          .update(updatePayload)
          .eq("id", input.productId);

        if (error) {
          throw new SaveProductError("save_failed");
        }

        void logEvent({
          eventName: "product_updated",
          productId: input.productId,
        });

        return input.productId;
      }

      const insertPayload = {
        store_id: storeId,
        name: input.name.trim(),
        category_id: categoryId,
        unit: input.unit,
        price: input.price,
        available: input.available,
        image_url: imageUrl,
      };

      const createParsed = CreateProductInputSchema.safeParse(insertPayload);
      if (!createParsed.success) {
        throw new SaveProductError("save_failed");
      }

      const { data, error } = await supabase
        .from("products")
        .insert(insertPayload)
        .select("id")
        .single();

      if (error) {
        throw new SaveProductError("save_failed");
      }

      void logEvent({ eventName: "product_added", productId: data.id });

      return data.id;
    },
    onSettled: (_data, _error, _variables, _context, { client }) => {
      void client.invalidateQueries({ queryKey: ["products", storeId] });
      void client.invalidateQueries({ queryKey: ["categories", storeId] });
    },
  });
}
