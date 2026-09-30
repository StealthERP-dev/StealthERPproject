-- pgTAP: the core records this plan adds — customers, catalogue_shares, and
-- the new orders/stores/products columns (DATA-01). Fixtures are built as
-- postgres (bypasses RLS). This file proves data-model correctness AND the
-- zero-anon-privilege posture on the two new tables (T-01.1-06/07); RLS
-- ownership isolation for the general public-read/owner-manage pattern is
-- already covered by 010_public_read_surface.sql / 030_vendor_isolation.sql
-- — this file adds only what is genuinely new: the per-shop customers
-- uniqueness guarantee (BR8) and the owner-scoped catalogue_shares write path.

begin;

select plan(60);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_core_a', 'vendor_core_a@test.local');
select tests.create_supabase_user('vendor_core_b', 'vendor_core_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('50000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_core_a'),
    '9800000001', 'Core Shop A', 'Vendor Core A', 'core-shop-a', array['Vegetables'], true),
  ('50000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_core_b'),
    '9800000002', 'Core Shop B', 'Vendor Core B', 'core-shop-b', array['Vegetables'], true);

insert into public.products (id, store_id, name, unit, available) values
  ('50000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000001', 'Core Product A', 'kg', true),
  ('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000002', 'Core Product B', 'kg', true);

-- ── Column shape assertions (doc §1 field list) ─────────────────────────────

-- customers
select has_column('public', 'customers', 'id', 'customers has an id column');
select col_type_is('public', 'customers', 'id', 'uuid', 'customers.id is uuid');
select has_column('public', 'customers', 'store_id', 'customers has a store_id column');
select col_type_is('public', 'customers', 'store_id', 'uuid', 'customers.store_id is uuid');
select has_column('public', 'customers', 'phone', 'customers has a phone column');
select col_type_is('public', 'customers', 'phone', 'text', 'customers.phone is text');
select has_column('public', 'customers', 'status', 'customers has a status column');
select col_type_is('public', 'customers', 'status', 'text', 'customers.status is text');

-- orders
select has_column('public', 'orders', 'customer_id', 'orders has a customer_id column');
select col_type_is('public', 'orders', 'customer_id', 'uuid', 'orders.customer_id is uuid');
select has_column('public', 'orders', 'total', 'orders has a total column');
select col_type_is('public', 'orders', 'total', 'numeric', 'orders.total is numeric');
select has_column('public', 'orders', 'status', 'orders has a status column');
select col_type_is('public', 'orders', 'status', 'text', 'orders.status is text');
select has_column('public', 'orders', 'confirmed_at', 'orders has a confirmed_at column');
select col_type_is('public', 'orders', 'confirmed_at', 'timestamp with time zone', 'orders.confirmed_at is timestamptz');
select has_column('public', 'orders', 'cancelled_at', 'orders has a cancelled_at column');
select col_type_is('public', 'orders', 'cancelled_at', 'timestamp with time zone', 'orders.cancelled_at is timestamptz');
select has_column('public', 'orders', 'completed_at', 'orders has a completed_at column');
select col_type_is('public', 'orders', 'completed_at', 'timestamp with time zone', 'orders.completed_at is timestamptz');

-- stores
select has_column('public', 'stores', 'location', 'stores has a location column');
select col_type_is('public', 'stores', 'location', 'text', 'stores.location is text');
select has_column('public', 'stores', 'status', 'stores has a status column');
select col_type_is('public', 'stores', 'status', 'text', 'stores.status is text');
select has_column('public', 'stores', 'last_active_at', 'stores has a last_active_at column');
select col_type_is('public', 'stores', 'last_active_at', 'timestamp with time zone', 'stores.last_active_at is timestamptz');

-- products
select has_column('public', 'products', 'created_at', 'products has a created_at column');
select col_type_is('public', 'products', 'created_at', 'timestamp with time zone', 'products.created_at is timestamptz');
select has_column('public', 'products', 'price', 'products has a price column');
select col_type_is('public', 'products', 'price', 'numeric', 'products.price is numeric');

-- catalogue_shares
select has_column('public', 'catalogue_shares', 'id', 'catalogue_shares has an id column');
select col_type_is('public', 'catalogue_shares', 'id', 'uuid', 'catalogue_shares.id is uuid');
select has_column('public', 'catalogue_shares', 'store_id', 'catalogue_shares has a store_id column');
select col_type_is('public', 'catalogue_shares', 'store_id', 'uuid', 'catalogue_shares.store_id is uuid');
select has_column('public', 'catalogue_shares', 'product_id', 'catalogue_shares has a product_id column');
select col_type_is('public', 'catalogue_shares', 'product_id', 'uuid', 'catalogue_shares.product_id is uuid');
select has_column('public', 'catalogue_shares', 'share_type', 'catalogue_shares has a share_type column');
select col_type_is('public', 'catalogue_shares', 'share_type', 'text', 'catalogue_shares.share_type is text');
select has_column('public', 'catalogue_shares', 'destination', 'catalogue_shares has a destination column');
select col_type_is('public', 'catalogue_shares', 'destination', 'text', 'catalogue_shares.destination is text');
select has_column('public', 'catalogue_shares', 'created_at', 'catalogue_shares has a created_at column');
select col_type_is('public', 'catalogue_shares', 'created_at', 'timestamp with time zone', 'catalogue_shares.created_at is timestamptz');

-- ── RLS enabled on both new tables ───────────────────────────────────────────
select tests.rls_enabled('public', 'customers');
select tests.rls_enabled('public', 'catalogue_shares');

-- ── products.price check: rejects negative, accepts 0 and null ─────────────
select throws_ok(
  $$ insert into public.products (id, store_id, name, unit, available, price) values
    ('50000000-0000-4000-8000-000000000020', '50000000-0000-4000-8000-000000000001', 'Priced Product', 'kg', true, -1) $$,
  '23514', null, 'products.price = -1 is rejected by the check constraint'
);
select lives_ok(
  $$ insert into public.products (id, store_id, name, unit, available, price) values
    ('50000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000001', 'Zero Priced Product', 'kg', true, 0) $$,
  'products.price = 0 is accepted'
);
select lives_ok(
  $$ insert into public.products (id, store_id, name, unit, available, price) values
    ('50000000-0000-4000-8000-000000000022', '50000000-0000-4000-8000-000000000001', 'Unpriced Product', 'kg', true, null) $$,
  'products.price = null is accepted'
);

-- ── orders.total check: rejects negative, accepts 0 and null ───────────────
select throws_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone, total) values
    ('50000000-0000-4000-8000-000000000001', 'Total Test', '9800000010', -1) $$,
  '23514', null, 'orders.total = -1 is rejected by the check constraint'
);
select lives_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone, total) values
    ('50000000-0000-4000-8000-000000000001', 'Total Test', '9800000011', 0) $$,
  'orders.total = 0 is accepted'
);
select lives_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone, total) values
    ('50000000-0000-4000-8000-000000000001', 'Total Test', '9800000012', null) $$,
  'orders.total = null is accepted'
);

-- ── orders.status check: exactly the four allowed values ───────────────────
select throws_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone, status) values
    ('50000000-0000-4000-8000-000000000001', 'Status Test', '9800000013', 'bogus') $$,
  '23514', null, 'orders.status outside the four allowed values is rejected'
);

-- ── customers: per-shop identity guarantee (BR8) ────────────────────────────
insert into public.customers (id, store_id, phone, name) values
  ('50000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000001', '9800000099', 'Repeat Customer');

select throws_ok(
  $$ insert into public.customers (store_id, phone, name) values
    ('50000000-0000-4000-8000-000000000001', '9800000099', 'Duplicate At Same Shop') $$,
  '23505', null, 'a second customers row for the same (store_id, phone) raises 23505'
);
select lives_ok(
  $$ insert into public.customers (store_id, phone, name) values
    ('50000000-0000-4000-8000-000000000002', '9800000099', 'Same Phone Different Shop') $$,
  'the same phone at a different store is a distinct, accepted customers row (BR8)'
);

-- ── zero anon privilege on both new tables ──────────────────────────────────
select is(
  (
    select count(*)::int
    from (values
      ('customers', 'SELECT'), ('customers', 'INSERT'), ('customers', 'UPDATE'), ('customers', 'DELETE'),
      ('catalogue_shares', 'SELECT'), ('catalogue_shares', 'INSERT'), ('catalogue_shares', 'UPDATE'), ('catalogue_shares', 'DELETE')
    ) as t (tbl, priv)
    where has_table_privilege('anon', 'public.' || t.tbl, t.priv)
  ),
  0,
  'anon has no select/insert/update/delete privilege on customers or catalogue_shares'
);

-- authenticated keeps read-only access to customers (via the owner-scoped
-- policy) but never a direct insert privilege — only place_order writes it.
select is(
  has_table_privilege('authenticated', 'public.customers', 'insert'),
  false,
  'authenticated has no insert privilege on customers (only place_order writes it)'
);

-- ── catalogue_shares.share_type check: widened to accept 'offer' (D-12) ────
-- Run as postgres (this file's own fixtures, per the header) so the
-- constraint itself is what's under test, independent of RLS. This is what
-- would have caught a migration whose `drop constraint` was never followed
-- by its `add constraint`: an accepted-value-only assertion set would pass
-- against no constraint at all, which is precisely why the bogus-value
-- rejection below (asserted by its check-violation error code) is here too.
select lives_ok(
  $$ insert into public.catalogue_shares (store_id, share_type, destination) values
    ('50000000-0000-4000-8000-000000000001', 'offer', 'WhatsApp') $$,
  'catalogue_shares.share_type = ''offer'' is accepted by the widened constraint (D-12)'
);
select lives_ok(
  $$ insert into public.catalogue_shares (store_id, share_type, destination) values
    ('50000000-0000-4000-8000-000000000001', 'catalogue', 'Copy link') $$,
  'catalogue_shares.share_type = ''catalogue'' is still accepted'
);
select lives_ok(
  $$ insert into public.catalogue_shares (store_id, product_id, share_type, destination) values
    ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000010', 'product', 'Copy link') $$,
  'catalogue_shares.share_type = ''product'' is still accepted'
);
select throws_ok(
  $$ insert into public.catalogue_shares (store_id, share_type, destination) values
    ('50000000-0000-4000-8000-000000000001', 'bogus', 'Copy link') $$,
  '23514', null, 'catalogue_shares.share_type outside the three allowed values is still rejected'
);

-- ── catalogue_shares: owner-scoped write path, cross-vendor insert denied ──
select tests.authenticate_as('vendor_core_b');

select throws_ok(
  $$ insert into public.catalogue_shares (store_id, share_type, destination) values
    ('50000000-0000-4000-8000-000000000001', 'catalogue', 'whatsapp') $$,
  '42501', null, 'vendor B inserting a catalogue_shares row with vendor A''s store_id fails 42501'
);

select * from finish();

rollback;
