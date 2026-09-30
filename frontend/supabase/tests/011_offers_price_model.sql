-- pgTAP: public.offers numeric price model — column shapes, the offer_price/
-- regular_price check constraints, exact-decimal saving, the IST-derived
-- half-open starts_at/ends_at window, and the one-offer-per-product-per-day
-- uniqueness guard (DATA-01, closes 01-REVIEW WR-02). Fixtures are built as
-- postgres (bypasses RLS) — this file proves data-model correctness, not RLS
-- (already covered by 010_public_read_surface.sql / 030_vendor_isolation.sql).

begin;

select plan(26);

-- ── Fixture (as postgres) ───────────────────────────────────────────────────
select tests.create_supabase_user('vendor_offer_a', 'vendor_offer_a@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open)
values (
  '40000000-0000-4000-8000-000000000001',
  tests.get_supabase_uid('vendor_offer_a'),
  '9500000001', 'Offer Test Shop', 'Vendor Offer A', 'offer-test-shop', array['Vegetables'], true
);

insert into public.products (id, store_id, name, unit, available) values
  ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000001', 'Offer Product 1', 'kg', true);

-- ── Column shape assertions (D-16 rename + doc §1 numeric model) ────────────

select has_column('public', 'offers', 'today_price_label',
  'offers has the renamed today_price_label column (D-16)');
select has_column('public', 'offers', 'regular_price_label',
  'offers has the renamed regular_price_label column (D-16)');

select has_column('public', 'offers', 'created_at', 'offers has a created_at column (doc §1)');
select col_type_is('public', 'offers', 'created_at', 'timestamp with time zone',
  'offers.created_at is timestamptz');

select has_column('public', 'offers', 'offer_price', 'offers has a numeric offer_price column (doc §1)');
select col_type_is('public', 'offers', 'offer_price', 'numeric', 'offers.offer_price is numeric');

select has_column('public', 'offers', 'regular_price', 'offers has a numeric regular_price column (doc §1)');
select col_type_is('public', 'offers', 'regular_price', 'numeric', 'offers.regular_price is numeric');

select has_column('public', 'offers', 'saving', 'offers has a generated saving column (doc §1)');
select col_type_is('public', 'offers', 'saving', 'numeric', 'offers.saving is numeric');

select has_column('public', 'offers', 'starts_at', 'offers has a generated starts_at column (doc §1)');
select col_type_is('public', 'offers', 'starts_at', 'timestamp with time zone', 'offers.starts_at is timestamptz');

select has_column('public', 'offers', 'ends_at', 'offers has a generated ends_at column (doc §1)');
select col_type_is('public', 'offers', 'ends_at', 'timestamp with time zone', 'offers.ends_at is timestamptz');

-- ── offer_price check: rejects negative, accepts 0 and null ─────────────────

select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg', -0.01,
      public.today_ist() + 100) $$,
  '23514', null, 'offer_price = -0.01 is rejected by the check constraint'
);
select lives_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg', 0,
      public.today_ist() + 101) $$,
  'offer_price = 0 is accepted'
);
select lives_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg', null,
      public.today_ist() + 102) $$,
  'offer_price = null is accepted'
);

-- ── regular_price >= offer_price check ───────────────────────────────────────

select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, regular_price, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg', 40, 39.99,
      public.today_ist() + 103) $$,
  '23514', null, 'regular_price strictly below offer_price is rejected'
);
select lives_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_price, regular_price, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg', 40, 40,
      public.today_ist() + 104) $$,
  'regular_price equal to offer_price is accepted'
);

-- ── saving: exact decimal, null when regular_price is null ──────────────────

insert into public.offers (id, store_id, product_id, today_price_label, offer_price, regular_price, offer_date) values
  ('40000000-0000-4000-8000-000000000030', '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000010', '₹40/kg', 40, 50, public.today_ist() + 105);
select is(
  (select saving from public.offers where id = '40000000-0000-4000-8000-000000000030'),
  10::numeric, 'saving is exactly regular_price - offer_price (50 - 40 = 10, exact decimal)'
);

insert into public.offers (id, store_id, product_id, today_price_label, offer_price, offer_date) values
  ('40000000-0000-4000-8000-000000000031', '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000010', '₹40/kg', 40, public.today_ist() + 106);
select is(
  (select saving from public.offers where id = '40000000-0000-4000-8000-000000000031'),
  null, 'saving is null when regular_price is null, not 0'
);

-- ── starts_at / ends_at: IST midnight of offer_date and offer_date + 1 ──────

insert into public.offers (id, store_id, product_id, today_price_label, offer_date) values
  ('40000000-0000-4000-8000-000000000032', '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000010', '₹1/kg', public.today_ist() + 107);
select is(
  (select starts_at from public.offers where id = '40000000-0000-4000-8000-000000000032'),
  ((public.today_ist() + 107)::timestamp) at time zone 'Asia/Kolkata',
  'starts_at is the IST midnight of offer_date'
);
select is(
  (select ends_at from public.offers where id = '40000000-0000-4000-8000-000000000032'),
  ((public.today_ist() + 108)::timestamp) at time zone 'Asia/Kolkata',
  'ends_at is the IST midnight of offer_date + 1 (half-open window)'
);

-- ── starts_at/ends_at are generated — cannot be written to directly ─────────

select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_date, starts_at) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹1/kg',
      public.today_ist() + 110, now()) $$,
  '428C9', null, 'starts_at is a generated column and cannot be written to directly'
);

-- ── one offer per product per day (closes 01-REVIEW WR-02) ──────────────────

select throws_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹99/kg',
      (select public.today_ist() + 107)) $$,
  '23505', null, 'a second offer for the same (product_id, offer_date) is rejected'
);
select lives_ok(
  $$ insert into public.offers (store_id, product_id, today_price_label, offer_date) values
    ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000010', '₹99/kg',
      (select public.today_ist() + 109)) $$,
  'the same product on a different day is accepted'
);

select * from finish();

rollback;
