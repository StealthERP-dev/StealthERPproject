-- pgTAP: owner-only access to stores/categories/products/offers/orders/order_items
-- and cross-vendor write denial (PLAT-04 vendor side, D-06 — owning vendor vs a
-- different vendor). Fixtures are built as postgres (bypasses RLS).
--
-- RLS UPDATE/DELETE against rows the caller cannot see affect 0 rows without
-- raising (research correction: RESEARCH.md's skeleton used throws_ok for a
-- cross-vendor update) — those cases are asserted via a returning-count CTE,
-- then the target row's data is re-checked unchanged. Only INSERT and
-- with-check violations raise 42501, and the second-store insert raises 23505.

begin;

select plan(45);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────────
select tests.create_supabase_user('vendor_iso_a', 'vendor_iso_a@test.local');
select tests.create_supabase_user('vendor_iso_b', 'vendor_iso_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('30000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_iso_a'),
    '9700000001', 'Iso Shop A', 'Vendor Iso A', 'iso-shop-a', array['Vegetables'], true),
  ('30000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_iso_b'),
    '9700000002', 'Iso Shop B', 'Vendor Iso B', 'iso-shop-b', array['Vegetables'], true);

insert into public.categories (id, store_id, name) values
  ('30000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001', 'Iso Category A'),
  ('30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000002', 'Iso Category B');

insert into public.products (id, store_id, name, category_id, unit, available) values
  ('30000000-0000-4000-8000-000000000020', '30000000-0000-4000-8000-000000000001',
    'Iso Product A (available)', '30000000-0000-4000-8000-000000000010', 'kg', true),
  ('30000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000001',
    'Iso Product A (unavailable)', null, 'kg', false),
  ('30000000-0000-4000-8000-000000000022', '30000000-0000-4000-8000-000000000002',
    'Iso Product B (available)', '30000000-0000-4000-8000-000000000011', 'kg', true),
  ('30000000-0000-4000-8000-000000000023', '30000000-0000-4000-8000-000000000002',
    'Iso Product B (unavailable)', null, 'kg', false);

insert into public.offers (id, store_id, product_id, today_price_label, regular_price_label, offer_date) values
  ('30000000-0000-4000-8000-000000000030', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000020', '₹10/kg', '₹15/kg', public.today_ist()),
  ('30000000-0000-4000-8000-000000000031', '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000022', '₹20/kg', '₹25/kg', public.today_ist());

insert into public.orders (id, store_id, customer_name, customer_phone) values
  ('30000000-0000-4000-8000-000000000040', '30000000-0000-4000-8000-000000000001', 'Iso Customer A', '9600000001'),
  ('30000000-0000-4000-8000-000000000041', '30000000-0000-4000-8000-000000000002', 'Iso Customer B', '9600000002');

-- ORDR-03's own fixture: two more unseen orders per store (is_new defaults
-- true), added here rather than reusing 040/041 above, so the mark-seen
-- bulk-clear test below can observe a genuine multi-row clear without
-- disturbing any assertion already written against 040/041's specific
-- is_new value elsewhere in this file.
insert into public.orders (id, store_id, customer_name, customer_phone, is_new) values
  ('30000000-0000-4000-8000-000000000060', '30000000-0000-4000-8000-000000000001', 'Iso Customer A2', '9600000060', true),
  ('30000000-0000-4000-8000-000000000061', '30000000-0000-4000-8000-000000000001', 'Iso Customer A3', '9600000061', true),
  ('30000000-0000-4000-8000-000000000062', '30000000-0000-4000-8000-000000000002', 'Iso Customer B2', '9600000062', true),
  ('30000000-0000-4000-8000-000000000063', '30000000-0000-4000-8000-000000000002', 'Iso Customer B3', '9600000063', true);

insert into public.order_items (id, order_id, product_id, product_name, qty) values
  ('30000000-0000-4000-8000-000000000050', '30000000-0000-4000-8000-000000000040',
    '30000000-0000-4000-8000-000000000020', 'Iso Product A (available)', 1),
  ('30000000-0000-4000-8000-000000000051', '30000000-0000-4000-8000-000000000041',
    '30000000-0000-4000-8000-000000000022', 'Iso Product B (available)', 1);

-- ── As vendor A ──────────────────────────────────────────────────────────────
select tests.authenticate_as('vendor_iso_a');

-- 1. A sees exactly its own stores row (phone visible)
select is(
  (select array_agg(id order by id) from public.stores),
  array['30000000-0000-4000-8000-000000000001'::uuid],
  'A sees exactly its own stores row'
);
select is(
  (select phone from public.stores where id = '30000000-0000-4000-8000-000000000001'),
  '9700000001',
  'A sees its own store phone'
);

-- 2. A never sees B's stores row
select is(
  (select count(*)::int from public.stores where id = '30000000-0000-4000-8000-000000000002'),
  0,
  'A cannot see B''s stores row'
);

-- 3. A sees B's available product (public read) but not B's unavailable product
select is(
  (select count(*)::int from public.products
    where id = '30000000-0000-4000-8000-000000000022'),
  1,
  'A sees B''s available product via the public read policy'
);
select is(
  (select count(*)::int from public.products
    where id = '30000000-0000-4000-8000-000000000023'),
  0,
  'A does not see B''s unavailable product'
);

-- 4. A sees B's today offer and B's category (both public read)
select is(
  (select count(*)::int from public.offers where id = '30000000-0000-4000-8000-000000000031'),
  1,
  'A sees B''s today offer via the public read policy'
);
select is(
  (select count(*)::int from public.categories where id = '30000000-0000-4000-8000-000000000011'),
  1,
  'A sees B''s category via the public read policy'
);

-- 5. A does not see B's orders or order_items
select is(
  (select count(*)::int from public.orders where store_id = '30000000-0000-4000-8000-000000000002'),
  0,
  'A cannot see B''s orders'
);
select is(
  (select count(*)::int from public.order_items where id = '30000000-0000-4000-8000-000000000051'),
  0,
  'A cannot see B''s order_items'
);

-- 6. A inserting a product/offer/category into B's store fails 42501
select throws_ok(
  $$ insert into public.products (store_id, name) values
    ('30000000-0000-4000-8000-000000000002', 'A Malicious Product') $$,
  '42501', null, 'A inserting a product with store_id = B fails 42501'
);
select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label) values
    ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000022', '₹1/kg') $$,
  '42501', null, 'A inserting an offer with store_id = B fails 42501'
);
select throws_ok(
  $$ insert into public.categories (store_id, name) values
    ('30000000-0000-4000-8000-000000000002', 'A Malicious Category') $$,
  '42501', null, 'A inserting a category with store_id = B fails 42501'
);

-- 7. A attaching B's category to its own product fails 42501
select throws_ok(
  $$ insert into public.products (store_id, name, category_id) values
    ('30000000-0000-4000-8000-000000000001', 'A Cross-Category Product',
     '30000000-0000-4000-8000-000000000011') $$,
  '42501', null, 'A attaching B''s category to its own product fails 42501'
);

-- 8. A creating an offer on B's product fails 42501
select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label) values
    ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000022', '₹1/kg') $$,
  '42501', null, 'A creating an offer on B''s product fails 42501'
);

-- 9. A's update/delete aimed at B's rows affect 0 rows; B's data stays unchanged
-- (each WITH-with-a-data-modifying-statement must be the top-level statement —
-- pgTAP's is() cannot wrap it as a subquery argument.)
with x as (
  update public.stores set shop_name = 'A Hacked B''s Shop'
  where id = '30000000-0000-4000-8000-000000000002' returning 1
)
select is((select count(*)::int from x), 0, 'A''s update of B''s store affects 0 rows');

with x as (
  delete from public.stores where id = '30000000-0000-4000-8000-000000000002' returning 1
)
select is((select count(*)::int from x), 0, 'A''s delete of B''s store affects 0 rows');

with x as (
  update public.products set name = 'A Hacked'
  where id = '30000000-0000-4000-8000-000000000022' returning 1
)
select is((select count(*)::int from x), 0, 'A''s update of B''s product affects 0 rows');

with x as (
  delete from public.products where id = '30000000-0000-4000-8000-000000000022' returning 1
)
select is((select count(*)::int from x), 0, 'A''s delete of B''s product affects 0 rows');

with x as (
  update public.offers set today_price_label = '₹1/kg'
  where id = '30000000-0000-4000-8000-000000000031' returning 1
)
select is((select count(*)::int from x), 0, 'A''s update of B''s offer affects 0 rows');

with x as (
  delete from public.offers where id = '30000000-0000-4000-8000-000000000031' returning 1
)
select is((select count(*)::int from x), 0, 'A''s delete of B''s offer affects 0 rows');

with x as (
  update public.categories set name = 'A Hacked'
  where id = '30000000-0000-4000-8000-000000000011' returning 1
)
select is((select count(*)::int from x), 0, 'A''s update of B''s category affects 0 rows');

with x as (
  delete from public.categories where id = '30000000-0000-4000-8000-000000000011' returning 1
)
select is((select count(*)::int from x), 0, 'A''s delete of B''s category affects 0 rows');

with x as (
  update public.orders set is_new = false
  where id = '30000000-0000-4000-8000-000000000041' returning 1
)
select is((select count(*)::int from x), 0, 'A''s update of B''s order affects 0 rows');

-- 10. A updating its own store owner_id to B fails 42501
select throws_ok(
  $$ update public.stores set owner_id = tests.get_supabase_uid('vendor_iso_b')
     where id = '30000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'A updating its own store owner_id to B fails 42501'
);

-- 11. A inserting a second store fails 23505 (owner_id unique)
select throws_ok(
  $$ insert into public.stores (owner_id, phone, shop_name, vendor_name, slug)
     values (tests.get_supabase_uid('vendor_iso_a'), '9700099999', 'Second Shop', 'Vendor Iso A', 'iso-shop-a-2') $$,
  '23505', null, 'A inserting a second store fails 23505'
);

-- 12. Direct insert into orders/order_items fails 42501 for authenticated (A)
select throws_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone) values
    ('30000000-0000-4000-8000-000000000001', 'Direct Insert', '9000000099') $$,
  '42501', null, 'A''s direct insert into orders fails 42501'
);
select throws_ok(
  $$ insert into public.order_items (order_id, product_name, qty) values
    ('30000000-0000-4000-8000-000000000040', 'Direct Insert Item', 1) $$,
  '42501', null, 'A''s direct insert into order_items fails 42501'
);

-- 13. A can update is_new on its own order
with x as (
  update public.orders set is_new = false
  where id = '30000000-0000-4000-8000-000000000040' returning 1
)
select is((select count(*)::int from x), 1, 'A can update is_new on its own order');
select is(
  (select is_new from public.orders where id = '30000000-0000-4000-8000-000000000040'),
  false, 'A''s own order is_new is now false'
);

-- 14. ORDR-03: the mark-seen bulk update's cross-store isolation — the one
-- claim ORDR-03 makes that only this file can prove. A's owner-scoped bulk
-- clear (order 040 is already is_new=false from step 13 above, so only the
-- two fresh, still-unseen orders 060/061 match) affects exactly A's own
-- currently-unseen rows and none of B's.
with x as (
  update public.orders set is_new = false
  where store_id = '30000000-0000-4000-8000-000000000001' and is_new = true
  returning 1
)
select is((select count(*)::int from x), 2, 'mark-seen: A''s owner-scoped bulk clear affects exactly A''s two still-unseen rows (060, 061)');

-- ── Confirm B's data stayed unchanged after every A attempt above (as service_role, bypasses RLS) ──
select tests.authenticate_as_service_role();

select is(
  (select shop_name from public.stores where id = '30000000-0000-4000-8000-000000000002'),
  'Iso Shop B', 'B''s shop_name unchanged after A''s update/delete attempts'
);
select is(
  (select name from public.products where id = '30000000-0000-4000-8000-000000000022'),
  'Iso Product B (available)', 'B''s product name unchanged after A''s update/delete attempts'
);
select is(
  (select today_price_label from public.offers where id = '30000000-0000-4000-8000-000000000031'),
  '₹20/kg', 'B''s offer price unchanged after A''s update/delete attempts'
);
select is(
  (select name from public.categories where id = '30000000-0000-4000-8000-000000000011'),
  'Iso Category B', 'B''s category name unchanged after A''s update attempt'
);
select is(
  (select is_new from public.orders where id = '30000000-0000-4000-8000-000000000041'),
  true, 'B''s order is_new unchanged after A''s update attempt'
);
select is(
  (select owner_id from public.stores where id = '30000000-0000-4000-8000-000000000001'),
  tests.get_supabase_uid('vendor_iso_a'), 'A''s own store owner_id unchanged after the failed self-reassignment'
);

-- mark-seen (continued): B's own still-unseen rows (062, 063) are untouched
-- by A's bulk clear above — the neighbour's orders stay exactly as they were.
select is(
  (select is_new from public.orders where id = '30000000-0000-4000-8000-000000000062'),
  true, 'mark-seen: B''s order 062 is_new is still true — untouched by A''s bulk clear'
);
select is(
  (select is_new from public.orders where id = '30000000-0000-4000-8000-000000000063'),
  true, 'mark-seen: B''s order 063 is_new is still true — untouched by A''s bulk clear'
);

-- ── anon: direct insert into orders/order_items also fails 42501 ────────────
select tests.clear_authentication();

select throws_ok(
  $$ insert into public.orders (store_id, customer_name, customer_phone) values
    ('30000000-0000-4000-8000-000000000001', 'Anon Direct Insert', '9000000098') $$,
  '42501', null, 'anon''s direct insert into orders fails 42501'
);
select throws_ok(
  $$ insert into public.order_items (order_id, product_name, qty) values
    ('30000000-0000-4000-8000-000000000040', 'Anon Direct Insert Item', 1) $$,
  '42501', null, 'anon''s direct insert into order_items fails 42501'
);

-- mark-seen (continued): anon cannot perform the bulk clear at all — this is
-- a grant-level fact, not a policy-level one. anon holds no privilege on
-- public.orders whatsoever (`revoke all on public.orders from anon`).
select throws_ok(
  $$ update public.orders set is_new = false
     where store_id = '30000000-0000-4000-8000-000000000001' and is_new = true $$,
  '42501', null, 'anon cannot perform the mark-seen bulk update at all — anon holds no table privilege on public.orders whatsoever'
);

-- ── Spot-check the symmetric direction as B ─────────────────────────────────
select tests.authenticate_as('vendor_iso_b');

select is(
  (select array_agg(id order by id) from public.stores),
  array['30000000-0000-4000-8000-000000000002'::uuid],
  'B sees exactly its own stores row'
);
select is(
  (select count(*)::int from public.orders where store_id = '30000000-0000-4000-8000-000000000001'),
  0, 'B cannot see A''s orders'
);
select throws_ok(
  $$ insert into public.products (store_id, name) values
    ('30000000-0000-4000-8000-000000000001', 'B Malicious Product') $$,
  '42501', null, 'B inserting a product with store_id = A fails 42501'
);
with x as (
  update public.stores set shop_name = 'B Hacked A''s Shop'
  where id = '30000000-0000-4000-8000-000000000001' returning 1
)
select is((select count(*)::int from x), 0, 'B''s update of A''s store affects 0 rows');

select * from finish();

rollback;
