-- pgTAP: the day boundary WITH the products join applied, the NOT NULL
-- display label rejection, the generated difference column rejection, and
-- the one-per-product-per-day replace (05-01, criterion 4's database half).
-- Fixtures are built as postgres (bypasses RLS), own fixture prefix
-- (19000000-…), distinct from every other file's.
--
-- This file does NOT re-prove what 010_public_read_surface.sql and
-- 011_offers_price_model.sql already carry: 010 already proves the
-- anonymous date boundary for the UN-joined table (yesterday/today/tomorrow,
-- lines 39-47/83-88), and 011 already proves the generated starts_at column
-- rejects a direct write and that a bare same-day insert is rejected without
-- a products join in the picture. The new cases below are the ones neither
-- file carries: the boundary WITH the products join applied (the shape the
-- application's own read query uses), the availability half of that same
-- join (D-03 at the level a join can prove), and the upsert-shape statement
-- resolving a conflict instead of erroring.
--
-- Falsifiability requirement (recorded, not automated here, same convention
-- 018_categories_upsert.sql's header establishes): the "conflict-resolving
-- statement resolves to the SAME row" assertion below was run once with its
-- own `on conflict` clause removed, which raised an uncaught unique_violation
-- (23505) and aborted the run rather than resolving — confirming the
-- create-or-replace claim is real and not a tautology — then the clause was
-- restored and the file passed green again. See the plan's SUMMARY for the
-- observed output.

begin;

select plan(8);

-- ── Fixture (as postgres, bypasses RLS) ─────────────────────────────────────
select tests.create_supabase_user('vendor_offer_boundary', 'vendor_offer_boundary@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open)
values (
  '19000000-0000-4000-8000-000000000001',
  tests.get_supabase_uid('vendor_offer_boundary'),
  '9700000001', 'Offer Boundary Shop', 'Vendor Offer Boundary', 'offer-boundary-shop', array['Vegetables'], true
);

insert into public.products (id, store_id, name, unit, available) values
  ('19000000-0000-4000-8000-000000000010', '19000000-0000-4000-8000-000000000001', 'Boundary Product Available', 'kg', true),
  ('19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000001', 'Boundary Product Unavailable', 'kg', false);

-- ── The day boundary, WITH the products join applied ────────────────────────
-- Yesterday / today / tomorrow, all on the AVAILABLE product — the shape the
-- application's own vendor read (use-offers.ts) actually queries with.
insert into public.offers (id, store_id, product_id, today_price_label, offer_date) values
  ('19000000-0000-4000-8000-000000000030', '19000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000010', '₹1/kg', public.today_ist() - 1),
  ('19000000-0000-4000-8000-000000000031', '19000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000010', '₹1/kg', public.today_ist()),
  ('19000000-0000-4000-8000-000000000032', '19000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000010', '₹1/kg', public.today_ist() + 1);

select is(
  (
    select array_agg(o.id order by o.id)
    from public.offers o
    join public.products p on p.id = o.product_id and p.available
    where o.store_id = '19000000-0000-4000-8000-000000000001'
      and o.offer_date = public.today_ist()
  ),
  array['19000000-0000-4000-8000-000000000031'::uuid],
  'the day boundary with the products join applied returns exactly the one offer dated today_ist()'
);

-- Move that same today-dated offer onto the UNAVAILABLE product: the
-- database's own statement of D-03 at the level a join can prove — a plain
-- offer_date match is no longer enough once the joined product fails
-- availability.
update public.offers set product_id = '19000000-0000-4000-8000-000000000011'
  where id = '19000000-0000-4000-8000-000000000031';

select is(
  (
    select array_agg(o.id order by o.id)
    from public.offers o
    join public.products p on p.id = o.product_id and p.available
    where o.store_id = '19000000-0000-4000-8000-000000000001'
      and o.offer_date = public.today_ist()
  ),
  null,
  'moving the same today-dated offer onto the unavailable product excludes it from the joined query entirely (D-03)'
);

-- ── The NOT NULL display label rejects an insert that omits it ─────────────
select throws_ok(
  $$ insert into public.offers (store_id, product_id, offer_date) values
    ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000010',
      public.today_ist() + 50) $$,
  '23502', null,
  'omitting the NOT NULL today_price_label rejects the insert (D-06 corrected)'
);

-- ── The generated difference column rejects a direct write ─────────────────
-- The twin of 011_offers_price_model.sql's own starts_at assertion, added
-- here because this phase's write path is the first one that could ever
-- pass `saving` by accident.
select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_date, saving) values
    ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000010', '₹1/kg',
      public.today_ist() + 51, 5) $$,
  '428C9', null,
  'writing directly to the generated saving column is rejected'
);

-- ── Create-or-replace: a plain second insert is rejected, the upsert-shape
--    statement supabase-js generates resolves to the SAME row instead ──────
insert into public.offers (id, store_id, product_id, today_price_label, offer_price, offer_date) values
  ('19000000-0000-4000-8000-000000000040', '19000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000010', '₹10/kg', 10, public.today_ist() + 60);

select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, offer_date) values
    ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000010', '₹99/kg', 99,
      (select public.today_ist() + 60)) $$,
  '23505', null,
  'a second plain insert for the same (product_id, offer_date), with no conflict clause, is rejected'
);

select lives_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, offer_date) values
    ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000010', '₹99/kg', 99,
      (select public.today_ist() + 60))
    on conflict (product_id, offer_date) do update set
      today_price_label = excluded.today_price_label,
      offer_price = excluded.offer_price $$,
  'the upsert-shape statement supabase-js''s .upsert({...}, { onConflict }) generates resolves the conflict instead of erroring'
);

select is(
  (select id from public.offers
    where product_id = '19000000-0000-4000-8000-000000000010' and offer_date = public.today_ist() + 60),
  '19000000-0000-4000-8000-000000000040'::uuid,
  'the upsert resolved to the SAME row id — a replace, never a second row'
);
select is(
  (select offer_price from public.offers where id = '19000000-0000-4000-8000-000000000040'),
  99::numeric,
  'the upsert updated the existing row''s price to the new value'
);

select * from finish();

rollback;
