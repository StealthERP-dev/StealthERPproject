-- pgTAP: category create-or-reuse is atomic at the existing unique
-- (store_id, name) constraint (PROD-05, D-12) — no new RPC. Fixtures are two
-- vendors/stores under the 91000000-… prefix (distinct from every other
-- fixture prefix in this suite). The conflict-aware statement asserted here
-- is the exact shape RESEARCH.md live-tested against the local database:
-- `insert ... on conflict (store_id, name) do update set name = excluded.name
-- returning id, name` — the same shape supabase-js's own
-- `.upsert(row, { onConflict: 'store_id,name' })` generates.
--
-- Falsifiability requirement (recorded, not automated here): this file was
-- run once with the `on conflict` clause removed from the second insert for
-- store A, which raised an uncaught unique_violation (23505) and aborted the
-- run rather than resolving — confirming the create-or-reuse assertion is
-- real and not a tautology — then the clause was restored and the file
-- passed green again. See the plan's SUMMARY for the observed output.

begin;

select plan(7);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_cu_a', 'vendor_cu_a@test.local');
select tests.create_supabase_user('vendor_cu_b', 'vendor_cu_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('91000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_cu_a'),
    '9800000501', 'Upsert Shop A', 'Vendor Upsert A', 'upsert-shop-a', array['Vegetables'], true),
  ('91000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_cu_b'),
    '9800000502', 'Upsert Shop B', 'Vendor Upsert B', 'upsert-shop-b', array['Vegetables'], true);

-- ── The constraint the whole of D-12 rests on ───────────────────────────────
select is(
  (
    select count(*)::int
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'categories'
      and con.contype = 'u'
      and pg_catalog.pg_get_constraintdef(con.oid) = 'UNIQUE (store_id, name)'
  ),
  1,
  'public.categories carries a unique constraint on (store_id, name)'
);

-- ── Create-or-reuse, as postgres — captures each call's returned id/name ────
create temporary table cat_result (call_num int, id uuid, name text);

with ins as (
  insert into public.categories (store_id, name) values
    ('91000000-0000-4000-8000-000000000001', 'Vegetables')
  on conflict (store_id, name) do update set name = excluded.name
  returning id, name
)
insert into cat_result select 1, id, name from ins;

with ins as (
  insert into public.categories (store_id, name) values
    ('91000000-0000-4000-8000-000000000001', 'Vegetables')
  on conflict (store_id, name) do update set name = excluded.name
  returning id, name
)
insert into cat_result select 2, id, name from ins;

with ins as (
  insert into public.categories (store_id, name) values
    ('91000000-0000-4000-8000-000000000002', 'Vegetables')
  on conflict (store_id, name) do update set name = excluded.name
  returning id, name
)
insert into cat_result select 3, id, name from ins;

select is(
  (select id from cat_result where call_num = 2),
  (select id from cat_result where call_num = 1),
  'two upserts of the same (store_id, name) for store A resolve to the identical id'
);
select is(
  (select count(*)::int from public.categories
    where store_id = '91000000-0000-4000-8000-000000000001' and name = 'Vegetables'),
  1,
  'store A holds exactly one row named Vegetables after two upserts'
);
select isnt(
  (select id from cat_result where call_num = 3),
  (select id from cat_result where call_num = 1),
  'the same name under store B produces a genuinely different id than store A''s row'
);
select is(
  (select id from public.categories
    where store_id = '91000000-0000-4000-8000-000000000001' and name = 'Vegetables'),
  (select id from cat_result where call_num = 1),
  'store A''s row is untouched by store B''s insert of the same name'
);

-- ── RLS scoping: a signed-in vendor cannot write into another store ─────────
select tests.authenticate_as('vendor_cu_a');

select throws_ok(
  $$ insert into public.categories (store_id, name) values
    ('91000000-0000-4000-8000-000000000002', 'Vendor A Malicious Category')
  on conflict (store_id, name) do update set name = excluded.name $$,
  '42501', null,
  'a signed-in vendor cannot upsert a category into another store (with-check)'
);

select throws_ok(
  $$ insert into public.products (store_id, name, category_id) values
    ('91000000-0000-4000-8000-000000000001', 'Cross-Store Category Product',
     (select id from cat_result where call_num = 3)) $$,
  '42501', null,
  'a signed-in vendor cannot attach another store''s category to their own product'
);

select * from finish();

rollback;
