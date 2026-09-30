-- Phase 1 (v1) schema: PRD §6 subset per D-08/D-09/D-10/D-12.
-- Scope guard (D-08): does NOT include v1.1-deferred objects (products.description,
-- customers, orders.customer_id, order_items.rejected, availability_events, share_events,
-- store_insights, realtime triggers) and does NOT include any PIN-lockout objects (D-10).
-- Every reference is schema-qualified throughout (defense against search_path hijacking).

-- ── private schema ─────────────────────────────────────────────────────────
-- Holds security-definer helpers that must never be directly reachable by anon/authenticated
-- except through the explicit grants below. Not listed in [api] schemas (supabase/config.toml),
-- so it is never exposed over PostgREST.
create schema private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- ── today_ist(): single canonical source of "today" (D-12) ────────────────
-- STABLE, never IMMUTABLE — it reads now(), so IMMUTABLE would let the planner
-- constant-fold and freeze "today" forever (research correction / Pitfall 2).
create function public.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

revoke execute on function public.today_ist() from public;
grant execute on function public.today_ist() to anon, authenticated, service_role;

-- ── Tables (PRD §6 v1 subset) ───────────────────────────────────────────────

create table public.stores (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null unique references auth.users (id) on delete cascade,
  phone          text not null unique,
  shop_name      text not null,
  vendor_name    text not null,
  slug           text not null unique,
  business_types text[] not null default '{}',
  is_open        boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.categories (
  id       uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name     text not null,
  unique (store_id, name)
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  category_id uuid references public.categories (id) on delete set null,
  unit        text not null default 'piece',
  image_url   text,
  available   boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table public.offers (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  today_price   text not null,
  regular_price text,
  offer_date    date not null default public.today_ist()
);

-- D-09: customer_name/customer_phone stay directly on orders (the `customers`
-- table is a v1.1-deferred object per D-08).
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id) on delete cascade,
  customer_name  text not null,
  customer_phone text not null,
  note           text,
  is_new         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   uuid references public.products (id) on delete set null,
  product_name text not null,
  qty          int not null check (qty between 1 and 99),
  price        text
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index products_store_id_idx on public.products (store_id);
create index products_category_id_idx on public.products (category_id);
create index offers_store_id_offer_date_idx on public.offers (store_id, offer_date);
create index offers_product_id_idx on public.offers (product_id);
create index orders_store_id_created_at_idx on public.orders (store_id, created_at desc);
create index orders_store_id_customer_phone_created_at_idx
  on public.orders (store_id, customer_phone, created_at);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

-- ── updated_at trigger for products ─────────────────────────────────────────

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row
  execute function private.set_updated_at();

-- ── public_stores: security_invoker view over a security-definer row function ──
-- Research correction 3: PRD §6's naive `security_invoker` view directly over
-- `stores` would return zero rows to anon (anon has no RLS policy on `stores`)
-- and would hide other shops from signed-in vendors. Instead: a security-definer
-- function returns exactly the four public columns for every store, and the
-- security_invoker view sits on top of it so PostgREST's normal RLS-aware
-- query path still applies. The column list stays explicit (never `select *`)
-- so a later `alter table stores add column ...` can never silently re-expose
-- a sensitive column through this view (Pitfall 1).
create function private.public_store_rows()
returns table (id uuid, slug text, shop_name text, is_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select id, slug, shop_name, is_open from public.stores;
$$;

revoke all on function private.public_store_rows() from public;
grant execute on function private.public_store_rows() to anon, authenticated;

create view public.public_stores
with (security_invoker = true)
as
  select id, slug, shop_name, is_open from private.public_store_rows();

revoke all on public.public_stores from public;
grant select on public.public_stores to anon, authenticated;
