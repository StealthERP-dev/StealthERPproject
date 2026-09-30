-- pgTAP: the append-only events table and its only writer, log_event — the
-- allow-list (D-02), the silent-drop rate limit under real concurrency-shape
-- (D-04), append-only grants, server-side attribution, survival past
-- deletion (D-07) and the last-active refresh trigger (D-11). Fixtures are
-- built as postgres (bypasses RLS); anon-shaped calls run as anon
-- (tests.clear_authentication()), vendor-shaped calls run as a signed-in
-- vendor (tests.authenticate_as()), and reads that must bypass RLS use
-- tests.authenticate_as_service_role() — the same pattern 020_place_order.sql
-- and 030_vendor_isolation.sql already use.

begin;

select plan(63);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_events_a', 'vendor_events_a@test.local');
select tests.create_supabase_user('vendor_events_b', 'vendor_events_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('60000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_events_a'),
    '9800000101', 'Events Shop A', 'Vendor Events A', 'events-shop-a', array['Vegetables'], true),
  ('60000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_events_b'),
    '9800000102', 'Events Shop B', 'Vendor Events B', 'events-shop-b', array['Vegetables'], true);

insert into public.products (id, store_id, name, unit, available) values
  ('60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000001', 'Events Product A1', 'kg', true),
  ('60000000-0000-4000-8000-000000000011', '60000000-0000-4000-8000-000000000002', 'Events Product B1', 'kg', true);

insert into public.customers (id, store_id, phone, name) values
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000001', '9800000199', 'Events Customer');

insert into public.orders (id, store_id, customer_id, customer_name, customer_phone) values
  ('60000000-0000-4000-8000-000000000030', '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000020', 'Events Customer', '9800000199');

-- ── Shape: every D-01 column exists with the right type (24) ────────────────
select has_column('public', 'events', 'id', 'events has an id column');
select col_type_is('public', 'events', 'id', 'uuid', 'events.id is uuid');
select has_column('public', 'events', 'event_name', 'events has an event_name column');
select col_type_is('public', 'events', 'event_name', 'text', 'events.event_name is text');
select has_column('public', 'events', 'occurred_at', 'events has an occurred_at column');
select col_type_is('public', 'events', 'occurred_at', 'timestamp with time zone', 'events.occurred_at is timestamptz');
select has_column('public', 'events', 'store_id', 'events has a store_id column');
select col_type_is('public', 'events', 'store_id', 'uuid', 'events.store_id is uuid');
select has_column('public', 'events', 'user_id', 'events has a user_id column');
select col_type_is('public', 'events', 'user_id', 'uuid', 'events.user_id is uuid');
select has_column('public', 'events', 'customer_id', 'events has a customer_id column');
select col_type_is('public', 'events', 'customer_id', 'uuid', 'events.customer_id is uuid');
select has_column('public', 'events', 'visitor_id', 'events has a visitor_id column');
select col_type_is('public', 'events', 'visitor_id', 'text', 'events.visitor_id is text');
select has_column('public', 'events', 'product_id', 'events has a product_id column');
select col_type_is('public', 'events', 'product_id', 'uuid', 'events.product_id is uuid');
select has_column('public', 'events', 'order_id', 'events has an order_id column');
select col_type_is('public', 'events', 'order_id', 'uuid', 'events.order_id is uuid');
select has_column('public', 'events', 'offer_id', 'events has an offer_id column');
select col_type_is('public', 'events', 'offer_id', 'uuid', 'events.offer_id is uuid');
select has_column('public', 'events', 'app_version', 'events has an app_version column');
select col_type_is('public', 'events', 'app_version', 'text', 'events.app_version is text');
select has_column('public', 'events', 'props', 'events has a props column');
select col_type_is('public', 'events', 'props', 'jsonb', 'events.props is jsonb');

-- ── RLS + grants: append-only proof (3) ──────────────────────────────────────
select tests.rls_enabled('public', 'events');

select is(
  (
    select count(*)::int
    from (values
      ('anon', 'SELECT'), ('anon', 'INSERT'), ('anon', 'UPDATE'), ('anon', 'DELETE'),
      ('authenticated', 'INSERT'), ('authenticated', 'UPDATE'), ('authenticated', 'DELETE')
    ) as t (role, priv)
    where has_table_privilege(t.role, 'public.events', t.priv)
  ),
  0,
  'anon has no privilege on events; authenticated has no insert/update/delete privilege on events'
);
select is(
  has_table_privilege('authenticated', 'public.events', 'select'),
  true,
  'authenticated can select from events (owner-scoped read policy)'
);

-- ── Allow-list (D-02) (10) ────────────────────────────────────────────────────
select tests.clear_authentication();

select lives_ok(
  $$ select public.log_event('shop_created', 'events-shop-a', 'visitor-allow-1') $$,
  'log_event accepts shop_created'
);
select lives_ok(
  $$ select public.log_event('product_marked_available', 'events-shop-a', 'visitor-allow-2') $$,
  'log_event accepts product_marked_available'
);
select lives_ok(
  $$ select public.log_event('catalogue_shared', 'events-shop-a', 'visitor-allow-3') $$,
  'log_event accepts catalogue_shared'
);
select lives_ok(
  $$ select public.log_event('checkout_started', 'events-shop-a', 'visitor-allow-4') $$,
  'log_event accepts checkout_started'
);
select lives_ok(
  $$ select public.log_event('orders_opened', 'events-shop-a', 'visitor-allow-5') $$,
  'log_event accepts orders_opened'
);

select throws_ok(
  $$ select public.log_event('not_a_real_event', 'events-shop-a', 'visitor-bad-1') $$,
  'P0001', 'invalid_event_name', 'an event name not on the allow-list raises invalid_event_name'
);
select throws_ok(
  $$ select public.log_event('Shop_Created', 'events-shop-a', 'visitor-bad-2') $$,
  'P0001', 'invalid_event_name', 'an event name differing only by capitalisation raises invalid_event_name'
);
select throws_ok(
  $$ select public.log_event('shop_created ', 'events-shop-a', 'visitor-bad-3') $$,
  'P0001', 'invalid_event_name', 'an event name with a trailing space raises invalid_event_name'
);
select throws_ok(
  $$ select public.log_event(null, 'events-shop-a', 'visitor-bad-4') $$,
  'P0001', 'invalid_event_name', 'a null event name raises invalid_event_name'
);

select is(
  (
    select count(*)::int
    from regexp_matches(
      (
        select pg_get_constraintdef(oid)
        from pg_catalog.pg_constraint
        where conrelid = 'public.events'::regclass
          and conname = 'events_event_name_allowed'
      ),
      $$'[a-z_]+'::text$$,
      'g'
    )
  ),
  17,
  'events_event_name_allowed allows exactly 17 event names'
);

-- ── Silent drops (D-04, D-05) (6) — never raise except invalid_event_name ──
select lives_ok(
  $$ select public.log_event('shop_created') $$,
  'log_event with no session and a null slug does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.events where store_id is null),
  0,
  'log_event with no session and a null slug inserts no row (no event row can ever carry a null store_id)'
);
select tests.clear_authentication();

select lives_ok(
  $$ select public.log_event('shop_created', 'events-shop-a') $$,
  'log_event with a resolvable slug and a null visitor id does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (
    select count(*)::int from public.events
    where store_id = '60000000-0000-4000-8000-000000000001' and visitor_id is null and user_id is null
  ),
  0,
  'log_event with a resolvable slug and a null visitor id inserts no row'
);
select tests.clear_authentication();

select lives_ok(
  $$ select public.log_event('shop_created', 'events-shop-a', 'visitor-null-props', 'null-props-test') $$,
  'log_event with a null p_props does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select props from public.events where visitor_id = 'visitor-null-props'),
  jsonb_build_object('store_name', 'Events Shop A'),
  'log_event with a null p_props inserts a row whose props carries only the server-resolved store_name snapshot and no client payload'
);
select tests.clear_authentication();

-- ── Attribution (6) ───────────────────────────────────────────────────────────
select tests.authenticate_as('vendor_events_b');
select lives_ok(
  $$ select public.log_event('shop_created', 'events-shop-a', null, 'attrib-vendor-b') $$,
  'vendor B calling with vendor A''s slug does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select store_id from public.events where app_version = 'attrib-vendor-b'),
  '60000000-0000-4000-8000-000000000002'::uuid,
  'a signed-in vendor B call passing vendor A''s slug still stores vendor B''s own store_id (session branch wins, slug ignored)'
);

select tests.authenticate_as('vendor_events_a');
select lives_ok(
  $$ select public.log_event('product_viewed', null, null, 'attrib-cross-product', '60000000-0000-4000-8000-000000000011') $$,
  'passing a product_id belonging to another store does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select product_id from public.events where app_version = 'attrib-cross-product'),
  null,
  'a p_product_id belonging to another store stores a null product_id rather than raising'
);

select tests.authenticate_as('vendor_events_a');
select lives_ok(
  $$ select public.log_event('order_confirmed', null, null, 'attrib-order-customer', null, '60000000-0000-4000-8000-000000000030') $$,
  'passing an order_id from the resolved store does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select customer_id from public.events where app_version = 'attrib-order-customer'),
  '60000000-0000-4000-8000-000000000020'::uuid,
  'a p_order_id from the resolved store stores that order''s customer_id'
);
select tests.clear_authentication();

-- ── Boundary (D-04) (4) ────────────────────────────────────────────────────────
select tests.authenticate_as_service_role();
insert into public.events (event_name, store_id, visitor_id, occurred_at)
select 'catalogue_opened', '60000000-0000-4000-8000-000000000001', 'visitor-boundary', now()
from generate_series(1, 59);
select tests.clear_authentication();

select lives_ok(
  $$ select public.log_event('catalogue_opened', 'events-shop-a', 'visitor-boundary') $$,
  'the 60th log_event call for one actor inside the rolling minute does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.events where visitor_id = 'visitor-boundary'),
  60,
  'the 60th call is recorded — total rows for the actor is 60'
);
select tests.clear_authentication();

select lives_ok(
  $$ select public.log_event('catalogue_opened', 'events-shop-a', 'visitor-boundary') $$,
  'the 61st log_event call for the same actor inside the rolling minute does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.events where visitor_id = 'visitor-boundary'),
  60,
  'the 61st call is silently dropped — total rows for the actor stays at 60'
);
select tests.clear_authentication();

-- ── Survival past deletion (D-07) (4) ───────────────────────────────────────
select tests.authenticate_as('vendor_events_a');
select lives_ok(
  $$ select public.log_event('product_viewed', null, null, 'survival-test', '60000000-0000-4000-8000-000000000010') $$,
  'logging an event carrying a product id does not raise'
);
select tests.authenticate_as_service_role();
delete from public.products where id = '60000000-0000-4000-8000-000000000010';
select is(
  (select count(*)::int from public.events where app_version = 'survival-test'),
  1,
  'the event row still exists after the referenced product is deleted (D-07)'
);
select is(
  (select product_id from public.events where app_version = 'survival-test'),
  '60000000-0000-4000-8000-000000000010'::uuid,
  'the event row still carries the same product_id value after deletion — no FK erases it (D-07)'
);
select is(
  (select props ->> 'product_name' from public.events where app_version = 'survival-test'),
  'Events Product A1',
  'the event row still carries the product-name snapshot after deletion (D-07)'
);
select tests.clear_authentication();

-- ── Last-active refresh (D-11) (6) ──────────────────────────────────────────
select tests.authenticate_as('vendor_events_b');
select lives_ok(
  $$ select public.log_event('offer_created') $$,
  'a meaningful-action event does not raise'
);
select tests.authenticate_as_service_role();
select isnt(
  (select last_active_at from public.stores where id = '60000000-0000-4000-8000-000000000002'),
  null,
  'a meaningful-action event updates the store''s last_active_at (D-11)'
);
select tests.clear_authentication();

-- Reset the precondition explicitly: earlier allow-list sample calls in this
-- file already used D-11 meaningful-action names against store A (by design,
-- to exercise a diverse sample), so last_active_at may already be non-null.
-- This test must prove the trigger's negative case regardless of that
-- history, not rely on store A never having been touched.
select tests.authenticate_as_service_role();
update public.stores set last_active_at = null where id = '60000000-0000-4000-8000-000000000001';
select tests.clear_authentication();

select tests.authenticate_as('vendor_events_a');
select lives_ok(
  $$ select public.log_event('product_viewed') $$,
  'a non-meaningful-action event does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select last_active_at from public.stores where id = '60000000-0000-4000-8000-000000000001'),
  null,
  'a non-meaningful-action event (product_viewed) leaves the store''s last_active_at unchanged (D-11)'
);
select tests.clear_authentication();

select tests.authenticate_as('vendor_events_a');
select lives_ok(
  $$ select public.log_event('order_confirmed', null, null, null, null, '60000000-0000-4000-8000-000000000030') $$,
  'an event resolving to a customer does not raise'
);
select tests.authenticate_as_service_role();
select isnt(
  (select last_active_at from public.customers where id = '60000000-0000-4000-8000-000000000020'),
  null,
  'an event resolving to a customer updates that customer''s last_active_at (D-11)'
);

select * from finish();

rollback;
