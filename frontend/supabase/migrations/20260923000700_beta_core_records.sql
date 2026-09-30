-- Phase 01.1 (beta data): core records the beta needs (DATA-01, D-01
-- carried-forward, D-08). Additive-only migration — Phase 1's four migration
-- files are never edited (D-08); this CREATEs the new customers and
-- catalogue_shares tables and ALTERs existing tables. Every reference is
-- schema-qualified.
--
-- This file is extended by Task 2 of this plan with the remaining products/
-- stores/orders columns and the catalogue_shares table.

-- ── products.price (added early — migration ordering) ───────────────────────
-- The full products.price / created_at addition is DATA-01 scope owned by
-- Task 2 of this plan, but 20260923000800_place_order_customer_total.sql
-- (Task 1, this same migration wave) reads products.price to compute
-- orders.total. Postgres validates column references inside a plpgsql
-- function body at CREATE FUNCTION time (check_function_bodies is on by
-- default), so 000800 cannot apply unless this column already exists
-- somewhere earlier in the replay order. Adding it here (rather than only in
-- Task 2's later edit to this same file) keeps 000700 fully self-consistent
-- and lets 000800 apply cleanly the very first time this file is replayed.
-- Task 2 adds the remaining products column (created_at) alongside it.
alter table public.products add column price numeric check (price is null or price >= 0);

-- products.created_at: the remaining Task-2-owned products column. price
-- (above) is the optional vendor-entered value PROD-03 adds a form field for
-- in Phase 3; it is stored for analytics and order totals and is never
-- shown to a customer.
alter table public.products add column created_at timestamptz not null default now();

-- ── stores: location, status, last_active_at ────────────────────────────────
alter table public.stores add column location text;
alter table public.stores add column status text not null default 'active' check (status in ('active', 'inactive'));
alter table public.stores add column last_active_at timestamptz;

-- ── customers ─────────────────────────────────────────────────────────────
-- Customers are identified PER SHOP (BR8): the same phone at two different
-- shops is two separate customers rows with two separate ids. customers.id
-- is the identifier every other record links to — phone stays a per-shop
-- lookup attribute, never the primary identifier (doc §11).
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id) on delete cascade,
  phone          text not null,
  name           text not null,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz,
  status         text not null default 'active' check (status in ('active', 'inactive')),
  unique (store_id, phone)
);

alter table public.customers enable row level security;

create policy "customers: owner reads"
on public.customers
for select
to authenticated
using (store_id = (select private.owned_store_id()));

-- Supabase grants full CRUD on every new public-schema object to anon/
-- authenticated by default via `alter default privileges`. RLS restricts
-- rows; this revoke is what makes the table unreachable — neither is
-- optional (RESEARCH.md Pitfall 1). Only place_order (security definer)
-- writes this table, so authenticated keeps read-only access via the policy
-- above and loses insert/update/delete entirely.
revoke all on public.customers from anon;
revoke insert, update, delete on public.customers from authenticated;

-- ── orders: customer link + total ───────────────────────────────────────────
-- on delete set null, never cascade — an order must survive its customer
-- row disappearing.
alter table public.orders add column customer_id uuid references public.customers (id) on delete set null;
alter table public.orders add column total numeric check (total is null or total >= 0);

-- ── orders: status + timestamps (D-15: values and timestamps only) ──────────
-- A `check` constraint, never a native Postgres `enum` — an enum needs
-- `alter type ... add value` to extend, which does not compose well inside a
-- migration that then uses the new value. Per D-15, transition LEGALITY is
-- deliberately NOT enforced here: no trigger, no function, no guard. That
-- lands with the Confirm/Cancel actions in ORDR-05, Phase 6, which is what
-- actually creates transitions.
alter table public.orders add column status text not null default 'new' check (status in ('new', 'confirmed', 'cancelled', 'completed'));
alter table public.orders add column confirmed_at timestamptz;
alter table public.orders add column cancelled_at timestamptz;
alter table public.orders add column completed_at timestamptz;

-- ── catalogue_shares ──────────────────────────────────────────────────────
-- Sharing is always an authenticated vendor action (SHAR-01…05); the
-- ordinary owner-scoped RLS idiom is sufficient and no security-definer RPC
-- is needed for this table.
create table public.catalogue_shares (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  share_type text not null check (share_type in ('catalogue', 'product')),
  destination text not null,
  created_at timestamptz not null default now()
);

alter table public.catalogue_shares enable row level security;

create policy "catalogue_shares: owner manages"
on public.catalogue_shares
for all
to authenticated
using (store_id = (select private.owned_store_id()))
with check (store_id = (select private.owned_store_id()));

revoke all on public.catalogue_shares from anon;

create index catalogue_shares_store_id_created_at_idx on public.catalogue_shares (store_id, created_at desc);
