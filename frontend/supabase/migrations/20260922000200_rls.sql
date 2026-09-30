-- Phase 1 RLS: enables row level security on every public table and defines the
-- public-read / owner-managed policy set from PRD §6's RLS table (PLAT-04).

-- ── private.owned_store_id(): the caller's own store id, or null ────────────
create function private.owned_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.stores where owner_id = (select auth.uid());
$$;

revoke all on function private.owned_store_id() from public;
grant execute on function private.owned_store_id() to authenticated;

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- ── stores ────────────────────────────────────────────────────────────────
create policy "stores: owner manages own store"
on public.stores
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- ── categories ────────────────────────────────────────────────────────────
create policy "categories: public read"
on public.categories
for select
to anon, authenticated
using (true);

create policy "categories: owner manages"
on public.categories
for all
to authenticated
using (store_id = (select private.owned_store_id()))
with check (store_id = (select private.owned_store_id()));

-- ── products ──────────────────────────────────────────────────────────────
create policy "products: public reads available"
on public.products
for select
to anon, authenticated
using (available);

create policy "products: owner manages"
on public.products
for all
to authenticated
using (store_id = (select private.owned_store_id()))
with check (
  store_id = (select private.owned_store_id())
  and (
    category_id is null
    or exists (
      select 1
      from public.categories c
      where c.id = category_id
        and c.store_id = (select private.owned_store_id())
    )
  )
);

-- ── offers ────────────────────────────────────────────────────────────────
create policy "offers: public reads today's"
on public.offers
for select
to anon, authenticated
using (offer_date = public.today_ist());

create policy "offers: owner manages"
on public.offers
for all
to authenticated
using (store_id = (select private.owned_store_id()))
with check (
  store_id = (select private.owned_store_id())
  and exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.store_id = (select private.owned_store_id())
  )
);

-- ── orders (no insert/delete policy for any role — public writes only via
--    place_order, added in plan 02) ──────────────────────────────────────────
create policy "orders: owner reads"
on public.orders
for select
to authenticated
using (store_id = (select private.owned_store_id()));

create policy "orders: owner updates"
on public.orders
for update
to authenticated
using (store_id = (select private.owned_store_id()))
with check (store_id = (select private.owned_store_id()));

-- ── order_items (no insert/delete/update policy for any role) ───────────────
create policy "order_items: owner reads"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.store_id = (select private.owned_store_id())
  )
);

-- ── Defense-in-depth revokes ─────────────────────────────────────────────────
-- RLS alone already blocks these; explicit revokes remove the privilege entirely
-- so a future dropped/misconfigured policy cannot silently reopen access.
revoke all on public.stores from anon;
revoke all on public.orders from anon;
revoke all on public.order_items from anon;

revoke insert, update, delete, truncate on public.categories from anon;
revoke insert, update, delete, truncate on public.products from anon;
revoke insert, update, delete, truncate on public.offers from anon;

revoke insert, delete on public.orders from authenticated;
revoke insert, delete on public.order_items from authenticated;
revoke update on public.order_items from authenticated;
