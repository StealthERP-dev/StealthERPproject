-- Phase 01.1 (beta data): append-only events table (DATA-02, D-01, D-02,
-- D-07). Additive-only migration — Phase 1's four migration files are never
-- edited (D-08). This CREATEs public.events, the log every important vendor/
-- customer/anonymous action writes to through log_event (added in the next
-- migration) — no client role writes this table directly.
--
-- Entity-id shape (this plan's checkpoint decision: plain-uuid): store_id,
-- user_id, customer_id, product_id, order_id and offer_id are plain uuid
-- columns with NO foreign-key constraints. D-07 requires a deleted entity's
-- id to survive on every past event ("keep the entity id and a name
-- snapshot"); an `on delete set null` foreign key would erase precisely the
-- id D-07 says must survive. The absence of referential integrity is
-- mitigated by log_event (added next) being the only writer and validating
-- ownership server-side before it stores an id.
--
-- Every reference is schema-qualified throughout.

create table public.events (
  id          uuid primary key default gen_random_uuid(),
  event_name  text not null,
  occurred_at timestamptz not null default now(),
  store_id    uuid,
  user_id     uuid,
  customer_id uuid,
  visitor_id  text,
  product_id  uuid,
  order_id    uuid,
  offer_id    uuid,
  app_version text,
  props       jsonb,
  constraint events_event_name_allowed check (event_name in (
    'shop_created', 'onboarding_completed', 'product_added', 'product_updated',
    'product_marked_available', 'product_marked_unavailable', 'offer_created',
    'offer_shared', 'catalogue_shared', 'catalogue_opened', 'product_viewed',
    'add_to_cart', 'checkout_started', 'order_placed', 'order_confirmed',
    'order_cancelled', 'orders_opened'
  ))
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- The two partial indexes are what make log_event's rate-limit count cheap.
create index events_store_id_event_name_occurred_at_idx
  on public.events (store_id, event_name, occurred_at desc);
create index events_event_name_occurred_at_idx
  on public.events (event_name, occurred_at desc);
create index events_user_id_occurred_at_idx
  on public.events (user_id, occurred_at desc) where user_id is not null;
create index events_visitor_id_occurred_at_idx
  on public.events (visitor_id, occurred_at desc) where visitor_id is not null;
create index events_customer_id_occurred_at_idx
  on public.events (customer_id, occurred_at desc) where customer_id is not null;

-- ── RLS: append-only ─────────────────────────────────────────────────────────
alter table public.events enable row level security;

-- This is the ONLY policy on events — no insert/update/delete policy exists
-- for any role. The only writer is the security-definer log_event function
-- (added in the next migration), which bypasses RLS by running as its
-- definer. A signed-in vendor can read their own shop's events — required so
-- a table with RLS enabled and zero policies does not trip the
-- rls_enabled_no_policy advisor, and so this plan's HTTP test can count the
-- rows the rate limit actually recorded.
create policy "events: owner reads"
on public.events
for select
to authenticated
using (store_id = (select private.owned_store_id()));

-- Supabase grants full CRUD on every new public-schema object to anon/
-- authenticated by default via `alter default privileges`. RLS restricts
-- rows; these revokes are what make insert/update/delete on this table
-- actually impossible for any client role — an append-only log is only
-- append-only if no role holds those privileges (RESEARCH.md Pitfall 1).
revoke all on public.events from anon;
revoke insert, update, delete, truncate on public.events from authenticated;
grant select on public.events to authenticated;

-- ── last-active refresh (D-11) ───────────────────────────────────────────────
-- A trigger function runs as the invoking role by default; an authenticated
-- vendor holds no update privilege on stores or customers, so this must be
-- security definer.
create function private.refresh_last_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- D-11's eight meaningful-vendor-action names — merely opening the app
  -- does not count.
  if new.event_name in (
    'product_added', 'product_updated', 'product_marked_available',
    'product_marked_unavailable', 'offer_created', 'catalogue_shared',
    'offer_shared', 'orders_opened'
  ) then
    update public.stores set last_active_at = new.occurred_at where id = new.store_id;
  end if;

  if new.customer_id is not null then
    update public.customers set last_active_at = new.occurred_at where id = new.customer_id;
  end if;

  return new;
end;
$$;

revoke all on function private.refresh_last_active() from public;

create trigger events_refresh_last_active
  after insert on public.events
  for each row
  execute function private.refresh_last_active();
