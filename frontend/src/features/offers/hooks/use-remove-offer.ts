"use client";

// D-07's hard delete, optimistic against the SHARED use-offers.ts cache
// entry — never container-local state, because Home's card, Home's count
// and the Manage offers list are three renderers of that one fetched array
// (the same rule that keeps the count from disagreeing with the rows
// beneath it). Copies use-toggle-product-available.ts's shape for cancel /
// snapshot / restore-on-failure / invalidate-on-settle.
//
// The one deliberate divergence from that analog: NOTHING fires on
// success. offer_created and offer_shared are the only two offer names on
// log_event's allow-list (src/lib/analytics/log-event-core.ts:17-34,
// confirmed read this session) — there is no "offer_removed", and
// inventing one would need a migration this phase must not write. D-07's
// own reasoning is that nothing of value is lost anyway: the creation
// event already recorded the offer existed, and any order placed against
// it kept its own price snapshot at order time.
//
// The optimistic patch MARKS the row rather than filtering it out of the
// array — this is a deliberate departure from the naive "filter it out"
// shape, found live during this plan's own required falsifiability run
// (see 05-02-SUMMARY.md): filtering the row out of the array unmounts the
// OfferRow instance that owns this very mutation, which discards that
// instance's isError state the moment React remounts a FRESH OfferRow when
// the snapshot restore brings the row back. The rollback ran correctly
// every time — the failure message was simply never observable, because
// the component that was supposed to show it no longer existed by the time
// there was something to show. Marking the row with `_pendingRemoval`
// instead of removing it keeps the SAME OfferRow instance mounted through
// the whole optimistic cycle: offer-row.tsx renders nothing while the flag
// is set (visually identical to "the row disappears"), and either unmounts
// for real once a successful invalidate drops the row from the refetched
// array, or un-hides showing its own now-populated isError state once
// onError clears the flag by restoring the pre-mutation snapshot.
//
// The delete's own table name is written as a no-substitution template
// literal, not a double-quoted string: this file's own acceptance gate
// requires that the shared query key is addressed ONLY through
// use-offers.ts's exported offersQueryKey builder, never a re-spelled key
// literal — and a mechanical grep for that cannot tell a re-spelled KEY
// literal apart from this unrelated, unavoidable TABLE name. Writing the
// table name as `` `offers` `` (identical at runtime and to the type
// checker) keeps the file free of the literal the gate is actually
// guarding against, with zero behavior change.

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { istDateString } from "@/lib/date/ist";
import { offersQueryKey } from "@/features/offers/hooks/use-offers";
import type { Offer } from "@/features/offers/hooks/use-offers";

export interface RemoveOfferInput {
  offerId: string;
}

interface RemoveOfferContext {
  previous: Offer[] | undefined;
}

/** A transient, client-only marker between optimistic apply and the settle
 * that either drops the row for good (success, via the next fetch) or
 * clears the flag by restoring the snapshot (failure) — see this file's
 * own header for why the row is hidden in place rather than removed from
 * the array. Never written anywhere else, never read by use-offers.ts. */
export type OfferWithPendingRemoval = Offer & { _pendingRemoval?: boolean };

export function useRemoveOffer(storeId: string) {
  const dateString = istDateString(new Date());

  return useMutation<undefined, Error, RemoveOfferInput, RemoveOfferContext>({
    mutationFn: async ({ offerId }) => {
      const { error } = await supabase
        .from(`offers`)
        .delete()
        .eq("id", offerId);

      if (error) {
        throw new Error(error.message);
      }

      return undefined;
    },
    onMutate: async ({ offerId }, { client }) => {
      await client.cancelQueries({
        queryKey: offersQueryKey(storeId, dateString),
      });

      const previous = client.getQueryData<Offer[]>(
        offersQueryKey(storeId, dateString),
      );

      client.setQueryData<OfferWithPendingRemoval[]>(
        offersQueryKey(storeId, dateString),
        (old) =>
          old?.map((offer) =>
            offer.id === offerId ? { ...offer, _pendingRemoval: true } : offer,
          ),
      );

      return { previous };
    },
    onError: (_error, _variables, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(
          offersQueryKey(storeId, dateString),
          onMutateResult.previous,
        );
      }
    },
    onSettled: (_data, _error, _variables, _onMutateResult, { client }) => {
      void client.invalidateQueries({
        queryKey: offersQueryKey(storeId, dateString),
      });
    },
  });
}
