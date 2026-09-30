-- pgTAP: private.vendor_update_latency (DATA-11, D-14). Fixtures are built
-- as postgres (bypasses RLS): two vendors/stores under the 90000000-…
-- fixture prefix (distinct from every other test file's own prefix — see
-- 014_product_history.sql's 70000000-… and 015_analytics_views.sql's
-- 80000000-…). Store A gets three products: one never touched after
-- creation, one touched once and backdated to two hours ago, one touched
-- twice and backdated to thirty minutes ago. Store B gets no products at
-- all, proving an empty store produces no row rather than a zero row.
--
-- Backdating: a plain UPDATE ... SET updated_at = ... cannot set the past,
-- because products_set_updated_at overwrites any explicit value with the
-- real current time on every UPDATE statement (20260922000100_schema.sql).
-- The trigger is disabled by name for the one backdating statement per
-- product and re-enabled immediately after. The history trigger
-- (products_record_history) stays enabled throughout — the extra history
-- rows the backdating statements write are harmless, since the view only
-- asks whether at least one product_history row exists, not how many.
--
-- Every statement in this file's own transaction sees the same now(), so the
-- expected avg/min/max below are exact values, not approximations.

begin;

select plan(8);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_vul_a', 'vendor_vul_a@test.local');
select tests.create_supabase_user('vendor_vul_b', 'vendor_vul_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('90000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_vul_a'),
    '9800000401', 'Latency Shop A', 'Vendor Latency A', 'latency-shop-a', array['Vegetables'], true),
  ('90000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_vul_b'),
    '9800000402', 'Latency Shop B', 'Vendor Latency B', 'latency-shop-b', array['Vegetables'], true);

insert into public.categories (id, store_id, name) values
  ('90000000-0000-4000-8000-000000000010', '90000000-0000-4000-8000-000000000001', 'Latency Category A');

insert into public.products (id, store_id, name, category_id, unit, available) values
  ('90000000-0000-4000-8000-000000000020', '90000000-0000-4000-8000-000000000001',
    'Never Touched', '90000000-0000-4000-8000-000000000010', 'kg', true),
  ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000001',
    'Touched Once', '90000000-0000-4000-8000-000000000010', 'kg', true),
  ('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000001',
    'Touched Twice', '90000000-0000-4000-8000-000000000010', 'kg', true);

-- Touch "Touched Once" exactly once (writes 1 product_history row) and
-- "Touched Twice" exactly twice (writes 2 product_history rows). "Never
-- Touched" is left completely alone.
update public.products set name = 'Touched Once' where id = '90000000-0000-4000-8000-000000000021';

update public.products set name = 'Touched Twice (1st)' where id = '90000000-0000-4000-8000-000000000022';
update public.products set name = 'Touched Twice' where id = '90000000-0000-4000-8000-000000000022';

-- Backdate updated_at deterministically: disable products_set_updated_at by
-- name for exactly the one backdating statement per product, then
-- immediately re-enable it. products_record_history is left enabled.
alter table public.products disable trigger products_set_updated_at;

update public.products
  set updated_at = now() - interval '2 hours'
  where id = '90000000-0000-4000-8000-000000000021';

update public.products
  set updated_at = now() - interval '30 minutes'
  where id = '90000000-0000-4000-8000-000000000022';

alter table public.products enable trigger products_set_updated_at;

-- ── Isolation: neither anon nor authenticated holds select (as postgres) ────
select is(
  has_table_privilege('anon', 'private.vendor_update_latency', 'select'),
  false,
  'anon has no select privilege on private.vendor_update_latency'
);
select is(
  has_table_privilege('authenticated', 'private.vendor_update_latency', 'select'),
  false,
  'authenticated has no select privilege on private.vendor_update_latency'
);

-- ── Correctness, scoped to store A's own row (still as postgres) ────────────
select is(
  (select products_with_manual_update::int from private.vendor_update_latency
    where store_id = '90000000-0000-4000-8000-000000000001'),
  2,
  'D-14: products_with_manual_update is 2 for store A, excluding the never-touched product'
);
select is(
  (select avg_latency from private.vendor_update_latency
    where store_id = '90000000-0000-4000-8000-000000000001'),
  interval '1 hour 15 minutes',
  'avg_latency for store A is exactly the average of 2h and 30m (1h15m)'
);
select is(
  (select min_latency from private.vendor_update_latency
    where store_id = '90000000-0000-4000-8000-000000000001'),
  interval '30 minutes',
  'min_latency for store A is exactly 30 minutes'
);
select is(
  (select max_latency from private.vendor_update_latency
    where store_id = '90000000-0000-4000-8000-000000000001'),
  interval '2 hours',
  'max_latency for store A is exactly 2 hours'
);

-- Store B has no products at all: it must produce no row, not a zero row.
select is(
  (select count(*)::int from private.vendor_update_latency
    where store_id = '90000000-0000-4000-8000-000000000002'),
  0,
  'store B, which has no products, produces no row in vendor_update_latency'
);

-- ── Unreachability from a real signed-in vendor (role switch — kept last) ───
select tests.authenticate_as('vendor_vul_a');

select throws_ok(
  $$ select 1 from private.vendor_update_latency $$,
  '42501', null,
  'a signed-in vendor cannot select from private.vendor_update_latency'
);

select * from finish();

rollback;
