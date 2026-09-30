-- pgTAP: public.place_order (PLAT-06) — every rejection rule, boundary, encoding
-- rule, offer-price snapshot behavior and the sequential rate limit from this
-- plan's <behavior> list. The true concurrent rate-limit race is proven
-- separately in tests/db/place-order.test.mjs (pgTAP cannot fire true parallel
-- calls within one transaction).
--
-- Fixtures are built as postgres (bypasses RLS). Every place_order call runs as
-- anon (tests.clear_authentication()). Stored-row verification runs as
-- service_role (tests.authenticate_as_service_role(), also bypasses RLS) so
-- checks never depend on RLS policies, which are out of scope for this file.

begin;

select plan(55);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────────
select tests.create_supabase_user('vendor_place_a', 'vendor_place_a@test.local');
select tests.create_supabase_user('vendor_place_b', 'vendor_place_b@test.local');
select tests.create_supabase_user('vendor_place_c', 'vendor_place_c@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('20000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_place_a'),
    '9600000001', 'Place Test Shop A', 'Vendor A', 'place-test-shop-a', array['Vegetables'], true),
  ('20000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_place_b'),
    '9600000002', 'Place Test Shop B', 'Vendor B', 'place-test-shop-b', array['Vegetables'], true),
  ('20000000-0000-4000-8000-000000000003', tests.get_supabase_uid('vendor_place_c'),
    '9600000003', 'Place Test Shop C', 'Vendor C', 'place-test-shop-c', array['Vegetables'], false);

-- P1: available, has a today offer AND a yesterday offer (proves only today counts).
-- P2: unavailable. P3: available, no offers at all (proves price null with no offer).
-- P4: available, only a yesterday offer (proves a stale offer is never snapshotted).
insert into public.products (id, store_id, name, unit, available) values
  ('20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'Place Product 1', 'kg', true),
  ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'Place Product 2 (unavailable)', 'kg', false),
  ('20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'Place Product 3 (no offers)', 'kg', true),
  ('20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'Place Product 4 (yesterday offer only)', 'kg', true),
  ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000002', 'Place Product B1', 'kg', true),
  ('20000000-0000-4000-8000-000000000030', '20000000-0000-4000-8000-000000000003', 'Place Product C1', 'kg', true);

insert into public.offers (id, store_id, product_id, today_price_label, regular_price_label, offer_date) values
  ('20000000-0000-4000-8000-000000000040', '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000010', '₹40/kg', '₹50/kg', public.today_ist()),
  ('20000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000010', '₹35/kg', '₹50/kg', public.today_ist() - 1),
  ('20000000-0000-4000-8000-000000000042', '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000013', '₹20/kg', '₹25/kg', public.today_ist() - 1);

-- ── anon ──────────────────────────────────────────────────────────────────
select tests.clear_authentication();

-- 1-2. qty boundaries: 1 and 99 accepted
select isnt(
  public.place_order('place-test-shop-a', 'Order Qty1', '9000000001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'qty=1 is accepted'
);
select isnt(
  public.place_order('place-test-shop-a', 'Order Qty99', '9000000002', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":99}]'::jsonb),
  null, 'qty=99 is accepted'
);

-- 3-5. qty boundaries: 0, 100, -1 rejected invalid_qty
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Qty0', '9000000003', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":0}]'::jsonb) $$,
  'P0001', 'invalid_qty', 'qty=0 is rejected invalid_qty'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Qty100', '9000000004', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":100}]'::jsonb) $$,
  'P0001', 'invalid_qty', 'qty=100 is rejected invalid_qty'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order QtyNeg', '9000000005', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":-1}]'::jsonb) $$,
  'P0001', 'invalid_qty', 'qty=-1 is rejected invalid_qty'
);

-- 6-8. name boundaries: 'ab' (2 chars) accepted, 'a' and ' a ' (trims to 1) rejected
select isnt(
  public.place_order('place-test-shop-a', 'ab', '9000000006', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'name ''ab'' (2 chars) is accepted'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'a', '9000000007', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'P0001', 'invalid_name', 'name ''a'' is rejected invalid_name'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', ' a ', '9000000008', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'P0001', 'invalid_name', 'name '' a '' trims to 1 char, rejected invalid_name'
);

-- 9-12. phone boundaries: 6 and 15 digits accepted, 5 and 16 rejected invalid_phone
select isnt(
  public.place_order('place-test-shop-a', 'Order Phone6', repeat('9', 6), null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'phone with 6 digits is accepted'
);
select isnt(
  public.place_order('place-test-shop-a', 'Order Phone15', repeat('9', 15), null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'phone with 15 digits is accepted'
);
select throws_ok(
  format($$ select public.place_order('place-test-shop-a', 'Order Phone5', %L, null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$, repeat('9', 5)),
  'P0001', 'invalid_phone', 'phone with 5 digits is rejected invalid_phone'
);
select throws_ok(
  format($$ select public.place_order('place-test-shop-a', 'Order Phone16', %L, null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$, repeat('9', 16)),
  'P0001', 'invalid_phone', 'phone with 16 digits is rejected invalid_phone'
);

-- 13-14. note boundaries: 500 chars accepted, 501 rejected invalid_note
select isnt(
  public.place_order('place-test-shop-a', 'Order Note500', '9000000009', repeat('a', 500),
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'note with 500 chars is accepted'
);
select throws_ok(
  format($$ select public.place_order('place-test-shop-a', 'Order Note501', '9000000010', %L,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$, repeat('a', 501)),
  'P0001', 'invalid_note', 'note with 501 chars is rejected invalid_note'
);

-- 15-18. empty/malformed items: null, [], {}, a bare string — all invalid_items
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Null', '9000000011', null, null) $$,
  'P0001', 'invalid_items', 'p_items null is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Empty', '9000000012', null, '[]'::jsonb) $$,
  'P0001', 'invalid_items', 'p_items [] is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Obj', '9000000013', null, '{}'::jsonb) $$,
  'P0001', 'invalid_items', 'p_items {} is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Str', '9000000014', null, '"x"'::jsonb) $$,
  'P0001', 'invalid_items', 'p_items a bare string is rejected invalid_items'
);

-- 19. p_name null is rejected invalid_name
select throws_ok(
  $$ select public.place_order('place-test-shop-a', null, '9000000015', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'P0001', 'invalid_name', 'p_name null is rejected invalid_name'
);

-- 20-22. p_note null / '' / '   ' are all accepted and stored as null
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Note Null', '9000000016', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'p_note null is accepted'
);
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Note Empty', '9000000017', '',
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'p_note '''' is accepted'
);
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Note Blank', '9000000018', '   ',
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'p_note ''   '' (whitespace-only) is accepted'
);

select tests.authenticate_as_service_role();
select is(
  (select note from public.orders where customer_phone = '9000000016'), null,
  'p_note null is stored as null'
);
select is(
  (select note from public.orders where customer_phone = '9000000017'), null,
  'p_note '''' is stored as null'
);
select is(
  (select note from public.orders where customer_phone = '9000000018'), null,
  'p_note ''   '' is stored as null'
);
select tests.clear_authentication();

-- 23-26. items shape: non-UUID, duplicate product_id, 51 items, missing qty key
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Bad Id', '9000000019', null,
    '[{"product_id":"not-a-uuid","qty":1}]'::jsonb) $$,
  'P0001', 'invalid_items', 'a non-UUID product_id is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items Dup', '9000000020', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1},
      {"product_id":"20000000-0000-4000-8000-000000000010","qty":2}]'::jsonb) $$,
  'P0001', 'invalid_items', 'a duplicate product_id is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items 51', '9000000021', null,
    (select jsonb_agg(jsonb_build_object('product_id', gen_random_uuid()::text, 'qty', 1))
       from generate_series(1, 51))) $$,
  'P0001', 'invalid_items', '51 items is rejected invalid_items'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Items No Qty', '9000000022', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010"}]'::jsonb) $$,
  'P0001', 'invalid_items', 'a missing qty key is rejected invalid_items'
);

-- 27-28. qty shape: 1.5 and the string "2" are rejected invalid_qty
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Qty Decimal', '9000000023', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1.5}]'::jsonb) $$,
  'P0001', 'invalid_qty', 'qty=1.5 is rejected invalid_qty'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Qty String', '9000000024', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":"2"}]'::jsonb) $$,
  'P0001', 'invalid_qty', 'qty="2" (a JSON string) is rejected invalid_qty'
);

-- 29-30. store: unknown slug store_not_found, closed store store_closed
select throws_ok(
  $$ select public.place_order('no-such-shop', 'Order Store', '9000000025', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'P0001', 'store_not_found', 'an unknown slug is rejected store_not_found'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-c', 'Order Store', '9000000026', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000030","qty":1}]'::jsonb) $$,
  'P0001', 'store_closed', 'a closed store is rejected store_closed'
);

-- 31-33. items: unavailable product, another store's product, and a random UUID
-- are all rejected with the single item_unavailable code
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Unavail', '9000000027', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000011","qty":1}]'::jsonb) $$,
  'P0001', 'item_unavailable', 'an unavailable product is rejected item_unavailable'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Cross Store', '9000000028', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000020","qty":1}]'::jsonb) $$,
  'P0001', 'item_unavailable', 'another store''s product is rejected item_unavailable'
);
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Unknown Product', '9000000029', null,
    '[{"product_id":"99999999-9999-4999-8999-999999999999","qty":1}]'::jsonb) $$,
  'P0001', 'item_unavailable', 'an unknown product id is rejected item_unavailable'
);

-- 34. snapshot: today's offer price copied verbatim; client-supplied price/name
-- on the item are ignored (server-derived only, T-02-01)
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Snapshot Today', '9000000030', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":3,"price":"₹999/kg","name":"Hacked Name"}]'::jsonb) $$,
  'an order against a product with a today offer is accepted (extra keys ignored)'
);
select tests.authenticate_as_service_role();
select is(
  (select oi.price from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.customer_phone = '9000000030'),
  '₹40/kg', 'today''s offer price_label is copied verbatim, not the client-supplied price'
);
select is(
  (select oi.product_name from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.customer_phone = '9000000030'),
  'Place Product 1', 'product_name is the server''s current name, not the client-supplied name'
);
select tests.clear_authentication();

-- 35. snapshot: a yesterday-only offer is never snapshotted (price null)
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Snapshot Yesterday', '9000000031', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000013","qty":1}]'::jsonb) $$,
  'an order against a product with only a yesterday offer is accepted'
);
select tests.authenticate_as_service_role();
select is(
  (select oi.price from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.customer_phone = '9000000031'),
  null, 'a yesterday-only offer is never snapshotted; price is null'
);
select tests.clear_authentication();

-- 36. snapshot: a product with no offer at all also gets a null price
select lives_ok(
  $$ select public.place_order('place-test-shop-a', 'Order Snapshot None', '9000000032', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000012","qty":1}]'::jsonb) $$,
  'an order against a product with no offer at all is accepted'
);
select tests.authenticate_as_service_role();
select is(
  (select oi.price from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.customer_phone = '9000000032'),
  null, 'a product with no offer at all has a null price'
);
select tests.clear_authentication();

-- 37. anon cannot insert directly into public.orders (place_order is the only
-- public write path)
select throws_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone)
     values ('20000000-0000-4000-8000-000000000001', 'Direct Insert', '9000000033') $$,
  '42501', null, 'anon direct insert into public.orders fails 42501'
);

-- 38. encoding: name length is counted in code points, not bytes — two
-- multi-byte characters meet the 2-char minimum
select isnt(
  public.place_order('place-test-shop-a', 'അആ', '9000000034', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'a 2-code-point multi-byte name meets the 2-char minimum'
);

-- 39-43. encoding + rate limit: five different phone formats for the same
-- underlying number all succeed and share one rate-limit bucket
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order 1', '9876500001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'rate-limit order 1 of 5 (plain digits) succeeds'
);
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order 2', '98765 00001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'rate-limit order 2 of 5 (spaces) succeeds'
);
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order 3', '98765-00001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'rate-limit order 3 of 5 (dashes) succeeds'
);
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order 4', '(98765) 00001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'rate-limit order 4 of 5 (parens) succeeds'
);
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order 5', '98765.00001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'rate-limit order 5 of 5 (dots) succeeds'
);

-- 44. the 6th order from the same phone within the hour is rejected
select throws_ok(
  $$ select public.place_order('place-test-shop-a', 'Rate Order 6', '9876500001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb) $$,
  'P0001', 'rate_limited', 'the 6th order from the same phone within the hour is rejected rate_limited'
);

-- 45. all 5 accepted format variants normalized to the exact same digits-only
-- phone and share one rate-limit bucket (proves the encoding rule end to end)
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.orders
     where store_id = '20000000-0000-4000-8000-000000000001' and customer_phone = '9876500001'),
  5, 'all 5 phone formats normalized to one digits-only value sharing one rate-limit bucket'
);
select tests.clear_authentication();

-- 46. the same phone at ANOTHER store still succeeds (rate limit is per-store)
select isnt(
  public.place_order('place-test-shop-b', 'Rate Order Other Store', '9876500001', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000020","qty":1}]'::jsonb),
  null, 'the same phone at another store still succeeds'
);

-- 47. a different phone at the same store still succeeds
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order Diff Phone', '9000000035', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'a different phone at the same store still succeeds'
);

-- 48. orders older than 60 minutes do not count toward the rate limit
select tests.authenticate_as_service_role();
insert into public.orders (store_id, customer_name, customer_phone, created_at)
select '20000000-0000-4000-8000-000000000001', 'Backdated ' || g, '9000000036', now() - interval '61 minutes'
from generate_series(1, 5) as g;
select tests.clear_authentication();
select isnt(
  public.place_order('place-test-shop-a', 'Rate Order After Backdated', '9000000036', null,
    '[{"product_id":"20000000-0000-4000-8000-000000000010","qty":1}]'::jsonb),
  null, 'five orders backdated 61 minutes do not count toward the rate limit'
);

select * from finish();

rollback;
