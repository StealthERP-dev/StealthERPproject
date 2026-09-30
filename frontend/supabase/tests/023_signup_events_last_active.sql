-- pgTAP: D-19 — shop_created and onboarding_completed both refresh
-- stores.last_active_at, the eight pre-existing meaningful-action names
-- (proven generally in 013) are unaffected, and a name still outside the
-- allow-list still leaves last_active_at unchanged. Fixtures are built as
-- postgres (bypasses RLS), the same pattern 013/021/022 already use, with
-- their own store id in a distinct id range (90000000-...) so this file
-- never collides with another test file's fixtures.

begin;

select plan(8);

-- ── Fixture (as postgres, bypasses RLS) ─────────────────────────────────────
select tests.create_supabase_user('vendor_signup_events', 'vendor_signup_events@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('90000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_signup_events'),
    '9800000901', 'Signup Events Shop', 'Vendor Signup Events', 'signup-events-shop', array['Vegetables'], true);

-- ── shop_created refreshes last_active_at (D-19) (2) ────────────────────────
select tests.authenticate_as_service_role();
update public.stores set last_active_at = null where id = '90000000-0000-4000-8000-000000000001';
select tests.clear_authentication();

select tests.authenticate_as('vendor_signup_events');
select lives_ok(
  $$ select public.log_event('shop_created') $$,
  'shop_created does not raise'
);
select tests.authenticate_as_service_role();
select isnt(
  (select last_active_at from public.stores where id = '90000000-0000-4000-8000-000000000001'),
  null,
  'shop_created refreshes the store''s last_active_at (D-19)'
);
select tests.clear_authentication();

-- ── onboarding_completed refreshes last_active_at (D-19) (2) ────────────────
select tests.authenticate_as_service_role();
update public.stores set last_active_at = null where id = '90000000-0000-4000-8000-000000000001';
select tests.clear_authentication();

select tests.authenticate_as('vendor_signup_events');
select lives_ok(
  $$ select public.log_event('onboarding_completed') $$,
  'onboarding_completed does not raise'
);
select tests.authenticate_as_service_role();
select isnt(
  (select last_active_at from public.stores where id = '90000000-0000-4000-8000-000000000001'),
  null,
  'onboarding_completed refreshes the store''s last_active_at (D-19)'
);
select tests.clear_authentication();

-- ── A name still outside the allow-list leaves last_active_at unchanged (2) ─
select tests.authenticate_as_service_role();
update public.stores set last_active_at = null where id = '90000000-0000-4000-8000-000000000001';
select tests.clear_authentication();

select tests.authenticate_as('vendor_signup_events');
select lives_ok(
  $$ select public.log_event('product_viewed') $$,
  'product_viewed does not raise'
);
select tests.authenticate_as_service_role();
select is(
  (select last_active_at from public.stores where id = '90000000-0000-4000-8000-000000000001'),
  null,
  'product_viewed (not in the allow-list) leaves last_active_at unchanged'
);
select tests.clear_authentication();

-- ── A representative pre-existing meaningful-action name still refreshes,
--    proving the eight pre-existing names are unaffected by this migration (2) ─
select tests.authenticate_as_service_role();
update public.stores set last_active_at = null where id = '90000000-0000-4000-8000-000000000001';
select tests.clear_authentication();

select tests.authenticate_as('vendor_signup_events');
select lives_ok(
  $$ select public.log_event('offer_created') $$,
  'offer_created (pre-existing name) does not raise'
);
select tests.authenticate_as_service_role();
select isnt(
  (select last_active_at from public.stores where id = '90000000-0000-4000-8000-000000000001'),
  null,
  'offer_created (pre-existing name) still refreshes last_active_at, unaffected by this migration'
);
select tests.clear_authentication();

select * from finish();

rollback;
