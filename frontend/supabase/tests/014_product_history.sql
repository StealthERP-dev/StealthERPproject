-- pgTAP: public.product_history and its unconditional before-update trigger
-- (DATA-10, D-06, D-08). Fixtures are built as postgres (bypasses RLS); the
-- security-definer proof runs as a signed-in vendor
-- (tests.authenticate_as()), and the cross-vendor read-isolation check runs
-- as a different signed-in vendor.
--
-- Picking "the most recently written" history row orders by ctid, not
-- recorded_at: every statement inside this single test transaction sees the
-- same now(), so recorded_at is identical across every row this file writes,
-- and ctid (physical insertion order, reliable here since nothing else
-- writes or vacuums this table mid-test) is what actually disambiguates them.

begin;

select plan(31);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_ph_a', 'vendor_ph_a@test.local');
select tests.create_supabase_user('vendor_ph_b', 'vendor_ph_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('70000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_ph_a'),
    '9800000201', 'History Shop A', 'Vendor History A', 'history-shop-a', array['Vegetables'], true),
  ('70000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_ph_b'),
    '9800000202', 'History Shop B', 'Vendor History B', 'history-shop-b', array['Vegetables'], true);

insert into public.categories (id, store_id, name) values
  ('70000000-0000-4000-8000-000000000010', '70000000-0000-4000-8000-000000000001', 'History Category A');

insert into public.products (id, store_id, name, category_id, unit, available, price) values
  ('70000000-0000-4000-8000-000000000020', '70000000-0000-4000-8000-000000000001',
    'Original Name', '70000000-0000-4000-8000-000000000010', 'kg', true, 10.00);

-- ── Shape: every column exists with the right type (16) ─────────────────────
select has_table('public', 'product_history', 'product_history table exists');
select has_column('public', 'product_history', 'id', 'product_history has an id column');
select col_type_is('public', 'product_history', 'id', 'uuid', 'product_history.id is uuid');
select has_column('public', 'product_history', 'product_id', 'product_history has a product_id column');
select col_type_is('public', 'product_history', 'product_id', 'uuid', 'product_history.product_id is uuid');
select has_column('public', 'product_history', 'store_id', 'product_history has a store_id column');
select col_type_is('public', 'product_history', 'store_id', 'uuid', 'product_history.store_id is uuid');
select has_column('public', 'product_history', 'name', 'product_history has a name column');
select col_type_is('public', 'product_history', 'name', 'text', 'product_history.name is text');
select has_column('public', 'product_history', 'category_id', 'product_history has a category_id column');
select col_type_is('public', 'product_history', 'category_id', 'uuid', 'product_history.category_id is uuid');
select has_column('public', 'product_history', 'price', 'product_history has a price column');
select col_type_is('public', 'product_history', 'price', 'numeric', 'product_history.price is numeric');
select has_column('public', 'product_history', 'available', 'product_history has an available column');
select col_type_is('public', 'product_history', 'available', 'boolean', 'product_history.available is boolean');
select has_column('public', 'product_history', 'recorded_at', 'product_history has a recorded_at column');

-- ── RLS enabled, and the privilege matrix (D-06: un-rewritable) (4) ─────────
select tests.rls_enabled('public', 'product_history');

select is(
  (
    select count(*)::int
    from (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as t (priv)
    where has_table_privilege('anon', 'public.product_history', t.priv)
  ),
  0,
  'anon has no select/insert/update/delete privilege on product_history'
);
select is(
  (
    select count(*)::int
    from (values
      ('INSERT'), ('UPDATE'), ('DELETE')
    ) as t (priv)
    where has_table_privilege('authenticated', 'public.product_history', t.priv)
  ),
  0,
  'authenticated has no insert/update/delete privilege on product_history'
);
select is(
  has_table_privilege('authenticated', 'public.product_history', 'select'),
  true,
  'authenticated has select privilege on product_history (owner-scoped policy)'
);

-- ── A single-column update writes exactly one row with the pre-update values (5) ──
update public.products set price = 20.00 where id = '70000000-0000-4000-8000-000000000020';

select is(
  (select count(*)::int from public.product_history where product_id = '70000000-0000-4000-8000-000000000020'),
  1,
  'a single-column update writes exactly one history row'
);
select is(
  (select price from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  10.00,
  'the history row carries the price as it was BEFORE the update, not after'
);
select is(
  (select name from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  'Original Name',
  'the history row carries the pre-update name'
);
select is(
  (select available from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  true,
  'the history row carries the pre-update availability'
);
select is(
  (select category_id from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  '70000000-0000-4000-8000-000000000010'::uuid,
  'the history row carries the pre-update category_id'
);

-- ── An update touching three columns at once still writes exactly one row (1) ──
update public.products
  set name = 'Updated Name', price = 30.00, available = false
  where id = '70000000-0000-4000-8000-000000000020';

select is(
  (select count(*)::int from public.product_history where product_id = '70000000-0000-4000-8000-000000000020'),
  2,
  'an update touching three columns at once writes one row, not three (total is 2, not 4)'
);

-- ── An update that assigns every column its CURRENT value still writes one row (1) ──
-- Deliberately no `when` clause on the trigger: it is unconditional, so a
-- no-op update is still captured.
update public.products
  set name = 'Updated Name', category_id = '70000000-0000-4000-8000-000000000010',
      price = 30.00, available = false
  where id = '70000000-0000-4000-8000-000000000020';

select is(
  (select count(*)::int from public.product_history where product_id = '70000000-0000-4000-8000-000000000020'),
  3,
  'an update that changes nothing still writes exactly one history row (the trigger is unconditional)'
);

-- ── A price of 12.345 round-trips exactly (numeric, never rounded to 2dp) (1) ──
update public.products set price = 12.345 where id = '70000000-0000-4000-8000-000000000020';
update public.products set name = 'Round Trip Name' where id = '70000000-0000-4000-8000-000000000020';

select is(
  (select price from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  12.345,
  'a price of 12.345 round-trips exactly through product_history.price'
);

-- ── The security-definer proof: an authenticated vendor's own update writes
--    history despite holding no insert privilege on product_history (2) ──
select tests.authenticate_as('vendor_ph_a');

update public.products set price = 40.00 where id = '70000000-0000-4000-8000-000000000020';

select is(
  (
    select count(*)::int
    from public.product_history
    where product_id = '70000000-0000-4000-8000-000000000020'
  ),
  6,
  'a vendor-issued update writes history despite the vendor holding no insert privilege on product_history'
);
select is(
  (select price from public.product_history where product_id = '70000000-0000-4000-8000-000000000020' order by ctid desc limit 1),
  12.345,
  'the vendor-issued update''s history row carries the pre-update price'
);

-- ── A vendor cannot read another store's history rows (1) ──────────────────
select tests.authenticate_as('vendor_ph_b');

select is(
  (select count(*)::int from public.product_history where store_id = '70000000-0000-4000-8000-000000000001'),
  0,
  'vendor B cannot read shop A''s product_history rows'
);

select * from finish();

rollback;
