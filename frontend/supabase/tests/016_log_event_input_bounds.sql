-- pgTAP: the three Phase 01.1 code-review fixes (01.1-REVIEW.md WR-01/02/03),
-- shipped by migration 20260923001300_log_event_input_bounds.sql.
--
-- WR-01 a cross-store offer id resolves to null instead of being recorded
-- WR-02 over-long text/jsonb inputs are discarded, never raised on, and the
--       event itself is still recorded (analytics never errors at a caller)
-- WR-03 a catalogue_shares row may not name another store's product
--
-- Fixture convention matches 013_events_and_log_event.sql: fixtures as
-- postgres, anon-shaped calls via tests.clear_authentication(), reads that
-- must bypass RLS via tests.authenticate_as_service_role().

begin;

select plan(9);

select tests.create_supabase_user('vendor_bounds_a', 'vendor_bounds_a@test.local');
select tests.create_supabase_user('vendor_bounds_b', 'vendor_bounds_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('61000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_bounds_a'),
    '9800000201', 'Bounds Shop A', 'Vendor Bounds A', 'bounds-shop-a', array['Vegetables'], true),
  ('61000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_bounds_b'),
    '9800000202', 'Bounds Shop B', 'Vendor Bounds B', 'bounds-shop-b', array['Vegetables'], true);

insert into public.products (id, store_id, name, unit, available) values
  ('61000000-0000-4000-8000-000000000010', '61000000-0000-4000-8000-000000000001', 'Bounds Product A1', 'kg', true),
  ('61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000002', 'Bounds Product B1', 'kg', true);

insert into public.offers (id, store_id, product_id, today_price_label, offer_date) values
  ('61000000-0000-4000-8000-000000000020', '61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000011', '₹40/kg', public.today_ist());

-- ── WR-01: a cross-store offer id is dropped, not stored (2) ───────────────
select tests.clear_authentication();
select public.log_event(
  'catalogue_opened',
  'bounds-shop-a',
  'bounds-visitor-1',
  '0.1.0-beta',
  null,
  null,
  '61000000-0000-4000-8000-000000000020'  -- store B's offer, called against store A
);

select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.events
    where visitor_id = 'bounds-visitor-1'),
  1,
  'WR-01: the event is still recorded when a foreign offer id is supplied'
);
select is(
  (select offer_id from public.events where visitor_id = 'bounds-visitor-1'),
  null,
  'WR-01: a cross-store offer id resolves to null rather than being stored'
);

-- ── WR-02: over-long inputs are discarded, the event still lands (5) ───────
select tests.clear_authentication();
select public.log_event(
  'catalogue_opened',
  'bounds-shop-a',
  'bounds-visitor-2',
  repeat('v', 200),                                   -- over-long app version
  null, null, null,
  jsonb_build_object('blob', repeat('x', 5000))       -- over-large props
);

select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.events where visitor_id = 'bounds-visitor-2'),
  1,
  'WR-02: an event with over-long inputs is still recorded (analytics never errors)'
);
select is(
  (select app_version from public.events where visitor_id = 'bounds-visitor-2'),
  null,
  'WR-02: an over-long app_version is discarded rather than truncated to a misleading string'
);
select ok(
  (select not (props ? 'blob') from public.events where visitor_id = 'bounds-visitor-2'),
  'WR-02: over-large props are dropped'
);
select is(
  (select props ->> 'store_name' from public.events where visitor_id = 'bounds-visitor-2'),
  'Bounds Shop A',
  'WR-02: the server-resolved name snapshot still lands after props are dropped'
);

select tests.clear_authentication();
select lives_ok(
  $$ select public.log_event('catalogue_opened', 'bounds-shop-a', repeat('z', 500), null) $$,
  'WR-02: an over-long visitor id never raises at the caller'
);

-- ── WR-03: a share cannot name another store's product (2) ────────────────
select tests.authenticate_as('vendor_bounds_a');
select throws_ok(
  $$ insert into public.catalogue_shares (store_id, product_id, share_type, destination)
     values ('61000000-0000-4000-8000-000000000001',
             '61000000-0000-4000-8000-000000000011', 'product', 'whatsapp') $$,
  '23514',
  null,
  'WR-03: sharing another store''s product violates the check constraint'
);
select lives_ok(
  $$ insert into public.catalogue_shares (store_id, product_id, share_type, destination)
     values ('61000000-0000-4000-8000-000000000001',
             '61000000-0000-4000-8000-000000000010', 'product', 'whatsapp') $$,
  'WR-03: sharing the vendor''s own product is still accepted'
);

select * from finish();
rollback;
