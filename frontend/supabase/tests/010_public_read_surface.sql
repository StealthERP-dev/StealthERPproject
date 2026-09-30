-- pgTAP: anon / signed-in-shopper public read surface matches PRD §6 (PLAT-04).
-- Fixtures are built as the postgres role (bypasses RLS), then every assertion
-- runs as anon (tests.clear_authentication) or as a different signed-in vendor
-- (tests.authenticate_as) — never as the fixture-creating role.

begin;

select plan(37);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_a', 'vendor_a@test.local');
select tests.create_supabase_user('vendor_b', 'vendor_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open)
values (
  '10000000-0000-4000-8000-000000000001',
  tests.get_supabase_uid('vendor_a'),
  '9111111111', 'Test Shop A', 'Vendor A', 'test-shop-a', array['Vegetables'], true
);

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open)
values (
  '10000000-0000-4000-8000-000000000002',
  tests.get_supabase_uid('vendor_b'),
  '9222222222', 'Test Shop B', 'Vendor B', 'test-shop-b', array['Vegetables'], true
);

insert into public.categories (id, store_id, name) values
  ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'Test Category');

-- Shop A: one available + one unavailable product. Shop B: zero products
-- (zero available products, per the behavior list).
insert into public.products (id, store_id, name, category_id, unit, available) values
  ('10000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', 'Available Product',
    '10000000-0000-4000-8000-000000000010', 'kg', true),
  ('10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000001', 'Unavailable Product',
    '10000000-0000-4000-8000-000000000010', 'kg', false);

-- Yesterday / today / tomorrow offers on the same product — only "today" should
-- ever be anon-visible.
insert into public.offers (id, store_id, product_id, today_price_label, regular_price_label, offer_date) values
  ('10000000-0000-4000-8000-000000000030', '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000020', '₹10/kg', '₹15/kg', public.today_ist() - 1),
  ('10000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000020', '₹10/kg', '₹15/kg', public.today_ist()),
  ('10000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000020', '₹10/kg', '₹15/kg', public.today_ist() + 1);

insert into public.orders (id, store_id, customer_name, customer_phone) values
  ('10000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 'Test Customer', '9333333333');

insert into public.order_items (order_id, product_id, product_name, qty) values
  ('10000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000020', 'Available Product', 1);

-- ── anon ──────────────────────────────────────────────────────────────────
select tests.clear_authentication();

-- 1. public_stores exposes exactly id, slug, shop_name, is_open (T-01-01)
select is(
  (
    select array_agg(column_name::text order by column_name::text)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'public_stores'
  ),
  array['id', 'is_open', 'shop_name', 'slug'],
  'public_stores exposes exactly id, slug, shop_name, is_open'
);

-- 2. products: available only (set comparison, not results_eq on unordered rows)
select is(
  (select array_agg(id order by id) from public.products where store_id = '10000000-0000-4000-8000-000000000001'),
  array['10000000-0000-4000-8000-000000000020'::uuid],
  'anon sees only the available product for shop A'
);

-- 3. a fixture shop with zero available products returns an empty list, not an error
select is(
  (select count(*)::int from public.products where store_id = '10000000-0000-4000-8000-000000000002'),
  0,
  'anon sees zero products for a shop with no available products (not an error)'
);

-- 4. offers: only the one dated today_ist()
select is(
  (select array_agg(id order by id) from public.offers where store_id = '10000000-0000-4000-8000-000000000001'),
  array['10000000-0000-4000-8000-000000000031'::uuid],
  'anon sees only the offer dated today_ist(), not yesterday''s or tomorrow''s'
);

-- 5. categories are readable
select is(
  (select count(*)::int from public.categories where store_id = '10000000-0000-4000-8000-000000000001'),
  1,
  'anon can read categories'
);

-- 6-8. selecting stores, orders or order_items fails with permission denied
select throws_ok(
  $$ select 1 from public.stores $$,
  '42501',
  null,
  'anon cannot select from stores (permission denied)'
);
select throws_ok(
  $$ select 1 from public.orders $$,
  '42501',
  null,
  'anon cannot select from orders (permission denied)'
);
select throws_ok(
  $$ select 1 from public.order_items $$,
  '42501',
  null,
  'anon cannot select from order_items (permission denied)'
);

-- 9. anon has no insert/update/delete privilege on any of the six public tables
select is(
  (
    select count(*)::int
    from (values
      ('stores', 'INSERT'), ('stores', 'UPDATE'), ('stores', 'DELETE'),
      ('categories', 'INSERT'), ('categories', 'UPDATE'), ('categories', 'DELETE'),
      ('products', 'INSERT'), ('products', 'UPDATE'), ('products', 'DELETE'),
      ('offers', 'INSERT'), ('offers', 'UPDATE'), ('offers', 'DELETE'),
      ('orders', 'INSERT'), ('orders', 'UPDATE'), ('orders', 'DELETE'),
      ('order_items', 'INSERT'), ('order_items', 'UPDATE'), ('order_items', 'DELETE')
    ) as t (tbl, priv)
    where has_table_privilege('anon', 'public.' || t.tbl, t.priv)
  ),
  0,
  'anon has no insert/update/delete privilege on any public table'
);

-- 10-15. RLS is enabled on every table in schema public. Checked per-table
-- (not via the schema-wide tests.rls_enabled('public')) because that helper
-- counts every relation with a composite type in the schema, including the
-- public_stores VIEW — views have no ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- equivalent in Postgres, so the schema-wide form always reports a false
-- "1 relation without RLS" once a security_invoker view exists alongside the
-- tables. The per-table form is the correct, unambiguous check.
select tests.rls_enabled('public', 'stores');
select tests.rls_enabled('public', 'categories');
select tests.rls_enabled('public', 'products');
select tests.rls_enabled('public', 'offers');
select tests.rls_enabled('public', 'orders');
select tests.rls_enabled('public', 'order_items');
select tests.rls_enabled('public', 'customers');
select tests.rls_enabled('public', 'catalogue_shares');
select tests.rls_enabled('public', 'events');
select tests.rls_enabled('public', 'product_history');

-- 16-25. schema scope guard (D-08, D-09, D-10) — no v1.1-deferred objects, no PIN-lockout objects
select hasnt_column('public', 'products', 'description',
  'products has no description column (D-08 scope guard)');
select has_column('public', 'orders', 'customer_id',
  'orders has a customer_id column (DATA-01)');
select has_column('public', 'orders', 'customer_name',
  'orders keeps customer_name (D-09)');
select has_column('public', 'orders', 'customer_phone',
  'orders keeps customer_phone (D-09)');
select hasnt_column('public', 'order_items', 'rejected',
  'order_items has no rejected column (D-08 scope guard)');
select has_table('public', 'customers',
  'customers table exists (DATA-01)');
select has_table('public', 'catalogue_shares',
  'catalogue_shares table exists (DATA-01)');
select has_table('public', 'events',
  'events table exists (DATA-02)');
select has_table('public', 'product_history',
  'product_history table exists (DATA-10)');
select hasnt_table('public', 'availability_events',
  'availability_events table does not exist (D-08 scope guard)');
select hasnt_table('public', 'share_events',
  'share_events table does not exist (D-08 scope guard)');
select hasnt_table('public', 'login_attempts',
  'login_attempts table does not exist (D-10 scope guard — no PIN-lockout objects)');
select hasnt_function('public', 'store_insights',
  'store_insights function does not exist (D-08 scope guard)');

-- 26. today_ist() must be STABLE, never IMMUTABLE (Pitfall 2)
select volatility_is('public', 'today_ist', 'stable', 'today_ist() is STABLE, never IMMUTABLE');

-- 27. today_ist() equals (now() at time zone 'Asia/Kolkata')::date
select is(
  public.today_ist(),
  (now() at time zone 'Asia/Kolkata')::date,
  'today_ist() returns (now() at time zone Asia/Kolkata)::date'
);

-- ── signed-in vendor B browsing vendor A's shop sees the same public surface ──
select tests.authenticate_as('vendor_b');

-- 28. same available products as anon
select is(
  (select array_agg(id order by id) from public.products where store_id = '10000000-0000-4000-8000-000000000001'),
  array['10000000-0000-4000-8000-000000000020'::uuid],
  'signed-in vendor B sees the same available product for shop A as anon'
);

-- 29. same today's offers as anon
select is(
  (select array_agg(id order by id) from public.offers where store_id = '10000000-0000-4000-8000-000000000001'),
  array['10000000-0000-4000-8000-000000000031'::uuid],
  'signed-in vendor B sees the same today offer for shop A as anon'
);

-- 30. same public_stores row as anon
select is(
  (select shop_name from public.public_stores where id = '10000000-0000-4000-8000-000000000001'),
  'Test Shop A',
  'signed-in vendor B sees the same public_stores row for shop A as anon'
);

select * from finish();

rollback;
