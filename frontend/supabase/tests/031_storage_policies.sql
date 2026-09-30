-- pgTAP: product-images bucket config + the storage.objects write-policy
-- matrix (PLAT-05, T-04-01..T-04-03). HTTP-level boundary/mime/anonymous-upload
-- and remove/overwrite-of-another-vendor's-object assertions live in
-- tests/db/storage.test.mjs (Task 3) — DELETE against storage.objects is
-- blocked locally by storage.protect_delete() regardless of caller role
-- ("Direct deletion from storage tables is not allowed. Use the Storage API
-- instead.", errcode 42501), so this file only exercises the cases direct SQL
-- permits: the bucket columns and INSERT.

begin;

select plan(7);

-- 1-3. bucket config
select is(
  (select public from storage.buckets where id = 'product-images'),
  true, 'product-images bucket is public'
);
select is(
  (select file_size_limit from storage.buckets where id = 'product-images'),
  2097152::bigint, 'product-images file_size_limit is 2097152'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'product-images'),
  array['image/jpeg'], 'product-images allowed_mime_types is {image/jpeg}'
);

-- ── Fixtures (as postgres) ────────────────────────────────────────────────────
select tests.create_supabase_user('vendor_storage_a', 'vendor_storage_a@test.local');
select tests.create_supabase_user('vendor_storage_b', 'vendor_storage_b@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('31000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_storage_a'),
    '9800000001', 'Storage Test Shop A', 'Vendor Storage A', 'storage-test-shop-a', array['Vegetables'], true),
  ('31000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_storage_b'),
    '9800000002', 'Storage Test Shop B', 'Vendor Storage B', 'storage-test-shop-b', array['Vegetables'], true);

-- ── As vendor A ──────────────────────────────────────────────────────────────
select tests.authenticate_as('vendor_storage_a');

-- 4. insert into own folder succeeds
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
    ('product-images', '31000000-0000-4000-8000-000000000001/a.jpg') $$,
  'A inserting into its own folder succeeds'
);

-- 5. insert into another store's folder fails 42501
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
    ('product-images', '31000000-0000-4000-8000-000000000002/a.jpg') $$,
  '42501', null, 'A inserting into B''s folder fails 42501'
);

-- 6. insert at the bucket root (no folder) fails 42501
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
    ('product-images', 'a.jpg') $$,
  '42501', null, 'A inserting at the bucket root fails 42501'
);

-- ── As anon ──────────────────────────────────────────────────────────────────
select tests.clear_authentication();

-- 7. any insert fails 42501 for anon (no anon policy on storage.objects)
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
    ('product-images', '31000000-0000-4000-8000-000000000001/anon.jpg') $$,
  '42501', null, 'anon inserting into any folder fails 42501'
);

select * from finish();

rollback;
