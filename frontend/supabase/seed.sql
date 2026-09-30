-- Local-only seed data (D-14). MUST NEVER be pushed to any cloud/production project —
-- this file is referenced only by `supabase db reset` against the local Docker stack.
-- Seeds one demo shop ("Priya Stores") from the prototype's mock data
-- (product UI reference/app/App.tsx INITIAL_PRODUCTS / ORDERS), with fixed UUIDs so
-- every reset is byte-for-byte deterministic.

-- ── Demo vendor auth user ────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  '9876543210@phone.local',
  extensions.crypt('123456', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000001',
    'email', '9876543210@phone.local'
  ),
  'email',
  '00000000-0000-4000-8000-000000000001',
  now(),
  now(),
  now()
);

-- ── Store ─────────────────────────────────────────────────────────────────
insert into public.stores (
  id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open
) values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  '9876543210',
  'Priya Stores',
  'Priya',
  'priya-stores',
  array['Fruits', 'Vegetables', 'Grocery', 'Bakery & Confectionery'],
  true
);

-- ── Categories ────────────────────────────────────────────────────────────
insert into public.categories (id, store_id, name) values
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000002', 'Vegetables'),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'Fruits'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'Bakery'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000002', 'Groceries');

-- ── Products (INITIAL_PRODUCTS, verbatim from the prototype) ────────────────
-- img(id) => https://images.unsplash.com/photo-{id}?w=400&h=400&fit=crop&auto=format
insert into public.products (id, store_id, name, category_id, unit, image_url, available) values
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000002', 'Tomatoes',
    '00000000-0000-4000-8000-000000000010', 'kg',
    'https://images.unsplash.com/photo-1582284540020-8acbe03f4924?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000002', 'Bananas',
    '00000000-0000-4000-8000-000000000011', 'dozen',
    'https://images.unsplash.com/photo-1603036966599-dd8428837323?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000002', 'Cucumbers',
    '00000000-0000-4000-8000-000000000010', 'kg',
    'https://images.unsplash.com/photo-1568584711271-6c929fb49b60?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000002', 'Apples',
    '00000000-0000-4000-8000-000000000011', 'kg',
    'https://images.unsplash.com/photo-1619546813926-a78fa6372cd2?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000002', 'Sourdough Bread',
    '00000000-0000-4000-8000-000000000012', 'piece',
    'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000002', 'Eggs',
    '00000000-0000-4000-8000-000000000013', 'dozen',
    'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=400&h=400&fit=crop&auto=format', true),
  ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000002', 'Onions',
    '00000000-0000-4000-8000-000000000010', 'kg',
    'https://images.unsplash.com/photo-1605197378298-02bf0af1c896?w=400&h=400&fit=crop&auto=format', true);

-- ── Offer (not present in the prototype's static data; one seeded row) ──────
insert into public.offers (id, store_id, product_id, today_price_label, regular_price_label) values
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000020', '₹40/kg', '₹50/kg');

-- ── Orders (ORDERS, verbatim) ────────────────────────────────────────────────
-- "Bread" in the prototype's free-text items maps to the seeded Sourdough Bread product.
insert into public.orders (id, store_id, customer_name, customer_phone, note, is_new, created_at) values
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000002', 'Meera S.',
    '9000000001', null, true, (public.today_ist() + time '08:42:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000002', 'Ravi K.',
    '9000000002', null, true, (public.today_ist() + time '08:15:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000002', 'Anita P.',
    '9000000003', null, false, ((public.today_ist() - 1) + time '18:30:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000002', 'Sanjay M.',
    '9000000004', null, false, ((public.today_ist() - 1) + time '18:30:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000002', 'Lakshmi R.',
    '9000000005', null, false, ((public.today_ist() - 1) + time '18:30:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000002', 'Deepa R.',
    '9000000006', null, false, ((public.today_ist() - 1) + time '18:30:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000002', 'Suresh N.',
    '9000000007', null, false, ((public.today_ist() - 2) + time '17:00:00') at time zone 'Asia/Kolkata'),
  ('00000000-0000-4000-8000-000000000047', '00000000-0000-4000-8000-000000000002', 'Kavitha B.',
    '9000000008', null, false, ((public.today_ist() - 2) + time '17:00:00') at time zone 'Asia/Kolkata');

-- ── Order items (parsed from ORDERS[].items "Name ×N") ───────────────────────
insert into public.order_items (order_id, product_id, product_name, qty, price) values
  -- Meera S.: Tomatoes ×2, Onions ×1
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000020', 'Tomatoes', 2, null),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000026', 'Onions', 1, null),
  -- Ravi K.: Bananas ×3, Apples ×2
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000021', 'Bananas', 3, null),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000023', 'Apples', 2, null),
  -- Anita P.: Eggs ×12
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000025', 'Eggs', 12, null),
  -- Sanjay M.: Tomatoes ×1, Cucumbers ×2
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000020', 'Tomatoes', 1, null),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000022', 'Cucumbers', 2, null),
  -- Lakshmi R.: Bread ×2 (Sourdough Bread), Eggs ×6
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000024', 'Sourdough Bread', 2, null),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000025', 'Eggs', 6, null),
  -- Deepa R.: Apples ×4, Bananas ×1
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000023', 'Apples', 4, null),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000021', 'Bananas', 1, null),
  -- Suresh N.: Onions ×3, Tomatoes ×2
  ('00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000026', 'Onions', 3, null),
  ('00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000020', 'Tomatoes', 2, null),
  -- Kavitha B.: Bread ×1 (Sourdough Bread), Eggs ×6
  ('00000000-0000-4000-8000-000000000047', '00000000-0000-4000-8000-000000000024', 'Sourdough Bread', 1, null),
  ('00000000-0000-4000-8000-000000000047', '00000000-0000-4000-8000-000000000025', 'Eggs', 6, null);
