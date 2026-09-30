-- Phase 01.1 (beta data): product history (DATA-10, D-06, D-08). Additive-only
-- migration — Phase 1's four migration files are never edited (D-08). This
-- CREATEs public.product_history and an unconditional trigger that snapshots a
-- product's PREVIOUS values before every UPDATE, so a product's name,
-- category, price and availability on a past date can be reconstructed
-- directly rather than replayed from the event log. Offers and order status
-- rely on the event log alone (D-06) — no second history table is created for
-- them.
--
-- Trigger-written, not written alongside log_event: log_event is
-- fire-and-forget and allowed to fail silently (D-05) and to drop over its
-- rate limit (D-04), so riding history on it would silently lose history
-- rows. A BEFORE UPDATE trigger with no `when` clause fires for every UPDATE
-- regardless of which code path issued it — including a direct edit in the
-- Supabase SQL editor — which is the reliability D-06 actually needs.
--
-- Every reference is schema-qualified throughout.

create table public.product_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  store_id    uuid not null,
  name        text not null,
  category_id uuid,
  price       numeric,
  available   boolean not null,
  recorded_at timestamptz not null default now()
);

-- Deliberate contrast with public.events: a history row describes a product
-- and is meaningless without it, so `on delete cascade` on product_id is
-- correct here — the opposite of D-07's carve-out for the event log, which
-- specifically requires event rows to survive the entities they name.

create index product_history_product_id_recorded_at_idx
  on public.product_history (product_id, recorded_at desc);

alter table public.product_history enable row level security;

-- A table with RLS enabled and zero policies trips the rls_enabled_no_policy
-- advisor, which scripts/check-advisors.mjs treats as unconditionally
-- blocking — this single owner-scoped read policy is required even though
-- the only writer is the security-definer trigger function below.
create policy "product_history: owner reads"
on public.product_history
for select
to authenticated
using (store_id = (select private.owned_store_id()));

-- Supabase grants full CRUD on every new public-schema object to anon/
-- authenticated by default via `alter default privileges`. RLS restricts
-- rows; these revokes are what make a recorded history row genuinely
-- un-rewritable by any application role — neither is optional.
revoke all on public.product_history from anon;
revoke insert, update, delete, truncate on public.product_history from authenticated;
grant select on public.product_history to authenticated;

-- A trigger function runs with the privileges of the role that issued the
-- triggering statement. An authenticated vendor holds no insert privilege on
-- product_history, so this must be security definer — a security-invoker
-- function would fail with a permission error on every product update, a
-- failure mode that only appears at runtime, not at migration time.
create function private.record_product_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_history (product_id, store_id, name, category_id, price, available)
  values (old.id, old.store_id, old.name, old.category_id, old.price, old.available);
  return new;
end;
$$;

revoke all on function private.record_product_history() from public;

-- Deliberately no `when` clause and no comparison of old to new: the trigger
-- must be unconditional so it also captures an update issued directly in the
-- Supabase SQL editor or by a future migration, and so a single UPDATE
-- statement — whether it changes one column, several, or none at all —
-- always writes exactly one history row, never zero and never one per
-- column.
create trigger products_record_history
  before update on public.products
  for each row
  execute function private.record_product_history();
